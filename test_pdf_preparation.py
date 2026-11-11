import unittest,tempfile,hashlib,json,subprocess
from pathlib import Path
from unittest import mock
import preparation_http as h,pdf_parse as p,local_controller as c,docker_control as d
class PortalTests(unittest.TestCase):
 def html(self,created):return ('<form method="post" action="/api/admin/lotes/criar?portal=presidente"><button'+(' disabled=""'if created else'')+'>Fechar lote final agora</button></form>'+('<h2>Lote 1 · final</h2><dd>PDF pronto</dd><a href="/api/admin/lotes/1/pdf">Baixar PDF original</a>'if created else'<p>Nenhum lote ainda.</p>')).encode()
 def test_native_empty_form_enabled(self):self.assertFalse(h.inspect_portal(self.html(False),False)['finalButtonDisabled'])
 def test_created_final_form_disabled_and_download(self):self.assertTrue(h.inspect_portal(self.html(True),True)['finalButtonDisabled'])
 def test_duplicate_form_rejected(self):
  with self.assertRaises(RuntimeError):h.inspect_portal(self.html(False)*2,False)
 def test_missing_download_not_reviewable(self):
  with self.assertRaises(RuntimeError):h.inspect_portal(self.html(True).replace(b'/api/admin/lotes/1/pdf',b'/other'),True)
class PreparedTests(unittest.TestCase):
 def setUp(self):
  self.seed={'readyPdfSeeded':False,'cryptographicClassificationSeeded':False,'emptyDocumentTables':{'batches':0,'versions':0,'preparations':0},'listHash':'a'*64};self.snapshot={'batches':1,'kind':'final','status':'prepared','signatureKind':'none','listHash':'a'*64,'counts':{'signatures':3,'batch_preparations':1,'batch_document_versions':1,'mail_messages':0,'mail_message_attempts':0,'mail_outbox':0,'batch_sends':0},'historyAuthorId':1,'historyRecordedBy':1,'historyVariant':'original','exactHistoryBytes':True}
 def test_actual_generation_preconditions_and_publication_metadata(self):self.assertTrue(h.verify_prepared(self.seed,self.snapshot))
 def test_prebuilt_pdf_seed_never_accepted(self):
  self.seed['readyPdfSeeded']=True
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
 def test_crypto_classification_seed_rejected(self):
  self.seed['cryptographicClassificationSeeded']=True
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
 def test_wrong_reserved_list_hash_rejected(self):
  self.snapshot['listHash']='b'*64
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
 def test_mail_or_send_is_not_preparation_only(self):
  self.snapshot['counts']['mail_messages']=1
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
 def test_duplicate_version_or_missing_author_rejected(self):
  self.snapshot['counts']['batch_document_versions']=2
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
  self.snapshot['counts']['batch_document_versions']=1;self.snapshot['historyAuthorId']=None
  with self.assertRaises(RuntimeError):h.verify_prepared(self.seed,self.snapshot)
class PdfReaderTests(unittest.TestCase):
 def setUp(self):self.names=['Name A','Name B','Name C'];self.info='Title: Petição PLV 12/2026 - lote 1\nPages: 4\n';self.text='Name A Name B Name C '+('a'*16)+' NAO ASSINADO (teste)'
 def test_all_names_list_hash_footer_and_pages(self):self.assertEqual(p.verify_outputs(self.info,self.text,self.names,'a'*64)['pages'],4)
 def test_missing_name_rejected(self):
  with self.assertRaises(RuntimeError):p.verify_outputs(self.info,self.text.replace('Name C',''),self.names,'a'*64)
 def test_missing_unsigned_footer_rejected(self):
  with self.assertRaises(RuntimeError):p.verify_outputs(self.info,self.text.replace('NAO ASSINADO (teste)',''),self.names,'a'*64)
 def test_wrong_hash_or_title_rejected(self):
  with self.assertRaises(RuntimeError):p.verify_outputs(self.info,self.text,self.names,'b'*64)
  with self.assertRaises(RuntimeError):p.verify_outputs(self.info.replace('lote 1','lote 2'),self.text,self.names,'a'*64)
 def test_page_limit_rejected(self):
  for n in [0,1,21]:
   with self.assertRaises(RuntimeError):p.verify_outputs(self.info.replace('Pages: 4','Pages: '+str(n)),self.text,self.names,'a'*64)
 def test_pdf_readers_are_fixed_no_shell(self):
  with tempfile.TemporaryDirectory()as tmp:
   file=Path(tmp)/'generated.pdf';file.write_bytes(b'%PDF-DUMMY-MOCK-NOT-REAL')
   with mock.patch.object(p,'verify_tools'),mock.patch.object(p.subprocess,'run',side_effect=[mock.Mock(returncode=0,stdout=self.info),mock.Mock(returncode=0,stdout=self.text)])as run:
    self.assertTrue(p.parse_pdf(file,self.names,'a'*64)['parsed']);self.assertEqual(run.call_args_list[0].args[0],['/usr/bin/pdfinfo',str(file)]);self.assertEqual(run.call_args_list[1].args[0],['/usr/bin/pdftotext','-layout','-enc','UTF-8','-nopgbrk',str(file),'-']);self.assertTrue(all('shell'not in x.kwargs for x in run.call_args_list))
class ProfileTests(unittest.TestCase):
 def test_no_built_pdf_insert_and_no_approval_routes(self):
  root=Path(__file__).parent;s=(root/'fixture.cjs').read_text();self.assertNotIn('INSERT INTO batches',s);self.assertNotIn('INSERT INTO batch_document_versions',s);self.assertNotIn('INSERT INTO batch_packages',s);main=(root/'functional_smoke.py').read_text();self.assertNotIn('/(?:codigo|aprovar|conciliar)',main);self.assertNotIn('shutil.copytree(RUNTIME_SOURCE',main);self.assertIn("'RECIPIENTS':'','APPROVER_EMAIL':''",main)
 def test_own_r12_resource_names_ports(self):self.assertEqual(d.network_args('a'*12)[-1],'peticao-r0012-'+('a'*12)+'-net');self.assertIn('127.0.0.1:55492:5432',d.container_args('a'*12,'b'*64))
 def test_no_sensitive_artifacts_exported(self):
  for n in ['private-markers.json','server.log','seed.log','mail-outbox']:self.assertNotIn(n,c.ALLOW)
  self.assertIn('downloads/generated.pdf',c.ALLOW)
if __name__=='__main__':unittest.main()
