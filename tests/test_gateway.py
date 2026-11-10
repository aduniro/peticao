import subprocess,sys,concurrent.futures,importlib.util,json,pathlib,hashlib,hmac,os,secrets,sqlite3,tempfile,threading,time,unittest,struct
from unittest.mock import patch
P=pathlib.Path('/mnt/apps/peticao-final/_ops/controle-operacional/infra/local_codex_gateway.py');SPEC=importlib.util.spec_from_file_location('gateway',P);g=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(g)
class GatewayTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir="/dev/shm" if pathlib.Path("/dev/shm").is_dir() else None);self.root=pathlib.Path(self.tmp.name);self.key=b'fixture-hmac-secret-key-32-bytes!!';self.k=self.root/'hmac';self.k.write_bytes(self.key);self.k.chmod(0o600);self.adapter=g.FixtureAdapter();self.g=g.Gateway(self.k,self.root/'receipts.sqlite',self.adapter)
 def tearDown(self):self.tmp.cleanup()
 def request(self,action='submit',ident='request-0001',**extra):
  p={'action':action,'requestId':ident,'keyId':g.KEY_ID,'ts':int(time.time()),'nonce':secrets.token_hex(16)}
  if action=='submit':p.update(alias='apoio',instruction={'text':'Instrução fictícia explícita, não enviar mensagem real.'})
  p.update(extra);p['signature']=hmac.new(self.key,g.canonical(p),hashlib.sha256).hexdigest();return p
 def test_signature_timestamp_replay_and_no_dispatch_on_tampering(self):
  p=self.request();p['instruction']['text']='changed'
  with self.assertRaises(g.GatewayError):self.g.handle(p)
  p=self.request(ts=int(time.time())-121)
  with self.assertRaises(g.GatewayError):self.g.handle(p)
  p=self.request();self.g.handle(p)
  with self.assertRaises(g.GatewayError):self.g.handle(p)
  self.assertEqual(self.adapter.calls,1)
 def test_same_id_frozen_payload_has_one_receipt_and_one_attempt(self):
  a=self.g.handle(self.request());b=self.g.handle(self.request());self.assertEqual(a['receipt'],b['receipt']);self.assertEqual(self.adapter.calls,1)
  with self.assertRaises(g.GatewayError):self.g.handle(self.request(instruction={'text':'Outro texto explícito.'}))
 def test_fixture_status_correlates_and_returns_only_fixture_answer(self):
  a=self.g.handle(self.request());b=self.g.handle(self.request('status'))
  self.assertEqual(a['requestId'],b['requestId']);self.assertEqual(a['receipt'],b['receipt']);self.assertEqual(b['state'],'completed');self.assertFalse(b['live']);self.assertEqual(b['answer'],'fixture-completed')
 def test_busy_paused_unavailable_wait_without_attempt_and_retry_is_safe(self):
  for i,state in enumerate(('busy','paused','unavailable')):
   ident='request-wait-'+str(i);self.adapter.state=state;r=self.g.handle(self.request(ident=ident));self.assertEqual(r['state'],'waiting')
   self.assertEqual(self.adapter.calls,i);self.adapter.state='ready';r=self.g.handle(self.request(ident=ident));self.assertEqual(r['state'],'accepted');self.g.handle(self.request('status',ident))
  self.assertEqual(self.adapter.calls,3)
 def test_uncertain_send_never_retried_or_polled_into_false_success(self):
  self.adapter.state='uncertain';a=self.g.handle(self.request());self.assertEqual(a['state'],'uncertain')
  self.adapter.state='ready';b=self.g.handle(self.request());c=self.g.handle(self.request('status'));self.assertEqual(b['state'],'uncertain');self.assertEqual(c['state'],'uncertain');self.assertEqual(self.adapter.calls,1)
 def test_uncertain_alias_blocks_another_request(self):
  self.adapter.state='uncertain';self.g.handle(self.request());self.adapter.state='ready';r=self.g.handle(self.request(ident='request-0002'));self.assertEqual(r['state'],'waiting');self.assertEqual(r['reason'],'alias_busy');self.assertEqual(self.adapter.calls,1)
 def test_concurrent_identical_submit_does_not_duplicate(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(lambda _:self.g.handle(self.request()),range(6)))
  self.assertEqual(self.adapter.calls,1);self.assertEqual(len({r['receipt'] for r in results}),1)
 def test_default_disabled_never_opens_proxy_or_executes(self):
  gateway=g.Gateway(self.k,self.root/'disabled.sqlite')
  with patch.object(g.subprocess,'Popen',side_effect=AssertionError('no subprocess allowed')):
   r=gateway.handle(self.request());self.assertEqual(r['state'],'waiting');self.assertEqual(r['reason'],'live_adapter_not_qualified');self.assertFalse(r['live'])
 def test_forbidden_fields_alias_attachments_methods_and_target(self):
  bad=[{'alias':'arbitrary-thread'},{'method':'turn/start'},{'threadId':g.ALIASES['admin']},{'model':'different'},{'goal':'new'},{'instruction':{'text':'text','attachments':['file']}},{'action':'shell'},{'action':'turn/start'}]
  for extra in bad:
   with self.assertRaises(g.GatewayError):self.g.handle(self.request(**extra))
  self.assertEqual(self.adapter.calls,0)
 def test_hmac_file_must_be_private_regular_owned_and_no_symlink(self):
  self.k.chmod(0o644)
  with self.assertRaises(g.GatewayError):self.g.handle(self.request())
  self.k.chmod(0o600);link=self.root/'link';link.symlink_to(self.k);self.g.key_file=link
  with self.assertRaises(g.GatewayError):self.g.handle(self.request())
 def test_instruction_not_persisted_and_restarted_dispatch_is_uncertain(self):
  request=self.request();text=request['instruction']['text'];a=self.g.handle(request)
  with self.g.store.db() as d:
   allrows=list(d.execute('SELECT * FROM requests'))+list(d.execute('SELECT * FROM transitions'))+list(d.execute('SELECT * FROM used_nonces'))
   self.assertNotIn(text,json.dumps([tuple(r) for r in allrows]))
   d.execute("UPDATE requests SET state='dispatching' WHERE request_id=?",(a['requestId'],))
  self.assertEqual(self.g.handle(self.request('status'))['state'],'uncertain');self.assertEqual(self.g.handle(self.request())['state'],'uncertain');self.assertEqual(self.adapter.calls,1)
 def test_stdio_fixture_receipt_survives_processes_without_live_rpc(self):
  db=self.root/'stdio.sqlite'
  def invoke(payload):
   p=subprocess.run([sys.executable,str(P),'--adapter','fixture','--key-file',str(self.k),'--db',str(db)],input=json.dumps(payload),text=True,capture_output=True,check=True,timeout=10)
   self.assertEqual(p.stderr,'');return json.loads(p.stdout)['result']
  a=invoke(self.request());again=invoke(self.request());b=invoke(self.request('status'))
  self.assertEqual(a['receipt'],again['receipt']);self.assertEqual(a['receipt'],b['receipt']);self.assertEqual(b['state'],'completed');self.assertFalse(b['live'])
  with sqlite3.connect(db) as d:self.assertEqual(d.execute("SELECT COUNT(*) FROM transitions WHERE state='dispatching'").fetchone()[0],1)
 def test_duplicate_json_keys_rejected(self):
  with self.assertRaises(g.GatewayError):g.strict_json('{"action":"status","action":"shell"}')
  with self.assertRaises(g.GatewayError):g.strict_json('{"x":NaN}')
 def test_readonly_proxy_rejects_mutating_rpc_before_transport(self):
  proxy=g.ReadOnlyProxy()
  for method in ('turn/start','turn/steer','thread/resume','thread/start','thread/objective/set','thread/shellCommand'):
   with self.assertRaises(g.GatewayError):proxy.rpc(method,{})
  with self.assertRaises(g.GatewayError):proxy.rpc('thread/read',{'threadId':'unknown','includeTurns':False})
  with self.assertRaises(g.GatewayError):proxy.rpc('thread/read',{'threadId':g.ALIASES['apoio'],'includeTurns':True})
 def test_masked_client_websocket_frame_and_fragmented_server_reply(self):
  proxy=g.ReadOnlyProxy();sent=[];proxy.raw_send=sent.append;proxy.send({'id':1,'method':'initialize'});frame=sent[0]
  self.assertEqual(frame[0],0x81);self.assertTrue(frame[1]&0x80);n=frame[1]&127;mask=frame[2:6];decoded=bytes(b^mask[i%4] for i,b in enumerate(frame[6:6+n]));self.assertEqual(json.loads(decoded)['method'],'initialize')
  one=b'{"id":';two=b'1,"result":{}}';data=bytes([0x01,len(one)])+one+bytes([0x80,len(two)])+two
  def receive(size,deadline):
   nonlocal data
   value,data=data[:size],data[size:];return value
  proxy.receive_bytes=receive;self.assertEqual(proxy.receive_json(time.monotonic()+1),{'id':1,'result':{}})
if __name__=='__main__':unittest.main()
