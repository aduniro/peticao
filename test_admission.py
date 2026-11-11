import unittest,copy,ast,json,hashlib
from pathlib import Path
import a1_http as a,browser_hook as b,local_controller as c
ROOT=Path(__file__).parent
class Admission(unittest.TestCase):
 def pair(self):
  before={'job':None,'counts':{'batch_a1_jobs':0,'batch_a1_validations':0,**{n:0 for n in ['mail_messages','mail_message_attempts','mail_outbox','batch_sends','document_reference_bindings']}},'documentFingerprint':'f','documentVersion':'d','historyVersionId':'v','pdfSha256':'h','pdfBytes':3,'listHash':'l'}
  after=copy.deepcopy(before);after['counts']['batch_a1_jobs']=1;after['jobFingerprint']='j';after['job']={'state':'queued','attempts':0,'revision':1,'batchId':1,'documentVersion':'d','inputArtifactVersionId':'v','inputSha256':'h','inputByteLength':3,'listHash':'l','policyRevision':1,'ownArtifactId':None,'outputVersionId':None,'outputSha256':None,'validationReportId':None,'leaseUntil':None,'requestId':'r'};return before,after
 def test_bound_original_queue(self):self.assertTrue(a.verify_admitted(*self.pair(),'r'))
 def test_wrong_document_rejected(self):
  before,after=self.pair();after['documentFingerprint']='mutated'
  with self.assertRaises(RuntimeError):a.verify_admitted(before,after)
 def test_no_prior_job(self):
  before,after=self.pair();before['job']={}
  with self.assertRaises(RuntimeError):a.verify_admitted(before,after)
 def test_no_worker_crypto_or_wrong_binding(self):
  for patch in [{'state':'running'},{'attempts':1},{'inputSha256':'other'},{'ownArtifactId':'own'},{'leaseUntil':'date'},{'outputVersionId':'signed'}]:
   before,after=self.pair();after['job'].update(patch)
   with self.assertRaises(RuntimeError):a.verify_admitted(before,after)
 def test_no_mail_validation_send(self):
  for key in ['mail_messages','mail_outbox','batch_sends','batch_a1_validations']:
   before,after=self.pair();after['counts'][key]=1
   with self.assertRaises(RuntimeError):a.verify_admitted(before,after)
 def test_wrong_nonce(self):
  with self.assertRaises(RuntimeError):a.verify_admitted(*self.pair(),'other')
 def test_browser_checks_exact18_and_no_secret_export(self):
  self.assertEqual(len(b.EXPECTED_CHECKS),18);self.assertEqual(len(set(b.EXPECTED_CHECKS)),18)
  for name in ['browser-config.json','private-markers.json','admitted.json','admitted-proof.json','server.log','seed.log']:self.assertNotIn(name,c.ALLOW)
 def test_environment_metadata_validator_only_guarded(self):
  s=(ROOT/'functional_smoke.py').read_text();g=(ROOT/'functional-guard.mjs').read_text()
  for literal in ["'NODE_ENV':'production'","'SIGNER':'none'","'APPROVER_EMAIL':''","'RECIPIENTS':''","'ICP_VALIDATOR_URL':'http://127.0.0.1:1/never-called'"]:self.assertIn(literal,s)
  self.assertIn('Number(selectedPort)!==55495',g);self.assertNotIn('Number(selectedPort)===1',g)
 def test_no_prebuilt_pdf_or_job_seed(self):
  s=(ROOT/'fixture.cjs').read_text();seed=s[s.index("if(action==='seed'){"):s.index("}else if(action==='stepup-fixture')")]
  for forbidden in ['INSERT INTO batches','INSERT INTO batch_document_versions','INSERT INTO batch_a1_jobs','INSERT INTO batch_preparations']:self.assertNotIn(forbidden,seed)
  self.assertIn("'queued'",s);self.assertIn('j.attempts!==0',s);self.assertIn('j.lease_token!==null',s)
 def test_no_previous_failure_gate(self):
  s=(ROOT/'local_controller.py').read_text();self.assertNotIn('verify_reconciled_previous_attempt',s);self.assertIn("ROOT/'execution.started'",s)
 def test_driver_hash_and_syntax(self):
  self.assertEqual(b.DRIVER_SHA,hashlib.sha256((ROOT/'a1-browser.cjs').read_bytes()).hexdigest())
  for p in ROOT.glob('*.py'):ast.parse(p.read_text())
if __name__=='__main__':unittest.main()
