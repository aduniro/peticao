import dataclasses
import hashlib
import hmac
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest import mock

BASE=Path(__file__).resolve().parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
c=load('owner_review_console',BASE/'console'/'console.py')
e=load('owner_review_executor',BASE/'executor'/'executor.py')
m=load('owner_review_hooks',BASE/'infra'/'owner_mail_console.py')

class OwnerMailConsoleTests(unittest.TestCase):
 def setUp(self):
  self.folder=tempfile.TemporaryDirectory(dir='/dev/shm');self.root=Path(self.folder.name);self.clock=[int(time.time())]
  self.config=e.Config('fixture-provider','fixture-account',b'p'*32,'owner-pairing','owner-key-1',b'o'*32,'executor@fixture.invalid',{'ADMIN':str(uuid.uuid4()),'PAGINA':str(uuid.uuid4()),'APOIO':str(uuid.uuid4())},'fixture-provider','fixture-model',b'a'*32)
  self.adapter=e.FixtureAdapter();self.executor=e.Executor(self.root/'executor.sqlite',self.config,self.adapter)
  c.initialize(self.root/'console','https://ops.fixture.invalid',pepper=b'z'*48);self.console=c.Console(self.root/'console',clock=lambda:self.clock[0])
  self.audit=[];self.review=m.OwnerMailConsole(self.executor,self.config.approval_key,auth_pepper=self.console.pepper,denied=c.Denied,audit=lambda kind,value:self.audit.append((kind,value)),clock=lambda:self.clock[0])
  self.context={'owner_id':e.OWNER,'session_id':'f'*64}
 def tearDown(self):self.folder.cleanup()
 def stage(self,alias='ADMIN-V2',instruction='Revisar somente o material autorizado.'):
  data={'provider_id':self.config.provider_id,'provider_account_id':self.config.provider_account_id,'provider_event_id':uuid.uuid4().hex,'recipient':self.config.mailbox,'from':e.OWNER,'alias':alias,'instruction':instruction,'quoted_text':'SECRET_QUOTED_DO_NOT_EXECUTE','attachments':[{'text':'SECRET_ATTACHMENT'}]}
  body=e.canonical(data);stamp=str(self.clock[0]);nonce=uuid.uuid4().hex;headers={'x-executor-provider':self.config.provider_id,'x-executor-timestamp':stamp,'x-executor-nonce':nonce,'x-executor-signature':e.webhook_signature(self.config.provider_key,self.config.provider_id,stamp,nonce,body)}
  return self.executor.stage(body,headers,now=self.clock[0])
 def approve(self,stage):return self.review.approve(self.context,{'stage_id':stage['stage_id'],'instruction_sha256':stage['instruction_sha256']})
 def test_indices_only_metadata_and_read_exact_frozen_plain_text(self):
  text='<img src=x onerror="alert(1)"> instrução sensível de fixture';stage=self.stage(instruction=text)
  index=self.review.staging(self.context);encoded=json.dumps(index)
  self.assertNotIn(text,encoded);self.assertNotIn('SECRET_QUOTED',encoded);self.assertNotIn('instruction"',encoded)
  detail=self.review.read(self.context,{'stage_id':stage['stage_id']});self.assertEqual(detail['frozen']['instruction'],text);self.assertTrue(detail['untrusted_text']);self.assertEqual(detail['frozen']['display_alias'],'ADMIN-V2')
  self.assertNotIn('SECRET_ATTACHMENT',json.dumps(detail));self.assertEqual(self.review.status(self.context)['items'],[])
 def test_exact_hash_server_hmac_idempotent_and_no_dispatch(self):
  stage=self.stage();captured=[];original=self.executor.approve_staged
  def spy(assertion,signature,**kwargs):captured.append((assertion,signature));return original(assertion,signature,**kwargs)
  with mock.patch.object(self.executor,'approve_staged',side_effect=spy):first=self.approve(stage);second=self.approve(stage)
  self.assertEqual(first['id'],second['id']);self.assertFalse(first['dispatch_triggered']);self.assertEqual(self.adapter.submissions,[])
  assertion,signature=captured[0];self.assertEqual(assertion['instruction_sha256'],stage['instruction_sha256']);self.assertEqual(signature,hmac.new(self.config.approval_key,b'console-approve-v1\n'+e.canonical(assertion),hashlib.sha256).hexdigest())
  self.assertNotIn('instruction',assertion);self.assertNotIn(signature,json.dumps(self.audit));self.assertEqual(len(self.executor.list_status()),1)
  with self.executor.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM approval_nonces').fetchone()[0],1)
 def test_wrong_hash_fields_owner_and_key_are_rejected(self):
  stage=self.stage()
  for context in [{},{'owner_id':'attacker@fixture.invalid','session_id':'f'*64},{**self.context,'extra':'x'}]:
   with self.assertRaises(c.Denied):self.review.approve(context,{'stage_id':stage['stage_id'],'instruction_sha256':stage['instruction_sha256']})
  with self.assertRaises(c.Denied):self.review.approve(self.context,{'stage_id':stage['stage_id'],'instruction_sha256':'0'*64})
  with self.assertRaises(c.Denied):self.review.approve(self.context,{'stage_id':stage['stage_id'],'instruction_sha256':stage['instruction_sha256'],'signature':'browser-forged'})
  for key in [self.config.provider_key,self.config.owner_key,self.console.pepper,b'wrong'*8]:
   with self.assertRaises(ValueError):m.OwnerMailConsole(self.executor,key,auth_pepper=self.console.pepper,denied=c.Denied)
  self.assertEqual(self.executor.list_status(),[])
 def test_global_is_single_request_and_canonical_aliases(self):
  stage=self.stage('GERAL');detail=self.review.read(self.context,{'stage_id':stage['stage_id']});self.assertTrue(detail['metadata']['global_scope']);self.assertFalse(detail['metadata']['children_implemented'])
  result=self.approve(stage);self.assertEqual(result['alias'],'GERAL');self.assertEqual(result['metadata']['coordinator_alias'],'ADMIN');self.assertEqual(len(self.executor.list_status()),1);self.assertEqual(self.adapter.submissions,[])
  with self.executor.db() as db:self.assertEqual(db.execute('SELECT thread_id FROM requests').fetchone()[0],self.config.threads['ADMIN'])
  for raw,canonical in [('Admin-v2','ADMIN'),('homepage','PAGINA')]:
   item=self.stage(raw);self.assertEqual(self.review.read(self.context,{'stage_id':item['stage_id']})['frozen']['alias'],canonical)
 def test_lost_approval_response_requires_status_and_never_replays(self):
  stage=self.stage();original=self.executor.approve_staged
  def lost(*args,**kwargs):original(*args,**kwargs);raise TimeoutError('fixture transport lost')
  with mock.patch.object(self.executor,'approve_staged',side_effect=lost):
   with self.assertRaises(c.Denied) as raised:self.approve(stage)
   self.assertEqual(raised.exception.code,'approval_result_unknown_consult_status')
  self.assertEqual(len(self.review.status(self.context)['items']),1);self.assertEqual(self.review.read(self.context,{'stage_id':stage['stage_id']})['state'],'approved');self.assertEqual(self.adapter.submissions,[])
  self.approve(stage);self.assertEqual(len(self.executor.list_status()),1)
 def test_database_frozen_tamper_and_confirming_are_not_silently_approved(self):
  stage=self.stage()
  with self.executor.db() as db:db.execute("UPDATE staged SET state='confirming' WHERE id=?",(stage['stage_id'],))
  with self.assertRaises(c.Denied):self.approve(stage)
  with self.executor.db() as db:db.execute('UPDATE staged SET frozen=? WHERE id=?',(json.dumps({'alias':'ADMIN','instruction':'changed','from':e.OWNER,'recipient':self.config.mailbox}),stage['stage_id']))
  with self.assertRaises(c.Denied) as raised:self.review.read(self.context,{'stage_id':stage['stage_id']})
  self.assertEqual(raised.exception.code,'frozen_content_integrity_failure');self.assertEqual(self.executor.list_status(),[])
 def test_key_loader_requires_private_regular_absolute_file(self):
  path=self.root/'approval-key';path.write_bytes(b'k'*32);path.chmod(0o600);self.assertEqual(m.load_approval_key(path),b'k'*32)
  path.chmod(0o644)
  with self.assertRaises(PermissionError):m.load_approval_key(path)
  path.chmod(0o600);link=self.root/'key-link';link.symlink_to(path)
  with self.assertRaises(PermissionError):m.load_approval_key(link)
 def test_http_fresh_owner_otp_csrf_origin_and_exact_approval(self):
  stage=self.stage('homepage');server=c.make_server(self.console,port=0,extensions=self.review.extensions());thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
  def request(method,path,body=None,headers=None):
   connection.request(method,path,json.dumps(body) if body is not None else None,headers or {});response=connection.getresponse();return response,json.loads(response.read())
  try:
   response,data=request('GET','/api/session');cookie=response.getheader('Set-Cookie').split(';')[0];headers={'Cookie':cookie,'Content-Type':'application/json','Origin':self.console.origin,'X-CSRF-Token':data['csrf']}
   response,_=request('GET','/api/mail/staging',headers={'Cookie':cookie});self.assertEqual(response.status,403)
   response,challenge=request('POST','/api/auth/request',{},headers);self.assertEqual(response.status,200);mail=self.console.outbox_claim();self.console.outbox_result(mail['id'],mail['delivery_token'],'accepted')
   response,owner=request('POST','/api/auth/verify',{'challenge_id':challenge['challenge_id'],'code':mail['payload']['otp']},headers);self.assertEqual(response.status,200);cookie=response.getheader('Set-Cookie').split(';')[0];headers={**headers,'Cookie':cookie,'X-CSRF-Token':owner['csrf']}
   for bad in [{'X-CSRF-Token':'forged'},{'Origin':'https://evil.fixture.invalid'}]:
    response,_=request('POST','/api/mail/approve',{'stage_id':stage['stage_id'],'instruction_sha256':stage['instruction_sha256']},{**headers,**bad});self.assertEqual(response.status,403)
   response,index=request('GET','/api/mail/staging',headers={'Cookie':cookie});self.assertEqual(response.status,200);self.assertEqual(len(index['items']),1)
   response,detail=request('POST','/api/mail/read',{'stage_id':stage['stage_id']},headers);self.assertEqual(response.status,200);self.assertEqual(detail['frozen']['display_alias'],'HOMEPAGE')
   response,result=request('POST','/api/mail/approve',{'stage_id':stage['stage_id'],'instruction_sha256':detail['instruction_sha256']},headers);self.assertEqual(response.status,200);self.assertEqual(result['state'],'queued');self.assertEqual(self.adapter.submissions,[])
   self.clock[0]+=901
   response,_=request('GET','/api/mail/staging',headers={'Cookie':cookie});self.assertEqual(response.status,403)
   response,_=request('POST','/api/mail/approve',{'stage_id':stage['stage_id'],'instruction_sha256':stage['instruction_sha256']},headers);self.assertEqual(response.status,403)
   self.assertEqual(len(self.executor.list_status()),1)
  finally:connection.close();server.shutdown();server.server_close();thread.join()
 def test_frontend_uses_text_content_not_html_execution(self):
  script=(BASE/'console'/'app.js').read_text();self.assertIn("el('mail-text').textContent=item.frozen.instruction",script)
  for forbidden in ['.innerHTML','.outerHTML','insertAdjacentHTML','eval(']:self.assertNotIn(forbidden,script)

if __name__=='__main__':unittest.main()
