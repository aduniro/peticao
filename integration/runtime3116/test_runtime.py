import base64
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import artifacts
import remote_contract as c
from admission import Admission
from controller import Backend,Finalizer
from worker import WorkerRPC
from systemd_adapter import SystemdAdapter
import log_redaction


class LocalAdapter:
    """Real fixture subprocess, synthetic unit/cgroup identity. NO systemd proof."""
    def __init__(self,root,boot):self.root=root;self.boot=boot;self.units={};self.starts=0;self.stops=0
    def preflight(self,m,d):
        if m['job_id'] in self.units or (self.root/m['job_id']).exists():raise PermissionError('preexisting fixture unit')
    def start(self,m,r,d):
        self.preflight(m,d);work=self.root/m['job_id'];work.mkdir(mode=0o700)
        p=subprocess.run([d['python_path'],'-s','-E','-B',d['program'],d['name']],cwd=work,capture_output=True,timeout=10,env={'PATH':'/usr/bin:/bin'})
        self.starts+=1
        self.units[m['job_id']]={'unit':r['unit'],'invocation_id':'d'*32,'worker_boot_id':self.boot,
            'manifest_sha256':c.digest(m),'receipt_sha256':c.digest(r),'main_pid':0,'cgroup_empty':True,
            'cgroup_path':'/system.slice/'+r['unit'],'exit_code':p.returncode,'exited':True}
        return dict(self.units[m['job_id']])
    def observe(self,m,r,d):return dict(self.units[m['job_id']]) if m['job_id'] in self.units else None
    def stop(self,m,r,d,b):
        value=self.units[m['job_id']]
        if value['invocation_id']!=b['invocation_id']:raise PermissionError('foreign fixture invocation')
        self.stops+=1;del self.units[m['job_id']]
        return {'unit':r['unit'],'invocation_id':value['invocation_id'],'worker_boot_id':self.boot,'main_pid':0,'cgroup_empty':True,'unit_stopped':True,'exit_code':value['exit_code']}
    def output_root(self,m,r,d):return self.root/m['job_id']


