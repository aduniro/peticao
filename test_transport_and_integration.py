import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import remote_contract as c
import transport
import rpc
import client_entry
from node_catalog import NodeCatalog
import test_runtime as fixtures

HERE=Path(__file__).parent
FACADE=HERE/'integration/facade3080'
sys.path.append(str(FACADE))
spec=importlib.util.spec_from_file_location('pinned_facade3080',FACADE/'rpc_facade.py')
facade=importlib.util.module_from_spec(spec);spec.loader.exec_module(facade)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.ctx=fixtures.RuntimeTests('test_full_rpc_child_stop_artifact_and_queue_success');self.ctx.setUp()
        ctx=self.ctx
        self.current={'role':'primary','generation':1,'armed_boot_id':'controller-boot-1','coordinator_host':'civo','authority_operation_id':'e'*32,'epoch_sha256':c.digest(ctx.floor)}
        ctx.authority.write_text(json.dumps(self.current))
        self.patches=[mock.patch.object(facade.authority_guard,'GUARD',ctx.guard),mock.patch.object(facade.authority_guard,'local_node',return_value='civo'),
                      mock.patch.object(facade.authority_guard,'boot_id',return_value='controller-boot-1')]
        for p in self.patches:p.start()
        nodes={}
        for worker in c.WORKERS:
            profiles={}
            for kind,d in ctx.profiles.items():
                ready=worker=='civo'
                profiles[kind]={'profile':kind,'qualified':ready,'profile_sha256':c.digest(d),
                                **{k:d[k] for k in ('source_sha256','dependencies_sha256','artifact_policy_sha256')},
                                'qualification_manifest_event':1 if ready else None,'qualification_evidence_sha256':'f'*64 if ready else None}
            nodes[worker]={'qualified':worker=='civo','profiles':profiles}
        self.catalog={'version':2,'nodes':nodes};self.path=ctx.root/'control/catalog.json';self.save()
        self.selector=NodeCatalog(self.path,c.private_file)
        self.facade=facade.Facade(ctx.queue,self.selector,lambda:dict(self.current),backend=ctx.backend)

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.ctx.tearDown()

    def save(self):self.path.write_text(json.dumps(self.catalog));self.path.chmod(0o600)

    def submit(self,job='b'*32,worker='civo'):
        return self.facade.rpc({'action':'submit','id':job,'kind':'fixture-pass','worker_id':worker})

    def test_public_submit_manifest_backend_child_and_public_status(self):
        self.submit();m=self.facade.manifest_for('b'*32);self.ctx.backend.dispatch(m,self.ctx.token)
        self.assertEqual(self.ctx.backend.finish(m)['state'],'completed')
        result=self.facade.rpc({'action':'status','id':'b'*32})
        self.assertEqual(result['state'],'completed');self.assertNotIn(self.ctx.token,c.canonical(result))

    def test_same_id_idempotent_changed_identity_rejected(self):
        self.assertFalse(self.submit()['existing']);self.assertTrue(self.submit()['existing'])
        with self.assertRaises(PermissionError):self.submit(worker='akamai')

    def test_unqualified_azure_and_free_command_never_admitted(self):
        with self.assertRaises(PermissionError):self.submit(worker='azure')
        with self.assertRaises(ValueError):self.facade.rpc({'action':'submit','id':'b'*32,'kind':'fixture-pass','worker_id':'civo','command':'sh'})

    def test_unrelated_node_update_does_not_change_selected_manifest(self):
        self.submit();before=self.facade.manifest_for('b'*32)
        self.catalog['nodes']['akamai']['qualified']=True
        self.save();self.assertEqual(self.facade.manifest_for('b'*32),before)

    def test_different_worker_profile_digests_remain_distinct(self):
        self.catalog['nodes']['akamai']['qualified']=True
        p=self.catalog['nodes']['akamai']['profiles']['fixture-pass'];p.update(qualified=True,qualification_manifest_event=2,qualification_evidence_sha256='e'*64,profile_sha256='9'*64)
        self.save();a,_=self.selector.select('fixture-pass','akamai');b,_=self.selector.select('fixture-pass','civo')
        self.assertNotEqual(a['profile_sha256'],b['profile_sha256'])

    def test_remote_logs_use_backend_and_never_local_fallback(self):
        self.submit();m=self.facade.manifest_for('b'*32);self.ctx.backend.dispatch(m,self.ctx.token)
        result=self.facade.rpc({'action':'logs','id':'b'*32,'offset':0})
        self.assertTrue(result['available']);self.assertLessEqual(len(result['output'].encode()),32768)

    def test_hot_journal_read_fails_without_recovering_or_changing_main(self):
        # Real process crash leaves a hot DELETE journal. The new read-only
        # connection must refuse required recovery, never perform it implicitly.
        code="import sqlite3,sys,os;c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA journal_mode=DELETE');c.execute('PRAGMA cache_size=1');c.execute('BEGIN IMMEDIATE');c.execute('UPDATE jobs SET payload=? WHERE id=?',('X'*4194304,'f'*32));os._exit(0)"
        subprocess.run([sys.executable,'-s','-E','-B','-c',code,str(self.ctx.queue)],check=True,timeout=10)
        journal=Path(str(self.ctx.queue)+'-journal');self.assertTrue(journal.exists())
        before=hashlib.sha256(self.ctx.queue.read_bytes()).hexdigest(),hashlib.sha256(journal.read_bytes()).hexdigest()
        with self.assertRaises(sqlite3.OperationalError):c.Claims(self.ctx.queue,self.ctx.claims.authority,self.ctx.profile_hashes)
        after=hashlib.sha256(self.ctx.queue.read_bytes()).hexdigest(),hashlib.sha256(journal.read_bytes()).hexdigest()
        self.assertEqual(before,after)


