#!/usr/bin/python3
"""Typed, authenticated local gateway. Live turn execution is deliberately disabled."""
from __future__ import annotations
import argparse, base64, struct, contextlib, datetime as dt, hashlib, hmac, json, os, pathlib, re, selectors, secrets, sqlite3, stat, subprocess, sys, time, uuid
BASE=pathlib.Path('/mnt/apps/peticao-final/_ops/controle-operacional')
CODEX=pathlib.Path('/home/barre/.codex/packages/app-server-daemon/releases/0.166.0-x86_64-unknown-linux-musl/bin/codex')
SOCKET=pathlib.Path('/home/barre/.codex/app-server-control/app-server-control.sock')
ALIASES={'apoio':'01a1c0b3-f069-75a0-a2e9-e691094c9bab','admin':'01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7'}
KEY_ID='local-codex-v1'
MAX_INPUT=65536
class GatewayError(Exception):
 def __init__(self,code):self.code=code;super().__init__(code)
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
def strict_json(raw):
 def pairs(items):
  result={}
  for key,value in items:
   if key in result:raise GatewayError('duplicate_json_key')
   result[key]=value
  return result
 try:return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(GatewayError('invalid_json_number')))
 except GatewayError:raise
 except Exception:raise GatewayError('invalid_json') from None
