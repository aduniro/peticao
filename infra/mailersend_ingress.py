#!/usr/bin/python3
"""Loopback MailerSend inbound receiver: authenticate, durably spool, then 202. Never execute."""
from __future__ import annotations
import argparse, contextlib, dataclasses, datetime as dt, fcntl, hashlib, hmac, http.server, ipaddress, json, os, pathlib, re, secrets, socket, stat, threading, time
PUBLIC_TEST_SECRET=b'test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G'
TEST_MESSAGE='This is a ping test message'
ROUTE='/mailersend/inbound'
class IngressError(Exception):
 def __init__(self,status,code):self.status=status;self.code=code;super().__init__(code)
def stamp():return dt.datetime.now(dt.timezone.utc).isoformat()
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def strict_json(body):
 def pairs(items):
  value={}
  for k,v in items:
   if k in value:raise IngressError(400,'duplicate_json_key')
   value[k]=v
  return value
 try:return json.loads(body.decode('utf8'),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(IngressError(400,'invalid_json')))
 except IngressError:raise
 except (UnicodeError,ValueError,RecursionError):raise IngressError(400,'invalid_json') from None
def iso_time(value):
 if not isinstance(value,str) or len(value)>64:raise IngressError(400,'invalid_created_at')
 try:
  parsed=dt.datetime.fromisoformat(value[:-1]+'+00:00' if value.endswith('Z') else value)
  if parsed.tzinfo is None:raise ValueError()
 except ValueError:raise IngressError(400,'invalid_created_at') from None
 return value
def recipient(value):
 if not isinstance(value,str) or len(value)>254 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+',value):raise ValueError('Invalid configured recipient')
 return value.casefold()
@dataclasses.dataclass(frozen=True)
class Config:
 spool_root:pathlib.Path
 secret_file:pathlib.Path|None=None
 inbound_id:str|None=None
 recipients:tuple[str,...]=()
 max_body:int=262144
 test_max_entries:int=32
 test_max_bytes:int=2*1024**2
 inbound_max_entries:int=10000
 inbound_max_bytes:int=256*1024**2
 read_group:int|None=None
 def __post_init__(self):
  root=pathlib.Path(self.spool_root)
  if not root.is_absolute():raise ValueError('Absolute spool root required')
  object.__setattr__(self,'spool_root',root)
  if self.secret_file is not None:
   p=pathlib.Path(self.secret_file)
   if not p.is_absolute():raise ValueError('Absolute secret path required')
   object.__setattr__(self,'secret_file',p)
  values=tuple(dict.fromkeys(recipient(x) for x in self.recipients))
  if len(values)>4:raise ValueError('At most four fixed recipients')
  object.__setattr__(self,'recipients',values)
  if not 1<=self.max_body<=1048576 or min(self.test_max_entries,self.test_max_bytes,self.inbound_max_entries,self.inbound_max_bytes)<1:raise ValueError('Invalid storage/body limit')
  if self.read_group is not None and (type(self.read_group) is not int or self.read_group<0):raise ValueError('Invalid private read group')