class TransportTests(unittest.TestCase):
    def test_unprivileged_entries_fail_before_loading_qualification_or_keys(self):
        with mock.patch.object(rpc.os,'geteuid',return_value=1000),mock.patch.object(Path,'lstat',side_effect=AssertionError('no privileged read')):
            with self.assertRaises(PermissionError):rpc.make_service()
        with mock.patch.object(client_entry.os,'geteuid',return_value=1000),mock.patch.object(sys,'argv',['client','civo']):
            with self.assertRaises(PermissionError):client_entry.main()

    def test_real_local_pipe_uses_stdin_not_argument(self):
        code="import json,sys;r=json.load(sys.stdin);print(json.dumps({'ok':True,'result':{'action':r['action'],'received_secret':bool(r.get('token'))}}))"
        argv=[sys.executable,'-s','-E','-B','-c',code]
        value=transport.exchange(argv,b'{"action":"start","token":"fixture_private_value"}',2)
        self.assertTrue(value['received_secret']);self.assertNotIn('fixture_private_value',' '.join(argv))

    def test_timeout_no_replay_and_only_child_terminated(self):
        start=time.monotonic()
        with self.assertRaises(TimeoutError):transport.exchange([sys.executable,'-c','import time;time.sleep(5)'],b'{}',.05)
        self.assertLess(time.monotonic()-start,2)

    def test_reply_budget_and_invalid_json_fail_closed(self):
        with mock.patch.object(transport,'MAX_REPLY',128):
            with self.assertRaises(ValueError):transport.exchange([sys.executable,'-c','print("X"*4096)'],b'{}',2)
        with self.assertRaises(ValueError):transport.exchange([sys.executable,'-c','print("not-json")'],b'{}',2)

    def test_unqualified_node_never_reads_key(self):
        with mock.patch.object(transport.contract,'private_file',side_effect=AssertionError('must not read key')):
            with self.assertRaises(PermissionError):transport.SSHTransport({'azure':{'qualified':False}}).argv('azure')

    def test_privileged_helper_fixed_node_no_free_arguments(self):
        with mock.patch.object(transport,'exchange',return_value={'fixture':True}) as exchange:
            self.assertTrue(transport.PrivilegedTransport().call('civo',{'action':'observe','id':'a'*32})['fixture'])
            argv=exchange.call_args[0][0]
            self.assertEqual(argv,['/usr/bin/sudo','-n','/usr/local/libexec/peticao-dev-worker-client','civo'])
            with self.assertRaises(ValueError):transport.PrivilegedTransport().call('$(cmd)',{})

    def test_ssh_argv_pinned_tailnet_root_command(self):
        with tempfile.TemporaryDirectory(prefix='transport-',dir=HERE) as d:
            root=Path(d);key=root/'key.fixture';key.write_text('not a real key');key.chmod(0o600)
            known=root/'known.fixture';known.write_text('fixture public host metadata');known.chmod(0o600)
            host,port=transport.HOSTS['akamai'];nodes={'akamai':{'qualified':True,'host':host,'port':port,'identity_file':str(key),
                'known_hosts_file':str(known),'known_hosts_sha256':hashlib.sha256(known.read_bytes()).hexdigest(),'host_key_alias':'['+host+']:'+str(port)}}
            with mock.patch.object(transport.contract,'root_control_file',side_effect=c.private_file):argv=transport.SSHTransport(nodes).argv('akamai')
            self.assertIn('StrictHostKeyChecking=yes',argv);self.assertIn('PasswordAuthentication=no',argv);self.assertEqual(argv[-1],transport.REMOTE_COMMAND)


if __name__=='__main__':unittest.main()
