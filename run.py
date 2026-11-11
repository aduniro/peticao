#!/usr/bin/python3
"""LOCAL compiled-Next Materials QA; preparation refuses missing reviewed new runtime."""
from pathlib import Path
import hashlib,http.client,json,os,re,signal,socket,subprocess,time,uuid
from local_controller import DockerPG,CancellationState,live_context,verify_local_manifest,verify_local_context,cgroup_of
from materials_http import protocol
ROOT=Path(__file__).resolve().parent
CONFIG_PATH=ROOT/'config.json'
COMMIT='140ce6b98af23045849335693a82b426fdc9c826'
APPROVED_EXPORT_ROOT=Path('/mnt/apps/peticao-final/_ops/qa-materials-app-http-20261111/export')
PORT=31398

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def safe(name):
 p=Path(name)
 if not name or p.is_absolute()or '..'in p.parts or str(p)!=name or any(n.startswith('.env')or n in {'.ssh','secrets','preview-state'}or Path(n).suffix.lower()in {'.pfx','.p12','.pem','.key','.sqlite','.dump'}for n in p.parts):raise ValueError('unsafe runtime member')
 return p

def inventory(runtime,manifest):
 if runtime.is_symlink()or runtime.resolve()!=runtime or not runtime.is_dir():raise ValueError('canonical runtime required')
 files=manifest.get('files')
 if not isinstance(files,dict)or not files:raise ValueError('runtime file manifest missing')
 actual={}
 for p in runtime.rglob('*'):
  if p.is_symlink()or not(p.is_dir()or p.is_file()):raise ValueError('runtime symlink/special member')
  if p.is_file():
   name=str(p.relative_to(runtime));safe(name);actual[name]={'bytes':p.stat().st_size,'sha256':sha(p)}
 if actual!=files:raise ValueError('whole runtime file-set/bytes drift')
 return actual

def admit_runtime(cfg):
 # No directories, process, Docker, socket or marker may be created before this gate.
 pin=cfg.get('runtime_manifest_sha256')
 if not isinstance(pin,str)or not re.fullmatch('[a-f0-9]{64}',pin):raise ValueError('new reviewed runtime pin absent')
 if cfg.get('infra_reviewed')is not True or cfg.get('source_commit')!=COMMIT or cfg.get('newRuntimeRequired')is not True:raise ValueError('profile not activated for exact source')
 path=Path(cfg.get('runtime_manifest_path')or'');runtime=Path(cfg.get('runtime_dir')or'')
 if path!=APPROVED_EXPORT_ROOT/'release-manifest.json'or runtime!=APPROVED_EXPORT_ROOT/'runtime':raise ValueError('only new Phase A runtime allowed')
 if path.is_symlink()or path.resolve()!=path or not path.is_file()or sha(path)!=pin:raise ValueError('reviewed new manifest identity')
 m=json.loads(path.read_text())
 if m.get('source_commit')!=COMMIT or m.get('release_id')!='materials-preview-140ce6b-local-20261111'or m.get('runtime_format')!='next-start-v1'or m.get('entrypoint')!='node_modules/next/dist/bin/next':raise ValueError('new runtime source/format required')
 before=inventory(runtime,m)
 required=['.next/BUILD_ID','package.json','package-lock.json','node_modules/pg/package.json','.next/server/app-paths-manifest.json','.next/server/app/api/admin/materiais/route.js','.next/server/app/api/admin/materiais/[id]/route.js','.next/server/app/api/admin/materiais/pedidos/[requestId]/route.js','.next/server/app/api/admin/materiais/[id]/previa/route.js']
 if any(n not in before for n in required):raise ValueError('compiled real Materials routes absent')
 routes=json.loads((runtime/'.next/server/app-paths-manifest.json').read_text())
 for route in ['api/admin/materiais','api/admin/materiais/[id]','api/admin/materiais/pedidos/[requestId]','api/admin/materiais/[id]/previa']:
  if routes.get('/'+route+'/route')!='app/'+route+'/route.js':raise ValueError('compiled Next route map mismatch')
 return runtime,m,before