class LocalTransport:
    def __init__(self,worker):self.worker=worker;self.lose=None;self.calls=[]
    def call(self,node,request):
        self.calls.append(request['action']);result=self.worker.rpc(request)
        if request['action']==self.lose:self.lose=None;raise TimeoutError('fixture lost reply after remote action')
        return result


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='runtime-',dir=Path(__file__).parent);self.root=Path(self.tmp.name)
        for name in ('queue','control','journal','exports','worker-data','custody'):(self.root/name).mkdir(mode=0o700)
        self.floor={'generation':1,'primary_host':'civo','coordinator_boot_id':'controller-boot-1','operation_id':'e'*32}
        self.epoch=self.root/'control/epoch.json';self.epoch.write_text(json.dumps(self.floor));self.epoch.chmod(0o600)
        self.guard=c.EpochGuard(self.epoch,c.private_file)
        self.authority=self.root/'queue/authority.json';self.authority.write_text(json.dumps({'role':'primary','generation':1,'armed_boot_id':'controller-boot-1'}));self.authority.chmod(0o600)
        self.queue=self.root/'queue/queue.sqlite'
        with sqlite3.connect(self.queue) as db:
            db.executescript('CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT,digest TEXT,state TEXT,generation INTEGER,created_at TEXT,updated_at TEXT,started_at TEXT,finished_at TEXT,exit_code INTEGER,error TEXT);CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,job_id TEXT,kind TEXT,data TEXT);')
            db.execute("INSERT INTO jobs VALUES(?,'{}','legacy','completed',1,'old','old',NULL,'old',0,NULL)",('f'*32,))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES('old',?,'legacy','{}')",('f'*32,))
        self.queue.chmod(0o600)
        self.program=self.root/'fixture_job.py';self.program.write_bytes((Path(__file__).parent/'fixture_job.py').read_bytes());self.program.chmod(0o600)
        python=Path(sys.executable).resolve();python_sha=hashlib.sha256(python.read_bytes()).hexdigest();program_sha=hashlib.sha256(self.program.read_bytes()).hexdigest()
        self.profiles={}
        for name in ('fixture-pass','fixture-fail'):
            self.profiles[name]={'name':name,'program':str(self.program),'program_sha256':program_sha,'python_path':str(python),'python_sha256':python_sha,
                                 'source_sha256':program_sha,'dependencies_sha256':c.digest({'python':python_sha}),'artifact_policy_sha256':c.digest({'max':artifacts.MAX_BYTES,'protocol':1})}
        self.profile_hashes={k:c.digest(v) for k,v in self.profiles.items()}
        self.claims=c.Claims(self.queue,c.Authority(self.authority,lambda:'controller-boot-1',self.guard,'civo','e'*32),self.profile_hashes);self.claims.install_schema(1)
        journal_path=self.root/'journal/receipts.sqlite';c.WorkerJournal.initialize(journal_path,'civo',1)
        self.journal=c.WorkerJournal(journal_path,'civo',1,lambda:'worker-boot-1',self.profile_hashes,self.guard);WorkerRPC.install_schema(self.journal)
        self.admission_root=self.root/'journal'
        (self.admission_root/'admission.lock').write_bytes(b'');(self.admission_root/'admission.lock').chmod(0o600)
        (self.admission_root/'admission.json').write_text(json.dumps({'enabled':True,'epoch_sha256':c.digest(self.floor)}));(self.admission_root/'admission.json').chmod(0o600)
        self.admission=Admission(self.admission_root,c.private_file)
        self.adapter=LocalAdapter(self.root/'worker-data','worker-boot-1')
        self.worker=WorkerRPC(self.journal,self.adapter,self.profiles,self.root/'exports',self.admission,c.private_file)
        self.transport=LocalTransport(self.worker);self.store=artifacts.ArtifactStore(self.root/'custody');self.finalizer=Finalizer(self.claims,self.store)
        self.backend=Backend(self.claims,self.transport,self.finalizer);self.token='a'*64;self.manifest=self.new_job('a'*32)

    def tearDown(self):self.tmp.cleanup()

    def new_job(self,job,name='fixture-pass'):
        payload={'backend':c.BACKEND,'kind':name};d=self.profiles[name]
        with sqlite3.connect(self.queue) as db:db.execute("INSERT INTO jobs VALUES(?,?,?,'queued',1,'now','now',NULL,NULL,NULL,NULL)",(job,c.canonical(payload),c.digest(payload)))
        return {'backend':c.BACKEND,'job_id':job,'generation':1,'worker_id':'civo','profile':name,'profile_sha256':c.digest(d),
                'source_sha256':d['source_sha256'],'dependencies_sha256':d['dependencies_sha256'],'artifact_policy_sha256':d['artifact_policy_sha256'],'payload_sha256':c.digest(payload),
                'coordinator_host':'civo','coordinator_boot_id':'controller-boot-1','authority_operation_id':'e'*32,'epoch_sha256':c.digest(self.floor)}

    def state(self,job=None):
        with sqlite3.connect(self.queue) as db:return db.execute('SELECT state FROM jobs WHERE id=?',(job or self.manifest['job_id'],)).fetchone()[0]

    def test_full_rpc_child_stop_artifact_and_queue_success(self):
        self.backend.dispatch(self.manifest,self.token);self.assertEqual(self.state(),'running')
        result=self.backend.finish(self.manifest);self.assertEqual(result['state'],'completed');self.assertEqual(self.adapter.starts,1);self.assertEqual(self.adapter.stops,1)
        self.assertEqual(self.state(),'completed');self.assertTrue(result['changed'])
        self.assertEqual(self.backend.finish(self.manifest)['changed'],False)

    def test_failure_exit_and_missing_result_are_never_success(self):
        for job,name,delete in [('b'*32,'fixture-fail',False),('c'*32,'fixture-pass',True)]:
            m=self.new_job(job,name);self.backend.dispatch(m,self.token)
            if delete:(self.root/'worker-data'/job/'result.json').unlink()
            result=self.backend.finish(m);self.assertEqual(result['state'],'failed')

    def test_duplicate_dispatch_does_not_retry_transport(self):
        self.backend.dispatch(self.manifest,self.token);before=len(self.transport.calls)
        with self.assertRaises(RuntimeError):self.backend.dispatch(self.manifest,self.token)
        self.assertEqual(len(self.transport.calls),before);self.assertEqual(self.adapter.starts,1)

    def test_lost_reply_after_actual_child_observe_and_finish_same_id(self):
        self.transport.lose='start'
        with self.assertRaises(TimeoutError):self.backend.dispatch(self.manifest,self.token)
        self.assertEqual(self.adapter.starts,1);self.assertEqual(self.state(),'starting')
        self.backend.observe(self.manifest);self.assertEqual(self.state(),'running')
        self.assertEqual(self.backend.finish(self.manifest)['state'],'completed');self.assertEqual(self.adapter.starts,1)

    def test_lost_finalize_reply_reuses_sealed_bundle_without_reexecution(self):
        self.backend.dispatch(self.manifest,self.token);self.transport.lose='finalize'
        with self.assertRaises(TimeoutError):self.backend.finish(self.manifest)
        self.assertEqual(self.state(),'running');self.assertEqual(self.backend.finish(self.manifest)['state'],'completed')
        self.assertEqual((self.adapter.starts,self.adapter.stops),(1,1))

    def test_cancel_before_start_idempotent_no_process(self):
        self.claims.reserve(self.manifest,self.token)
        receipt=self.worker.rpc({'action':'prepare','manifest':self.manifest,'token_sha256':hashlib.sha256(self.token.encode()).hexdigest()})
        self.claims.bind(self.manifest,receipt)
        self.assertEqual(self.backend.finish(self.manifest,cancel=True)['state'],'canceled');self.assertEqual(self.adapter.starts,0)
        self.assertEqual(self.backend.finish(self.manifest,cancel=True)['state'],'canceled')

    def test_cancel_stops_only_bound_unit_and_custody_records_canceled(self):
        self.backend.dispatch(self.manifest,self.token)
        self.assertEqual(self.backend.finish(self.manifest,cancel=True)['state'],'canceled');self.assertEqual(self.adapter.stops,1)

    def test_late_cancel_preserves_already_sealed_success(self):
        self.backend.dispatch(self.manifest,self.token);self.worker.rpc({'action':'finalize','id':self.manifest['job_id']})
        self.assertEqual(self.backend.finish(self.manifest,cancel=True)['state'],'completed')
        self.assertEqual((self.adapter.starts,self.adapter.stops),(1,1))

    def test_foreign_invocation_not_stopped_or_finalized(self):
        self.backend.dispatch(self.manifest,self.token);self.adapter.units[self.manifest['job_id']]['invocation_id']='b'*32
        with self.assertRaises(PermissionError):self.backend.finish(self.manifest)
        self.assertEqual(self.adapter.stops,0);self.assertEqual(self.state(),'running')

    def test_live_cgroup_cannot_finish(self):
        self.backend.dispatch(self.manifest,self.token);self.adapter.units[self.manifest['job_id']].update(main_pid=999,cgroup_empty=False,exited=False,exit_code=None)
        with self.assertRaises(RuntimeError):self.backend.finish(self.manifest)
        self.assertEqual(self.adapter.stops,0);self.assertEqual(self.state(),'running')

    def test_artifact_link_after_stop_rejected_without_completion(self):
        self.backend.dispatch(self.manifest,self.token)
        (self.root/'worker-data'/self.manifest['job_id']/'artifacts/link').symlink_to(self.authority)
        with self.assertRaises((ValueError,OSError)):self.backend.finish(self.manifest)
        self.assertEqual(self.state(),'running')

    def test_damaged_received_custody_blocks_terminal_update(self):
        self.backend.dispatch(self.manifest,self.token);self.worker.rpc({'action':'finalize','id':self.manifest['job_id']})
        row,_=self.worker.stored(self.manifest['job_id']);receipt=json.loads(row['receipt_json']);wire=self.worker.bundle(self.manifest['job_id']);payload=base64.b64decode(wire['bundle_base64'])
        result=json.loads(self.worker.stored(self.manifest['job_id'])[1]['finalized_result']);self.store.receive(payload,result['identity'])
        (self.root/'custody'/self.manifest['job_id']/'artifacts/fixture.txt').write_text('tamper')
        with self.assertRaises(ValueError):self.finalizer.accept_result(self.manifest,receipt,payload)
        self.assertEqual(self.state(),'running')

    def test_guard_revoked_blocks_new_mutation(self):
        self.epoch.write_text(json.dumps({**self.floor,'operation_id':'b'*32}))
        with self.assertRaises(PermissionError):self.backend.dispatch(self.manifest,self.token)
        self.assertEqual(self.adapter.starts,0)

    def test_closed_admission_prevents_prepare_and_remains_closed_after_fence(self):
        with self.admission.closed_for_fencing():
            with self.assertRaises(RuntimeError):self.worker.rpc({'action':'prepare','manifest':self.manifest,'token_sha256':'f'*64})
        with self.assertRaises(PermissionError):self.worker.rpc({'action':'prepare','manifest':self.manifest,'token_sha256':'f'*64})
        self.assertEqual(self.adapter.starts,0)

    def test_admission_shared_mutation_prevents_fencing_exclusive(self):
        with self.admission.mutation(self.manifest):
            with self.assertRaises(RuntimeError):
                with self.admission.closed_for_fencing():self.fail('must not fence while request active')
        self.assertTrue(json.loads((self.admission_root/'admission.json').read_text())['enabled'])

    def test_perjob_mutex_serializes_mutating_requests(self):
        with self.worker.job_lock(self.manifest['job_id']):
            with self.assertRaises(RuntimeError):self.worker.rpc({'action':'prepare','manifest':self.manifest,'token_sha256':'f'*64})

    def test_worker_reboot_only_observes_reconciliation_required(self):
        self.backend.dispatch(self.manifest,self.token);self.journal.boot_id=lambda:'other-boot'
        response=self.worker.rpc({'action':'observe','id':self.manifest['job_id']});self.assertTrue(response['reconciliation_required'])
        with self.assertRaises(PermissionError):self.worker.rpc({'action':'finalize','id':self.manifest['job_id']})

    def test_unknown_fields_and_free_commands_rejected(self):
        for field in ('argv','command','env','database_url'):
            with self.assertRaises(ValueError):self.worker.rpc({'action':'prepare','manifest':self.manifest,'token_sha256':'b'*64,field:'ignored'})
        self.assertEqual(self.adapter.starts,0)

    def test_program_or_python_pin_change_blocks(self):
        self.program.write_text('altered')
        with self.assertRaises(PermissionError):self.backend.dispatch(self.manifest,self.token)
        self.assertEqual(self.adapter.starts,0)

    def test_known_tokens_never_returned_at_arbitrary_log_offsets(self):
        self.backend.dispatch(self.manifest,self.token);path=self.root/'worker-data'/self.manifest['job_id']/'output.log'
        raw=b'prefix TOKEN=fixture_secret_value\nAuthorization: Bearer fixture_bearer\n';path.write_bytes(raw)
        for offset in range(len(raw)):
            response=self.backend.logs(self.manifest,offset)
            self.assertNotIn('fixture_secret_value',response['output']);self.assertNotIn('fixture_bearer',response['output'])
        self.assertEqual(self.backend.logs(self.manifest,13)['output'][:5],'*****')

    def test_log_slicing_preserves_offsets_and_long_line_is_bounded(self):
        raw=b'X'*32760+b' TOKEN=fixture_value_after_boundary\n'+b'Y'*100
        started=time.monotonic();value=log_redaction.slice_log(raw,32768)
        self.assertNotIn('fixture_value_after_boundary',value['output']);self.assertLess(time.monotonic()-started,2)
        self.assertEqual(value['offset'],len(raw))

    def test_private_token_not_in_public_worker_result_or_final_custody(self):
        response=self.backend.dispatch(self.manifest,self.token);self.backend.finish(self.manifest)
        self.assertNotIn(self.token,c.canonical(response));self.assertNotIn(self.token,(self.root/'custody'/self.manifest['job_id']/'result.json').read_text())

    def test_legacy_terminal_row_and_event_preserved(self):
        with sqlite3.connect(self.queue) as db:before=db.execute("SELECT * FROM jobs WHERE id=?",('f'*32,)).fetchall(),db.execute("SELECT * FROM events WHERE kind='legacy'").fetchall()
        self.backend.dispatch(self.manifest,self.token);self.backend.finish(self.manifest)
        with sqlite3.connect(self.queue) as db:after=db.execute("SELECT * FROM jobs WHERE id=?",('f'*32,)).fetchall(),db.execute("SELECT * FROM events WHERE kind='legacy'").fetchall()
        self.assertEqual(before,after)

    def test_systemd_argv_fixed_properties_no_secret_and_no_free_command(self):
        self.claims.reserve(self.manifest,self.token);receipt=self.journal.prepare(self.manifest,hashlib.sha256(self.token.encode()).hexdigest())
        argv=SystemdAdapter().unit_argv(self.manifest,receipt,self.profiles['fixture-pass'])
        for expected in ('--property=DynamicUser=yes','--property=PrivateNetwork=yes','--property=ProtectSystem=strict','--property=CapabilityBoundingSet=','--property=KillMode=control-group','--property=ProtectHome=tmpfs'):
            self.assertIn(expected,argv)
        self.assertNotIn(self.token,' '.join(argv));self.assertIn('/usr/bin/env',argv);self.assertIn('-i',argv)


if __name__=='__main__':unittest.main()
