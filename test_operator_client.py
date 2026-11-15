"""Local client/filesystem and simulated canonical ledger; no SSH or host I/O.

Load the exact pure contract from its preserved Git blob, never the changing
helper worktree. This client is not deployable until composed into SourceA.
"""
import ast
import hashlib
import io
import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

import qualification_contract as q
import qualification_client as client
import review_gate as gate

HERE = Path(__file__).parent


def operation():
    return {'version':1,'operation_id':'a'*32,
            'jobs':{'success':'1'*32,'failure':'2'*32,'cancellation':'3'*32},'prestart_job_id':'4'*32,
            'runtime_commit':gate.RUNTIME_COMMIT,'broker_commit':gate.BROKER_COMMIT,
            'runtime_sha256':{n:'b'*64 for n in q.RUNTIME},
            'broker_sha256':{n:'c'*64 for n in q.BROKER},
            'harness_sha256':{n:'d'*64 for n in q.HARNESS},
            'execute':True,'systemd_major':255,'systemd_version_sha256':'e'*64}


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='client-fixture-',dir=HERE)
        self.root = Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()

    def test_default_guard_denies_before_subprocess_or_pin_read(self):
        with mock.patch.object(client.subprocess,'run') as ssh,mock.patch.object(Path,'read_bytes',side_effect=AssertionError('file read before guard')):
            with self.assertRaises(PermissionError):client.PinnedSSH().call('observe')
            ssh.assert_not_called()

    def test_fixed_transport_has_no_mux_and_pinned_host_alias(self):
        args=client.PinnedSSH().argv()
        self.assertIn('StrictHostKeyChecking=yes',args);self.assertIn('ControlPath=none',args)
        self.assertIn('HostKeyAlias=212.2.241.70',args);self.assertIn('root@100.122.224.82',args)
        self.assertNotIn('-A',args)

    def test_exclusive_mutation_intent_survives_lost_reply_no_reinvoke(self):
        transport=mock.Mock();transport.call.side_effect=TimeoutError('lost response')
        c=client.Client(self.root,transport)
        with self.assertRaises(TimeoutError):c.phase('start')
        with self.assertRaises(FileExistsError):c.phase('start')
        transport.call.assert_called_once()
        self.assertEqual((self.root/'start-intent.json').stat().st_mode&0o777,0o600)

    def test_observe_repeat_has_no_mutation_intent(self):
        transport=mock.Mock();transport.call.return_value={'state':'IN_PROGRESS_OR_UNCERTAIN'}
        c=client.Client(self.root,transport)
        c.phase('observe');c.phase('observe')
        self.assertEqual(transport.call.call_count,2);self.assertEqual(list(self.root.iterdir()),[])

    def test_local_symlink_or_permissive_state_refused(self):
        path=self.root/'state';path.mkdir(mode=0o700);link=self.root/'link';link.symlink_to(path)
        with self.assertRaises(PermissionError):client.Client(link)
        path.chmod(0o755)
        with self.assertRaises(PermissionError):client.Client(path)

    def test_scope_change_blocks_network(self):
        first={'qualification_operation':operation(),'capability':{'fence':1}}
        second={**first,'capability':{'fence':2}}
        guard=mock.Mock(side_effect=[first,second])
        with mock.patch.object(client.subprocess,'run') as ssh:
            with self.assertRaises(PermissionError):client.PinnedSSH(guard).call('observe')
            ssh.assert_not_called()

    def test_changed_host_pin_blocks_network(self):
        grant={'qualification_operation':operation(),'capability':{'fence':1}}
        with mock.patch.object(Path,'read_bytes',return_value=b'wrong host key'),mock.patch.object(client.subprocess,'run') as ssh:
            with self.assertRaises(PermissionError):client.PinnedSSH(lambda p:grant).call('observe')
            ssh.assert_not_called()

    def test_remote_error_never_echoes_stderr_and_no_retry(self):
        grant={'qualification_operation':operation(),'capability':{'fence':1}}
        digest=mock.Mock();digest.hexdigest.return_value=client.KNOWN_HOSTS_SHA256
        r=mock.Mock(returncode=1,stdout=b'',stderr=b'synthetic private token not to report')
        with mock.patch.object(Path,'read_bytes',return_value=b'pin'),mock.patch.object(client.hashlib,'sha256',return_value=digest),mock.patch.object(client.subprocess,'run',return_value=r) as ssh:
            with self.assertRaisesRegex(RuntimeError,'^remote_phase_uncertain_preserve_observe_only$'):client.PinnedSSH(lambda p:grant).call('observe')
            ssh.assert_called_once()

    def test_package_exact_sets_hashes_and_public_request_only(self):
        request=operation()
        for field,prefix in [('runtime_sha256','runtime'),('broker_sha256','broker'),('harness_sha256','')]:
            d=self.root/prefix;d.mkdir(exist_ok=True)
            for name in request[field]:
                raw=('# synthetic '+name+'\n').encode();(d/name).write_bytes(raw)
                request[field][name]=hashlib.sha256(raw).hexdigest()
        raw=client.package(request,self.root);value=json.loads(raw)
        self.assertEqual(set(value),q.RUNTIME|q.BROKER|q.HARNESS|{'RUN-REQUEST.json','readonly-marker'})
        self.assertEqual(len(value),25)
        self.assertEqual(json.loads(value['RUN-REQUEST.json']['text']),request)
        (self.root/'runtime'/'worker.py').write_text('changed')
        with self.assertRaises(PermissionError):client.package(request,self.root)

    def test_installer_fixed_names_and_no_private_credential_or_free_path(self):
        ast.parse(client.INSTALLER)
        self.assertIn("base/'peticao-dev-short-alias-native-20261115-attempt1'",client.INSTALLER)
        self.assertNotIn('shutil.rmtree',client.INSTALLER);self.assertNotIn('extractall',client.INSTALLER)
        self.assertNotIn('PRIVATE',client.INSTALLER);self.assertNotIn('IDENTITY',client.INSTALLER)

    def test_actual_helper_A_aggregate_shapes_and_negative_global_flags(self):
        cases=[{'state':'PREFLIGHT_A_PASS','scope':'isolated-short-alias','global_qualified':False},
               {'state':'BOOTSTRAPPED_A_CLOSED','job_count':4,'global_qualified':False},
               {'state':'STARTED_A','no_replay':True},
               {'state':'NATIVE_SHORT_ALIAS_PASS','scope':'isolated-short-alias','jobs':3,'prestart_no_unit':True,'global_qualified':False},
               {'state':'UNCERTAIN_PENDING_PROCESS_RECEIPT','pending_intents':['server-1'],'no_replay':True,'global_qualified':False},
               {'state':'OWN_A_RETAINED_VERIFIED','evidence_deleted':False}]
        for value in cases:self.assertEqual(client.aggregate_reply(value),value)
        with self.assertRaises(PermissionError):client.aggregate_reply({**cases[0],'global_qualified':True})
        with self.assertRaises(PermissionError):client.aggregate_reply({**cases[0],'scope':'global-B'})
        with self.assertRaises(ValueError):client.aggregate_reply({**cases[0],'raw_log':'not allowed'})

    def payload(self):
        value={}
        for name in q.RUNTIME|q.BROKER|q.HARNESS|{'RUN-REQUEST.json','readonly-marker'}:
            text='synthetic public content '+name+'\n'
            value[name]={'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()}
        return value

    def run_installer(self, payload=None, fail_runtime=False):
        """Execute the actual installer with real I/O under a project fixture.

        Only absolute roots, UID/host and ancestor ownership are modeled. mkdir,
        O_EXCL, writes, file/directory fsync, modes and partial state are REAL.
        """
        opt=self.root/'opt'
        if not opt.exists():opt.mkdir(mode=0o755)
        private=self.root/'private-attempt';socket_parent=self.root/'socket-attempt'
        concrete=type(self.root);original_lstat=concrete.lstat;original_open=os.open;original_sync=os.fsync
        self.sync_paths=[]
        def path_factory(*args):
            replacements={'/opt':opt,str(client.PRIVATE):private,str(q.SOCKET_PARENT):socket_parent}
            if len(args)==1 and str(args[0])in replacements:return replacements[str(args[0])]
            return concrete(*args)
        def root_metadata(path,*a,**kw):
            i=original_lstat(path,*a,**kw)
            return types.SimpleNamespace(st_uid=0,st_mode=i.st_mode&~0o022)
        def open_file(path,*a,**kw):
            p=concrete(path)
            if fail_runtime and p.parent.name=='runtime' and p.name=='worker.py':
                raise OSError('synthetic power loss before public code complete')
            return original_open(path,*a,**kw)
        def sync_file(fd):
            self.sync_paths.append(os.readlink('/proc/self/fd/'+str(fd)))
            return original_sync(fd)
        stdin=types.SimpleNamespace(buffer=io.BytesIO(q.canonical(self.payload() if payload is None else payload).encode()))
        output=io.StringIO()
        with mock.patch('pathlib.Path',side_effect=path_factory),mock.patch.object(concrete,'lstat',root_metadata),mock.patch.object(os,'geteuid',return_value=0),mock.patch('socket.gethostname',return_value='peticao-civo'),mock.patch.object(sys,'stdin',stdin),mock.patch.object(os,'open',side_effect=open_file),mock.patch.object(os,'fsync',side_effect=sync_file),contextlib.redirect_stdout(output):
            exec(compile(client.INSTALLER,'fixed-installer','exec'),{'__name__':'fixed_installer_test'})
        return json.loads(output.getvalue())

    def test_actual_installer_writes_expected23_file_tree_and_modes(self):
        value=self.payload();self.assertEqual(self.run_installer(value),{'state':'PUBLIC_PACKAGE_INSTALLED','file_count':25})
        public=self.root/'opt'/client.PUBLIC.name
        self.assertEqual({p.name for p in (public/'runtime').iterdir()},q.RUNTIME)
        self.assertEqual({p.name for p in (public/'broker').iterdir()},q.BROKER)
        self.assertEqual({p.name for p in public.iterdir()},q.HARNESS|{'runtime','broker','RUN-REQUEST.json','readonly-marker'})
        for name,item in value.items():
            prefix='runtime' if name in q.RUNTIME else 'broker' if name in q.BROKER else ''
            path=public/prefix/name
            self.assertEqual(path.read_text(),item['text']);self.assertEqual(path.stat().st_mode&0o777,0o644)
        for directory in [public,public/'runtime',public/'broker']:
            self.assertEqual(directory.stat().st_mode&0o777,0o755)
        intent=self.root/'opt'/client.INSTALL_INTENT.name
        self.assertTrue(intent.exists());self.assertEqual(intent.stat().st_mode&0o777,0o600)
        self.assertEqual(self.sync_paths[:2],[str(intent),str(self.root/'opt')])
        self.assertEqual(self.sync_paths[-4:],[str(public/'runtime'),str(public/'broker'),str(public),str(self.root/'opt')])
        with self.assertRaises(PermissionError):self.run_installer(value)

    def test_actual_installer_partial_files_burn_remote_intent_no_reinstall(self):
        with self.assertRaises(OSError):self.run_installer(fail_runtime=True)
        intent=self.root/'opt'/client.INSTALL_INTENT.name
        saved=intent.read_bytes();self.assertTrue((self.root/'opt'/client.PUBLIC.name).exists())
        with self.assertRaises(PermissionError):self.run_installer()
        self.assertEqual(intent.read_bytes(),saved)

    def test_actual_installer_refuses_private_attempt_before_any_public_write(self):
        (self.root/'private-attempt').mkdir(mode=0o700)
        with self.assertRaises(PermissionError):self.run_installer()
        self.assertFalse((self.root/'opt'/client.PUBLIC.name).exists())
        self.assertFalse((self.root/'opt'/client.INSTALL_INTENT.name).exists())

    def test_actual_installer_refuses_socket_attempt_before_any_public_write(self):
        (self.root/'socket-attempt').mkdir(mode=0o700)
        with self.assertRaises(PermissionError):self.run_installer()
        self.assertFalse((self.root/'opt'/client.PUBLIC.name).exists())
        self.assertFalse((self.root/'opt'/client.INSTALL_INTENT.name).exists())

    def test_actual_installer_digest_failure_precedes_intent_creation(self):
        data=self.payload();data['worker.py']['sha256']='0'*64
        with self.assertRaises(ValueError):self.run_installer(data)
        self.assertFalse((self.root/'opt'/client.PUBLIC.name).exists())
        self.assertFalse((self.root/'opt'/client.INSTALL_INTENT.name).exists())

    def test_ledger_timeout_or_os_failure_cannot_print_private_capability(self):
        args=['check','--token','SYNTHETIC-PRIVATE-CAPABILITY']
        for error in (subprocess.TimeoutExpired(['python',*args],30),OSError('SYNTHETIC-PRIVATE-CAPABILITY')):
            with self.subTest(error=type(error).__name__),mock.patch.object(gate.subprocess,'run',side_effect=error):
                with self.assertRaises(PermissionError) as result:gate.central(args)
                self.assertEqual(str(result.exception),'canonical_ledger_unavailable_no_authority')
                self.assertTrue(result.exception.__suppress_context__)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='client-fixture-',dir=HERE);self.root=Path(self.tmp.name)
        self.request=operation();self.head='f'*40
        self.hashes={}
        for field,prefix in [('runtime_sha256','runtime/'),('broker_sha256','broker/'),('harness_sha256','')]:
            self.hashes.update({prefix+k:v for k,v in self.request[field].items()})
        self.template_raw=q.canonical({**self.request,'execute':False})
        self.hashes['OPERATION.template.json']=hashlib.sha256(self.template_raw.encode()).hexdigest()
        self.source=6000;self.event=6003;self.acquired=6005
        def notice(seq,actor,data,resources=[]):return {'seq':seq,'kind':'notice','actor':actor,'data':data,'resources':resources}
        self.data={'manifest':{'commit':self.head},'file_sha256':dict(self.hashes),'operation':'test',
                   'preparation_only':False,'production_access':False,'queue_cutover':False,'operator_session':gate.SESSION,
                   'root_window_event':6001,'source_notice':self.source,'runtime_notice':gate.RUNTIME_NOTICE,'broker_notice':gate.BROKER_NOTICE,
                   'qualification_operation':self.request,'install_intent_path':gate.INSTALL_INTENT}
        self.events=[
            notice(gate.RUNTIME_NOTICE,'admin-recuperacao',{'manifest':{'commit':gate.RUNTIME_COMMIT},'file_sha256':dict(self.request['runtime_sha256'])}),
            {'seq':3183,'kind':'ack','actor':'apoio','data':{'event_seq':gate.RUNTIME_NOTICE}},
            notice(gate.BROKER_NOTICE,'admin-recuperacao',{'manifest':{'commit':gate.BROKER_COMMIT},'file_sha256':dict(self.request['broker_sha256'])}),
            {'seq':3242,'kind':'ack','actor':'apoio','data':{'event_seq':gate.BROKER_NOTICE}},
            notice(self.source,'admin-recuperacao',{'preparation_only':True,'manifest':{'commit':self.head},'file_sha256':dict(self.hashes)}),
            notice(6001,'admin-recuperacao',dict(root_thread='01a1cad7-4a65-7d43-b8c2-f0b50a90a580',operator_session=gate.SESSION,resource=gate.RESOURCE,operation_id=self.request['operation_id'],source_notice=self.source,scope='isolated-short-alias-test',production_access=False,queue_cutover=False,opens_at=time.time()-1,closes_at=time.time()+1700)),
            {'seq':6002,'kind':'ack','actor':'apoio','data':{'event_seq':self.source}},
            notice(self.event,'admin-recuperacao',self.data,[gate.RESOURCE]),
            {'seq':6004,'kind':'ack','actor':'apoio','data':{'event_seq':self.event}},
            {'seq':self.acquired,'kind':'lease_acquired','actor':'admin-recuperacao','data':{'manifest_event':self.event,'lease':'fixture-own-lease'}}]
        self.lease={'id':'fixture-own-lease','actor':'admin-recuperacao','operation':'test','state':'active',
                    'resources':[gate.RESOURCE],'fence':100,'expires':time.time()+1800}
        self.dispositions=[];self.valid=True
        self.cap=self.root/'own.private.json'
        self.cap.write_text(json.dumps({'operator_session':gate.SESSION,'result':{'lease':'fixture-own-lease','token':'synthetic-test-capability','fence':100,'seq':self.acquired}}));self.cap.chmod(0o600)
        (self.root/'OPERATION.template.json').write_text(self.template_raw)
        self.patches=[mock.patch.object(gate,'central',side_effect=self.central),mock.patch.object(gate,'git',side_effect=lambda *a:'' if a[0]=='status' else self.head),mock.patch.object(gate,'source_hashes',return_value=self.hashes),mock.patch.object(gate,'ROOT',self.root)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def central(self,args):
        if args[0]=='status':return {'leases':[self.lease],'notice_dispositions':self.dispositions}
        if args[0]=='check':return {'valid':self.valid}
        if args[0]=='history':
            after=int(args[args.index('--after-seq')+1]);limit=int(args[args.index('--limit')+1])
            return [e for e in self.events if e['seq']>after][:limit]
        raise AssertionError('unexpected canonical action')
    def call(self,phase='start'):return gate.Gate(self.event,self.cap)(phase)

    def test_complete_composite_reviews_and_own_notice_bound_lease(self):
        self.assertEqual(self.call()['capability']['manifest_event'],self.event)
    def test_missing_independent_source_runtime_broker_or_execution_ack_refused(self):
        original=list(self.events)
        for target in [self.source,gate.RUNTIME_NOTICE,gate.BROKER_NOTICE,self.event]:
            self.events=[e for e in original if not(e['kind']=='ack' and e['data']['event_seq']==target)]
            with self.subTest(target=target),self.assertRaises(PermissionError):self.call()
    def test_changed_source_or_runtime_broker_hash_refused(self):
        self.data['file_sha256']['runtime/worker.py']='0'*64
        with self.assertRaises(PermissionError):self.call()
    def test_disposed_notice_rejected_despite_old_ack(self):
        self.dispositions=[{'target_event':gate.BROKER_NOTICE,'disposition':'superseded'}]
        with self.assertRaises(PermissionError):self.call()
    def test_borrowed_session_or_permissive_capability_refused(self):
        self.cap.chmod(0o644)
        with self.assertRaises(PermissionError):self.call()
        self.cap.chmod(0o600);v=json.loads(self.cap.read_text());v['operator_session']='another-session';self.cap.write_text(json.dumps(v))
        with self.assertRaises(PermissionError):self.call()
    def test_wrong_resource_state_or_operation_is_not_test_authority(self):
        original=dict(self.lease)
        for key,value in [('resources',[gate.RESOURCE,'deploy:other']),('state','uncertain'),('operation','deploy')]:
            self.lease.update(original);self.lease[key]=value
            with self.subTest(key=key),self.assertRaises(PermissionError):self.call()
    def test_false_valid_or_insufficient_budget_refused(self):
        self.valid=False
        with self.assertRaises(PermissionError):self.call()
        self.valid=True;self.lease['expires']=time.time()+300
        with self.assertRaises(PermissionError):self.call('start')
        self.assertEqual(self.call('observe')['capability']['manifest_event'],self.event)
    def test_capability_acquisition_must_reference_this_manifest(self):
        self.events[-1]['data']['manifest_event']=1
        with self.assertRaises(PermissionError):self.call()
    def test_preparation_or_other_session_notice_cannot_execute(self):
        self.data['preparation_only']=True
        with self.assertRaises(PermissionError):self.call()
        self.data['preparation_only']=False;self.data['operator_session']='other-session'
        with self.assertRaises(PermissionError):self.call()
    def test_sourceA_author_and_freeze_required(self):
        next(e for e in self.events if e['seq']==self.source)['actor']='apoio'
        with self.assertRaises(PermissionError):self.call()

    def test_install_intent_path_must_be_explicit_in_execution_scope(self):
        self.data.pop('install_intent_path')
        with self.assertRaises(PermissionError):self.call()
        self.data['install_intent_path']='/opt/not-this-intent'
        with self.assertRaises(PermissionError):self.call()

    def test_host_version_pin_cannot_drift_from_frozen_source_template(self):
        self.request['systemd_version_sha256']='f'*64
        with self.assertRaises(PermissionError):self.call()

    def test_untracked_or_changed_template_is_not_a_frozen_host_pin(self):
        self.hashes.pop('OPERATION.template.json')
        self.data['file_sha256']=dict(self.hashes)
        next(e for e in self.events if e['seq']==self.source)['data']['file_sha256']=dict(self.hashes)
        with self.assertRaises(PermissionError):self.call()


if __name__ == '__main__':unittest.main()
