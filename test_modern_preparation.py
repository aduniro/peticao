import unittest,tempfile,json,hashlib
from pathlib import Path
from unittest import mock
import preparation_http as h,pdf_parse as p,browser_hook as b,local_controller as c,docker_control as d
class ModernSnapshotTests(unittest.TestCase):
 def setUp(self):
  self.seed={'readyPdfSeeded':False,'cryptographicClassificationSeeded':False,'emptyDocumentTables':{'batches':0,'versions':0,'preparations':0},'listHash':'a'*64};self.snap={'batches':1,'kind':'final','status':'prepared','signatureKind':'none','listHash':'a'*64,'snapshotVersion':2,'signaturePreparation':'a1','preparedSignedNote':'','referencePublished':False,'documentReference':{'id':'11111111-1111-4111-8111-111111111111','url':'https://documents.example.org/api/documentos/referencia/11111111-1111-4111-8111-111111111111'},'historyAuthorId':1,'historyRecordedBy':1,'historyVariant':'original','exactHistoryBytes':True,'counts':{'signatures':3,'batch_preparations':1,'batch_document_versions':1,'document_references':1,'batch_a1_jobs':0,'batch_a1_validations':0,'document_reference_bindings':0,'mail_messages':0,'mail_message_attempts':0,'mail_outbox':0,'batch_sends':0}}
 def test_render_only_policy_and_real_publication_metadata_pass(self):self.assertTrue(h.verify_prepared(self.seed,self.snap))
 def test_old_snapshot_or_old_footer_not_modern(self):
  for key,val in [('snapshotVersion',1),('preparedSignedNote','NAO ASSINADO (teste)'),('signaturePreparation',None)]:
   before=self.snap[key];self.snap[key]=val
   with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snap)
   self.snap[key]=before
 def test_signing_job_validation_publication_or_mail_effect_refused(self):
  for key in ['batch_a1_jobs','batch_a1_validations','document_reference_bindings','mail_messages','batch_sends']:
   self.snap['counts'][key]=1
   with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snap)
   self.snap['counts'][key]=0
 def test_loopback_or_mismatched_reference_refused(self):
  self.snap['documentReference']['url']='http://127.0.0.1:31394/reference'
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snap)
class ModernPdfTests(unittest.TestCase):
 def setUp(self):self.ref={'id':'11111111-1111-4111-8111-111111111111','url':'https://documents.example.org/api/documentos/referencia/11111111-1111-4111-8111-111111111111'};self.info='Title: Petição PLV 12/2026 - lote 1\nPages: 3\n';self.text='Name A '+('a'*16)+'\fAutenticidade: '+self.ref['id']+' Name B\fName C\f';self.names=['Name A','Name B','Name C']
 def test_reference_uuid_text_and_no_old_footer(self):
  j=p.verify_outputs(self.info,self.text,self.names,'a'*64,self.ref);self.assertEqual(j['referencePage'],2);self.assertFalse(j['qrIndependentlyDecoded'])
 def test_old_unsigned_footer_rejected_even_with_accent(self):
  for footer in ['NAO ASSINADO (teste)','NÃO ASSINADO (teste)']:
   with self.assertRaises(RuntimeError):p.verify_outputs(self.info,self.text+footer,self.names,'a'*64,self.ref)
 def test_missing_or_duplicate_reference_page_refused(self):
  for text in [self.text.replace(self.ref['id'],''),self.text+'Autenticidade: '+self.ref['id']]:
   with self.assertRaises(RuntimeError):p.verify_outputs(self.info,text,self.names,'a'*64,self.ref)
 def test_pinned_raster_command_only_no_actual_poppler(self):
  with tempfile.TemporaryDirectory()as tmp:
   pdf=Path(tmp)/'generated.pdf';pdf.write_bytes(b'%PDF-DUMMY-MOCK')
   def run(args,**kw):
    if args[0]=='/usr/bin/pdfinfo':return mock.Mock(returncode=0,stdout=self.info)
    if args[0]=='/usr/bin/pdftotext':return mock.Mock(returncode=0,stdout=self.text)
    self.assertEqual(args[:7],['/usr/bin/pdftoppm','-f','2','-l','2','-singlefile','-png']);Path(args[-1]+'.png').write_bytes(b'\x89PNG\r\n\x1a\nDUMMY-NOT-A-REAL-RASTER');return mock.Mock(returncode=0,stdout='')
   with mock.patch.object(p,'verify_tools'),mock.patch.object(p.subprocess,'run',side_effect=run)as calls:
    result=p.parse_pdf(pdf,self.names,'a'*64,self.ref);self.assertTrue(result['qrVisualReviewPending']);self.assertEqual(calls.call_count,3)
class ProfileTests(unittest.TestCase):
 def test_fifteen_checks_and_strict_unit(self):
  self.assertEqual(len(b.EXPECTED_CHECKS),15);self.assertEqual(len(set(b.EXPECTED_CHECKS)),15);self.assertIn('r0014',str(b.ROOT));self.assertIn('127.0.0.1:55494:5432',d.container_args('a'*12,'b'*64))
 def test_driver_env_has_no_application_secrets_or_provider(self):
  env=b.browser_environment(b.ROOT/'runs'/('a'*12));self.assertNotIn('DATABASE_URL',env);self.assertNotIn('HASH_PEPPER',env)
 def test_no_seed_document_or_signature_operation_and_readiness_unconditional(self):
  root=Path(__file__).parent;fixture=(root/'fixture.cjs').read_text();self.assertNotIn('INSERT INTO batches',fixture);self.assertNotIn('INSERT INTO batch_a1_jobs',fixture);main=(root/'functional_smoke.py').read_text();self.assertIn("request('GET','/privacidade')",main);self.assertNotIn("request('GET','/presidente')",main);self.assertIn("'RECIPIENTS':'','APPROVER_EMAIL':''",main);self.assertNotIn('shutil.copytree(RUNTIME_SOURCE',main)
 def test_private_json_mode(self):
  with tempfile.TemporaryDirectory()as tmp:
   f=Path(tmp)/'data.json';f.write_text('{}');f.chmod(0o644)
   with self.assertRaises(b.BrowserHookError):b.read_private_json(f)
 def test_config_requires_own_root_unit(self):
  with self.assertRaises(b.BrowserHookError):b.make_config(Path('/tmp/foreign'),'adm='+'a'*32,'/foreign',[])
 def test_private_cookie_server_logs_not_exported(self):
  for name in ['browser-config.json','private-markers.json','server.log','browser-stdout.log','mail-outbox']:self.assertNotIn(name,c.ALLOW)
  self.assertIn('downloads/reference-page.png',c.ALLOW)
 def test_cancel_handler_deferred_during_cleanup(self):
  s=c.CancellationState();s.cleaning=True;s.handle(15,None);self.assertEqual(s.signals,1);s.cleaning=False
  with self.assertRaises(c.Cancelled):s.handle(15,None)
if __name__=='__main__':unittest.main()
