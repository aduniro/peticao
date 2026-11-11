"""Old ROOT technical receipts read only; every live Docker/socket operation mocked."""
import unittest,tempfile,json,os,hashlib
from pathlib import Path
from unittest import mock
import local_controller as c,docker_control as d
class GateTests(unittest.TestCase):
 def gate(self,visible='',port=111,digest=None):
  with mock.patch.object(d,'docker',return_value=mock.Mock(stdout=visible))as calls,mock.patch.object(c.socket,'socket')as sock:
   sock.return_value.__enter__.return_value.connect_ex.return_value=port
   if digest:
    with mock.patch.object(c,'digest',side_effect=digest):value=c.verify_reconciled_previous_attempt()
   else:value=c.verify_reconciled_previous_attempt()
   return value,calls.call_args_list
 def test_exact_failed_root_and_reconciliation_then_fresh_reads(self):
  result,calls=self.gate();self.assertTrue(result['noAutomaticRetry']);self.assertEqual(len(calls),2);self.assertTrue(all('label=org.peticao.qa.local-r0013=97b317f6483b'in v.args for v in calls))
 def test_changed_old_marker_refuses_gate(self):
  original=c.digest
  with self.assertRaises(ValueError):self.gate(digest=lambda p:'e'*64 if p.name=='execution.started'else original(p))
 def test_reappeared_old_nonce_refuses_gate_without_cleanup(self):
  with self.assertRaises(ValueError):self.gate(visible='late-resource')
 def test_occupied_port_refuses_gate(self):
  with self.assertRaises(ValueError):self.gate(port=0)
 def test_new_marker_exclusive_only_after_gate(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest();prior={'oldMarkerSha256':'a'*64,'files':{'root-failure-receipt.json':'b'*64,'root-manual-reconciliation.json':'c'*64}}
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_reconciled_previous_attempt',return_value=prior),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    c.verify_local_manifest();self.assertTrue((root/'execution.create90-v2.started').exists())
    with self.assertRaises(FileExistsError):c.verify_local_manifest()
 def test_failed_gate_never_creates_intent(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_reconciled_previous_attempt',side_effect=ValueError('missing ROOT proof')),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    with self.assertRaises(ValueError):c.verify_local_manifest()
   self.assertFalse((root/'execution.create90-v2.started').exists())
if __name__=='__main__':unittest.main()
