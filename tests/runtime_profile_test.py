import contextlib
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
import coordinator as c
import runtime_profile as p

class RuntimeProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.h = self.root / "harness"; self.h.mkdir(mode=0o700)
        (self.h / "inputs").mkdir(mode=0o700); (self.h / "runs").mkdir(mode=0o700)
        pins = {}
        for name in p.PINS:
            f=self.h/name;f.write_bytes(("FIXTURE ONLY " + name).encode());pins[name]=hashlib.sha256(f.read_bytes()).hexdigest()
        manifest={"source_commit":p.SOURCE_COMMIT,"runtime_format":"next-start-v1","release_id":"r0000-portable-0a5f734-20261110","files":{str(i):{} for i in range(12043)}}
        m=self.h/'inputs/release-manifest.json';m.write_text(json.dumps(manifest))
        a=self.h/'inputs/runtime.tar';a.write_bytes(b"synthetic fixture; never application code")
        node=self.root/'node';node.write_bytes(b"fake node bytes; never executable")
        self.patch=mock.patch.multiple(p,ROOT=self.h,WORKER=self.root/'worker',NODE=node,PINS=pins,NODE_SHA=hashlib.sha256(node.read_bytes()).hexdigest(),ARCHIVE_SHA=hashlib.sha256(a.read_bytes()).hexdigest(),MANIFEST_SHA=hashlib.sha256(m.read_bytes()).hexdigest());self.patch.start()
        self.job='1'*32; (p.WORKER/'jobs'/self.job/'work').mkdir(parents=True)
    def tearDown(self): self.patch.stop();self.tmp.cleanup()
    def data(self,**extra): return dict(action='submit',id=self.job,kind=p.KIND,source_commit=p.SOURCE_COMMIT,**extra)
    def test_fixed_profile_rejects_shell_paths_timeout_and_wrong_commit(self):
        self.assertEqual(p.payload(self.data())['source_commit'],p.SOURCE_COMMIT)
        for extra in [{"command":"sh -c anything"},{"archive":"/tmp/x"},{"project_subdir":"site"},{"duration_seconds":999}]:
            with self.assertRaises(ValueError):p.payload(self.data(**extra))
        data=self.data();data['source_commit']='b'*40
        with self.assertRaises(ValueError):p.payload(data)
        with self.assertRaises(ValueError):p.argv('../escape')
    def test_separate_uids_admission_never_reads_worker_private_inputs(self):
        with mock.patch.object(p, 'validate_inputs', side_effect=PermissionError('worker UID997 directory0700 is not coordinator UID999 readable')) as read:
            admitted=p.payload(self.data());read.assert_not_called()
            self.assertEqual(admitted['runtime_sha256'],p.ARCHIVE_SHA)
        # The executing worker must still reject an inaccessible/mismatched private staging root.
        with mock.patch.object(p.os, 'getuid', return_value=os.getuid()+997), mock.patch.object(p.subprocess, 'Popen') as start:
            self.assertEqual(p.run(self.job),1);start.assert_not_called()
    def test_missing_worker_inputs_refused_without_child_after_admission(self):
        (self.h/'inputs/runtime.tar').unlink()
        self.assertEqual(p.payload(self.data())['kind'],p.KIND)
        with mock.patch.object(p.subprocess, 'Popen') as start:
            self.assertEqual(p.run(self.job),1);start.assert_not_called()
    def test_pin_tamper_rejected_before_any_child(self):
        (self.h/'smoke.py').write_text('changed')
        with mock.patch.object(p.subprocess,'Popen') as start:
            self.assertEqual(p.run(self.job),1);start.assert_not_called()
    def test_symlink_and_archive_digest_refused(self):
        (self.h/'inputs/runtime.tar').write_bytes(b'tamper')
        with self.assertRaises(ValueError):p.validate_inputs(full=True)
        node=p.NODE;node.unlink();node.symlink_to('/etc/hostname')
        with self.assertRaises(OSError):p.validate_inputs()
    def test_existing_queue_idempotence_and_no_import_source_required(self):
        with mock.patch.multiple(c,ROOT=self.root/'coord',WORKER=p.WORKER),mock.patch.dict(os.environ,ADMIN_CLUSTER_BOOT='fixture',ADMIN_CLUSTER_DISPATCH='1'):
            c.initialize();c.atomic(c.ROOT/'authority.json',dict(role='primary',generation=1,armed_boot_id='fixture'))
            first=c.submit(self.data());again=c.submit(self.data());self.assertFalse(first['existing']);self.assertTrue(again['existing'])
            self.assertFalse((c.ROOT/'sources'/p.SOURCE_COMMIT).exists())
            with c.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
            self.assertEqual(c.commands(p.payload(self.data()),self.job),[p.argv(self.job)])
            self.assertEqual(c.cancel(self.job)['state'],'canceled')
    def test_all_phases_success_and_technical_export_only(self):
        calls=[]
        owner=self
        class Fake:
            pid=999999
            def __init__(self,argv,**kwargs):
                calls.append(argv);owner.assertNotIn('shell',kwargs);owner.assertEqual(kwargs['env']['RUNTIME_SMOKE_NODE_SHA256'],p.NODE_SHA)
                http=p.ROOT/'runs'/(owner.job+'-http');guard=p.ROOT/'runs'/(owner.job+'-guard')
                if len(calls)==1:http.mkdir();(http/'runtime').mkdir();(http/'runtime/NEVER_EXPORT').write_text('fixture')
                if len(calls)==2:(guard/'result.json').write_text(json.dumps(dict(exit=0,observedDenials=11,guardInstalled=True,processGroupDrained=True,remainingProcesses=[])))
                if len(calls)==3:(http/'result.json').write_text(json.dumps(dict(exit=0,checks=[{}]*5,verifiedFiles=12043,guardInstalled=True,networkOrProcessDenials=0,sourceStable=True,processGroupDrained=True,remainingProcesses=[])))
            def wait(self,timeout=None):return 0
            def poll(self):return 0
        with mock.patch.object(p.subprocess,'Popen',Fake):self.assertEqual(p.run(self.job),0)
        self.assertEqual([Path(x[1]).name for x in calls],['safe_extract.py','probe.py','smoke.py'])
        artifacts=p.WORKER/'jobs'/self.job/'work/artifacts';self.assertTrue((artifacts/'runtime-profile-result.json').exists());self.assertFalse(any('NEVER_EXPORT' in str(x) for x in artifacts.rglob('*')))
        with mock.patch.object(p.subprocess,'Popen') as start:
            with self.assertRaises(FileExistsError):p.run(self.job)
            start.assert_not_called()
    def test_guard_fail_prevents_smoke(self):
        calls=[]
        class Fake:
            pid=999999
            def __init__(inner,argv,**kw):
                calls.append(argv)
                if len(calls)==1:(p.ROOT/'runs'/(self.job+'-http')).mkdir()
            def wait(inner,timeout=None):return 0 if len(calls)==1 else 9
            def poll(inner):return 0
        with mock.patch.object(p.subprocess,'Popen',Fake):self.assertEqual(p.run(self.job),1)
        self.assertEqual(len(calls),2)
    def test_sigterm_drains_real_fixture_child_without_application(self):
        ready=self.root/'fixture-ready';http=p.ROOT/'runs'/(self.job+'-http')
        code="import os,time;from pathlib import Path;Path(%r).write_text(str(os.getpid()));time.sleep(30)"%str(ready)
        with mock.patch.object(p,'phase_commands',return_value=[['/usr/bin/python3','-c',code]]):
            proc=multiprocessing.get_context('fork').Process(target=p.run,args=(self.job,));proc.start()
            try:
                deadline=time.monotonic()+5
                while not ready.exists() and time.monotonic()<deadline:time.sleep(.03)
                self.assertTrue(ready.exists());child=int(ready.read_text());os.kill(proc.pid,signal.SIGTERM);proc.join(5);self.assertFalse(proc.is_alive())
                with self.assertRaises(ProcessLookupError):os.kill(child,0)
                result=json.loads((p.WORKER/'jobs'/self.job/'work/artifacts/runtime-profile-result.json').read_text());self.assertEqual(result['exit'],1);self.assertIn('KeyboardInterrupt',result['error'])
            finally:
                if proc.is_alive():proc.kill();proc.join()
    def test_launcher_fixed_timeout_and_cgroup_contract(self):
        text=(Path(__file__).resolve().parents[1]/'infra/launch.py').read_text()
        for expected in ["('120' if profile else '7200')",'KillMode=control-group','TimeoutStopSec=15','CPUQuota=300%','MemoryMax=5G']:self.assertIn(expected,text)
        self.assertEqual(p.TIMEOUT_SECONDS,120)
        self.assertNotIn('shell=True',(Path(__file__).resolve().parents[1]/'core/runtime_profile.py').read_text())
if __name__=='__main__':unittest.main()