def environment(run,nonce,runtime):
 empty=str(run/'empty');env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','NODE_ENV':'production','APP_URL':f'http://127.0.0.1:{PORT}','DATABASE_URL':'postgres://fixture_only:fixture_only@127.0.0.1:55498/fixture_only','HASH_PEPPER':'QA_MATERIALS_HTTP_ONLY_NOT_PRODUCTION_0123456789','ADMIN_PASSWORD':'Fixture-NotProduction-92837465','ADMIN_PASSWORD_FILE':empty+'/never-present.hash','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'QA <noreply@fixture.invalid>','CONTACT_TO':'noreply@fixture.invalid','CONTACT_BCC':'','RECIPIENTS':'','APPROVER_EMAIL':'','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SIGNER':'none','MATERIALS_LIBRARY_ENABLED':'1','GOVBR_BASE_ENABLED':'0','GOVBR_BASE_VALIDATION_ENABLED':'0','GOVBR_BASE_VALIDATOR_URL':'','BATCH_PACKAGE_ENABLED':'0','BATCH_A1_ENABLED':'0','ICP_VALIDATOR_URL':'','PRESIDENT_OWN_ENABLED':'0','DOCUMENT_REFERENCE_ENABLED':'0','DOCUMENT_REFERENCE_ORIGIN':'','DOCUMENT_VERIFICATION_PUBLIC':'0','NEXT_TELEMETRY_DISABLED':'1','CI':'1','TMPDIR':str(run/'tmp'),'RUNTIME_SMOKE_RUN':str(run),'RUNTIME_SMOKE_PORT':str(PORT),'FUNCTIONAL_PGDATA':'/var/lib/postgresql/data','FUNCTIONAL_NONCE':nonce,'MAIL_OUTBOX_DIR':str(run/'mail-outbox'),'MATERIALS_HTTP_FIXTURE':'materials-next-real-140ce-local-v1','QA_RUNTIME':str(runtime),'NODE_OPTIONS':'--max-old-space-size=1536 --import='+str(ROOT/'runtime-guard.mjs')}
 for key in ['HOME','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']:env[key]=empty
 return env

def get(path,cookie=None,method='GET',data=None):
 # Physical loopback only; no redirects followed and no retries of any POST.
 if not path.startswith('/')or path.startswith('//')or any(x in path for x in ['\r','\n','#']):raise ValueError('closed local HTTP path')
 allowed=path=='/privacidade'or path=='/api/admin/login'or re.fullmatch(r'/api/admin/materiais(?:/[a-f0-9-]{36}(?:/previa)?|/pedidos/[a-f0-9-]{36})?(?:\?[A-Za-z0-9=&-]+)?',path)
 if not allowed or method not in {'GET','POST'}:raise ValueError('outside Materials HTTP contract')
 if method=='POST'and path not in {'/api/admin/login','/api/admin/materiais'}:raise ValueError('unexpected mutation endpoint')
 headers={'Origin':f'http://127.0.0.1:{PORT}','Content-Type':'application/x-www-form-urlencoded'if path=='/api/admin/login'else'application/json'}
 if cookie:headers['Cookie']=cookie
 conn=http.client.HTTPConnection('127.0.0.1',PORT,timeout=8)
 try:
  conn.request(method,path,body=data,headers=headers);r=conn.getresponse();body=r.read(1024*1024+1)
  if len(body)>1024*1024:raise ValueError('bounded response exceeded')
  return r.status,{k.lower():v for k,v in r.getheaders()},body
 finally:conn.close()

