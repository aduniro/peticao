"""Fake canonical ledger/source and private fictitious capabilities only."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import gate

HERE=Path(__file__).absolute().parent
TMP=HERE/'test-state'/'tmp'
TMP.parent.mkdir(mode=0o700,exist_ok=True);TMP.mkdir(mode=0o700,exist_ok=True)
EVENT=5000
NOW=2000000.0
SHA='a'*64
HEAD='b'*40
SECRET='c'*48
LEASE='d'*32


class FakeLedger:
    def __init__(self,execution,hashes,root):
        def notice(seq,actor,data,resources=None):return {'seq':seq,'kind':'notice','actor':actor,'resources':resources if resources is not None else [gate.RESOURCE],'requires_ack':1,'data':data}
        manifest={'commit':HEAD,'api_contracts':'closed','database':'none','destination':'Civo public toolchain','files':list(hashes),'tests':['fictitious']}
        common={'preparation_only':True,'production_access':False,'queue_cutover':False,'manifest':manifest,'file_sha256':hashes}
        self.rows={4001:notice(4001,gate.ACTOR,copy.deepcopy(common),['path:'+str(root)]),
            4003:notice(4003,gate.ACTOR,{'source_notice':4001,'source_commit':HEAD,'root_thread':'01a1cad7-4a65-7d43-b8c2-f0b50a90a580',
                'operation_id':execution['operation_id'],'operator_session':gate.SESSION,'resource':gate.RESOURCE,
                'scope':gate.SCOPE,'production_access':False,'queue_cutover':False,'opens_at':NOW-10,'closes_at':NOW+1800}),
            gate.SRI_SOURCE:notice(gate.SRI_SOURCE,gate.REVIEWER,{'proof_sha256':SHA,'fullVendorIntegrity':True,'cacheOriginalIntegral':False,'RootFullClosure':False,'qualified':False,'scope':'derived-content-only'}),
            gate.QUALIFICATION_RELEASE_EVENT:notice(gate.QUALIFICATION_RELEASE_EVENT,gate.ACTOR,copy.deepcopy(gate.QUALIFICATION_RELEASE_DATA),['path:'+str(root)]),
            EVENT:notice(EVENT,gate.ACTOR,{'version':1,'operation':'deploy','preparation_only':False,'production_access':False,'queue_cutover':False,
                'operator_session':gate.SESSION,'scope':gate.SCOPE,'source_notice':4001,'root_window_event':4003,'qualification_release_event':gate.QUALIFICATION_RELEASE_EVENT,
                'full_integrity_event':gate.SRI_SOURCE,'manifest':manifest,'file_sha256':hashes,'execution':execution})}
        self.rows[gate.SRI_SOURCE]['requires_ack']=0
        for i,(event,actor) in enumerate([(4001,gate.REVIEWER),(4003,gate.REVIEWER),(gate.SRI_SOURCE,gate.ACTOR),(gate.QUALIFICATION_RELEASE_EVENT,gate.REVIEWER),(EVENT,gate.REVIEWER)]):
            seq=6000+i;self.rows[seq]={'seq':seq,'kind':'ack','actor':actor,'resources':[gate.RESOURCE],'data':{'event_seq':event}}
        self.cap={'lease':LEASE,'token':SECRET,'fence':7,'expires':NOW+2000,'resources':gate.RESOURCES,'seq':7000}
        self.rows[7000]={'seq':7000,'kind':'lease_acquired','actor':gate.ACTOR,'resources':gate.RESOURCES,'data':{'lease':LEASE,'fence':7,'expires':NOW+2000,'operation':'deploy','manifest_event':EVENT}}
        self.lease={'id':LEASE,'actor':gate.ACTOR,'fence':7,'expires':NOW+2000,'resources':gate.RESOURCES,'operation':'deploy','state':'active'}
        self.dispositions=[];self.calls=[]
    def __call__(self,args):
        self.calls.append(list(args))
        if args[0]=='history':
            after=int(args[args.index('--after-seq')+1]);limit=int(args[args.index('--limit')+1])
            return [copy.deepcopy(self.rows[n]) for n in sorted(self.rows) if n>after][:limit]
        if args[0]=='status':return {'leases':[copy.deepcopy(self.lease)],'notice_dispositions':copy.deepcopy(self.dispositions)}
        if args[0]=='check':
            if args[args.index('--token')+1]!=SECRET:raise RuntimeError('do not expose '+SECRET)
            return {'valid':True,'lease':LEASE,'fence':7,'expires':self.lease['expires']}
        raise AssertionError('mutating ledger action forbidden')


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=TMP,prefix='fake-gate-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.capfile=self.root/'own-cap.json'
        payload=b'fictitious bytes never transported'
        header={'version':1,'operation_id':'e'*32,'operator_session':gate.SESSION,'scope':'new-civo-sealed-toolchain-no-dispatch',
            'source_notice':4001,'execution_notice':0,'root_window_event':4003,'qualification_release_event':gate.QUALIFICATION_RELEASE_EVENT,
            'full_integrity_event':gate.SRI_SOURCE,'expected_boot_id':'12345678-1234-1234-1234-123456789abc',
            'payload_sha256':hashlib.sha256(payload).hexdigest(),'payload_bytes':len(payload),'unpacked_bytes':40,
            'files':{'bin/fictitious':{'sha256':'b'*64,'bytes':1,'mode':0o755}},'deadline_unix':0}
        raw=gate.canonical(header)
        for n,data in [('header.json',raw),('payload.tar',payload)]:p=self.root/n;p.write_bytes(data);p.chmod(0o600)
        execution={'operation_id':'e'*32,'header_template':{'path':'header.json','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)},
            'runtime_bindings':copy.deepcopy(gate.RUNTIME_BINDINGS),'payload_path':'payload.tar',
            'payload_sha256':hashlib.sha256(payload).hexdigest(),'payload_bytes':len(payload)}
        self.hashes={'gate.py':'f'*64,'materializer.py':'1'*64,'root_entry.py':'2'*64}
        self.ledger=FakeLedger(execution,self.hashes,self.root);self.savecap()
        patches=[mock.patch.object(gate,'ROOT',self.root),mock.patch.object(gate,'SRI_PROOF_SHA256',SHA),
            mock.patch.object(gate,'SRI_NOTICE_DATA_SHA256',hashlib.sha256(gate.canonical(self.ledger.rows[gate.SRI_SOURCE]['data'])).hexdigest()),
            mock.patch.object(gate,'source_hashes',return_value=(HEAD,self.hashes)),mock.patch.object(gate,'central',side_effect=self.ledger),mock.patch.object(gate.time,'time',return_value=NOW)]
        for patch in patches:patch.start();self.addCleanup(patch.stop)
    def savecap(self,record=None):
        if record is None:record={'operator_session':gate.SESSION,'result':self.ledger.cap}
        self.capfile.write_text(json.dumps(record));self.capfile.chmod(0o600)
    def run_gate(self,action='install'):return gate.Gate(EVENT,self.capfile)(action)
    def deny(self,action='install'):
        with self.assertRaises(gate.GateDenied) as error:self.run_gate(action)
        self.assertNotIn(SECRET,str(error.exception));self.assertIsNone(error.exception.__context__)
    def test_install_and_observe_return_exact_secret_free_shape(self):
        for action in ('install','observe'):
            result=self.run_gate(action);self.assertEqual(set(result),{'action','execution','authority'})
            self.assertEqual(set(result['authority']),{'session','execution_event','source_notice','root_window_notice','fence','lease_expires','window_closes'})
            self.assertEqual(result['action'],action);self.assertEqual(result['authority']['fence'],7)
            self.assertNotIn(SECRET,json.dumps(result));self.assertNotIn('token',json.dumps(result))
        self.assertTrue(all(c[0] in {'history','status','check'} for c in self.ledger.calls))
    def test_missing_real_source_authority_defaults_deny_without_magic_flag(self):
        with mock.patch.object(gate,'source_hashes',side_effect=gate.GateDenied('not reviewed')):self.deny()
        self.assertFalse(hasattr(gate,'INTEGRATION_READY'));self.assertFalse(hasattr(gate,'ROOT_PACKET_SOURCE_FILE'))
    def test_actions_are_fixed_and_no_generic_transport(self):
        for action in ('deploy','ssh','cleanup','preflight','',None):self.deny(action)
    def test_every_call_rechecks_root_window_disposition(self):
        self.run_gate();self.ledger.dispositions=[{'target_event':4003}];self.deny('observe')
    def test_dispositions_cover_all_source_exec_window_and_sri_bindings(self):
        for event in (EVENT,4001,4003,gate.SRI_SOURCE,gate.QUALIFICATION_RELEASE_EVENT):
            with self.subTest(event=event):self.ledger.dispositions=[{'target_event':event}];self.deny()
    def test_real_independent_sri_ack_required_not_claimed_flag(self):
        self.ledger.rows.pop(6002);self.ledger.rows[gate.SRI_SOURCE]['data']['admin_ack']=True;self.deny()
    def test_all_independent_ack_roles_required(self):
        for seq in range(6000,6005):
            row=self.ledger.rows.pop(seq)
            with self.subTest(seq=seq):self.deny()
            self.ledger.rows[seq]=row
    def test_window_finite_current_max3600_and_deadline_margin(self):
        original=copy.deepcopy(self.ledger.rows[4003]['data'])
        for change in ({'opens_at':True},{'closes_at':float('nan')},{'closes_at':float('inf')},{'opens_at':NOW+1},{'closes_at':NOW-1},{'opens_at':NOW-3600},{'closes_at':NOW+1019}):
            with self.subTest(change=change):self.ledger.rows[4003]['data']={**original,**change};self.deny()
        self.ledger.rows[4003]['data']=original
    def test_observe_current_original_window_and_lease_need_not_have_install_margin(self):
        self.ledger.rows[4003]['data']['closes_at']=NOW+1;self.ledger.lease['expires']=NOW+1
        self.assertEqual(self.run_gate('observe')['action'],'observe');self.deny('install')
        self.ledger.rows[4003]['data']['closes_at']=NOW;self.deny('observe')
        self.ledger.rows[4003]['data']['closes_at']=NOW+1;self.ledger.lease['expires']=NOW;self.deny('observe')
    def test_window_exact_scope_operation_session_and_no_production(self):
        original=copy.deepcopy(self.ledger.rows[4003]['data'])
        for key,value in [('scope','other'),('operation_id','0'*32),('operator_session','borrowed'),('resource','deploy:other'),('production_access',True),('queue_cutover',True)]:
            with self.subTest(key=key):self.ledger.rows[4003]['data']={**original,key:value};self.deny()
    def test_execution_requires_deploy_exact_source_commit_and_header_bytes(self):
        data=self.ledger.rows[EVENT]['data'];data['operation']='test';self.deny();data['operation']='deploy'
        data['manifest']['commit']='0'*40;self.deny();data['manifest']['commit']=HEAD
        (self.root/'header.json').write_bytes(b'changed header');self.deny()
    def test_source_preparation_and_qualification_release_proof_required(self):
        self.ledger.rows[4001]['data']['preparation_only']=False;self.deny();self.ledger.rows[4001]['data']['preparation_only']=True
        self.ledger.rows[gate.QUALIFICATION_RELEASE_EVENT]['data']['host_execution_authorized']=True;self.deny()
    def test_sri_derived_only_no_root_qualification_or_wrong_proof(self):
        original=copy.deepcopy(self.ledger.rows[gate.SRI_SOURCE]['data'])
        for key,value in [('proof_sha256','0'*64),('fullVendorIntegrity',False),('RootFullClosure',True),('qualified',True),('cacheOriginalIntegral',True),('scope','root-qualified')]:
            with self.subTest(key=key):self.ledger.rows[gate.SRI_SOURCE]['data']={**original,key:value};self.deny()
    def test_lease_must_be_own_active_deploy_exact_resources_and_margin(self):
        original=copy.deepcopy(self.ledger.lease)
        for key,value in [('actor','other'),('operation','test'),('state','uncertain'),('resources',[gate.RESOURCE]),('resources',['code:',gate.RESOURCE,'deploy:other']),('fence',8),('expires',NOW+1019),('expires',float('nan'))]:
            with self.subTest(key=key):self.ledger.lease={**original,key:value};self.deny()
    def test_acquire_history_bound_to_exact_execution_not_borrowed(self):
        original=copy.deepcopy(self.ledger.rows[7000])
        for change in ({'manifest_event':EVENT-1},{'operation':'test'},{'fence':8},{'lease':'0'*32}):
            self.ledger.rows[7000]=copy.deepcopy(original);self.ledger.rows[7000]['data'].update(change);self.deny()
        self.ledger.rows[7000]=copy.deepcopy(original);self.ledger.rows[7000]['resources']=[gate.RESOURCE];self.deny()
    def test_capfile_private_exact_session_no_symlink_hardlink(self):
        self.savecap({'operator_session':'borrowed','result':self.ledger.cap});self.deny();self.savecap()
        self.capfile.chmod(0o700);self.deny();self.capfile.chmod(0o600)
        original=self.root/'cap-original';self.capfile.rename(original);self.capfile.symlink_to(original);self.deny()
        self.capfile.unlink();os.link(original,self.capfile);self.deny()
    def test_confirmed_source_release_resources_actor_and_no_extra_envelope(self):
        source=self.ledger.rows[4001];source['actor']=gate.REVIEWER;self.deny();source['actor']=gate.ACTOR
        source['resources']=[gate.RESOURCE];self.deny();source['resources']=['path:'+str(self.root)]
        release=self.ledger.rows[gate.QUALIFICATION_RELEASE_EVENT];release['resources']=[gate.RESOURCE];self.deny();release['resources']=['path:'+str(self.root)]
        self.ledger.rows[EVENT]['data']['root_source_notice']=4002;self.deny()
    def test_root_window_exact_owner_schema_no_aliases_or_wrong_commit_thread(self):
        original=copy.deepcopy(self.ledger.rows[4003]['data'])
        for key,value in [('opens',NOW-1),('closes',NOW+1800),('source_commit','0'*40),('root_thread','foreign')]:
            self.ledger.rows[4003]['data']={**original,key:value};self.deny()
    def test_execution_runtime_bindings_and_template_ids_remain_exact(self):
        execution=self.ledger.rows[EVENT]['data']['execution']
        execution['runtime_bindings']['execution_notice']='predicted_next_seq';self.deny()
        execution['runtime_bindings']=copy.deepcopy(gate.RUNTIME_BINDINGS)
        header=json.loads((self.root/'header.json').read_bytes());header['source_notice']=4009;raw=gate.canonical(header)
        (self.root/'header.json').write_bytes(raw);execution['header_template'].update(sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw));self.deny()
    def test_actual_client_owner_contract_accepts_gate_grant_without_spawning(self):
        import client
        grant=self.run_gate('install');template=grant['execution']['header_template'];contract=client.OwnerContract(template,clock=lambda:NOW)
        header=contract.prepare(grant)
        self.assertEqual(header['execution_notice'],EVENT);self.assertEqual(header['deadline_unix'],NOW+900)
        contract.request('install',header,header['payload_sha256'],header['payload_bytes'],grant)
        grant2=self.run_gate('observe');before=client.canonical_header(header)
        contract.request('observe',header,None,0,grant2)
        self.assertEqual(client.canonical_header(header),before)
        self.assertEqual(grant['execution']['remote_code_sha256'],{n:self.hashes[n] for n in ('materializer.py','root_entry.py')})

    def test_error_messages_and_exception_context_never_expose_cap(self):
        with mock.patch.object(gate,'central',side_effect=RuntimeError('private '+SECRET)):self.deny()
        error=subprocess.TimeoutExpired(['coord','check','--token',SECRET],30,output=SECRET.encode(),stderr=SECRET.encode())
        with mock.patch.object(gate,'central',side_effect=error):self.deny()


class PrimitiveTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=TMP,prefix='fake-primitives-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def template(self):
        return {'version':1,'operation_id':'e'*32,'operator_session':gate.SESSION,'scope':'new-civo-sealed-toolchain-no-dispatch',
            'source_notice':4001,'execution_notice':0,'root_window_event':4003,'qualification_release_event':gate.QUALIFICATION_RELEASE_EVENT,'full_integrity_event':gate.SRI_SOURCE,
            'expected_boot_id':'12345678-1234-1234-1234-123456789abc','payload_sha256':'a'*64,'payload_bytes':5,'unpacked_bytes':9,
            'files':{'bin/fictitious':{'sha256':'b'*64,'bytes':1,'mode':0o755}},'deadline_unix':0}
    def test_owner_template_allows_only_two_exact_zero_placeholders(self):
        header=self.template();self.assertEqual(gate.validate_header_template(header,gate.RUNTIME_BINDINGS),header)
        for key,value in [('execution_notice',5000),('execution_notice',False),('deadline_unix',0.0),('deadline_unix',123),('qualification_release_event',0),('full_integrity_event',1),('scope',gate.SCOPE)]:
            with self.subTest(key=key,value=value):
                changed={**header,key:value}
                with self.assertRaises(gate.GateDenied):gate.validate_header_template(changed,gate.RUNTIME_BINDINGS)
        with self.assertRaises(gate.GateDenied):gate.validate_header_template(header,{'execution_notice':'next_seq','deadline_unix':gate.RUNTIME_BINDINGS['deadline_unix']})
        for path in ('.','../escape','/absolute','dir//alias'):
            changed=copy.deepcopy(header);changed['files']={path:next(iter(header['files'].values()))}
            with self.assertRaises(gate.GateDenied):gate.validate_header_template(changed,gate.RUNTIME_BINDINGS)
    def test_qualification_release_exact_data_actor_ack_and_disposition(self):
        row={'seq':gate.QUALIFICATION_RELEASE_EVENT,'kind':'notice','actor':gate.ACTOR,'resources':['path:'+str(gate.ROOT)],'requires_ack':1,'data':copy.deepcopy(gate.QUALIFICATION_RELEASE_DATA)}
        ack={'seq':6007,'kind':'ack','actor':gate.REVIEWER,'data':{'event_seq':gate.QUALIFICATION_RELEASE_EVENT}}
        def ledger(args):
            if args[0]=='status':return {'notice_dispositions':[]}
            return [row] if args[-1]=='1' else [ack]
        with mock.patch.object(gate,'central',side_effect=ledger):self.assertEqual(gate.qualification_release(gate.QUALIFICATION_RELEASE_EVENT),gate.QUALIFICATION_RELEASE_EVENT)
        row['data']['host_execution_authorized']=0  # Numeric zero must not masquerade as literal False.
        with mock.patch.object(gate,'central',side_effect=ledger):
            with self.assertRaises(gate.GateDenied):gate.qualification_release(gate.QUALIFICATION_RELEASE_EVENT)
    def test_central_rejects_mutating_operations_without_subprocess(self):
        with mock.patch.object(gate.subprocess,'run') as spawn:
            for operation in ('acquire','renew','release','notice','ack'):
                with self.assertRaises(gate.GateDenied):gate.central([operation])
            spawn.assert_not_called()
    def test_central_timeout_redacts_command_context_stdout_stderr(self):
        error=subprocess.TimeoutExpired(['coord','--token',SECRET],30,output=SECRET.encode(),stderr=SECRET.encode())
        with mock.patch.object(gate.subprocess,'run',side_effect=error):
            with self.assertRaises(gate.GateDenied) as caught:gate.central(['check','--token',SECRET])
        self.assertIsNone(caught.exception.__context__);self.assertNotIn(SECRET,str(caught.exception))
    def test_central_malformed_nonfinite_and_duplicate_json_deny(self):
        for raw in (b'{"ok":true,"result":NaN}',b'{"ok":true,"ok":false,"result":{}}',b'not json'):
            with mock.patch.object(gate.subprocess,'run',return_value=subprocess.CompletedProcess([],0,raw,SECRET.encode())):
                with self.assertRaises(gate.GateDenied):gate.central(['status'])
    def test_tracked_git_closure_hashes_all_files_and_rejects_dirty(self):
        for name,raw in [('a.py',b'public fixture'),('b.json',b'{}'),('empty',b'')]:p=self.root/name;p.write_bytes(raw);p.chmod(0o600)
        def git(*args):
            if args[0]=='status':return ''
            if args==('rev-parse','--show-toplevel'):return str(self.root)+'\n'
            if args[0]=='rev-parse':return HEAD+'\n'
            if args[0]=='ls-files':return 'a.py\0b.json\0empty\0'
            raise AssertionError('unexpected git request')
        with mock.patch.object(gate,'ROOT',self.root),mock.patch.object(gate,'git',side_effect=git):
            head,hashes=gate.source_hashes();self.assertEqual(head,HEAD);self.assertEqual(set(hashes),{'a.py','b.json','empty'})
            self.assertEqual(hashes['a.py'],hashlib.sha256(b'public fixture').hexdigest())
        with mock.patch.object(gate,'git',return_value=' M a.py\n'):
            with self.assertRaises(gate.GateDenied):gate.source_hashes()
    def test_read_checks_ancestral_symlink_and_mode_and_does_not_mutate(self):
        private=self.root/'private';private.mkdir(mode=0o700);path=private/'cap';path.write_bytes(b'{}');path.chmod(0o600)
        alias=self.root/'alias';alias.symlink_to(private,target_is_directory=True)
        with self.assertRaises(OSError):gate._read(alias/'cap',100,private=True)
        self.assertEqual(path.read_bytes(),b'{}');self.assertEqual(path.stat().st_mode&0o777,0o600)


if __name__=='__main__':unittest.main()