class ReadOnlyProxy:
 """Only connects the existing daemon; the allowlist contains no mutating RPC."""
 METHODS={'initialize','thread/read'}
 def __init__(self,timeout=15):self.timeout=timeout;self.proc=None;self.buffer=b'';self.counter=0;self.methods=[]
 def __enter__(self):
  try:
   socket_stat=SOCKET.stat()
   if not stat.S_ISSOCK(socket_stat.st_mode) or socket_stat.st_uid!=os.geteuid():raise GatewayError('existing_daemon_socket_unavailable')
   if not CODEX.is_file():raise GatewayError('qualified_client_unavailable')
   self.identity=(socket_stat.st_dev,socket_stat.st_ino)
   self.proc=subprocess.Popen([str(CODEX),'app-server','proxy','--sock',str(SOCKET)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0,start_new_session=True)
   self.selector=selectors.DefaultSelector();self.selector.register(self.proc.stdout,selectors.EVENT_READ)
   self.upgrade_websocket()
   self.rpc('initialize',{'clientInfo':{'name':'peticao_readonly_gateway','title':'Peticao read-only gateway qualification','version':'1.0'}})
   self.notify_initialized()
   return self
  except Exception:
   self.close();raise
 def raw_send(self,payload):
  try:self.proc.stdin.write(payload);self.proc.stdin.flush()
  except (OSError,BrokenPipeError):raise GatewayError('proxy_transport_unavailable') from None
 def receive_bytes(self,size,deadline):
  while len(self.buffer)<size:
   left=deadline-time.monotonic()
   if left<=0 or not self.selector.select(left):raise GatewayError('readonly_rpc_timeout')
   chunk=os.read(self.proc.stdout.fileno(),65536)
   if not chunk:raise GatewayError('proxy_transport_closed')
   self.buffer+=chunk
   if len(self.buffer)>4*1024**2+65536:raise GatewayError('readonly_response_too_large')
  value,self.buffer=self.buffer[:size],self.buffer[size:];return value
 def upgrade_websocket(self):
  key=base64.b64encode(secrets.token_bytes(16)).decode();deadline=time.monotonic()+self.timeout
  self.raw_send(('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
  header=b''
  while not header.endswith(b'\r\n\r\n'):
   header+=self.receive_bytes(1,deadline)
   if len(header)>16384:raise GatewayError('websocket_upgrade_too_large')
  rows=header.decode('ascii','strict').split('\r\n');status_line=rows[0].split()
  if len(status_line)<2 or status_line[1]!='101':raise GatewayError('websocket_upgrade_rejected')
  fields={k.lower():v.strip() for line in rows[1:] if ':' in line for k,v in [line.split(':',1)]}
  expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
  if fields.get('sec-websocket-accept')!=expected:raise GatewayError('websocket_upgrade_invalid_accept')
  self.websocket=True
 def send_frame(self,payload,opcode=1):
  mask=secrets.token_bytes(4);size=len(payload);header=bytes([0x80|opcode])
  header+=bytes([0x80|size]) if size<126 else bytes([0x80|126])+struct.pack('!H',size) if size<65536 else bytes([0x80|127])+struct.pack('!Q',size)
  self.raw_send(header+mask+bytes(b^mask[i%4] for i,b in enumerate(payload)))
 def send(self,value):self.send_frame(canonical(value))
 def receive_json(self,deadline):
  message=b'';started=False
  while True:
   first,second=self.receive_bytes(2,deadline);finished=bool(first&0x80);opcode=first&15
   if first&0x70 or second&0x80:raise GatewayError('invalid_websocket_frame')
   length=second&127
   if length==126:length=struct.unpack('!H',self.receive_bytes(2,deadline))[0]
   elif length==127:length=struct.unpack('!Q',self.receive_bytes(8,deadline))[0]
   if length>4*1024**2 or len(message)+length>4*1024**2:raise GatewayError('readonly_response_too_large')
   payload=self.receive_bytes(length,deadline)
   if opcode==8:raise GatewayError('proxy_transport_closed')
   if opcode==9:
    if not finished or length>125:raise GatewayError('invalid_websocket_ping')
    self.send_frame(payload,10);continue
   if opcode==10:continue
   if opcode==1:
    if started:raise GatewayError('invalid_websocket_fragment')
    started=True
   elif opcode!=0 or not started:raise GatewayError('unexpected_websocket_opcode')
   message+=payload
   if finished:return strict_json(message)
 def notify_initialized(self):
  self.methods.append('initialized');self.send({'method':'initialized'})
 def rpc(self,method,params):
  if method not in self.METHODS:raise GatewayError('rpc_method_forbidden')
  if method=='thread/read' and (set(params)!={'threadId','includeTurns'} or params['threadId'] not in ALIASES.values() or params['includeTurns'] is not False):raise GatewayError('rpc_target_or_history_forbidden')
  self.counter+=1;ident=self.counter;self.methods.append(method);self.send({'id':ident,'method':method,'params':params});deadline=time.monotonic()+self.timeout;notifications=0
  while True:
   message=self.receive_json(deadline)
   if not isinstance(message,dict):raise GatewayError('invalid_rpc_response')
   if 'method' in message:
    if 'id' in message:raise GatewayError('unexpected_server_request')
    notifications+=1
    if notifications>1000:raise GatewayError('excessive_rpc_notifications')
    continue
   if message.get('id')!=ident:raise GatewayError('unexpected_rpc_response_id')
   if 'error' in message:raise GatewayError('readonly_rpc_rejected')
   if 'result' not in message:raise GatewayError('invalid_rpc_response')
   return message['result']
 def thread(self,alias):
  if alias not in ALIASES:raise GatewayError('alias_forbidden')
  result=self.rpc('thread/read',{'threadId':ALIASES[alias],'includeTurns':False});thread=result.get('thread') if isinstance(result,dict) else None
  if not isinstance(thread,dict) or thread.get('id')!=ALIASES[alias]:raise GatewayError('thread_identity_mismatch')
  status=thread.get('status',{});kind=status.get('type') if isinstance(status,dict) else None
  if kind not in ('notLoaded','idle','systemError','active'):raise GatewayError('unknown_thread_state')
  objective=thread.get('objective');paused=isinstance(objective,dict) and objective.get('status')=='paused'
  flags=status.get('activeFlags',[]) if isinstance(status,dict) else []
  known_flags={'waitingOnApproval','waitingOnUserInput','reviewing','compacting','running'}
  return {'alias':alias,'threadId':thread['id'],'statusType':kind,'activeFlags':[x for x in flags if x in known_flags] if isinstance(flags,list) else [],'paused':paused,'historyRequested':False}
 def same_daemon(self):
  s=SOCKET.stat();return (s.st_dev,s.st_ino)==self.identity
 def close(self):
  if getattr(self,'proc',None):
   try:
    if self.proc.stdin:self.proc.stdin.close()
    self.proc.wait(timeout=2)
   except (subprocess.TimeoutExpired,OSError):
    self.proc.terminate()
    try:self.proc.wait(timeout=2)
    except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait(timeout=2)
   if self.proc.stdout:self.proc.stdout.close()
  if getattr(self,'selector',None):self.selector.close()
  self.buffer=b''
 def __exit__(self,*args):self.close()
def qualify_readonly():
 with ReadOnlyProxy() as p:
  threads=[p.thread(alias) for alias in ALIASES]
  return {'state':'qualified_readonly','live':False,'observedAt':now(),'rpcMethods':p.methods,'threads':threads,'sameDaemonSocket':p.same_daemon(),'newAppServerStarted':False,'turnMethodsSent':False,'historyStored':False,'clientPath':str(CODEX),'transport':'codex app-server proxy --sock existing-control-socket','documentation':'https://learn.chatgpt.com/docs/app-server'}

class DisabledAdapter:
 name='disabled'
 def probe(self,alias):return {'state':'unavailable','reason':'live_adapter_not_qualified'}
 def submit(self,alias,request_id,text):raise GatewayError('live_execution_disabled')
 def poll(self,receipt):return {'state':'uncertain','reason':'live_execution_disabled'}
class FixtureAdapter:
 """Explicit test adapter: contains no RPC/SSH/shell/model call."""
 name='fixture'
 def __init__(self,state='ready'):self.state=state;self.calls=0
 def probe(self,alias):return {'state':'ready' if self.state=='uncertain' else self.state,'reason':'fixture_'+self.state}
 def submit(self,alias,request_id,text):
  self.calls+=1
  if self.state=='uncertain':raise TimeoutError('fixture result deliberately unknown')
  return {'state':'accepted','reason':'fixture_only'}
 def poll(self,receipt):return {'state':'completed','reason':'fixture_only','answer':'fixture-completed'}
class ReceiptStore:
 def __init__(self,path):
  self.path=pathlib.Path(path)
  if not self.path.is_absolute() or self.path.is_symlink():raise GatewayError('invalid_receipt_path')
  self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with self.db() as d:
   d.executescript('''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS used_nonces(nonce TEXT PRIMARY KEY,at INTEGER NOT NULL,digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY,alias TEXT NOT NULL,instruction_hash TEXT NOT NULL,receipt TEXT UNIQUE NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,adapter TEXT NOT NULL,attempted INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,answer TEXT);
CREATE TABLE IF NOT EXISTS transitions(seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,at TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL);
''')
  self.path.chmod(0o600)
 @contextlib.contextmanager
 def db(self,write=False):
  d=sqlite3.connect(self.path,timeout=10,isolation_level=None);d.row_factory=sqlite3.Row;d.execute('PRAGMA busy_timeout=10000')
  try:
   if write:d.execute('BEGIN IMMEDIATE')
   yield d
   if write:d.commit()
  except BaseException:
   if write:d.rollback()
   raise
  finally:d.close()
 def consume_nonce(self,nonce,digest):
  with self.db(True) as d:
   try:d.execute('INSERT INTO used_nonces VALUES(?,?,?)',(nonce,int(time.time()),digest))
   except sqlite3.IntegrityError:raise GatewayError('replayed_nonce') from None
 def event(self,d,ident,state,reason):d.execute('INSERT INTO transitions(request_id,at,state,reason) VALUES(?,?,?,?)',(ident,now(),state,reason))
 def get(self,ident):
  with self.db() as d:
   row=d.execute('SELECT * FROM requests WHERE request_id=?',(ident,)).fetchone()
   if not row:raise GatewayError('unknown_request')
   return dict(row)
 def public(self,row):
  state=row['state'];reason=row['reason']
  if state=='dispatching':state='uncertain';reason='prior_attempt_not_resolved'
  return {'requestId':row['request_id'],'receipt':row['receipt'],'alias':row['alias'],'state':state,'reason':reason,'live':False,'adapter':row['adapter'],'instructionHash':row['instruction_hash'],'updatedAt':row['updated_at'],'answer':row['answer']}
 def waiting(self,ident,reason):
  with self.db(True) as d:
   changed=d.execute("UPDATE requests SET reason=?,updated_at=? WHERE request_id=? AND state='waiting' AND attempted=0",(reason,now(),ident)).rowcount
   if changed:self.event(d,ident,'waiting',reason)
  return self.public(self.get(ident))
 def update(self,ident,state,reason,answer=None):
  if state not in ('waiting','accepted','completed','failed','uncertain'):raise GatewayError('invalid_adapter_state')
  with self.db(True) as d:
   d.execute('UPDATE requests SET state=?,reason=?,updated_at=?,answer=? WHERE request_id=?',(state,reason,now(),answer,ident));self.event(d,ident,state,reason)
  return self.public(self.get(ident))
class Gateway:
 COMMON={'action','keyId','ts','nonce','signature'}
 def __init__(self,key_file,db_file,adapter=None):self.key_file=pathlib.Path(key_file);self.store=ReceiptStore(db_file);self.adapter=adapter or DisabledAdapter()
 def key(self):
  if not self.key_file.is_absolute() or self.key_file.is_symlink():raise GatewayError('invalid_auth_key_path')
  try:
   fd=os.open(self.key_file,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
   with os.fdopen(fd,'rb') as f:
    s=os.fstat(f.fileno())
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.geteuid() or stat.S_IMODE(s.st_mode)!=0o600:raise GatewayError('invalid_auth_key_permissions')
    key=f.read(129)
  except GatewayError:raise
  except OSError:raise GatewayError('auth_key_unavailable') from None
  if not 32<=len(key)<=128:raise GatewayError('invalid_auth_key_size')
  return key
 def validate(self,data):
  if not isinstance(data,dict):raise GatewayError('invalid_request')
  action=data.get('action');extra={'submit':{'requestId','alias','instruction'},'status':{'requestId'},'qualify_readonly':set()}.get(action)
  if extra is None or set(data)!=self.COMMON|extra:raise GatewayError('request_fields_forbidden')
  if data.get('keyId')!=KEY_ID or type(data.get('ts')) is not int or abs(time.time()-data['ts'])>120:raise GatewayError('authentication_failed')
  if not isinstance(data.get('nonce'),str) or not re.fullmatch('[a-f0-9]{32,128}',data['nonce']):raise GatewayError('invalid_nonce')
  if not isinstance(data.get('signature'),str) or not re.fullmatch('[a-f0-9]{64}',data['signature']):raise GatewayError('authentication_failed')
  if action in ('submit','status') and (not isinstance(data['requestId'],str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{7,127}',data['requestId'])):raise GatewayError('invalid_request_id')
  if action=='submit':
   if not isinstance(data['alias'],str) or data['alias'] not in ALIASES:raise GatewayError('alias_forbidden')
   instruction=data['instruction']
   if not isinstance(instruction,dict) or set(instruction)!={'text'} or not isinstance(instruction['text'],str) or not instruction['text'].strip() or len(instruction['text'].encode())>16384 or any(ord(c)<32 and c not in '\n\t' for c in instruction['text']):raise GatewayError('explicit_text_instruction_required')
  unsigned={k:v for k,v in data.items() if k!='signature'};expected=hmac.new(self.key(),canonical(unsigned),hashlib.sha256).hexdigest()
  if not hmac.compare_digest(expected,data['signature']):raise GatewayError('authentication_failed')
  self.store.consume_nonce(data['nonce'],hashlib.sha256(canonical(unsigned)).hexdigest());return action
 def handle(self,data):
  action=self.validate(data)
  if action=='qualify_readonly':return qualify_readonly()
  if action=='status':return self.status(data['requestId'])
  return self.submit(data['requestId'],data['alias'],data['instruction']['text'])
 def submit(self,ident,alias,text):
  digest=hashlib.sha256(canonical({'alias':alias,'instruction':{'text':text}})).hexdigest()
  with self.store.db(True) as d:
   row=d.execute('SELECT * FROM requests WHERE request_id=?',(ident,)).fetchone()
   if row:
    if row['alias']!=alias or row['instruction_hash']!=digest:raise GatewayError('idempotency_conflict')
    if row['state']!='waiting' or row['attempted']:return self.store.public(dict(row))
   else:
    t=now();receipt='gw-'+uuid.uuid4().hex
    d.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?)',(ident,alias,digest,receipt,'waiting','not_dispatched',self.adapter.name,0,t,t,None));self.store.event(d,ident,'waiting','not_dispatched')
  try:probe=self.adapter.probe(alias)
  except Exception:return self.store.waiting(ident,'probe_unavailable')
  state=probe.get('state') if isinstance(probe,dict) else 'unavailable'
  if state!='ready':
   reason={'busy':'thread_busy','active':'thread_busy','paused':'thread_paused','unavailable':'transport_unavailable','notLoaded':'thread_not_loaded'}.get(state,'adapter_not_ready')
   if self.adapter.name=='disabled':reason='live_adapter_not_qualified'
   return self.store.waiting(ident,reason)
  with self.store.db(True) as d:
   row=d.execute('SELECT * FROM requests WHERE request_id=?',(ident,)).fetchone()
   if row['state']!='waiting' or row['attempted']:return self.store.public(dict(row))
   existing=d.execute("SELECT request_id FROM requests WHERE alias=? AND request_id!=? AND (state IN ('dispatching','accepted','uncertain'))",(alias,ident)).fetchone()
   if existing:
    d.execute('UPDATE requests SET reason=?,updated_at=? WHERE request_id=?',('alias_busy',now(),ident));return self.store.public(dict(d.execute('SELECT * FROM requests WHERE request_id=?',(ident,)).fetchone()))
   d.execute("UPDATE requests SET state='dispatching',reason='attempt_reserved',attempted=1,updated_at=? WHERE request_id=?",(now(),ident));self.store.event(d,ident,'dispatching','attempt_reserved')
  try:
   result=self.adapter.submit(alias,ident,text)
   if not isinstance(result,dict) or result.get('state') not in ('accepted','failed'):raise GatewayError('adapter_result_unknown')
   return self.store.update(ident,result['state'],'fixture_only' if self.adapter.name=='fixture' else 'live_execution_disabled')
  except Exception:return self.store.update(ident,'uncertain','send_result_unknown_do_not_retry')
 def status(self,ident):
  row=self.store.get(ident)
  if row['state']=='dispatching':return self.store.update(ident,'uncertain','prior_attempt_not_resolved')
  if row['state']=='accepted':
   # A fixture receipt is never polled via a different adapter after a restart.
   if row['adapter']!=self.adapter.name:return self.store.update(ident,'uncertain','adapter_changed_do_not_retry')
   try:
    result=self.adapter.poll(row['receipt'])
    if not isinstance(result,dict) or result.get('state') not in ('accepted','completed','failed','uncertain'):raise GatewayError('adapter_poll_unknown')
    answer='fixture-completed' if result['state']=='completed' and self.adapter.name=='fixture' else None
    return self.store.update(ident,result['state'],'fixture_only' if self.adapter.name=='fixture' else 'live_execution_disabled',answer)
   except Exception:return self.store.update(ident,'uncertain','poll_unavailable_do_not_retry')
  return self.store.public(row)

def main():
 os.umask(0o077)
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--key-file',type=pathlib.Path,default=BASE/'state/gateway.hmac');p.add_argument('--db',type=pathlib.Path,default=BASE/'state/local-codex-gateway.sqlite');p.add_argument('--qualify-readonly',action='store_true');p.add_argument('--adapter',choices=['disabled','fixture'],default='disabled');p.add_argument('--fixture-state',choices=['ready','busy','paused','unavailable','uncertain'],default='ready');args=p.parse_args()
 try:
  if args.qualify_readonly:result=qualify_readonly()
  else:
   raw=sys.stdin.buffer.read(MAX_INPUT+1)
   if len(raw)>MAX_INPUT:raise GatewayError('request_too_large')
   gateway=Gateway(args.key_file,args.db,FixtureAdapter(args.fixture_state) if args.adapter=='fixture' else None);result=gateway.handle(strict_json(raw))
  print(json.dumps({'ok':True,'result':result},ensure_ascii=False));return 0
 except GatewayError as e:print(json.dumps({'ok':False,'error':e.code,'state':'waiting'}));return 1
 except Exception:print(json.dumps({'ok':False,'error':'gateway_unavailable','state':'waiting'}));return 1
if __name__=='__main__':sys.exit(main())