class Calls:
 def __init__(self):self.cookies={}
 def login(self,actor):
  from urllib.parse import urlencode
  if actor not in {'editor','reader'}:raise ValueError('fixture role')
  password={'editor':'Fixture-Editor-Only-92837465','reader':'Fixture-Reader-Only-92837465'}[actor]
  status,h,b=get('/api/admin/login',method='POST',data=urlencode({'email':actor+'@fixture.invalid','password':password}))
  cookie=h.get('set-cookie','')
  if status!=303 or not h.get('location','').endswith('/admin')or not all(x in cookie.lower()for x in ['httponly','secure','samesite=strict']):raise ValueError('real authenticated role login')
  value=cookie.split(';',1)[0]
  if not re.fullmatch(r'[A-Za-z0-9_-]+=[A-Za-z0-9._~-]+',value):raise ValueError('strict session cookie shape')
  self.cookies[actor]=value
  return {'actor':actor,'status':303,'secure':True,'httpOnly':True,'sameSite':'strict'}
 def __call__(self,method,path,payload,actor):
  if actor not in {'anonymous','editor','reader'}:raise ValueError('closed actors')
  status,h,b=get(path,self.cookies.get(actor),method,None if payload is None else json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode())
  value=json.loads(b)if h.get('content-type','').startswith('application/json')else None
  return status,h,b,value

def members(pgid):
 found=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    fields=(p/'stat').read_text().rpartition(') ')[2].split()
    if int(fields[2])==pgid and fields[0]not in {'Z','X','x'}:found.append(int(p.name))
   except(FileNotFoundError,ProcessLookupError,PermissionError):pass
 return found

def stop_node(proc,group,ticks):
 for pid in members(proc.pid):
  path=Path('/proc')/str(pid)
  try:
   if path.stat().st_uid!=os.getuid()or cgroup_of(pid)!=group:raise ValueError('foreign Node group member')
   if pid==proc.pid and(path/'stat').read_text().rpartition(') ')[2].split()[19]!=ticks:raise ValueError('PID reused')
  except FileNotFoundError:pass
 if members(proc.pid):
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:
   for pid in members(proc.pid):
    if cgroup_of(pid)!=group:raise ValueError('foreign Node group during drain')
   os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
 return {'remainingProcesses':members(proc.pid)}

def fixture(node,env,run,action,deadline):
 with(run/(action+'-stdout.json')).open('xb')as out,(run/(action+'-stderr.log')).open('xb')as err:
  p=subprocess.run([str(node),str(ROOT/'fixture.cjs'),action],cwd=env['QA_RUNTIME'],env=env,stdout=out,stderr=err,timeout=min(30,max(1,deadline-time.monotonic())))
 if p.returncode:raise ValueError('fictitious fixture '+action+' failed')
 return json.loads((run/(action+'-stdout.json')).read_text())

