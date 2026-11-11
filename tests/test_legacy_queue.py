import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import unittest
import uuid
from unittest import mock

CORE = Path(__file__).resolve().parents[1] / 'coordinator' / 'coordinator.py'
spec = importlib.util.spec_from_file_location('coordinator', CORE)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = mock.patch.dict(os.environ, ADMIN_CLUSTER_ROOT=str(self.root/'coord'), ADMIN_WORKER_ROOT=str(self.root/'worker'), ADMIN_CLUSTER_BOOT='test-boot', ADMIN_CLUSTER_TEST_INLINE='1', ADMIN_CLUSTER_DISPATCH='1')
        self.env.start()
        c.ROOT = self.root/'coord'
        c.WORKER = self.root/'worker'
        c.initialize()
        self.arm()

    def arm(self, role='primary', generation=1, boot='test-boot'):
        c.atomic(c.ROOT/'authority.json', dict(role=role,generation=generation,armed_boot_id=boot))

    def tearDown(self):
        for p in (c.WORKER/'jobs').glob('*/state.json') if (c.WORKER/'jobs').exists() else []:
            state=json.loads(p.read_text())
            if state['state']=='running' and c.alive(state):
                os.kill(state['pid'], signal.SIGTERM)
        time.sleep(.05)
        for child in c.INLINE_CHILDREN:
            child.wait(timeout=5)
        c.INLINE_CHILDREN.clear()
        self.env.stop()
        self.temp.cleanup()

    def submit(self, kind='fixture-pass', **kw):
        job=uuid.uuid4().hex
        c.submit(dict(action='submit',id=job,kind=kind,**kw))
        return job

    def wait(self, job, state=None):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            result=c.status(job)
            if result['state'] in c.TERMINAL or result['state']==state:
                return result
            time.sleep(.03)
        self.fail('job did not reach expected state: '+str(result))

    def archive(self, entries=None, commit='a'*40):
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w') as tar:
            for name, value, kind in entries or [('site/package.json',b'{}',None),('site/package-lock.json',b'{}',None)]:
                info=tarfile.TarInfo(name)
                if kind:
                    info.type=kind
                    info.linkname='/etc/passwd'
                else:
                    info.size=len(value)
                tar.addfile(info,io.BytesIO(value) if not kind else None)
        raw=stream.getvalue()
        return dict(action='import-source',commit=commit,sha256=hashlib.sha256(raw).hexdigest(),archive_base64=base64.b64encode(raw).decode())

    def test_authority_boot_and_standby(self):
        for role,boot in [('standby','test-boot'),('suspended','test-boot'),('primary','previous-boot')]:
            self.arm(role=role,boot=boot)
            with self.assertRaises(PermissionError): self.submit()
        self.arm()
        self.assertEqual(c.authority()['effective_role'],'primary')

    def test_identity_and_fixed_commands(self):
        job=self.submit()
        self.assertTrue(c.submit(dict(id=job,kind='fixture-pass'))['existing'])
        with self.assertRaisesRegex(ValueError,'identity'): c.submit(dict(id=job,kind='fixture-fail'))
        for data in [dict(id=uuid.uuid4().hex,kind='shell'),dict(id=uuid.uuid4().hex,kind='fixture-pass',command='touch /tmp/no')]:
            with self.assertRaises(ValueError): c.submit(data)
        with self.assertRaises(ValueError): c.status('../bad')

    def test_import_and_explicit_commit(self):
        req=self.archive()
        self.assertFalse(c.import_source(req)['existing'])
        self.assertTrue(c.import_source(req)['existing'])
        job=self.submit('build',source_commit='a'*40)
        self.assertEqual(c.status(job)['source_commit'],'a'*40)
        with self.assertRaisesRegex(ValueError,'explicit_source'): self.submit('build')
        changed=self.archive([('different',b'x',None)])
        with self.assertRaisesRegex(ValueError,'checksum'): c.import_source(changed)

    def test_archive_rejects_paths_links_secrets_specials(self):
        for name,kind in [('../escape',None),('/absolute',None),('site/.env.local',None),('site/node_modules/a',None),('link',tarfile.SYMTYPE),('hard',tarfile.LNKTYPE),('fifo',tarfile.FIFOTYPE)]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                c.import_source(self.archive([(name,b'x',kind)]))
        self.assertFalse(list((c.ROOT/'sources').glob('.source-*')))
        req=self.archive();req['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'): c.import_source(req)

    def test_fixture_pass_and_failure(self):
        for kind,expected,code in [('fixture-pass','completed',0),('fixture-fail','failed',7)]:
            job=self.submit(kind)
            self.assertEqual(c.dispatch_once(),job)
            result=self.wait(job)
            self.assertEqual(result['state'],expected)
            self.assertEqual(result['exit_code'],code)
            self.assertIn('fixture-finished',c.rpc(dict(action='logs',id=job))['output'])
            self.assertTrue((c.WORKER/'jobs'/job/'execution.started').exists())
            replay=subprocess.run(['/usr/bin/python3',str(CORE),'run',job],capture_output=True,env=os.environ.copy())
            self.assertNotEqual(replay.returncode,0)
        self.assertIsNone(c.dispatch_once())

    def test_cancel_queued_and_running(self):
        queued=self.submit()
        self.assertEqual(c.cancel(queued)['state'],'canceled')
        running=self.submit(duration_seconds=5)
        c.dispatch_once()
        self.wait(running,'running')
        c.cancel(running)
        self.assertEqual(self.wait(running)['state'],'canceled')

    def test_worker_loss_never_replays(self):
        job=self.submit(duration_seconds=5)
        c.dispatch_once()
        self.wait(job,'running')
        runtime=c.read_runtime(job)
        os.kill(runtime['pid'],signal.SIGKILL)
        time.sleep(.1)
        # Reaped/zombie processes cannot be mistaken for running workers.
        result=self.wait(job)
        self.assertEqual(result['state'],'interrupted')
        self.assertIsNone(c.dispatch_once())

    def test_standby_queries_do_not_reconcile(self):
        job=self.submit()
        with c.connect() as db:
            db.execute("UPDATE jobs SET state='running',updated_at='2000-01-01T00:00:00+00:00' WHERE id=?",(job,))
        self.arm('standby')
        self.assertEqual(c.status(job)['state'],'running')
        self.assertEqual(c.rpc(dict(action='jobs'))['jobs'][0]['state'],'running')

    def test_dispatch_disabled_and_old_generation(self):
        job=self.submit()
        with mock.patch.dict(os.environ,ADMIN_CLUSTER_DISPATCH='0'):
            self.assertIsNone(c.dispatch_once())
        self.assertEqual(c.status(job)['state'],'queued')
        self.arm(generation=2)
        self.assertIsNone(c.dispatch_once())
        self.assertEqual(c.status(job)['state'],'interrupted')

    def test_standby_initialize_has_no_worker(self):
        old=c.WORKER
        c.WORKER=self.root/'absent-worker'
        try:
            with mock.patch.dict(os.environ,ADMIN_CLUSTER_DISPATCH='0'):
                c.initialize()
            self.assertFalse(c.WORKER.exists())
        finally:
            c.WORKER=old

    def test_rpc_client_disconnect_does_not_own_worker(self):
        job=uuid.uuid4().hex
        daemon=subprocess.Popen(['/usr/bin/python3',str(CORE),'daemon'],env=os.environ.copy(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            request=dict(action='submit',id=job,kind='fixture-pass',duration_seconds=1)
            client=subprocess.run(['/usr/bin/python3',str(CORE),'rpc'],input=json.dumps(request),text=True,capture_output=True,env=os.environ.copy(),check=True)
            self.assertTrue(json.loads(client.stdout)['ok'])
            self.assertIsNone(daemon.poll())
            self.assertEqual(self.wait(job)['state'],'completed')
        finally:
            daemon.terminate()
            daemon.communicate(timeout=5)

    def test_snapshot_online_consistent(self):
        self.submit()
        result=c.rpc(dict(action='snapshot'))
        path=Path(result['path'])/'queue.sqlite'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),result['sha256'])
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)

    def test_redaction_and_artifacts(self):
        value=c.sanitize('PASSWORD=abc Authorization: Bearer key https://name:pass@host DATABASE_URL=postgres://secret')
        for token in ['abc','Bearer key','name:pass','postgres://secret']:self.assertNotIn(token,value)
        folder=self.root/'example'
        dest=folder/'work'/'artifacts';dest.mkdir(parents=True)
        (dest/'a.txt').write_text('ok')
        exported=c.collect_artifacts(folder)[0]
        self.assertEqual(exported['bytes'],2)
        self.assertEqual(exported['path'],'artifacts/a.txt')
        copied=folder/exported['path']
        self.assertEqual(copied.read_bytes(),b'ok')
        self.assertEqual(exported['sha256'],hashlib.sha256(copied.read_bytes()).hexdigest())
        (dest/'a.txt').write_text('changed after export')
        self.assertEqual(copied.read_text(),'ok')

    def test_artifact_export_rejects_links_and_limits_without_partial_results(self):
        for kind in ['symlink','hardlink','limit']:
            with self.subTest(kind=kind):
                folder=self.root/kind
                dest=folder/'work'/'artifacts';dest.mkdir(parents=True)
                (dest/'good').write_bytes(b'abcdef')
                if kind=='symlink':(dest/'bad').symlink_to('/etc/passwd')
                elif kind=='hardlink':os.link(dest/'good',dest/'bad')
                with mock.patch.object(c,'MAX_ARTIFACTS',3 if kind=='limit' else 500*1024*1024):
                    with self.assertRaises((ValueError,OSError)):c.collect_artifacts(folder)
                self.assertFalse((folder/'artifacts').exists())
                self.assertFalse(list(folder.glob('.artifacts-*')))

    def test_artifact_export_nested_regular_files(self):
        folder=self.root/'nested'
        source=folder/'work'/'artifacts'/'reports';source.mkdir(parents=True)
        (source/'build.json').write_bytes(b'{"success":true}')
        manifest=c.collect_artifacts(folder)
        self.assertEqual(manifest[0]['path'],'artifacts/reports/build.json')
        path=folder/manifest[0]['path']
        self.assertTrue(path.is_file())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest[0]['sha256'])

if __name__=='__main__': unittest.main()
