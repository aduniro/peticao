"""Synthetic Gate/Owner/SSH fixtures only. No network/host/Root invocation."""
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import client

TMP=Path(__file__).absolute().parent/'test-state/tmp'


def header():
    return {'version':1,'operation_id':'a'*32,'operator_session':client.OPERATOR_SESSION,
        'scope':'new-civo-sealed-toolchain-no-dispatch','source_notice':1,'execution_notice':2,
        'root_window_event':3,'qualification_release_event':4,'full_integrity_event':5,
        'expected_boot_id':'12345678-1234-1234-1234-123456789abc','payload_sha256':'b'*64,
        'payload_bytes':4,'unpacked_bytes':4,'files':{'tool':{'sha256':'c'*64,'bytes':4,'mode':0o644}},'deadline_unix':150.0}


def fixture_contract():
    # Reviewed production composition remains pending. These callbacks are fake.
    def request(action,h,sha,size,grant):
        if grant!={'fixture':'allowed'}:raise PermissionError('fixture denied')
        if type(h)is not dict:raise ValueError('fixture header')
    def reply(action,value,grant):
        if set(value)!={'state'}or value['state']!='FIXTURE_SAFE':raise ValueError('fixture whitelist')
        return dict(value)
    class FixtureContract:
        def ready(self):pass
    result=FixtureContract();result.request=request;result.reply=reply
    return result


class FakeTransport:
    def __init__(self,error=None):self.frames=[];self.error=error
    def exchange(self,action,chunks,pre_ssh):
        pre_ssh();self.frames.append((action,list(chunks)))
        if self.error:raise self.error
        return b'{"state":"FIXTURE_SAFE"}'


class ClientTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='client-',dir=TMP);self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.packet=self.root/'packet';self.packet.mkdir(mode=0o700)
        self.patcher=mock.patch.object(client,'__file__',str(self.packet/'client.py'));self.patcher.start()
        self.payload=self.root/'payload.tar';self.payload.write_bytes(b'fixture-compressed-data');self.payload.chmod(0o600)
        self.sha=hashlib.sha256(self.payload.read_bytes()).hexdigest();self.size=self.payload.stat().st_size
        self.gate=mock.Mock(return_value={'fixture':'allowed'});self.transport=FakeTransport()
        self.component=client.Client(self.gate,self.transport,fixture_contract())
    def tearDown(self):self.patcher.stop();self.temp.cleanup()
    def install(self,h=None):return self.component.install(h or {'fixture':1},self.payload,self.sha,self.size)

    def test_default_guard_before_state_payload_or_transport(self):
        component=client.Client()
        with mock.patch.object(client.os,'open',side_effect=AssertionError('no IO')),mock.patch.object(client.subprocess,'Popen',side_effect=AssertionError('no SSH')):
            with self.assertRaises(client.ClientRefused):component.install({},'/not/read','a'*64,1)
            with self.assertRaises(client.ClientRefused):component.observe({})
        self.assertEqual(list(self.packet.iterdir()),[])

    def test_contract_pending_after_gate_before_any_io(self):
        component=client.Client(self.gate,self.transport)
        with mock.patch.object(client.os,'open',side_effect=AssertionError('no IO')):
            with self.assertRaises(client.IntegrationPending):component.install({},'/not/read','a'*64,1)
            with self.assertRaises(client.IntegrationPending):component.observe({})
        self.assertFalse(client.OPERATOR_COMPOSITION_READY)

    def test_frame_unsigned_big_endian_canonical_and_streamed_exact_bytes(self):
        raw=client.canonical_header({'z':2,'a':1});payload=b'x'*(2*client.CHUNK+17)
        chunks=list(client.frame_chunks(raw,io.BytesIO(payload),hashlib.sha256(payload).hexdigest(),len(payload)))
        self.assertEqual(chunks[0],len(raw).to_bytes(8,'big'))
        self.assertEqual(chunks[1],b'{"a":1,"z":2}')
        self.assertTrue(all(len(part)<=client.CHUNK for part in chunks))
        self.assertEqual(b''.join(chunks[2:]),payload)

    def test_frame_rejects_short_extra_or_changed_payload(self):
        for raw,size,digest in ((b'x',2,hashlib.sha256(b'x').hexdigest()),(b'xx',1,hashlib.sha256(b'x').hexdigest()),(b'x',1,'0'*64)):
            with self.assertRaises(client.TransportUncertain):list(client.frame_chunks(b'{}',io.BytesIO(raw),digest,size))
        with self.assertRaises(client.ClientRefused):list(client.frame_chunks(b'{}',None,'a'*64,1))

    def test_header_finite_object_and_2mib_bound(self):
        for value in ([],{'x':float('nan')},{'x':'a'*client.MAX_HEADER}):
            with self.assertRaises(client.ClientRefused):client.canonical_header(value)

    def test_install_header_intent_receipt_private_and_no_capability_copy(self):
        self.install();state=self.packet/'execution-state'
        self.assertEqual((state/'install-header.json').read_bytes(),b'{"fixture":1}')
        intent=json.loads((state/'install-intent.json').read_bytes())
        self.assertNotIn('grant',intent);self.assertNotIn('capability',intent)
        self.assertEqual(json.loads((state/'install-receipt.json').read_bytes()),{'state':'FIXTURE_SAFE'})
        self.assertEqual(state.stat().st_mode&0o777,0o700)
        self.assertTrue(all(path.stat().st_mode&0o777==0o600 for path in state.iterdir()))
        self.assertEqual(self.gate.call_count,2)

    def test_lost_reply_burns_install_no_retry_observe_same_concrete_header(self):
        self.transport.error=TimeoutError('FICTITIOUS PRIVATE ARGV')
        with self.assertRaisesRegex(client.TransportUncertain,'observe_only'):self.install({'deadline_unix':1})
        state=self.packet/'execution-state';self.assertTrue((state/'install-intent.json').exists())
        self.assertFalse((state/'install-receipt.json').exists())
        self.transport.error=None
        with self.assertRaises(FileExistsError):self.install({'deadline_unix':2})
        self.assertEqual(len(self.transport.frames),1)
        self.component.observe()
        observed=b''.join(self.transport.frames[-1][1]);self.assertEqual(observed[8:],b'{"deadline_unix":1}')
        with self.assertRaises(client.ClientRefused):self.component.observe({'deadline_unix':2})

    def test_observe_does_not_create_state_or_mutation_intent(self):
        self.component.observe({'fixture':1});self.assertEqual(list(self.packet.iterdir()),[])
        self.assertEqual(self.transport.frames[0][0],'observe')

    def test_recheck_gate_change_prevents_transport_consumption(self):
        self.gate.side_effect=[{'fixture':'allowed'},{'fixture':'changed'}]
        with self.assertRaises(client.TransportUncertain):self.install()
        self.assertEqual(self.transport.frames,[])
        self.assertTrue((self.packet/'execution-state/install-intent.json').exists())

    def test_gate_timeout_argv_is_never_exposed(self):
        self.gate.side_effect=subprocess.TimeoutExpired(['SECRET-FIXTURE'],10,stderr=b'SECRET-FIXTURE')
        with self.assertRaises(client.ClientRefused)as raised:self.install()
        self.assertNotIn('SECRET',str(raised.exception));self.assertEqual(list(self.packet.iterdir()),[])

    def test_state_symlink_or_permissive_mode_refused(self):
        state=self.packet/'execution-state';state.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(OSError):self.install()
        state.unlink();state.mkdir(mode=0o755)
        with self.assertRaises(client.ClientRefused):self.install()

    def test_payload_symlink_changed_pin_or_hardlink_refused(self):
        link=self.root/'link';link.symlink_to(self.payload)
        with self.assertRaises(OSError):
            with client.verified_payload(link,self.sha,self.size):pass
        with self.assertRaises(client.ClientRefused):
            with client.verified_payload(self.payload,'a'*64,self.size):pass
        os.link(self.payload,self.root/'hard')
        with self.assertRaises(client.ClientRefused):
            with client.verified_payload(self.payload,self.sha,self.size):pass

    def test_payload_source_exit_before_receipt(self):
        class Mutating(FakeTransport):
            def exchange(inner,*args):
                reply=super().exchange(*args);self.payload.write_bytes(b'changed');return reply
        self.component.transport=Mutating()
        with self.assertRaises(client.TransportUncertain):self.install()
        self.assertFalse((self.packet/'execution-state/install-receipt.json').exists())

    def test_two_packets_have_independent_state(self):
        self.install();other=self.root/'other';other.mkdir(mode=0o700)
        with mock.patch.object(client,'__file__',str(other/'client.py')):self.install()
        self.assertNotEqual((other/'execution-state').stat().st_ino,(self.packet/'execution-state').stat().st_ino)

    def test_wire_schema_and_original_expired_observe_deadline(self):
        h=header();client.validate_wire_header(h,'install',100)
        client.validate_wire_header(h,'observe',1000)
        for key,value in (('version',True),('payload_bytes',True),('scope','production'),('expected_boot_id','bad')):
            changed=deepcopy(h);changed[key]=value
            with self.assertRaises(client.ClientRefused):client.validate_wire_header(changed,'install',100)
        changed=deepcopy(h);changed['free']='no'
        with self.assertRaises(client.ClientRefused):client.validate_wire_header(changed,'install',100)

    def test_deadline_only_formula_exact_margin(self):
        self.assertEqual(client.concrete_deadline(100,1120,1200),1000)
        for lease,window in ((1119,1200),(1200,1119)):
            with self.assertRaises(client.ClientRefused):client.concrete_deadline(100,lease,window)

    def test_reply_whitelist_writer_three_fields_and_false_flags(self):
        h=header();value={'state':'WRITER_ACTIVE_OBSERVE_ONLY','writer':{'pid':42,'start_ticks':'99','boot_id':h['expected_boot_id']},
            'writer_alive':True,'prefix_exists':False,'no_retry':True,'operational_ready':False}
        self.assertEqual(client.validate_wire_reply(value,h),value)
        for changed in ({**value,'operational_ready':True},{**value,'free':'no'},{**value,'writer':{'pid':42}},
                        {**value,'no_retry':False},{**value,'writer_alive':1}):
            with self.assertRaises((client.ClientRefused,client.TransportUncertain)):client.validate_wire_reply(changed,h)

    def test_public_remote_code_exact_two_blobs_explicit_module_dispatch(self):
        blobs={}
        for name in ('materializer.py','root_entry.py'):
            path=self.root/name;raw=b'raise AssertionError("PUBLIC_FIXTURE_NOT_RUN_LOCALLY")\n';path.write_bytes(raw);path.chmod(0o600)
            blobs[name]={'path':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        command=client.public_remote_command('observe',blobs);decoded=shlex.split(command)[-1]
        self.assertIn("types.ModuleType('root_entry')",decoded)
        self.assertIn(".dispatch('observe',sys.stdin.buffer)",decoded)
        self.assertNotIn("ModuleType('__main__')",decoded)
        with self.assertRaises(client.IntegrationPending):client.public_remote_command('install',{**blobs,'payload.py':{}})

    def test_ssh_default_closed_fixed_transport_no_mux_or_free_config(self):
        with mock.patch.object(client.subprocess,'Popen',side_effect=AssertionError('network prohibited')):
            with self.assertRaises(client.IntegrationPending):client.PinnedSSH().exchange('install',iter(()),lambda:None)
        argv=client.PinnedSSH.argv()
        self.assertIn('ControlPath=none',argv);self.assertIn('IdentityAgent=none',argv)
        self.assertIn('HostKeyAlias='+client.HOST_KEY_ALIAS,argv)
        self.assertEqual(argv[-1],'root@100.122.224.82');self.assertIn('/dev/null',argv)

    def test_bootstrap_fixture_dict_one_json_line_and_redacted_failure(self):
        # Only synthetic public modules execute here; never Owner/candidate bytes.
        for body,exit_code in (("return {'state':'NOT_STARTED','no_retry':True,'operational_ready':False}",None),
                               ("raise ValueError('FICTITIOUS_PRIVATE_ERROR')",1),('return []',1)):
            blobs={}
            sources={'materializer.py':b'PUBLIC_FIXTURE=True\n',
                'root_entry.py':('def dispatch(action,stream):\n '+body+'\n').encode()}
            for name,raw in sources.items():
                path=self.root/name;path.write_bytes(raw);path.chmod(0o600)
                blobs[name]={'path':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
            code=shlex.split(client.public_remote_command('observe',blobs))[-1]
            output=io.StringIO();saved={name:sys.modules.get(name)for name in('materializer','root_entry')}
            try:
                with mock.patch.object(sys,'stdin',mock.Mock(buffer=io.BytesIO())),mock.patch.object(sys,'stdout',output):
                    if exit_code is None:exec(compile(code,'<synthetic-bootstrap>','exec'),{})
                    else:
                        with self.assertRaises(SystemExit)as raised:exec(compile(code,'<synthetic-bootstrap>','exec'),{})
                        self.assertEqual(raised.exception.code,exit_code)
            finally:
                for name,value in saved.items():
                    if value is None:sys.modules.pop(name,None)
                    else:sys.modules[name]=value
            self.assertEqual(len(output.getvalue().splitlines()),1)
            reply=json.loads(output.getvalue());self.assertNotIn('FICTITIOUS_PRIVATE',output.getvalue())
            if exit_code:self.assertEqual(set(reply),{'state','error_type'})

    def test_parse_reply_never_returns_remote_logs_or_duplicates(self):
        for raw in (b'{"x":1,"x":2}',b'not-json',b'{"x":NaN}',b'x'*(client.MAX_REPLY+1)):
            with self.assertRaises(client.TransportUncertain):client.parse_reply(raw)

    def ssh_fixture(self,response=b'{"state":"FIXTURE_SAFE"}',failure=None):
        known=self.root/'known-hosts-public';known.write_bytes(b'fixture public host key\n');known.chmod(0o600)
        blobs={name:{'path':'/fixture/'+name,'sha256':'a'*64,'bytes':1}for name in('materializer.py','root_entry.py')}
        transport=client.PinnedSSH(blobs,integration_enabled=True,deadline_seconds=1)
        class Input(io.BytesIO):
            def close(inner):inner.closed_by_writer=True
        process=mock.Mock();process.stdin=Input();process.stdout=io.BytesIO(response)
        process.returncode=0;process.poll.return_value=0
        if failure:process.wait.side_effect=failure
        patches=[mock.patch.object(client,'KNOWN_HOSTS',str(known)),
            mock.patch.object(client,'KNOWN_HOSTS_SHA',hashlib.sha256(known.read_bytes()).hexdigest()),
            mock.patch.object(client,'public_remote_command',return_value='FIXED_PUBLIC_CODE'),
            mock.patch.object(client.subprocess,'Popen',return_value=process)]
        for patch in patches:patch.start();self.addCleanup(patch.stop)
        return transport,process,patches[-1]

    def ssh_grant(self):return {'execution':{'remote_code_sha256':{name:'a'*64 for name in('materializer.py','root_entry.py')}}}

    def test_mock_ssh_streams_stdin_bounds_stdout_and_discards_stderr(self):
        transport,process,_=self.ssh_fixture();calls=[]
        def checked():calls.append('gate');return self.ssh_grant()
        raw=transport.exchange('observe',client.frame_chunks(b'{}'),checked)
        self.assertEqual(raw,b'{"state":"FIXTURE_SAFE"}');self.assertEqual(calls,['gate'])
        self.assertEqual(process.stdin.getvalue(),b'\0\0\0\0\0\0\0\2{}')
        args=client.subprocess.Popen.call_args.kwargs
        self.assertEqual(args['stderr'],subprocess.DEVNULL);self.assertTrue(args['close_fds'])
        self.assertNotIn('capture_output',args)

    def test_mock_ssh_gate_remote_hash_mismatch_refuses_before_popen(self):
        transport,process,_=self.ssh_fixture()
        grant=self.ssh_grant();grant['execution']['remote_code_sha256']['root_entry.py']='b'*64
        with self.assertRaises(client.ClientRefused):transport.exchange('observe',iter(()),lambda:grant)
        client.subprocess.Popen.assert_not_called()

    def test_mock_ssh_owner_exit_one_accepts_only_safe_uncertain_reply(self):
        reply={'state':'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY','error_type':'ValueError'}
        transport,process,_=self.ssh_fixture(response=json.dumps(reply).encode());process.returncode=1
        self.assertEqual(client.parse_reply(transport.exchange('observe',iter(()),self.ssh_grant)),reply)

    def test_mock_ssh_output_overflow_and_timeout_or_oserror_never_echo_argv(self):
        transport,process,_=self.ssh_fixture(response=b'x'*(client.MAX_REPLY+100))
        with self.assertRaises(client.TransportUncertain):transport.exchange('observe',iter([b'fixture']),self.ssh_grant)
        process.stdout=io.BytesIO(b'{}');process.stdin=io.BytesIO()
        process.wait.side_effect=subprocess.TimeoutExpired(['FICTITIOUS-SECRET-ARGV'],1,stderr=b'FICTITIOUS-SECRET')
        with self.assertRaises(client.TransportUncertain)as raised:transport.exchange('observe',iter([]),self.ssh_grant)
        self.assertNotIn('SECRET',str(raised.exception))
        with mock.patch.object(client.subprocess,'Popen',side_effect=OSError('FICTITIOUS-SECRET-ARGV')):
            with self.assertRaises(client.TransportUncertain)as raised:transport.exchange('observe',iter([]),self.ssh_grant)
        self.assertNotIn('SECRET',str(raised.exception))

    def test_mock_ssh_rechecks_gate_before_popen_and_redacts_recheck_errors(self):
        transport,process,_=self.ssh_fixture()
        with mock.patch.object(client.subprocess,'Popen')as spawn:
            def deny():raise subprocess.TimeoutExpired(['FICTITIOUS-PRIVATE'],1)
            with self.assertRaises(client.ClientRefused)as raised:transport.exchange('observe',iter([]),deny)
            self.assertNotIn('PRIVATE',str(raised.exception));spawn.assert_not_called()

    def test_closed_production_main(self):
        with self.assertRaises(client.IntegrationPending):client.main()

    def concrete(self):
        template=header();template.update(execution_notice=0,deadline_unix=0,payload_sha256=self.sha,payload_bytes=self.size)
        self.clock=[100.0];contract=client.OwnerContract(template,clock=lambda:self.clock[0])
        self.public={'session':client.OPERATOR_SESSION,'execution_event':42,'source_notice':template['source_notice'],
            'root_window_notice':template['root_window_event'],'fence':1,'lease_expires':5000.0,'window_closes':5000.0}
        execution={'operation_id':template['operation_id'],'payload_sha256':self.sha,'payload_bytes':self.size,
            'payload_path':'payload.tar','header_sha256':hashlib.sha256(client.canonical_header(template)).hexdigest(),
            'header_bytes':len(client.canonical_header(template)),'header_template':deepcopy(template)}
        def gate(action):return {'action':action,'authority':dict(self.public),'execution':dict(execution)}
        return template,contract,gate

    def test_concrete_contract_only_binds_two_fields_to_gate_and_margin(self):
        template,contract,gate=self.concrete();grant=gate('install');h=contract.prepare(grant)
        self.assertEqual(h['execution_notice'],42);self.assertEqual(h['deadline_unix'],1000)
        stable=dict(h);stable.update(execution_notice=0,deadline_unix=0);self.assertEqual(stable,template)
        contract.request('install',h,self.sha,self.size,grant)
        for key,value in (('execution_notice',43),('root_window_event',99),('payload_bytes',1),('deadline_unix',999)):
            changed=deepcopy(h);changed[key]=value
            with self.subTest(key=key),self.assertRaises(client.ClientRefused):contract.request('install',changed,self.sha,self.size,grant)
        self.public['lease_expires']=1119
        with self.assertRaises(client.ClientRefused):contract.prepare(gate('install'))

    def test_concrete_contract_persists_header_observes_expired_only_current_original_window(self):
        template,contract,gate=self.concrete();target=self.packet/'payload.tar'
        target.write_bytes(self.payload.read_bytes());target.chmod(0o600)
        class Transport(FakeTransport):
            def exchange(inner,action,chunks,check):
                check();inner.frames.append((action,list(chunks)))
                if action=='observe':return b'{"state":"NOT_STARTED","no_retry":true,"operational_ready":false}'
                return json.dumps({'state':'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED','operation_id':template['operation_id'],
                    'prefix':'/opt/peticao-dev-profile-tools-v1','files':1,'bytes':4,'source_notice':template['source_notice'],
                    'execution_notice':42,'candidate_programs_executed':False,'operational_ready':False,
                    'native_profiles_qualified':False,'queue_cutover':False}).encode()
        transport=Transport();component=client.Client(gate,transport,contract)
        component.install(None,target,self.sha,self.size)
        original=(self.packet/'execution-state/install-header.json').read_bytes()
        self.clock[0]=2000
        self.assertEqual(component.observe()['state'],'NOT_STARTED')
        self.assertEqual(b''.join(transport.frames[-1][1])[8:],original)
        self.public['root_window_notice']=99
        with self.assertRaises(client.ClientRefused):component.observe()
        self.public['root_window_notice']=3;self.clock[0]=5001
        with self.assertRaises(client.ClientRefused):component.observe()

    def test_concrete_reply_action_matrix_and_writer_ticks_string(self):
        template,contract,gate=self.concrete();h=contract.prepare(gate('install'))
        contract.request('install',h,self.sha,self.size,gate('install'))
        with self.assertRaises(client.TransportUncertain):contract.reply('install',{'state':'NOT_STARTED','no_retry':True,'operational_ready':False},gate('install'))
        contract.request('observe',h,None,0,gate('observe'))
        reply={'state':'WRITER_ACTIVE_OBSERVE_ONLY','writer':{'pid':7,'start_ticks':'123','boot_id':h['expected_boot_id']},
            'writer_alive':True,'prefix_exists':False,'no_retry':True,'operational_ready':False}
        self.assertEqual(contract.reply('observe',reply,gate('observe')),reply)
        for ticks in (123,'0','01','+1','١٢٣'):
            changed=deepcopy(reply);changed['writer']['start_ticks']=ticks
            with self.assertRaises(client.TransportUncertain):contract.reply('observe',changed,gate('observe'))

    def test_recording_received_reply_does_not_demand_a_new_1020_second_window(self):
        template,contract,gate=self.concrete();h=contract.prepare(gate('install'))
        grant=gate('install');contract.request('install',h,self.sha,self.size,grant)
        self.clock[0]=4900
        safe=contract.reply('install',{'state':'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY','error_type':'PermissionError'},grant)
        self.assertEqual(safe['state'],'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY')
        with self.assertRaises(client.ClientRefused):contract.request('install',h,self.sha,self.size,grant)


if __name__=='__main__':unittest.main()