def main():
 os.umask(0o077);cfg=json.loads(CONFIG_PATH.read_text());runtime,manifest,before=admit_runtime(cfg)
 verify_local_manifest();limits=live_context(cfg['expected_cgroup']);verify_local_context(cfg)
 node=Path(cfg['node_path'])
 if node.resolve()!=node or sha(node)!=cfg['node_sha256']:raise ValueError('pinned Node identity')
 if __import__('shutil').disk_usage(ROOT).free<2*1024**3:raise ValueError('2GiB free fixture budget required')
 cancel=CancellationState();deadline=time.monotonic()+600
 for sig in[signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,cancel.handle)
 signal.alarm(600);nonce=uuid.uuid4().hex[:12];run=ROOT/'runs'/nonce;run.mkdir(mode=0o700)
 for name in['empty','tmp','mail-outbox']:(run/name).mkdir(mode=0o700)
 env=environment(run,nonce,runtime);pg=None;child=None;ticks=None;log=None
 result={'classification':'LOCAL_REAL_COMPILED_NEXT_MATERIALS_HTTP','location':'LOCAL','sourceCommit':COMMIT,'runtimeManifestSha256':cfg['runtime_manifest_sha256'],'nonce':nonce,'limits':limits,'exit':1,'deployment':False,'browserExecuted':False,'realSendingOrSigning':False,'operationalReady':False,'requiresIndependentRetainedUnitExitZero':True}
 try:
  pg=DockerPG(run,nonce,cfg['expected_cgroup'],env,node,cfg,deadline,cancel)
  for action in[pg.prepare,pg.initialize,pg.start]:action()
  result['postgresHandshake']=pg.bootstrap();result['fixtureSeed']=fixture(node,env,run,'seed',deadline)
  log=(run/'next-server.log').open('xb');child=subprocess.Popen([str(node),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',str(PORT)],cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  ticks=(Path('/proc')/str(child.pid)/'stat').read_text().rpartition(') ')[2].split()[19];(run/'pid.json').write_text(json.dumps({'pid':child.pid,'startTicks':ticks,'cgroup':cfg['expected_cgroup'],'nonce':nonce})+'\n')
  ready=time.monotonic()+45
  while True:
   if child.poll()is not None:raise ValueError('Next exited before readiness')
   try:
    if get('/privacidade')[0]==200:break
   except(ConnectionError,OSError):pass
   if time.monotonic()>ready:raise TimeoutError('Next readiness; no alternate endpoint')
   time.sleep(.3)
  calls=Calls();result['logins']=[calls.login('editor'),calls.login('reader')]
  value=protocol(calls);(run/'protocol-result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');result['protocol']=value
  result['fixtureAfter']=fixture(node,env,run,'inspect',deadline)
  if list((run/'mail-outbox').iterdir()):raise ValueError('mail spool not empty')
  result['mailSpoolRemaining']=0;result['exit']=0
 except BaseException as exc:result['error']=type(exc).__name__+': '+str(exc)[:500];result['exit']=1
 finally:
  cancel.cleaning=True;signal.alarm(0)
  if child is not None:
   try:result['nodeCleanup']=stop_node(child,cfg['expected_cgroup'],ticks)
   except BaseException as exc:result['nodeCleanup']={'uncertain':True,'error':type(exc).__name__};result['exit']=1
  if log is not None:log.close()
  try:result['postgresCleanup']=pg.stop()if pg else{'stopped':True,'neverCreated':True}
  except BaseException as exc:result['postgresCleanup']={'stopped':False,'uncertain':True,'error':type(exc).__name__};result['exit']=1
  result['postgresLifecycle']=pg.report()if pg else{'neverCreated':True}
  try:result['runtimeStable']=before==inventory(runtime,manifest)
  except BaseException as exc:result['runtimeStable']=False;result['integrityError']=type(exc).__name__;result['exit']=1
  group=Path('/sys/fs/cgroup')/cfg['expected_cgroup'].lstrip('/')/'cgroup.procs';result['remainingCgroupProcesses']=[int(x)for x in group.read_text().split()if int(x)!=os.getpid()]
  result['localPortsClosed']=[]
  for port in[55498,31398]:
   with socket.socket()as sock:
    sock.settimeout(.3)
    if sock.connect_ex(('127.0.0.1',port))!=0:result['localPortsClosed'].append(port)
  records=[json.loads(v)for v in(run/'guard.jsonl').read_text().splitlines()]if(run/'guard.jsonl').exists()else[];result['guardInstalledForAppPid']=child is not None and any(v['kind']=='installed'and v['pid']==child.pid for v in records);result['guardDenials']=sum(v['kind']=='denied'for v in records);result['cancelSignals']=cancel.signals
  if result['remainingCgroupProcesses']or result['localPortsClosed']!=[55498,31398]or result.get('nodeCleanup',{}).get('remainingProcesses',[])or not result.get('postgresCleanup',{}).get('stopped')or result.get('runtimeStable')is not True or not result['guardInstalledForAppPid']or result['guardDenials']or cancel.signals:result['exit']=1
  (run/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');(ROOT/'latest-run.json').write_text(json.dumps({'run':str(run),'exit':result['exit']})+'\n')
 return result['exit']
if __name__=='__main__':raise SystemExit(main())
