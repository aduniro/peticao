"""Pure contract checks for the R14-specific infrastructure port."""
import ast,json,unittest
from pathlib import Path
import local_controller as c
ROOT=Path(__file__).parent
class InfraPort(unittest.TestCase):
 def test_first_attempt_kept_without_r13_failure_gate(self):
  s=(ROOT/'local_controller.py').read_text();self.assertIn("ROOT/'execution.started'",s)
  for forbidden in ['verify_reconciled_previous_attempt','execution.create90-v2.started','97b317f6483b','root-failure-receipt']:
   self.assertNotIn(forbidden,s)
 def test_namespace_and_runtime_caps_preserved(self):
  s=(ROOT/'local_controller.py').read_text();self.assertIn('peticao-r0014-',s);self.assertNotIn('peticao-r0013-',s)
  self.assertIn("for port in [55494,31394]",s);self.assertIn("<=2",s);self.assertIn("<=3*1024**3",s);self.assertIn("<=256",s)
  main=(ROOT/'functional_smoke.py').read_text();self.assertIn('job_deadline=time.monotonic()+600',main);self.assertIn('CONFIG,job_deadline,cancellation)',main)
 def test_only_safe_metadata_added_to_exports(self):
  self.assertIn('docker-operation-state.json',c.ALLOW)
  for name in ['docker-operation-1.tmp','docker-intent.json','server.log','preparation-lease.json']:self.assertNotIn(name,c.ALLOW)
 def test_review_gate_stays_false(self):
  self.assertIs(json.loads((ROOT/'config.json').read_text())['infra_reviewed'],False)
  tree=ast.parse((ROOT/'functional_smoke.py').read_text());self.assertIsInstance(tree,ast.Module)
if __name__=='__main__':unittest.main()
