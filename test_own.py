import unittest,copy,hashlib
from pathlib import Path
from unittest import mock
import own_http as h,own_pdf_parse as p,browser_hook as b,local_controller as c,docker_control as d
class OwnTests(unittest.TestCase):
 def state(self):
  seed={'identityPreconditionSeeded':True,'externalIdentityVerified':False,'ownArtifactsSeeded':0,'receiptId':'r','documentVersion':'a'*64,'originalSha256':'b'*64};counts={n:0 for n in ['batch_document_versions','batch_a1_jobs','batch_a1_validations','president_own_a1_inputs','mail_messages','mail_message_attempts','mail_outbox','batch_sends']};counts.update({n:1 for n in ['president_own_document_intents','president_own_document_results','president_own_document_artifacts']});before={'sourceFingerprint':'same'};after={'sourceFingerprint':'same','originalSha256':'b'*64,'counts':counts,'artifact':{'receiptId':'r','documentVersion':'a'*64,'sourceSha256':'b'*64,'createdBy':1,'source':'president-own','sha256':'c'*64}};return seed,before,after
 def test_one_effect_and_source_preserved(self):self.assertTrue(h.verify_own_state(*self.state()))
 def test_duplicate_own_effect_denied(self):
  seed,before,after=self.state();after['counts']['president_own_document_artifacts']=2
  with self.assertRaises(RuntimeError):h.verify_own_state(seed,before,after)
 def test_original_mutation_denied(self):
  seed,before,after=self.state();after['sourceFingerprint']='changed'
  with self.assertRaises(RuntimeError):h.verify_own_state(seed,before,after)
 def test_signing_or_mail_effect_denied(self):
  for key in ['batch_a1_jobs','mail_messages','batch_sends','batch_document_versions']:
   seed,before,after=self.state();after['counts'][key]=1
   with self.assertRaises(RuntimeError):h.verify_own_state(seed,before,after)
 def test_foreign_receipt_provenance_denied(self):
  seed,before,after=self.state();after['artifact']['receiptId']='other'
  with self.assertRaises(RuntimeError):h.verify_own_state(seed,before,after)
 def test_identity_seed_not_external_claim(self):
  seed,before,after=self.state();seed['externalIdentityVerified']=True
  with self.assertRaises(RuntimeError):h.verify_own_state(seed,before,after)
 def test_pdf_preserves_source_text_and_appends_binding(self):
  seed={'originalPages':5,'signerName':'QA Name','receiptId':'QAReceipt','originalSha256':'b'*64};v=p.verify_text('Pages: 6\n','SAME','SAME','Confirmação do responsável QA Name QAReceipt '+('b'*64),seed);self.assertTrue(v['originalTextPreserved']);self.assertFalse(v['identityExternallyVerified'])
 def test_pdf_source_text_mismatch_fails(self):
  with self.assertRaises(RuntimeError):p.verify_text('Pages: 6\n','CHANGED','SAME','',{'originalPages':5})
 def test_pdf_missing_binding_fails(self):
  with self.assertRaises(RuntimeError):p.verify_text('Pages: 6\n','SAME','SAME','',{'originalPages':5,'signerName':'QA','receiptId':'r','originalSha256':'b'*64})
 def test_own_controller_namespace_and_port(self):self.assertIn('127.0.0.1:55494:5432',d.container_args('a'*12,'b'*64));self.assertEqual(d.network_args('a'*12)[-1],'peticao-r0014-'+('a'*12)+'-net')
 def test_no_secret_export(self):
  for n in ['private-markers.json','browser-config.json','seed.log','server.log','mail-outbox']:self.assertNotIn(n,c.ALLOW)
 def test_browser_contract_exact_checks_and_clean_env(self):
  self.assertEqual(len(b.EXPECTED_CHECKS),13);env=b.browser_environment(Path('/own'));self.assertNotIn('NODE_OPTIONS',env);self.assertEqual(env['PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK'],'1')

class ResultGateTests(unittest.TestCase):
 def setUp(self):
  import tempfile,json
  self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).parent/'mock-proof');self.run=Path(self.temp.name);(self.run/'downloads').mkdir();data=b'%PDF-DUMMY-OWN-NOT-REAL'
  for name in ['own-database.pdf','browser-own.pdf','browser-history-own.pdf']:(self.run/'downloads'/name).write_bytes(data)
  (self.run/'own-browser.png').write_bytes(b'\x89PNG\r\n\x1a\nDUMMY');self.generated={'artifact':{'artifactId':'a','requestId':'r','sha256':hashlib.sha256(data).hexdigest(),'byteLength':len(data)}}
  self.value={'exit':0,'sourceCommit':b.SOURCE,'identityPreconditionSeeded':True,'externalIdentityVerified':False,'A1OperationTested':False,'approvalOrSendAttempted':False,'browserTmpRemoved':True,'checks':[{'name':n,'passed':True}for n in b.EXPECTED_CHECKS],'blocked':[],'pageErrors':[],'consoleErrors':[],'requests':[{'method':'POST','path':'/api/admin/presidente/documentos-proprios'},{'method':'GET','path':'/api/admin/lotes/1/presidente/historico','source':'observer'}],'artifactId':'a','requestId':'r'}
  self.value['getObservations']=[{'phase':n,'status':200,'finishedError':None,'requestFailed':None,'passed':True}for n in ['receipt_inventory_GET','manual_own_recovery_GET','artifact_inventory_GET','receipt_inventory_GET','manual_own_recovery_GET']]
 def tearDown(self):self.temp.cleanup()
 def test_complete_result_gate(self):self.assertEqual(b.validate_result(self.run,self.value,self.generated)['passedBrowserChecks'],13)
 def test_missing_check_or_extra_post_never_success(self):
  self.value['checks'].pop()
  with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,self.value,self.generated)
  self.value['checks']=[{'name':n,'passed':True}for n in b.EXPECTED_CHECKS];self.value['requests']*=2
  with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,self.value,self.generated)
 def test_foreign_artifact_or_download_rejected(self):
  self.value['artifactId']='foreign'
  with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,self.value,self.generated)
  self.value['artifactId']='a';(self.run/'downloads/browser-own.pdf').write_bytes(b'CHANGED')
  with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,self.value,self.generated)
 def test_infrastructure_review_guard_precedes_execution_marker(self):
  source=(Path(__file__).parent/'functional_smoke.py').read_text()
  self.assertIn("CONFIG.get('infra_reviewed')is not True",source)
  self.assertLess(source.index("if CONFIG.get('infra_reviewed')"),source.index('verify_local_manifest()'))

if __name__=='__main__':unittest.main()
