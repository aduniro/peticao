#!/usr/bin/python3
"""Private immutable release catalog and Owner-authorized deploy queue. No deploy execution."""
from __future__ import annotations
import argparse,ipaddress,base64,contextlib,datetime as dt,hashlib,hmac,http.cookies,http.server,json,os,pathlib,re,secrets,shutil,socket,sqlite3,stat,sys,tempfile,time,urllib.parse,uuid
OWNER='operator-1608598f41@example.invalid'
ROOT=pathlib.Path(os.environ.get('OPS_CONSOLE_ROOT','/srv/ops-console'))
MAX_BODY=16384
HEX40=re.compile(r'[0-9a-f]{40}\Z');HEX64=re.compile(r'[0-9a-f]{64}\Z');RELEASE=re.compile(r'r[0-9]{4}[a-z0-9_-]{0,70}\Z')
PHASES={'reserved','staging','backup','migrations','switch','smoke','rollback','reconciliation'}
TERMINAL={'completed','failed','uncertain','reverted'}
HERE=pathlib.Path(__file__).resolve().parent

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def sha(value):return hashlib.sha256(value).hexdigest()
def timestamp(value=None):return dt.datetime.fromtimestamp(value or time.time(),dt.timezone.utc).isoformat(timespec='seconds')
def atomic(path,content,mode=0o600):
 path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,tmp=tempfile.mkstemp(prefix='.console-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(content);stream.flush();os.fsync(stream.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def digest_file(path):
 value=hashlib.sha256()
 with pathlib.Path(path).open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
 return value.hexdigest()

class Denied(Exception):
 def __init__(self,code,status=400):self.code=code;self.status=status

class Console:
 def __init__(self,root=ROOT,origin=None,clock=time.time):
  self.root=pathlib.Path(root);self.clock=clock
  self.config=json.loads((self.root/'config.json').read_text())
  self.origin=origin or os.environ.get('OPS_PUBLIC_ORIGIN') or self.config.get('origin')
  parsed=urllib.parse.urlsplit(self.origin or '')
  self.secure=parsed.scheme=='https'
  if not parsed.hostname or parsed.path not in {'','/'} or parsed.query or parsed.fragment or parsed.username:raise ValueError('invalid_public_origin')
  if not self.secure and not (self.config.get('insecure_test') and parsed.hostname in {'localhost','127.0.0.1','::1'}):raise ValueError('https_required')
  self.origin=self.origin.rstrip('/')
  pepper_path=pathlib.Path(os.environ.get('OPS_AUTH_PEPPER_FILE',str(self.root/'auth-pepper')))
  info=pepper_path.lstat()
  if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077:raise ValueError('pepper_file_must_be_regular_private')
  self.pepper=pepper_path.read_bytes()
  if len(self.pepper)<32:raise ValueError('pepper_too_short')
  self.path=self.root/'console.sqlite'

 @contextlib.contextmanager
 def db(self):
  connection=sqlite3.connect(self.path,timeout=10);connection.row_factory=sqlite3.Row;connection.execute('PRAGMA busy_timeout=10000')
  try:yield connection;connection.commit()
  except Exception:connection.rollback();raise
  finally:connection.close()

 def keyed(self,value):return hmac.new(self.pepper,value.encode(),hashlib.sha256).hexdigest()
 def event(self,db,kind,data):db.execute('INSERT INTO events(at,kind,data) VALUES(?,?,?)',(self.clock(),kind,canonical(data)))
 def sweep(self,db):
  now=self.clock()
  db.execute("UPDATE outbox SET payload=NULL,state=CASE WHEN state IN ('queued','sending') THEN 'expired' ELSE state END WHERE expires_at<=?",(now,))
  db.execute('DELETE FROM rate_limits WHERE window<?',(int(now//900)-4,))
 def limit(self,db,action,subject,maximum):
  key=self.keyed('rate:'+action+':'+subject);window=int(self.clock()//900)
  row=db.execute('SELECT count FROM rate_limits WHERE key=? AND window=?',(key,window)).fetchone()
  if row and row['count']>=maximum:raise Denied('rate_limited',429)
  db.execute('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key,window) DO UPDATE SET count=count+1',(key,window))

 def session(self,token,create=False):
  with self.db() as db:
   self.sweep(db);row=db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',(self.keyed('session:'+(token or '')),self.clock())).fetchone()
   if row:return dict(row),None
   if not create:raise Denied('authentication_required',401)
   token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32);key=self.keyed('session:'+token)
   db.execute('INSERT INTO sessions(token_hash,csrf,owner,created_at,expires_at) VALUES(?,?,0,?,?)',(key,csrf,self.clock(),self.clock()+900))
   return dict(token_hash=key,csrf=csrf,owner=0,created_at=self.clock(),expires_at=self.clock()+900),token

 def request_otp(self,session,purpose,peer,release_id=None,manifest_hash=None,destination=None):
  if purpose not in {'login','deploy'}:raise Denied('invalid_purpose')
  if purpose=='deploy':
   if not session['owner']:raise Denied('owner_required',403)
   release=self.get_release(release_id)
   self.deployable(release,manifest_hash,destination)
  code=f'{secrets.randbelow(100000000):08d}';challenge=uuid.uuid4().hex;outbox=uuid.uuid4().hex;now=self.clock()
  with self.db() as db:
   self.sweep(db);self.limit(db,'otp-address',OWNER,6);self.limit(db,'otp-peer',peer,8)
   db.execute("UPDATE outbox SET payload=NULL,state='superseded' WHERE id IN (SELECT outbox_id FROM challenges WHERE session_hash=? AND purpose=? AND consumed=0) AND state='queued'",(session['token_hash'],purpose))
   db.execute('UPDATE challenges SET consumed=1 WHERE session_hash=? AND purpose=? AND consumed=0',(session['token_hash'],purpose))
   db.execute('INSERT INTO challenges(id,session_hash,purpose,code_hash,expires_at,attempts,consumed,release_id,manifest_hash,destination,outbox_id) VALUES(?,?,?,?,?,0,0,?,?,?,?)',(challenge,session['token_hash'],purpose,self.keyed('otp:'+challenge+':'+code),now+600,release_id,manifest_hash,destination,outbox))
   payload={'otp':code,'challenge_id':challenge,'purpose':purpose,'release_id':release_id,'manifest_hash':manifest_hash,'destination':destination}
   db.execute("INSERT INTO outbox(id,recipient,kind,payload,state,created_at,expires_at) VALUES(?,?,?,?, 'queued',?,?)",(outbox,OWNER,'owner_otp',canonical(payload),now,now+600))
   self.event(db,'otp_requested',{'challenge_id':challenge,'purpose':purpose,'release_id':release_id,'destination':destination})
  return {'challenge_id':challenge,'expires_in_seconds':600,'recipient':OWNER,'delivery_state':'queued'}

 def verify_otp(self,session,challenge_id,code,peer,purpose=None):
  if not isinstance(code,str) or not re.fullmatch(r'[0-9]{8}',code):raise Denied('invalid_code',403)
  error=None;result=None
  with self.db() as db:
   self.sweep(db);self.limit(db,'verify-peer',peer,30)
   db.execute('BEGIN IMMEDIATE') if not db.in_transaction else None
   row=db.execute('SELECT * FROM challenges WHERE id=?',(challenge_id,)).fetchone()
   if not row or row['session_hash']!=session['token_hash'] or row['consumed'] or row['expires_at']<=self.clock() or row['attempts']>=5 or purpose and row['purpose']!=purpose:error=Denied('invalid_or_expired_code',403)
   elif not hmac.compare_digest(row['code_hash'],self.keyed('otp:'+row['id']+':'+code)):
    db.execute('UPDATE challenges SET attempts=attempts+1 WHERE id=?',(row['id'],));error=Denied('invalid_or_expired_code',403)
   else:
    db.execute('UPDATE challenges SET consumed=1 WHERE id=?',(row['id'],));db.execute("UPDATE outbox SET payload=NULL,state=CASE WHEN state='queued' THEN 'consumed' ELSE state END WHERE id=?",(row['outbox_id'],))
    if row['purpose']=='login':
     token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32);key=self.keyed('session:'+token)
     db.execute('DELETE FROM sessions WHERE token_hash=?',(session['token_hash'],))
     db.execute('INSERT INTO sessions(token_hash,csrf,owner,created_at,expires_at) VALUES(?,?,1,?,?)',(key,csrf,self.clock(),self.clock()+8*3600))
     result={'owner':True,'csrf':csrf,'session_token':token}
    else:
     if not session['owner']:raise Denied('owner_required',403)
     release=self.get_release(row['release_id']);self.deployable(release,row['manifest_hash'],row['destination'])
     grant=secrets.token_urlsafe(32);nonce=uuid.uuid4().hex;gid=uuid.uuid4().hex
     db.execute('INSERT INTO grants(id,token_hash,session_hash,release_id,manifest_hash,destination,owner_nonce,challenge_id,approved_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(gid,self.keyed('grant:'+grant),session['token_hash'],row['release_id'],row['manifest_hash'],row['destination'],nonce,row['id'],self.clock(),self.clock()+300))
     result={'grant_token':grant,'release_id':row['release_id'],'manifest_hash':row['manifest_hash'],'destination':row['destination'],'expires_in_seconds':300}
    self.event(db,'owner_verified',{'purpose':row['purpose'],'challenge_id':row['id'],'release_id':row['release_id']})
  if error:raise error
  return result

 def get_release(self,release_id):
  if not isinstance(release_id,str) or not RELEASE.fullmatch(release_id):raise Denied('invalid_release_id')
  with self.db() as db:row=db.execute('SELECT * FROM releases WHERE id=?',(release_id,)).fetchone()
  if not row:raise Denied('release_not_found',404)
  value=dict(row);value['manifest']=json.loads(value['manifest']);value['readiness']=json.loads(value['readiness']);return value
 def releases(self):
  with self.db() as db:ids=[r['id'] for r in db.execute('SELECT id FROM releases ORDER BY created_at DESC,id DESC')]
  result=[]
  for rid in ids:
   row=self.get_release(rid);row.pop('artifact_path',None);result.append(row)
  return result
 def deployable(self,release,manifest_hash,destination):
  if destination not in {'fixture','sp-production'}:raise Denied('destination_not_allowed')
  if destination=='sp-production' and not self.config.get('production_enabled',False):raise Denied('production_gate_disabled',403)
  if release['manifest_hash']!=manifest_hash:raise Denied('release_hash_mismatch',409)
  if not release['readiness']['ready']:raise Denied('release_not_ready',409)
  if not release['artifact_path']:raise Denied('artifact_missing',409)

 def enqueue(self,session,data):
  if not session.get('owner'):raise Denied('owner_required',403)
  allowed={'request_id','release_id','manifest_hash','destination','grant_token'}
  if set(data)!=allowed:raise Denied('invalid_job_fields')
  try:request_id=str(uuid.UUID(data['request_id']))
  except (ValueError,TypeError,AttributeError):raise Denied('invalid_request_id')
  request_hash=sha(canonical({key:data[key] for key in ['release_id','manifest_hash','destination']}).encode())
  with self.db() as db:
   db.execute('BEGIN IMMEDIATE')
   old=db.execute('SELECT * FROM jobs WHERE request_id=?',(request_id,)).fetchone()
   if old:
    if old['request_hash']!=request_hash:raise Denied('request_identity_mismatch',409)
    return self.public_job(old)
   release=self.get_release(data['release_id']);self.deployable(release,data['manifest_hash'],data['destination'])
   grant=db.execute('SELECT * FROM grants WHERE token_hash=?',(self.keyed('grant:'+str(data['grant_token'])),)).fetchone()
   if not grant or grant['session_hash']!=session['token_hash'] or grant['expires_at']<=self.clock() or grant['job_id']:raise Denied('invalid_or_consumed_grant',403)
   if any(grant[key]!=data[key] for key in ['release_id','manifest_hash','destination']):raise Denied('grant_scope_mismatch',403)
   job=uuid.uuid4().hex;auth={'owner':OWNER,'owner_nonce':grant['owner_nonce'],'grant_id':grant['id'],'challenge_id':grant['challenge_id'],'approved_at':grant['approved_at'],'release_id':grant['release_id'],'manifest_hash':grant['manifest_hash'],'destination':grant['destination']}
   db.execute("INSERT INTO jobs(id,request_id,request_hash,release_id,manifest_hash,destination,state,phase,created_at,updated_at,authorization) VALUES(?,?,?,?,?,?,'queued','queued',?,?,?)",(job,request_id,request_hash,data['release_id'],data['manifest_hash'],data['destination'],self.clock(),self.clock(),canonical(auth)))
   db.execute('UPDATE grants SET job_id=? WHERE id=?',(job,grant['id']));self.event(db,'deploy_queued',{'job_id':job,'release_id':data['release_id'],'manifest_hash':data['manifest_hash'],'destination':data['destination'],'owner_nonce':grant['owner_nonce']})
   row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone();return self.public_job(row)
 def public_job(self,row):
  value=dict(row);value.pop('request_hash',None);value.pop('worker_token_hash',None);value['authorization']=json.loads(value['authorization']);value['result']=json.loads(value['result']) if value.get('result') else None;return value
 def jobs(self):
  with self.db() as db:return [self.public_job(row) for row in db.execute('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200')]
 def claim(self,worker):
  if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',worker):raise ValueError('invalid_worker')
  with self.db() as db:
   db.execute('BEGIN IMMEDIATE')
   if db.execute("SELECT 1 FROM jobs WHERE state IN ('reserved','running','uncertain')").fetchone():return None
   row=db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1").fetchone()
   if not row:return None
   release=self.get_release(row['release_id']);self.deployable(release,row['manifest_hash'],row['destination'])
   # Rehash executable bytes at claim, not only when catalog publication occurred.
   if digest_file(release['artifact_path'])!=release['manifest']['artifact']['sha256']:raise ValueError('artifact_integrity_failure')
   token=secrets.token_urlsafe(32)
   db.execute("UPDATE jobs SET state='reserved',phase='reserved',worker=?,worker_token_hash=?,updated_at=? WHERE id=?",(worker,self.keyed('worker:'+token),self.clock(),row['id']))
   self.event(db,'deploy_reserved',{'job_id':row['id'],'worker':worker,'release_id':row['release_id']})
   result=self.public_job(db.execute('SELECT * FROM jobs WHERE id=?',(row['id'],)).fetchone())
   result['worker_token']=token;result['release']=release;return result
 def update_job(self,job,token,state,phase,detail,reconcile=False):
  if state not in {'running'}|TERMINAL or phase not in PHASES:raise ValueError('invalid_job_transition')
  if not isinstance(detail,dict) or len(canonical(detail))>8000:raise ValueError('invalid_result')
  # Results must be structured evidence, never raw process output or credentials.
  if set(detail)-{'summary','artifact_sha256','deployed_commit','checks','previous_release','receipt_id','error_code'}:raise ValueError('unsupported_result_field')
  with self.db() as db:
   db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
   if not row or not row['worker_token_hash'] or not hmac.compare_digest(row['worker_token_hash'],self.keyed('worker:'+token)):raise ValueError('worker_authorization_required')
   if state=='completed':
    release=self.get_release(row['release_id']);checks=detail.get('checks')
    if phase not in {'smoke','reconciliation'} or detail.get('artifact_sha256')!=release['manifest']['artifact']['sha256'] or detail.get('deployed_commit')!=release['manifest']['source']['commit']:
     raise ValueError('completion_requires_exact_artifact_and_commit')
    if not isinstance(checks,list) or not checks or any(not isinstance(item,dict) or item.get('status')!='passed' or not item.get('name') for item in checks):raise ValueError('completion_requires_checks')
   if row['state'] in TERMINAL and not (row['state']=='uncertain' and reconcile and phase=='reconciliation'):raise ValueError('terminal_job_requires_reconciliation')
   if row['state'] not in {'reserved','running','uncertain'}:raise ValueError('job_not_reserved')
   db.execute('UPDATE jobs SET state=?,phase=?,result=?,updated_at=? WHERE id=?',(state,phase,canonical(detail),self.clock(),job))
   self.event(db,'deploy_'+state,{'job_id':job,'release_id':row['release_id'],'manifest_hash':row['manifest_hash'],'phase':phase,'result':detail})
   return self.public_job(db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone())

 def outbox_claim(self):
  with self.db() as db:
   self.sweep(db);db.execute('BEGIN IMMEDIATE') if not db.in_transaction else None
   row=db.execute("SELECT * FROM outbox WHERE state='queued' AND expires_at>? ORDER BY created_at,id LIMIT 1",(self.clock(),)).fetchone()
   if not row:return None
   token=secrets.token_urlsafe(32)
   db.execute("UPDATE outbox SET state='sending',delivery_token_hash=?,updated_at=? WHERE id=?",(self.keyed('delivery:'+token),self.clock(),row['id']))
   return {'id':row['id'],'recipient':OWNER,'kind':row['kind'],'payload':json.loads(row['payload']),'expires_at':row['expires_at'],'delivery_token':token}
 def outbox_result(self,oid,token,state,receipt=None,reconcile=False):
  if state not in {'accepted','rejected','uncertain'}:raise ValueError('invalid_delivery_state')
  if receipt is not None and (not isinstance(receipt,str) or not re.fullmatch(r'[A-Za-z0-9_.:/=-]{1,256}',receipt)):raise ValueError('invalid_provider_receipt')
  with self.db() as db:
   self.sweep(db);row=db.execute('SELECT * FROM outbox WHERE id=?',(oid,)).fetchone()
   if not row or not row['delivery_token_hash'] or not hmac.compare_digest(row['delivery_token_hash'],self.keyed('delivery:'+token)):raise ValueError('delivery_authorization_required')
   if row['state'] in {'accepted','rejected','uncertain'}:
    if row['state']==state:return {'id':oid,'state':state,'existing':True}
    if not (row['state']=='uncertain' and reconcile and state in {'accepted','rejected'}):raise ValueError('delivery_result_already_recorded')
   db.execute('UPDATE outbox SET state=?,payload=NULL,provider_receipt=?,updated_at=? WHERE id=?',(state,receipt,self.clock(),oid))
   self.event(db,'otp_delivery_'+state,{'outbox_id':oid,'provider_receipt':receipt,'reconciled':bool(reconcile),'otp_expired':row['expires_at']<=self.clock()});return {'id':oid,'state':state}

 def publish(self,manifest,artifact=None):
  if not isinstance(manifest,dict) or not RELEASE.fullmatch(manifest.get('release_id','')):raise ValueError('invalid_release_id')
  allowed={'release_id','title','source','build','artifact','tests','completed','pending','compatibility','readiness','schema','rollback','original_manifest_sha256','original_schema'}
  if set(manifest)-allowed:raise ValueError('unknown_manifest_field')
  if not HEX40.fullmatch(manifest.get('source',{}).get('commit','')):raise ValueError('explicit_source_commit_required')
  for key in ['completed','pending','tests']:
   if not isinstance(manifest.get(key),list):raise ValueError('manifest_list_required:'+key)
  if len(canonical(manifest))>128000:raise ValueError('manifest_too_large')
  reasons=[];build=manifest.get('build') or {};tests=manifest['tests'];compat=manifest.get('compatibility') or {};declared=manifest.get('readiness') or {}
  if not declared.get('declared_ready'):reasons.append('Não declarada pronta pelo publicador')
  if build.get('status')!='complete' or not build.get('executable') or not build.get('runtime'):reasons.append('Build executável completo não comprovado')
  if not tests or any(not isinstance(item,dict) or item.get('status')!='passed' or not item.get('name') for item in tests):reasons.append('Testes relevantes não comprovados')
  if not all(compat.get(key) is True for key in ['public_admin','schema_reviewed','migrations_reviewed','rollback_reviewed']):reasons.append('Compatibilidade ou retorno não aprovado')
  if not isinstance(compat.get('coordinator_acks'),list) or set(compat.get('coordinator_acks',[]))!={'apoio','admin'}:reasons.append('ACK dos dois coordenadores ausente')
  artifact_path=None;info=manifest.get('artifact')
  if not artifact or not isinstance(info,dict):reasons.append('Somente fonte ou sem artefato executável')
  else:
   source=pathlib.Path(artifact);s=source.lstat()
   if not stat.S_ISREG(s.st_mode) or s.st_size>2*1024**3:raise ValueError('invalid_artifact_file')
   if not HEX64.fullmatch(info.get('sha256','')) or digest_file(source)!=info['sha256'] or info.get('bytes')!=s.st_size:raise ValueError('artifact_integrity_failure')
   artifact_path=str(self.root/'artifacts'/info['sha256'])
   if not pathlib.Path(artifact_path).exists():
    temp=pathlib.Path(artifact_path+'.'+uuid.uuid4().hex)
    temp.parent.mkdir(mode=0o700,exist_ok=True)
    try:
     with source.open('rb') as inp,temp.open('xb') as out:shutil.copyfileobj(inp,out);out.flush();os.fsync(out.fileno())
     if digest_file(temp)!=info['sha256']:raise ValueError('artifact_changed_during_copy')
     temp.chmod(0o400);os.replace(temp,artifact_path)
    finally:temp.unlink(missing_ok=True)
   elif digest_file(artifact_path)!=info['sha256']:raise ValueError('stored_artifact_integrity_failure')
  readiness={'ready':not reasons,'reasons':reasons};text=canonical(manifest);mh=sha(text.encode())
  with self.db() as db:
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM releases WHERE id=?',(manifest['release_id'],)).fetchone()
   if old:
    if old['manifest_hash']!=mh:raise ValueError('immutable_release_conflict')
    return {'release_id':old['id'],'manifest_hash':mh,'existing':True,'readiness':json.loads(old['readiness'])}
   db.execute('INSERT INTO releases(id,manifest_hash,manifest,readiness,artifact_path,created_at) VALUES(?,?,?,?,?,?)',(manifest['release_id'],mh,text,canonical(readiness),artifact_path,self.clock()))
   self.event(db,'release_published',{'release_id':manifest['release_id'],'manifest_hash':mh,'readiness':readiness})
  return {'release_id':manifest['release_id'],'manifest_hash':mh,'existing':False,'readiness':readiness}

 def ledger_status(self):
  path=self.root/'ledger-status.json'
  if not path.is_file() or path.stat().st_size>65536:return {'state':'not_connected','meaning':'Adapter de leitura do ledger não configurado.'}
  try:return {'state':'snapshot','data':json.loads(path.read_text()),'read_only':True}
  except ValueError:return {'state':'invalid_snapshot'}

def normalize_manifest(manifest,original_hash):
 """Ingest the existing source-only schema without inventing runtime evidence."""
 if not isinstance(manifest,dict):raise ValueError('manifest_object_required')
 if manifest.get('schemaVersion')==1 and 'releaseId' in manifest:
  if manifest.get('state')!='source-recorded' or manifest.get('readyForDeploy') is not False or manifest.get('runtimeArtifact') is not None or manifest.get('buildResult') is not None:
   raise ValueError('camelcase_adapter_accepts_source_record_only')
  return {'release_id':manifest['releaseId'],'title':manifest.get('title',manifest['releaseId']),
   'source':manifest.get('source',{}),'build':None,'artifact':None,'tests':[],
   'completed':manifest.get('changes',[]),'pending':manifest.get('pending',[]),
   'compatibility':{},'readiness':{'declared_ready':False},
   'schema':{'database_changes':manifest.get('databaseChanges',[])},
   'original_manifest_sha256':original_hash,'original_schema':'source-recorded/schemaVersion1'}
 if not isinstance(manifest,dict):raise ValueError('manifest_object_required')
 return {**manifest,'original_manifest_sha256':original_hash}


SCHEMA='''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,owner INTEGER NOT NULL,created_at REAL,expires_at REAL);
CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,session_hash TEXT,purpose TEXT,code_hash TEXT,expires_at REAL,attempts INTEGER,consumed INTEGER,release_id TEXT,manifest_hash TEXT,destination TEXT,outbox_id TEXT);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,recipient TEXT,kind TEXT,payload TEXT,state TEXT,created_at REAL,expires_at REAL,updated_at REAL,delivery_token_hash TEXT,provider_receipt TEXT);
CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE,session_hash TEXT,release_id TEXT,manifest_hash TEXT,destination TEXT,owner_nonce TEXT,challenge_id TEXT,approved_at REAL,expires_at REAL,job_id TEXT);
CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,manifest_hash TEXT NOT NULL,manifest TEXT NOT NULL,readiness TEXT NOT NULL,artifact_path TEXT,created_at REAL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,request_id TEXT UNIQUE,request_hash TEXT,release_id TEXT,manifest_hash TEXT,destination TEXT,state TEXT,phase TEXT,created_at REAL,updated_at REAL,authorization TEXT,worker TEXT,worker_token_hash TEXT,result TEXT);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at REAL,kind TEXT,data TEXT);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT,window INTEGER,count INTEGER,PRIMARY KEY(key,window));
'''

def initialize(root,origin,insecure_test=False,pepper=None):
 root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True,mode=0o700);root.chmod(0o700)
 if not (root/'auth-pepper').exists():atomic(root/'auth-pepper',pepper or secrets.token_bytes(48))
 if not (root/'config.json').exists():atomic(root/'config.json',canonical({'origin':origin,'insecure_test':insecure_test,'production_enabled':False}).encode())
 with sqlite3.connect(root/'console.sqlite') as db:db.executescript(SCHEMA)
 (root/'console.sqlite').chmod(0o600)
 for suffix in ['-wal','-shm']:
  p=pathlib.Path(str(root/'console.sqlite')+suffix)
  if p.exists():p.chmod(0o600)
 current=json.loads((root/'config.json').read_text())
 return {'root':str(root),'production_enabled':bool(current.get('production_enabled')),'owner':OWNER,'origin':current.get('origin')}

class Handler(http.server.BaseHTTPRequestHandler):
 server_version='OpsConsole'
 def setup(self):
  super().setup();self.connection.settimeout(10)
 def log_message(self,*args):pass
 def reply(self,status,value,cookie=None,content_type='application/json; charset=utf-8'):
  body=canonical(value).encode() if content_type.startswith('application/json') else value
  self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers()
  if self.command!='HEAD':self.wfile.write(body)
 def cookie(self,token,maxage=28800):return 'ops_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+str(maxage)+('; Secure' if self.server.app.secure else '')
 def get_session(self,create=False):
  cookies=http.cookies.SimpleCookie()
  try:cookies.load(self.headers.get('Cookie',''))
  except http.cookies.CookieError:raise Denied('invalid_cookie')
  token=cookies.get('ops_session');return self.server.app.session(token.value if token else None,create)
 def owner(self):
  session,_=self.get_session()
  if not session['owner']:raise Denied('owner_required',403)
  return session
 def require_csrf(self):
  if self.headers.get('Origin')!=self.server.app.origin:raise Denied('origin_rejected',403)
  if self.headers.get('Sec-Fetch-Site') not in {None,'same-origin','none'}:raise Denied('cross_site_rejected',403)
  session,_=self.get_session()
  if not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),session['csrf']):raise Denied('csrf_rejected',403)
  return session
 def owner_context(self,recent_seconds=900):
  session=self.owner()
  if recent_seconds is not None and self.server.app.clock()-session['created_at']>recent_seconds:raise Denied('owner_reauthentication_required',403)
  return {'owner_id':OWNER,'session_id':session['token_hash']}
 def extension(self,method,path,data=None):
  hook=self.server.extensions.get((method,path))
  if hook is None:return False
  context=self.owner_context()
  result=hook(context,data)
  self.reply(200,result);return True
 def do_HEAD(self):self.do_GET()
 def do_GET(self):
  try:
   path=urllib.parse.urlsplit(self.path).path
   if path in {'/','/assets/app.js','/assets/app.css'}:
    file={'/':'index.html','/assets/app.js':'app.js','/assets/app.css':'app.css'}[path];mime={'/':'text/html; charset=utf-8','/assets/app.js':'text/javascript; charset=utf-8','/assets/app.css':'text/css; charset=utf-8'}[path]
    return self.reply(200,(HERE/file).read_bytes(),content_type=mime)
   if path=='/api/session':
    session,token=self.get_session(True);return self.reply(200,{'owner':bool(session['owner']),'csrf':session['csrf'],'recipient':OWNER,'destinations':['fixture']+(['sp-production'] if self.server.app.config.get('production_enabled') else [])},self.cookie(token,900) if token else None)
   if path=='/healthz':return self.reply(200,{'state':'ok','role':'private_release_catalog_and_queue','deploy_execution':False})
   self.owner()
   if self.extension('GET',path):return
   if path=='/api/releases':return self.reply(200,{'releases':self.server.app.releases()})
   if path=='/api/jobs':return self.reply(200,{'jobs':self.server.app.jobs()})
   if path=='/api/status':return self.reply(200,self.server.app.ledger_status())
   raise Denied('not_found',404)
  except Denied as error:self.reply(error.status,{'error':error.code})
  except Exception:self.reply(500,{'error':'internal_error'})
 def do_POST(self):
  try:
   session=self.require_csrf()
   if self.headers.get('Transfer-Encoding'):raise Denied('transfer_encoding_rejected')
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=MAX_BODY:raise Denied('invalid_body_size',413)
   if self.headers.get_content_type()!='application/json':raise Denied('json_required',415)
   data=json.loads(self.rfile.read(length))
   if not isinstance(data,dict):raise Denied('object_required')
   path=urllib.parse.urlsplit(self.path).path;app=self.server.app;peer=self.client_address[0]
   if path=='/api/auth/request':return self.reply(200,app.request_otp(session,'login',peer))
   if path=='/api/auth/verify':
    result=app.verify_otp(session,data.get('challenge_id'),data.get('code'),peer,'login')
    token=result.pop('session_token',None);return self.reply(200,result,self.cookie(token) if token else None)
   if not session['owner']:raise Denied('owner_required',403)
   if self.extension('POST',path,data):return
   if path=='/api/auth/logout':
    with app.db() as db:db.execute('DELETE FROM sessions WHERE token_hash=?',(session['token_hash'],))
    return self.reply(200,{'owner':False},self.cookie('',0))
   if path=='/api/grants/request':return self.reply(200,app.request_otp(session,'deploy',peer,data.get('release_id'),data.get('manifest_hash'),data.get('destination')))
   if path=='/api/grants/verify':return self.reply(200,app.verify_otp(session,data.get('challenge_id'),data.get('code'),peer,'deploy'))
   if path=='/api/jobs':return self.reply(200,app.enqueue(session,data))
   raise Denied('not_found',404)
  except Denied as error:self.reply(error.status,{'error':error.code})
  except (ValueError,TypeError):self.reply(400,{'error':'invalid_request'})
  except Exception:self.reply(500,{'error':'internal_error'})

def make_server(app,host='127.0.0.1',port=8777,extensions=None):
 address=ipaddress.ip_address(host)
 if not (address.is_loopback or address in ipaddress.ip_network('100.64.0.0/10') or address in ipaddress.ip_network('fd7a:115c:a1e0::/48')):raise ValueError('private_bind_required')
 for method,path in (extensions or {}):
  if method not in {'GET','POST'} or not path.startswith('/api/mail/'):raise ValueError('unsupported_extension_route')
 server_type=type('PrivateHTTPServer',(http.server.ThreadingHTTPServer,),{'address_family':socket.AF_INET6 if address.version==6 else socket.AF_INET})
 server=server_type((host,port),Handler);server.daemon_threads=True;server.app=app;server.extensions=extensions or {};return server

def main():
 os.umask(0o077);p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=pathlib.Path,default=ROOT);sub=p.add_subparsers(dest='command',required=True)
 q=sub.add_parser('init');q.add_argument('--origin',required=True);q.add_argument('--insecure-test',action='store_true');q.add_argument('--pepper-stdin',action='store_true')
 q=sub.add_parser('publish-release');q.add_argument('--manifest',type=pathlib.Path,required=True);q.add_argument('--artifact',type=pathlib.Path)
 sub.add_parser('list-releases');sub.add_parser('outbox-claim');q=sub.add_parser('outbox-result');q.add_argument('--input',type=pathlib.Path)
 sub.add_parser('jobs');q=sub.add_parser('job-claim');q.add_argument('--worker',required=True);q=sub.add_parser('job-update');q.add_argument('--input',type=pathlib.Path)
 q=sub.add_parser('serve');q.add_argument('--host',default='127.0.0.1');q.add_argument('--port',type=int,default=8777)
 args=p.parse_args()
 if args.command=='init':
  pepper=sys.stdin.buffer.read(4097) if args.pepper_stdin else None
  if pepper is not None and not 32<=len(pepper)<=4096:raise ValueError('invalid_pepper_length')
  result=initialize(args.root,args.origin,args.insecure_test,pepper)
 else:
  app=Console(args.root)
  if args.command=='publish-release':
   raw=args.manifest.read_bytes();manifest=normalize_manifest(json.loads(raw),sha(raw));result=app.publish(manifest,args.artifact)
  elif args.command=='list-releases':result=app.releases()
  elif args.command=='outbox-claim':result=app.outbox_claim()
  elif args.command=='outbox-result':
   data=json.loads(args.input.read_text() if args.input else sys.stdin.read());result=app.outbox_result(data['id'],data['delivery_token'],data['state'],data.get('provider_receipt'),data.get('reconcile',False))
  elif args.command=='jobs':result=app.jobs()
  elif args.command=='job-claim':result=app.claim(args.worker)
  elif args.command=='job-update':
   data=json.loads(args.input.read_text() if args.input else sys.stdin.read());result=app.update_job(data['id'],data['worker_token'],data['state'],data['phase'],data.get('result',{}),data.get('reconcile',False))
  elif args.command=='serve':make_server(app,args.host,args.port).serve_forever();return
 print(canonical(result))
if __name__=='__main__':
 try:main()
 except Exception as error:print(canonical({'error_type':type(error).__name__,'error':'operation_failed'}),file=sys.stderr);sys.exit(1)
