"""Pure contract checks for the R14-specific infrastructure port."""
import ast,json,hashlib,unittest
from unittest.mock import patch
from pathlib import Path
import local_controller as c
ROOT=Path(__file__).parent
class InfraPort(unittest.TestCase):
 def test_first_marker_preserved_without_r13_failure_gate(self):
  s=(ROOT/'local_controller.py').read_text();self.assertIn("ROOT/'execution.started'",s)
  for forbidden in ['verify_reconciled_previous_attempt','execution.create90-v2.started','97b317f6483b']:
   self.assertNotIn(forbidden,s)
  self.assertIn('verify_response_observation_v2_previous_attempt',s)
  self.assertIn('execution.response-observation-v2.started',s)
 def test_namespace_and_runtime_caps_preserved(self):
  s=(ROOT/'local_controller.py').read_text();self.assertIn('peticao-r0014-',s);self.assertNotIn('peticao-r0013-',s)
  self.assertIn("for port in [55494,31394]",s);self.assertIn("<=2",s);self.assertIn("<=3*1024**3",s);self.assertIn("<=256",s)
  main=(ROOT/'functional_smoke.py').read_text();self.assertIn('job_deadline=time.monotonic()+600',main);self.assertIn('CONFIG,job_deadline,cancellation)',main)
 def test_only_safe_metadata_added_to_exports(self):
  self.assertIn('docker-operation-state.json',c.ALLOW)
  for name in ['docker-operation-1.tmp','docker-intent.json','server.log','preparation-lease.json']:self.assertNotIn(name,c.ALLOW)
 def test_unreviewed_config_still_stops_before_marker(self):
  import functional_smoke as smoke
  with patch.dict(smoke.CONFIG,{'infra_reviewed':False},clear=True):
   with self.assertRaisesRegex(RuntimeError,'blocked pending reviewed'):
    smoke.main()
  self.assertFalse((ROOT/'execution.history-diagnostic-v3.started').exists())
  tree=ast.parse((ROOT/'functional_smoke.py').read_text());self.assertIsInstance(tree,ast.Module)
 def test_activation_is_bound_to_accepted_run_and_independent_review(self):
  self.assertIs(json.loads((ROOT/'config.json').read_text())['infra_reviewed'],True)
  proof=json.loads((ROOT/'INFRA-ACCEPTANCE.json').read_text())
  self.assertEqual(proof['decision'],'ROOT_APPROVED_FIRST_ISOLATED_EXECUTION')
  for name in ['r13AcceptedRun','r14IndependentReview']:
   item=proof[name];self.assertEqual(hashlib.sha256(Path(item['path']).read_bytes()).hexdigest(),item['sha256'])
  accepted=json.loads(Path(proof['r13AcceptedRun']['path']).read_text())
  self.assertEqual(accepted['exit'],0);self.assertEqual(accepted['browserChecks'],15)
  self.assertFalse(accepted['realA1CryptographyTested'])
if __name__=='__main__':unittest.main()
