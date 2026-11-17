import concurrent.futures,hashlib,http.client,importlib.util,json,pathlib,secrets,sqlite3,tempfile,threading,unittest,uuid
from unittest import mock
MODULE=pathlib.Path(__file__).resolve().parents[1]/'console'/'console.py'
spec=importlib.util.spec_from_file_location('opsconsole',MODULE);c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class ConsoleTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.time=[1000000.0]
  c.initialize(self.root,'https://ops.example.test',pepper=b'fixture-secret-pepper-32-bytes!!!!')
  self.app=c.Console(self.root,clock=lambda:self.time[0]);self.session,self.token=self.app.session(None,True)
 def tearDown(self):self.tmp.cleanup()
 def otp(self,session,purpose='login',release=None,destination='fixture'):
  request=self.app.request_otp(session,purpose,'fixture-peer',release['release_id'] if release else None,release['manifest_hash'] if release else None,destination if release else None)
  delivery=self.app.outbox_claim();self.assertEqual(delivery['recipient'],c.OWNER)
  code=delivery['payload']['otp'];self.app.outbox_result(delivery['id'],delivery['delivery_token'],'accepted','fixture-provider-id')
  return request['challenge_id'],code,delivery
 def login(self):
  cid,code,_=self.otp(self.session);verified=self.app.verify_otp(self.session,cid,code,'fixture-peer','login')
  session,_=self.app.session(verified['session_token']);return session
 def manifest(self,release_id='r0001-fixture'):
  artifact=self.root/'fixture.tar';artifact.write_bytes(b'fixture artifact; no deployment')
  manifest={'release_id':release_id,'title':'Fixture executável','source':{'commit':'a'*40},'build':{'status':'complete','executable':True,'runtime':{'node':'22.20.0'}},'artifact':{'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'bytes':artifact.stat().st_size,'format':'fixture'},'tests':[{'name':'fictício','status':'passed'}],'completed':['fixture'],'pending':[],'compatibility':{'public_admin':True,'schema_reviewed':True,'migrations_reviewed':True,'rollback_reviewed':True,'coordinator_acks':['apoio','admin']},'readiness':{'declared_ready':True}}
  return manifest,artifact
 def release(self,release_id='r0001-fixture'):
  manifest,artifact=self.manifest(release_id);return self.app.publish(manifest,artifact)
 def authorized_request(self):
  owner=self.login();release=self.release();cid,code,_=self.otp(owner,'deploy',release);grant=self.app.verify_otp(owner,cid,code,'fixture-peer','deploy')
  return owner,dict(request_id=str(uuid.uuid4()),release_id=release['release_id'],manifest_hash=release['manifest_hash'],destination='fixture',grant_token=grant['grant_token'])
 def test_otp_hash_attempts_expiry_and_fixed_owner(self):
  cid,code,delivery=self.otp(self.session)
  with self.app.db() as db:
   row=db.execute('SELECT code_hash,attempts FROM challenges WHERE id=?',(cid,)).fetchone();self.assertNotEqual(row['code_hash'],code)
   self.assertIsNone(db.execute('SELECT payload FROM outbox WHERE id=?',(delivery['id'],)).fetchone()['payload'])
  for _ in range(5):
   with self.assertRaises(c.Denied):self.app.verify_otp(self.session,cid,'00000000' if code!='00000000' else '99999999','fixture-peer')
  with self.assertRaises(c.Denied):self.app.verify_otp(self.session,cid,code,'fixture-peer')
  with self.app.db() as db:self.assertEqual(db.execute('SELECT attempts FROM challenges WHERE id=?',(cid,)).fetchone()[0],5)
  request=self.app.request_otp(self.session,'login','other-peer');self.time[0]+=601
  with self.assertRaises(c.Denied):self.app.verify_otp(self.session,request['challenge_id'],'12345678','other-peer')
  with self.app.db() as db:self.assertTrue(all(row[0] is None for row in db.execute('SELECT payload FROM outbox')))
 def test_otp_session_binding_single_use_and_cookie_rotation(self):
  cid,code,_=self.otp(self.session);other,_=self.app.session(None,True)
  with self.assertRaises(c.Denied):self.app.verify_otp(other,cid,code,'fixture-peer')
  verified=self.app.verify_otp(self.session,cid,code,'fixture-peer','login');self.assertNotEqual(self.token,verified['session_token'])
  with self.assertRaises(c.Denied):self.app.session(self.token)
  with self.assertRaises(c.Denied):self.app.verify_otp(self.session,cid,code,'fixture-peer')
 def test_outbox_uncertain_not_requeued_and_redacted(self):
  self.app.request_otp(self.session,'login','fixture-peer');delivery=self.app.outbox_claim()
  self.assertIsNone(self.app.outbox_claim())
  result=self.app.outbox_result(delivery['id'],delivery['delivery_token'],'uncertain');self.assertEqual(result['state'],'uncertain');self.assertIsNone(self.app.outbox_claim())
  self.assertTrue(self.app.outbox_result(delivery['id'],delivery['delivery_token'],'uncertain')['existing'])
  with self.app.db() as db:self.assertIsNone(db.execute('SELECT payload FROM outbox').fetchone()[0])
  with self.assertRaises(ValueError):self.app.outbox_result(delivery['id'],delivery['delivery_token'],'accepted')
 def test_rate_limit_and_event_log_has_no_otp(self):
  code=None
  for i in range(6):
   self.app.request_otp(self.session,'login','fixture-peer')
  with self.assertRaises(c.Denied) as raised:self.app.request_otp(self.session,'login','fixture-peer')
  self.assertEqual(raised.exception.status,429)
  with self.app.db() as db:
   payload=json.loads(db.execute('SELECT payload FROM outbox WHERE payload IS NOT NULL LIMIT 1').fetchone()[0]);events=''.join(row[0] for row in db.execute('SELECT data FROM events'))
   self.assertNotIn(payload['otp'],events);self.assertNotIn('code_hash',events)
 def test_immutable_catalog_and_source_only_blocked(self):
  manifest,artifact=self.manifest();published=self.app.publish(manifest,artifact);self.assertTrue(published['readiness']['ready'])
  self.assertTrue(self.app.publish(manifest,artifact)['existing'])
  changed={**manifest,'title':'mutated'}
  with self.assertRaisesRegex(ValueError,'immutable'):self.app.publish(changed,artifact)
  source={**manifest,'release_id':'r0000-source','artifact':None,'build':None,'readiness':{'declared_ready':False}}
  result=self.app.publish(source);self.assertFalse(result['readiness']['ready'])
  with self.assertRaises(c.Denied):self.app.request_otp(self.login(),'deploy','fixture-peer',result['release_id'],result['manifest_hash'],'fixture')
 def test_real_source_schema_adapter_preserves_original_hash(self):
  source={'schemaVersion':1,'releaseId':'r0000','state':'source-recorded','readyForDeploy':False,'deploymentEnabled':False,'source':{'commit':'a'*40},'runtimeArtifact':None,'buildResult':None,'databaseChanges':[],'changes':[],'pending':['real validation'],'evidence':{'paths':['/fixture/source']}}
  raw=json.dumps(source).encode();normalized=c.normalize_manifest(source,hashlib.sha256(raw).hexdigest());release=self.app.publish(normalized)
  self.assertFalse(release['readiness']['ready']);row=self.app.get_release('r0000');self.assertEqual(row['manifest']['original_manifest_sha256'],hashlib.sha256(raw).hexdigest());self.assertIsNone(row['artifact_path'])
 def test_missing_compatibility_never_infers_next_readiness(self):
  manifest,artifact=self.manifest();manifest['build']={'status':'complete','executable':True,'runtime':{'.next':'exists'}};manifest['compatibility']['coordinator_acks']=['apoio']
  result=self.app.publish(manifest,artifact);self.assertFalse(result['readiness']['ready'])
 def test_grant_scope_expiry_production_gate_and_unknown_commands(self):
  owner,request=self.authorized_request()
  changed={**request,'destination':'sp-production'}
  with self.assertRaises(c.Denied):self.app.enqueue(owner,changed)
  with self.assertRaises(c.Denied):self.app.enqueue(owner,{**request,'command':'touch /tmp/unapproved'})
  self.time[0]+=301
  with self.assertRaises(c.Denied):self.app.enqueue(owner,request)
 def test_idempotent_job_replay_concurrent_and_durable(self):
  owner,request=self.authorized_request()
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:jobs=list(pool.map(lambda _:self.app.enqueue(owner,request),range(4)))
  self.assertEqual(len({job['id'] for job in jobs}),1)
  restarted=c.Console(self.root,clock=lambda:self.time[0]);self.assertEqual(restarted.enqueue(owner,{**request,'grant_token':''})['id'],jobs[0]['id'])
  self.assertEqual(len(restarted.jobs()),1)
  with self.assertRaises(c.Denied):self.app.enqueue(owner,{**request,'manifest_hash':'b'*64})
  self.assertNotIn('grant_token',json.dumps(restarted.jobs()));self.assertNotIn('worker_token_hash',json.dumps(restarted.jobs()))
 def test_worker_integrity_single_claim_and_uncertain_reconciliation(self):
  owner,request=self.authorized_request();job=self.app.enqueue(owner,request);claim=self.app.claim('fixture-worker');self.assertEqual(claim['id'],job['id']);self.assertIsNone(self.app.claim('fixture-worker'))
  token=claim['worker_token'];self.app.update_job(job['id'],token,'running','staging',{'summary':'fixture'})
  self.app.update_job(job['id'],token,'uncertain','switch',{'error_code':'connection_lost'})
  self.assertIsNone(self.app.claim('other-worker'))
  with self.assertRaises(ValueError):self.app.update_job(job['id'],token,'completed','smoke',{})
  result=self.app.update_job(job['id'],token,'completed','reconciliation',{'summary':'verified exact release','artifact_sha256':claim['release']['manifest']['artifact']['sha256'],'deployed_commit':'a'*40,'checks':[{'name':'fixture receipt','status':'passed'}]},True);self.assertEqual(result['state'],'completed')
 def test_completion_cannot_claim_other_artifact_or_commit(self):
  owner,request=self.authorized_request();job=self.app.enqueue(owner,request);claim=self.app.claim('fixture-worker')
  with self.assertRaisesRegex(ValueError,'exact_artifact'):self.app.update_job(job['id'],claim['worker_token'],'completed','smoke',{'deployed_commit':'b'*40,'artifact_sha256':'c'*64,'checks':[{'name':'fixture','status':'passed'}]})
  self.assertEqual(self.app.jobs()[0]['state'],'reserved')
 def test_late_delivery_and_manual_uncertain_reconciliation(self):
  self.app.request_otp(self.session,'login','fixture-peer');delivery=self.app.outbox_claim();self.time[0]+=601
  self.assertEqual(self.app.outbox_result(delivery['id'],delivery['delivery_token'],'uncertain')['state'],'uncertain')
  self.assertEqual(self.app.outbox_result(delivery['id'],delivery['delivery_token'],'accepted','queried-receipt',True)['state'],'accepted')
  with self.assertRaises(c.Denied):self.app.verify_otp(self.session,delivery['payload']['challenge_id'],delivery['payload']['otp'],'fixture-peer')
 def test_artifact_tamper_blocks_claim(self):
  owner,request=self.authorized_request();self.app.enqueue(owner,request);release=self.app.get_release(request['release_id']);path=pathlib.Path(release['artifact_path']);path.chmod(0o600);path.write_bytes(b'tamper')
  with self.assertRaisesRegex(ValueError,'integrity'):self.app.claim('fixture-worker')
 def test_http_csrf_origin_secure_cookie_and_owner_flow(self):
  hook_calls=[]
  def hook(context,data):hook_calls.append((context,data));return {'state':'fixture_only'}
  server=c.make_server(self.app,port=0,extensions={('POST','/api/mail/approve'):hook});thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
  try:
   connection.request('GET','/api/session');r=connection.getresponse();data=json.loads(r.read());cookie=r.getheader('Set-Cookie');self.assertIn('HttpOnly',cookie);self.assertIn('Secure',cookie);self.assertIn('SameSite=Strict',cookie)
   csrf=data['csrf'];cookie=cookie.split(';')[0]
   headers={'Cookie':cookie,'Content-Type':'application/json','Origin':self.app.origin,'X-CSRF-Token':csrf}
   for change in [{'Origin':'https://evil.example'},{'X-CSRF-Token':'wrong'}]:
    connection.request('POST','/api/auth/request','{}',{**headers,**change});r=connection.getresponse();self.assertEqual(r.status,403);r.read()
   connection.request('GET','/api/releases',headers={'Cookie':cookie});r=connection.getresponse();self.assertEqual(r.status,403);r.read()
   connection.request('POST','/api/auth/request','{}',headers);r=connection.getresponse();request=json.loads(r.read());self.assertEqual(r.status,200);self.assertNotIn('otp',request)
   delivery=self.app.outbox_claim();self.app.outbox_result(delivery['id'],delivery['delivery_token'],'accepted')
   connection.request('POST','/api/auth/verify',json.dumps({'challenge_id':request['challenge_id'],'code':delivery['payload']['otp']}),headers);r=connection.getresponse();owner=json.loads(r.read());self.assertEqual(r.status,200);self.assertTrue(owner['owner']);self.assertNotIn('session_token',owner)
   owner_cookie=r.getheader('Set-Cookie').split(';')[0]
   connection.request('GET','/api/releases',headers={'Cookie':owner_cookie});r=connection.getresponse();self.assertEqual(r.status,200);self.assertEqual(json.loads(r.read())['releases'],[])
   owner_headers={**headers,'Cookie':owner_cookie,'X-CSRF-Token':owner['csrf']}
   connection.request('POST','/api/mail/approve','{}',owner_headers);r=connection.getresponse();self.assertEqual(r.status,200);r.read();self.assertEqual(set(hook_calls[0][0]),{'owner_id','session_id'})
   self.time[0]+=901
   connection.request('POST','/api/mail/approve','{}',owner_headers);r=connection.getresponse();self.assertEqual(r.status,403);r.read();self.assertEqual(len(hook_calls),1)
   connection.request('GET','/');r=connection.getresponse();self.assertIn("frame-ancestors 'none'",r.getheader('Content-Security-Policy'));self.assertEqual(r.status,200);self.assertIn(b'Vers',r.read())
  finally:connection.close();server.shutdown();server.server_close();thread.join()
 def test_pepper_permissions_and_private_bind(self):
  (self.root/'auth-pepper').chmod(0o644)
  with self.assertRaisesRegex(ValueError,'private'):c.Console(self.root)
  with self.assertRaisesRegex(ValueError,'private_bind'):c.make_server(self.app,host='0.0.0.0')

if __name__=='__main__':unittest.main()
