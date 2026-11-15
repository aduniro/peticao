import hashlib,json,os,shlex,subprocess,unittest
from pathlib import Path
from unittest import mock
import client

# Load the reviewed composition with an explicit module identity.
import importlib.util
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('publication_operator',HERE/'publish_toolchain.py')
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)

class CompositionTests(unittest.TestCase):
    def test_denied_gate_precedes_contract_state_or_transport(self):
        with mock.patch.object(o.gate,'Gate')as gate,mock.patch.object(o.client,'OwnerContract')as contract,mock.patch.object(o.client,'PinnedSSH')as transport:
            gate.return_value.side_effect=PermissionError('fixture_denied')
            with self.assertRaises(PermissionError):o.run('install',1)
            contract.assert_not_called();transport.assert_not_called()
    def grant(self,action):
        return {'action':action,'execution':{'header_template':{'fixture':'data'},'remote_code_sha256':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest()for n in ('materializer.py','root_entry.py')},'payload_path':'execution-state/payload.tar.gz','payload_sha256':'a'*64,'payload_bytes':1}}
    def test_install_wires_exact_reviewed_payload_and_guard(self):
        guard=mock.Mock(return_value=self.grant('install'))
        with mock.patch.object(o.gate,'Gate',return_value=guard),mock.patch.object(o.client,'OwnerContract'),mock.patch.object(o.client,'PinnedSSH')as transport,mock.patch.object(o.client,'Client')as ctor:
            ctor.return_value.install.return_value={'state':'fixture_not_root'}
            self.assertEqual(o.run('install',9),{'state':'fixture_not_root'})
            guard.assert_called_once_with('install');transport.assert_called_once()
            self.assertTrue(transport.call_args.kwargs['integration_enabled'])
            self.assertIs(ctor.call_args.kwargs['scope_guard'],guard)
            ctor.return_value.install.assert_called_once_with(None,HERE/'execution-state/payload.tar.gz','a'*64,1)
    def test_observe_uses_saved_header_not_a_new_install(self):
        guard=mock.Mock(return_value=self.grant('observe'))
        with mock.patch.object(o.gate,'Gate',return_value=guard),mock.patch.object(o.client,'OwnerContract'),mock.patch.object(o.client,'PinnedSSH'),mock.patch.object(o.client,'Client')as ctor:
            o.run('observe',9);ctor.return_value.observe.assert_called_once_with();ctor.return_value.install.assert_not_called()
    @unittest.skipIf(os.geteuid()==0,'Actual nonroot guard denial test requires normal UID')
    def test_real_two_module_bootstrap_rejects_nonroot_before_stream_or_effects(self):
        refs={n:{'path':str(HERE/n),'sha256':hashlib.sha256((HERE/n).read_bytes()).hexdigest(),'bytes':(HERE/n).stat().st_size}for n in ('materializer.py','root_entry.py')}
        command=client.public_remote_command('observe',refs)
        argv=shlex.split(command);self.assertEqual(argv[:5],['/usr/bin/python3','-I','-S','-B','-c'])
        result=subprocess.run(argv,input=b'',capture_output=True,timeout=10)
        self.assertEqual(result.returncode,1);self.assertEqual(result.stderr,b'')
        self.assertEqual(json.loads(result.stdout),{'state':'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY','error_type':'PermissionError'})

if __name__=='__main__':unittest.main()
