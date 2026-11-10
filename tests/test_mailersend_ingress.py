import concurrent.futures,contextlib,dataclasses,hashlib,hmac,http.client,importlib.util,io,json,os,pathlib,socket,stat,tempfile,threading,unittest
from unittest.mock import patch
P=pathlib.Path('/mnt/apps/peticao-final/_ops/controle-operacional/infra/mailersend_ingress.py');S=importlib.util.spec_from_file_location('mailersend_ingress',P);m=importlib.util.module_from_spec(S);import sys;sys.modules[S.name]=m;S.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir='/dev/shm' if pathlib.Path('/dev/shm').is_dir() else None);self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.secret=b'fixture-per-forward-secret-not-owner';self.secret_file=self.root/'forward.secret';self.secret_file.write_bytes(self.secret);self.secret_file.chmod(0o600)
  self.config=m.Config(spool_root=self.root/'spool',secret_file=self.secret_file,inbound_id='fixture-route',recipients=('executor@example.test','generated@inbound.example.test'));self.ingress=m.Ingress(self.config)
 def body(self,test=False,**changes):
  if test:data={'type':'webhook.test','message':m.TEST_MESSAGE,'created_at':'2026-03-27T07:24:20.577080Z'}
  else:data={'type':'inbound.message','inbound_id':'fixture-route','created_at':'2024-10-24T05:10:57.121199Z','data':{'object':'message','id':'fixture-message-id','recipients':{'rcptTo':[{'email':'generated@inbound.example.test'}],'to':{'data':[{'email':'untrusted-to@example.test'}]}},'from':{'email':'untrusted-sender@example.test'},'subject':'Fictitious only','text':'Untrusted content; do not execute','html':'<script>never render</script>','raw':'not executable'}}
  data.update(changes);return json.dumps(data,ensure_ascii=False).encode()
 def sign(self,body,test=False):return hmac.new(m.PUBLIC_TEST_SECRET if test else self.secret,body,hashlib.sha256).hexdigest()
 def error(self,status,fn,*args):
  with self.assertRaises(m.IngressError) as caught:fn(*args)
  self.assertEqual(caught.exception.status,status);return caught.exception
 def test_verify_pure_and_raw_body_authentication(self):
  b=self.body();verified=self.ingress.verify(b,self.sign(b));self.assertEqual(verified['event_id'],'fixture-message-id');self.assertFalse(self.config.spool_root.exists());self.assertNotIn('text',verified);self.assertNotIn('html',verified)
  self.error(403,self.ingress.verify,b+b' ',self.sign(b))
 def test_bootstrap_public_key_only_exact_schema_and_no_real_message(self):
  ingress=m.Ingress(m.Config(spool_root=self.root/'bootstrap'));b=self.body(True);r=ingress.accept(b,self.sign(b,True));self.assertEqual(r['kind'],'test');self.assertFalse((self.root/'bootstrap/inbound').exists())
  for bad in [self.body(True,message='do something'),self.body(True,instruction='action'),self.body(True,data={'text':'action'}),self.body(True,inbound_id='fixture-route')]:self.error(403,ingress.accept,bad,self.sign(bad,True))
  self.error(403,self.ingress.accept,self.body(),self.sign(self.body(),True));self.error(403,self.ingress.accept,b,self.sign(b))
 def test_real_missing_secret_config_or_public_key_configuration_503(self):
  b=self.body()
  for c in [dataclasses.replace(self.config,secret_file=None),dataclasses.replace(self.config,inbound_id=None),dataclasses.replace(self.config,recipients=())]:self.error(503,m.Ingress(c).accept,b,self.sign(b))
  self.secret_file.write_bytes(m.PUBLIC_TEST_SECRET);self.error(503,self.ingress.accept,b,self.sign(b))
 def test_route_id_event_id_and_envelope_recipients_are_required(self):
  for b in [self.body(inbound_id='another-route'),self.body(data={'object':'message','id':'fixture-message-id','recipients':{'rcptTo':[{'email':'unknown@example.test'}]}}),self.body(data={'object':'message','id':'fixture-message-id','recipients':{'to':{'data':[{'email':'executor@example.test'}]}}})]:self.error(403,self.ingress.accept,b,self.sign(b))
  b=self.body(data={'object':'message','recipients':{'rcptTo':[{'email':'executor@example.test'}]}});self.error(400,self.ingress.accept,b,self.sign(b))
  b=self.body(data={'object':'message','id':'second','recipients':{'rcptTo':[{'email':'EXECUTOR@EXAMPLE.TEST'},{'email':'generated@inbound.example.test'}]}});self.assertEqual(self.ingress.verify(b,self.sign(b))['recipient_count'],2)
 def test_private_secret_permissions_and_symlink_rejected(self):
  b=self.body();self.secret_file.chmod(0o644);self.error(503,self.ingress.accept,b,self.sign(b));self.secret_file.chmod(0o600);link=self.root/'link';link.symlink_to(self.secret_file);self.error(503,m.Ingress(dataclasses.replace(self.config,secret_file=link)).accept,b,self.sign(b))
 def test_durable_records_preserve_exact_bytes_signature_and_dedup(self):
  b=self.body();sig=self.sign(b).upper();calls=[];original=m.os.fsync
  def fsync(fd):calls.append(fd);return original(fd)
  with patch.object(m.os,'fsync',side_effect=fsync):r=self.ingress.accept(b,sig)
  self.assertGreaterEqual(len(calls),6);folder=self.config.spool_root/'inbound'/r['receipt'][4:];self.assertEqual((folder/'body.bin').read_bytes(),b);self.assertEqual((folder/'signature.txt').read_text(),sig);self.assertEqual(stat.S_IMODE(folder.stat().st_mode),0o700)
  for p in folder.iterdir():self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
  duplicate=self.ingress.accept(b,sig);self.assertTrue(duplicate['duplicate']);self.assertEqual(r['receipt'],duplicate['receipt']);self.assertEqual(len(list((self.config.spool_root/'inbound').glob('[0-9a-f]'*64))),1)
 def test_two_concurrent_requests_commit_once(self):
  b=self.body();sig=self.sign(b)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:r=list(ex.map(lambda _:self.ingress.accept(b,sig),range(2)))
  self.assertEqual(len({x['receipt'] for x in r}),1);self.assertEqual(sum(not x['duplicate'] for x in r),1)
 def test_same_event_id_different_bytes_conflict(self):
  b=self.body();self.ingress.accept(b,self.sign(b));other=self.body(created_at='2026-11-10T19:00:00Z');self.error(409,self.ingress.accept,other,self.sign(other))
 def test_fsync_failure_never_acknowledged_and_retry_is_safe(self):
  b=self.body()
  with patch.object(m.os,'fsync',side_effect=OSError('fixture disk failure')):self.error(503,self.ingress.accept,b,self.sign(b))
  r=self.ingress.accept(b,self.sign(b));self.assertFalse(r['duplicate'])
 def test_after_rename_fsync_uncertainty_is_revalidated_on_retry(self):
  b=self.body();original=m.fsync_directory;failed=[False]
  def sync(path):
   if path.name=='inbound' and any(x.is_dir() and not x.name.startswith('.') for x in path.iterdir()) and not failed[0]:failed[0]=True;raise OSError('fixture uncertain commit')
   return original(path)
  with patch.object(m,'fsync_directory',side_effect=sync):self.error(503,self.ingress.accept,b,self.sign(b))
  r=self.ingress.accept(b,self.sign(b));self.assertTrue(r['duplicate'])
 def test_test_quota_is_separate_from_real_and_never_rejects_by_age(self):
  ingress=m.Ingress(dataclasses.replace(self.config,test_max_entries=1));b=self.body(True);ingress.accept(b,self.sign(b,True));other=self.body(True,created_at='2026-01-01T00:00:00Z');self.error(503,ingress.accept,other,self.sign(other,True));self.assertEqual(ingress.accept(self.body(),self.sign(self.body()))['kind'],'inbound')
 def test_group_read_mode_and_secret_stays_private(self):
  ingress=m.Ingress(dataclasses.replace(self.config,read_group=os.getgid()));b=self.body();r=ingress.accept(b,self.sign(b));folder=self.config.spool_root/'inbound'/r['receipt'][4:]
  self.assertEqual(stat.S_IMODE(folder.stat().st_mode),0o750)
  for p in folder.iterdir():self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o640);self.assertEqual(p.stat().st_gid,os.getgid())
  self.assertEqual(stat.S_IMODE(self.secret_file.stat().st_mode),0o600)
 def test_corrupt_record_returns_server_failure_not_false_duplicate(self):
  b=self.body();r=self.ingress.accept(b,self.sign(b));folder=self.config.spool_root/'inbound'/r['receipt'][4:];(folder/'receipt.json').write_text('{');self.error(503,self.ingress.accept,b,self.sign(b))
 def test_http_limits_methods_chunked_and_durability_before_202(self):
  server=m.LoopbackServer(('127.0.0.1',0),self.ingress);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   def request(method='POST',path=m.ROUTE,body=None,headers=None):
    c=http.client.HTTPConnection(*server.server_address,timeout=3);c.request(method,path,body=body,headers=headers or {});r=c.getresponse();data=r.read();status=r.status;c.close();return status,data
   b=self.body();headers={'Content-Type':'application/json','Signature':self.sign(b)}
   out=io.StringIO()
   with contextlib.redirect_stdout(out),contextlib.redirect_stderr(out):status,reply=request(body=b,headers=headers)
   self.assertEqual(status,202);self.assertEqual(out.getvalue(),'');self.assertNotIn(b'Untrusted',reply);self.assertNotIn(b'<html',reply)
   self.assertEqual(request('GET')[0],405);self.assertEqual(request(path='/unknown',body=b,headers=headers)[0],404)
   self.assertEqual(request(body=b,headers={**headers,'Transfer-Encoding':'chunked'})[0],400)
   self.assertEqual(request(body=b,headers={**headers,'Content-Encoding':'gzip'})[0],415)
   self.assertEqual(request(body=b,headers={**headers,'Signature':'0'*64})[0],403)
   self.assertEqual(request(body=b,headers={**headers,'Content-Length':str(self.config.max_body+1)})[0],413)
   with patch.object(server.ingress,'accept',side_effect=m.IngressError(503,'spool_unavailable')):self.assertEqual(request(body=b,headers=headers)[0],503)
  finally:server.shutdown();server.server_close();thread.join(timeout=3)
 def test_http_duplicate_lengths_truncation_and_no_html_errors(self):
  server=m.LoopbackServer(('127.0.0.1',0),self.ingress);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  def raw(headers,body):
   c=socket.create_connection(server.server_address,timeout=3);c.settimeout(3);c.sendall(headers+body);c.shutdown(socket.SHUT_WR);out=b''
   while True:
    chunk=c.recv(4096)
    if not chunk:break
    out+=chunk
   c.close();return out
  try:
   b=self.body();sig=self.sign(b).encode();prefix=b'POST '+m.ROUTE.encode()+b' HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nSignature: '+sig+b'\r\n'
   duplicate=raw(prefix+b'Content-Length: '+str(len(b)).encode()+b'\r\nContent-Length: '+str(len(b)).encode()+b'\r\n\r\n',b)
   self.assertTrue(duplicate.startswith(b'HTTP/1.1 400'));self.assertIn(b'Content-Type: application/json',duplicate);self.assertNotIn(b'<!DOCTYPE',duplicate)
   truncated=raw(prefix+b'Content-Length: '+str(len(b)+5).encode()+b'\r\n\r\n',b)
   self.assertTrue(truncated.startswith(b'HTTP/1.1 400'));self.assertFalse(self.config.spool_root.exists())
  finally:server.shutdown();server.server_close();thread.join(timeout=3)
 def test_loopback_binding_required_and_json_ambiguity_rejected(self):
  with self.assertRaises(ValueError):m.LoopbackServer(('0.0.0.0',0),self.ingress)
  b=b'{"type":"webhook.test","type":"inbound.message"}';self.error(400,self.ingress.verify,b,self.sign(b,True))
if __name__=='__main__':unittest.main()