class Ingress:
 def __init__(self,config):self.config=config
 def secret(self):
  p=self.config.secret_file
  if p is None or not self.config.inbound_id or not self.config.recipients:raise IngressError(503,'real_forward_not_configured')
  if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,127}',self.config.inbound_id):raise IngressError(503,'real_forward_not_configured')
  try:
   if p.is_symlink():raise IngressError(503,'forward_secret_unavailable')
   fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
   with os.fdopen(fd,'rb') as f:
    info=os.fstat(f.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>258:raise IngressError(503,'forward_secret_unavailable')
    value=f.read(259).rstrip(b'\r\n')
  except IngressError:raise
  except OSError:raise IngressError(503,'forward_secret_unavailable') from None
  if not 16<=len(value)<=256 or any(x<33 or x>126 for x in value) or hmac.compare_digest(value,PUBLIC_TEST_SECRET):raise IngressError(503,'forward_secret_unavailable')
  return value
 def verify(self,raw_bytes,signature_hex):
  """No spool writes and no instruction extraction. Only the provider-forward credential is read."""
  if not isinstance(raw_bytes,bytes) or not 0<len(raw_bytes)<=self.config.max_body:raise IngressError(413,'body_limit')
  if not isinstance(signature_hex,str) or not re.fullmatch('[a-fA-F0-9]{64}',signature_hex):raise IngressError(403,'invalid_signature')
  value=strict_json(raw_bytes)
  if not isinstance(value,dict):raise IngressError(400,'invalid_payload')
  kind=value.get('type');signature=signature_hex.lower();test_mac=hmac.new(PUBLIC_TEST_SECRET,raw_bytes,hashlib.sha256).hexdigest()
  if kind=='webhook.test':
   if set(value)!={'type','message','created_at'} or value.get('message')!=TEST_MESSAGE or not hmac.compare_digest(test_mac,signature):raise IngressError(403,'invalid_test_signature_or_schema')
   created=iso_time(value.get('created_at'));return {'kind':'test','event_id':created,'inbound_id':None,'created_at':created,'body_sha256':hashlib.sha256(raw_bytes).hexdigest(),'authenticated_by':'official_public_test_key','secret_fingerprint':hashlib.sha256(PUBLIC_TEST_SECRET).hexdigest()}
  if kind!='inbound.message':raise IngressError(403,'event_type_not_allowed')
  if hmac.compare_digest(test_mac,signature):raise IngressError(403,'public_test_key_forbidden_for_message')
  secret=self.secret()
  if not hmac.compare_digest(hmac.new(secret,raw_bytes,hashlib.sha256).hexdigest(),signature):raise IngressError(403,'invalid_signature')
  if value.get('inbound_id')!=self.config.inbound_id:raise IngressError(403,'inbound_id_not_allowed')
  created=iso_time(value.get('created_at'));data=value.get('data')
  if not isinstance(data,dict) or data.get('object')!='message' or not isinstance(data.get('id'),str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',data['id']):raise IngressError(400,'message_event_id_required')
  recipients=data.get('recipients');rcpt=recipients.get('rcptTo') if isinstance(recipients,dict) else None
  if not isinstance(rcpt,list) or not 1<=len(rcpt)<=8:raise IngressError(403,'recipient_not_allowed')
  try:
   actual={recipient(item.get('email')) for item in rcpt if isinstance(item,dict)}
   if len([x for x in rcpt if isinstance(x,dict)])!=len(rcpt) or not actual or not actual.issubset(self.config.recipients):raise ValueError()
  except (ValueError,TypeError):raise IngressError(403,'recipient_not_allowed') from None
  return {'kind':'inbound','event_id':data['id'],'inbound_id':value['inbound_id'],'created_at':created,'body_sha256':hashlib.sha256(raw_bytes).hexdigest(),'authenticated_by':'configured_per_forward_secret','secret_fingerprint':hashlib.sha256(secret).hexdigest(),'recipient_count':len(actual),'recipient_fingerprint':hashlib.sha256(canonical(sorted(actual))).hexdigest()}
 def accept(self,raw_bytes,signature_hex):
  verified=self.verify(raw_bytes,signature_hex)
  return DurableSpool(self.config).store(raw_bytes,signature_hex,verified)

def fsync_directory(path):
 fd=os.open(path,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
 try:os.fsync(fd)
 finally:os.close(fd)
def mkdir_durable(path,mode=0o700):
 if path.exists():
  if path.is_symlink() or not path.is_dir():raise IngressError(503,'spool_unavailable')
  return
 mkdir_durable(path.parent,mode)
 try:os.mkdir(path,mode)
 except FileExistsError:
  if path.is_symlink() or not path.is_dir():raise IngressError(503,'spool_unavailable')
 fsync_directory(path);fsync_directory(path.parent)
class DurableSpool:
 def __init__(self,config):
  self.config=config;self.root=config.spool_root;self.dir_mode=0o700 if config.read_group is None else 0o750;self.file_mode=0o600 if config.read_group is None else 0o640
 def permissions(self,path,is_dir=False):
  if self.config.read_group is not None:os.chown(path,-1,self.config.read_group)
  os.chmod(path,self.dir_mode if is_dir else self.file_mode)
 def directory(self,path):
  if path.is_symlink():raise IngressError(503,'spool_unavailable')
  new=not path.exists();mkdir_durable(path,self.dir_mode)
  if new:self.permissions(path,True);fsync_directory(path);fsync_directory(path.parent)
  info=path.stat()
  if info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=self.dir_mode or (self.config.read_group is not None and info.st_gid!=self.config.read_group):raise IngressError(503,'spool_permissions_invalid')
 def write_file(self,path,data):
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),self.file_mode)
  with os.fdopen(fd,'wb') as f:
   self.permissions(path);f.write(data);f.flush();os.fsync(f.fileno())
 def read_file(self,path,limit):
  fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
  with os.fdopen(fd,'rb') as f:
   info=os.fstat(f.fileno())
   if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=self.file_mode or info.st_size>limit or (self.config.read_group is not None and info.st_gid!=self.config.read_group):raise IngressError(503,'spool_record_invalid')
   return f.read(limit+1)
 @contextlib.contextmanager
 def lock(self,bucket):
  path=bucket/'.ingress.lock';fd=os.open(path,os.O_RDWR|os.O_CREAT|getattr(os,'O_NOFOLLOW',0),0o600)
  with os.fdopen(fd,'r+b') as f:
   st=os.fstat(f.fileno())
   if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o600:raise IngressError(503,'spool_lock_invalid')
   end=time.monotonic()+1.5
   while True:
    try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);break
    except BlockingIOError:
     if time.monotonic()>end:raise IngressError(503,'spool_busy')
     time.sleep(0.01)
   try:yield
   finally:fcntl.flock(f,fcntl.LOCK_UN)
 def usage(self,bucket):
  entries=0;total=0
  for path in bucket.iterdir():
   if path.name=='.ingress.lock':continue
   if path.is_symlink() or not path.is_dir():raise IngressError(503,'spool_record_invalid')
   entries+=1
   for child in path.iterdir():
    if child.is_symlink() or not child.is_file():raise IngressError(503,'spool_record_invalid')
    total+=child.stat().st_size
  return entries,total
 def store(self,body,signature,verified):
  try:
   self.directory(self.root);bucket=self.root/verified['kind'];self.directory(bucket)
   event_key=hashlib.sha256(canonical({'kind':verified['kind'],'inbound_id':verified['inbound_id'],'event_id':verified['event_id']})).hexdigest();target=bucket/event_key;receipt='msi-'+event_key
   with self.lock(bucket):
    if target.exists():
     if target.is_symlink() or not target.is_dir():raise IngressError(503,'spool_record_invalid')
     self.directory(target)
     try:meta=strict_json(self.read_file(target/'receipt.json',16384))
     except IngressError:raise IngressError(503,'spool_record_invalid') from None
     if not isinstance(meta,dict):raise IngressError(503,'spool_record_invalid')
     saved=self.read_file(target/'body.bin',self.config.max_body);saved_signature=self.read_file(target/'signature.txt',128).decode('ascii')
     if meta.get('body_sha256')!=verified['body_sha256'] or hashlib.sha256(saved).hexdigest()!=verified['body_sha256'] or len(saved)!=len(body):raise IngressError(409,'event_id_payload_conflict')
     if not re.fullmatch('[a-fA-F0-9]{64}',saved_signature) or meta.get('receipt')!=receipt:raise IngressError(503,'spool_record_invalid')
     # Retry after an uncertain fsync must re-establish durability before acknowledgement.
     for name in ['body.bin','signature.txt','receipt.json']:
      fd=os.open(target/name,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
      try:os.fsync(fd)
      finally:os.close(fd)
     fsync_directory(target);fsync_directory(bucket)
     return {'receipt':receipt,'kind':verified['kind'],'duplicate':True}
    entries,total=self.usage(bucket);is_test=verified['kind']=='test';max_entries=self.config.test_max_entries if is_test else self.config.inbound_max_entries;max_bytes=self.config.test_max_bytes if is_test else self.config.inbound_max_bytes
    meta={**verified,'receipt':receipt,'received_at':stamp(),'body_bytes':len(body),'signature_header':'Signature','signature_algorithm':'HMAC-SHA256/raw-body','scope':'provider_validation_only_not_a_command' if is_test else 'authenticated_transport_only_not_owner_approval'}
    metadata=canonical(meta);cost=len(body)+len(signature.encode('ascii'))+len(metadata)
    if entries>=max_entries or total+cost>max_bytes:raise IngressError(503,'spool_quota_exceeded')
    stage=bucket/('.stage-'+secrets.token_hex(16));os.mkdir(stage,self.dir_mode);self.permissions(stage,True)
    self.write_file(stage/'body.bin',body);self.write_file(stage/'signature.txt',signature.encode('ascii'));self.write_file(stage/'receipt.json',metadata);fsync_directory(stage)
    os.rename(stage,target);fsync_directory(bucket)
    return {'receipt':receipt,'kind':verified['kind'],'duplicate':False}
  except IngressError:raise
  except (OSError,ValueError,UnicodeError):raise IngressError(503,'spool_unavailable') from None

class LoopbackServer(http.server.ThreadingHTTPServer):
 daemon_threads=True;request_queue_size=16
 def __init__(self,address,ingress):
  if address[0] not in ('127.0.0.1','::1'):raise ValueError('Loopback binding only')
  self.address_family=socket.AF_INET6 if address[0]=='::1' else socket.AF_INET;self.ingress=ingress;self.slots=threading.BoundedSemaphore(8);super().__init__(address,Handler)
 def process_request(self,request,client_address):
  if not self.slots.acquire(blocking=False):
   try:request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
   except OSError:pass
   self.shutdown_request(request);return
  try:super().process_request(request,client_address)
  except Exception:self.slots.release();raise
 def process_request_thread(self,request,client_address):
  try:super().process_request_thread(request,client_address)
  finally:self.slots.release()
 def handle_error(self,request,client_address):pass
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1';server_version='PrivateIngress';sys_version=''
 def setup(self):super().setup();self.connection.settimeout(5)
 def log_message(self,*args):pass
 def send_error(self,code,message=None,explain=None):self.reply(code,{'error':'http_request_rejected'})
 def handle_expect_100(self):self.reply(417,{'error':'expect_not_supported'});return False
 def reply(self,status,value):
  self.close_connection=True;body=canonical(value)
  try:
   self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.end_headers()
   if self.command!='HEAD':self.wfile.write(body)
  except (OSError,ValueError):pass
 def do_GET(self):self.reply(405,{'error':'method_not_allowed'})
 do_HEAD=do_GET;do_PUT=do_GET;do_DELETE=do_GET;do_PATCH=do_GET;do_OPTIONS=do_GET
 def do_POST(self):
  try:
   if not ipaddress.ip_address(self.client_address[0]).is_loopback:raise IngressError(403,'loopback_only')
   if self.path!=ROUTE:raise IngressError(404,'not_found')
   if sum(len(k)+len(v) for k,v in self.headers.items())>16384:raise IngressError(431,'headers_limit')
   if self.headers.get_all('Transfer-Encoding'):raise IngressError(400,'transfer_encoding_not_supported')
   if self.headers.get_all('Expect'):raise IngressError(417,'expect_not_supported')
   content_encoding=self.headers.get_all('Content-Encoding',[])
   if content_encoding and content_encoding!=['identity']:raise IngressError(415,'content_encoding_not_supported')
   lengths=self.headers.get_all('Content-Length',[])
   if not lengths:raise IngressError(411,'content_length_required')
   if len(lengths)!=1 or not re.fullmatch('[0-9]{1,10}',lengths[0]):raise IngressError(400,'invalid_content_length')
   size=int(lengths[0])
   if not 0<size<=self.server.ingress.config.max_body:raise IngressError(413,'body_limit')
   signatures=self.headers.get_all('Signature',[])
   if len(signatures)!=1 or not re.fullmatch('[a-fA-F0-9]{64}',signatures[0]):raise IngressError(403,'invalid_signature')
   types=self.headers.get_all('Content-Type',[])
   if len(types)!=1 or types[0].split(';',1)[0].strip().lower()!='application/json':raise IngressError(415,'content_type_not_supported')
   body=self.rfile.read(size)
   if len(body)!=size:raise IngressError(400,'incomplete_body')
   result=self.server.ingress.accept(body,signatures[0]);self.reply(202,{'accepted':True,**result})
  except IngressError as e:self.reply(e.status,{'error':e.code})
  except (OSError,TimeoutError):self.reply(408,{'error':'body_read_timeout'})
  except Exception:self.reply(503,{'error':'ingress_unavailable'})
def main():
 os.umask(0o077);p=argparse.ArgumentParser(description=__doc__);p.add_argument('--listen',choices=['127.0.0.1','::1'],default='127.0.0.1');p.add_argument('--port',type=int,default=8790);p.add_argument('--spool-root',type=pathlib.Path,required=True);p.add_argument('--secret-file',type=pathlib.Path);p.add_argument('--inbound-id');p.add_argument('--recipient',action='append',default=[]);p.add_argument('--read-group',type=int);p.add_argument('--max-body',type=int,default=262144);a=p.parse_args()
 config=Config(spool_root=a.spool_root,secret_file=a.secret_file,inbound_id=a.inbound_id,recipients=tuple(a.recipient),read_group=a.read_group,max_body=a.max_body)
 with LoopbackServer((a.listen,a.port),Ingress(config)) as server:server.serve_forever()
if __name__=='__main__':main()
