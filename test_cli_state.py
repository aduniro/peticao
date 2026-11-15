"""Real CLI/local-intent filesystem, synthetic gate and transport. No SSH."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import qualification_client as client
import review_gate as gate
from test_operator_client import operation

HERE=Path(__file__).resolve().parent


class LocalCLIStateTests(unittest.TestCase):
    def test_two_source_packets_keep_separate_private_intents_and_receipts(self):
        with tempfile.TemporaryDirectory(prefix='cli-scope-',dir=HERE) as tmp:
            root=Path(tmp)
            for name in ('a','b'):
                source=root/name;source.mkdir(mode=0o700)
                request=operation();request['operation_id']=name*32
                transport=mock.Mock();transport.call.return_value={'state':'BOOTSTRAPPED_A_CLOSED','job_count':4,'global_qualified':False}
                guard=mock.Mock(return_value={'qualification_operation':request,'capability':{'manifest_event':42}})
                with mock.patch.object(client,'__file__',str(source/'qualification_client.py')),mock.patch.object(gate,'Gate',return_value=guard),mock.patch.object(client,'PinnedSSH',return_value=transport),mock.patch.object(sys,'argv',['qualification_client.py','bootstrap','--manifest-event','42','--lease-file',str(source/'synthetic-cap')]),contextlib.redirect_stdout(io.StringIO()):
                    client.main()
                state=source/'execution-state'
                self.assertEqual(state.stat().st_mode&0o777,0o700)
                self.assertEqual(json.loads((state/'bootstrap-intent.json').read_text())['phase'],'bootstrap')
                self.assertEqual(json.loads((state/'bootstrap-receipt.json').read_text())['state'],'BOOTSTRAPPED_A_CLOSED')
                transport.call.assert_called_once_with('bootstrap',b'')
            self.assertFalse((root/'execution-state').exists())
            self.assertNotEqual((root/'a/execution-state').stat().st_ino,(root/'b/execution-state').stat().st_ino)

    def test_denied_authority_creates_no_local_directory_or_transport(self):
        with tempfile.TemporaryDirectory(prefix='cli-deny-',dir=HERE) as tmp:
            root=Path(tmp);source=root/'source';source.mkdir(mode=0o700)
            guard=mock.Mock(side_effect=PermissionError('not authorized fixture'))
            with mock.patch.object(client,'__file__',str(source/'qualification_client.py')),mock.patch.object(gate,'Gate',return_value=guard),mock.patch.object(client,'PinnedSSH') as transport,mock.patch.object(sys,'argv',['qualification_client.py','bootstrap','--manifest-event','42','--lease-file',str(source/'synthetic-cap')]):
                with self.assertRaises(PermissionError):client.main()
            self.assertEqual(list(source.iterdir()),[]);transport.assert_not_called()


if __name__=='__main__':unittest.main()
