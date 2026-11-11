#!/usr/bin/python3
"""One LOCAL Materials PG17 test cohort. Preparation only until independent activation."""
from pathlib import Path
import os,json,hashlib,subprocess,socket,signal,time,re,uuid
from local_controller import DockerPG,CancellationState,Cancelled,live_context,verify_local_context,verify_local_manifest,cgroup_of
ROOT=Path(__file__).resolve().parent
CONFIG_PATH=ROOT/'config.json'
EXPECTED_NAMES=[
 "materials PG17: additive DDL twice, real JSONB hash roundtrip and exact head FK",
 "materials PG17: two actors racing one CAS revision append exactly one version",
 "materials PG17: concurrent same actor intent is durable and scoped, replay returns original version",
 "materials PG17: audit failure atomically rolls back create and revise, without orphan receipt",
 "materials PG17: store revalidates role, live session and identity before admission",
 "materials PG17: archive appends history and UPDATE/DELETE guards preserve versions and receipts",
 "materials PG17: library UUID pagination has no overlap and separates archived heads",
 "materials PG17: ordinal history pagination preserves current head and all old revisions",
 "materials PG17: disabling feature preserves existing records and rejects every entry point",
]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact_inventory(root,pins):
 if root.is_symlink()or root.resolve()!=root or not root.is_dir():raise ValueError('canonical source/package root')
 actual=set()
 for p in root.rglob('*'):
  if p.is_symlink()or not(p.is_file()or p.is_dir()):raise ValueError('special source/package member')
  if p.is_file():actual.add(str(p.relative_to(root)))
 if actual!=set(pins):raise ValueError('source/package file-set drift')
 for name,pin in pins.items():
  if not name or Path(name).is_absolute()or '..'in Path(name).parts or (root/name).stat().st_size!=pin['bytes']or sha(root/name)!=pin['sha256']:raise ValueError('source/package byte drift')
 return True

def verify_dependencies():
 m=json.loads((ROOT/'dependencies-manifest.json').read_text());base=Path(m['root'])
 for name,version in m['packages'].items():
  if not re.fullmatch('[a-z0-9-]+',name):raise ValueError('closed package name')
  package=base/name;subset={key[len(name)+1:]:pin for key,pin in m['files'].items()if key.startswith(name+'/')};exact_inventory(package,subset)
  if json.loads((package/'package.json').read_text())['version']!=version['expected']:raise ValueError('package lock drift')
 compiler=Path(m['compiler']['path'])
 if compiler.resolve()!=compiler or compiler.is_symlink()or sha(compiler)!=m['compiler']['sha256']:raise ValueError('compiler drift')
 return True

def verify_stage(run):
 m=json.loads((run/'stage-manifest.json').read_text());cfg=json.loads(CONFIG_PATH.read_text());graph=json.loads((ROOT/'source-preflight.json').read_text())
 if m['sourceCommit']!=cfg['source_commit']or m['raw']!=graph['files']:raise ValueError('exact source staging commit/file-set')
 exact_inventory(run/'stage/source',m['raw'])
 compiled=run/'stage/compiled';link=compiled/'site/node_modules'
 if not link.is_symlink()or os.readlink(link)!=cfg['dependencies_root']or link.resolve()!=Path(cfg['dependencies_root']).resolve():raise ValueError('exact reused dependency link')
 # Do not follow the one declared dependency link or call it an OS-read-only mount.
 actual=set()
 for base,dirs,files in os.walk(compiled,followlinks=False):
  for name in list(dirs):
   p=Path(base)/name
   if p.is_symlink():
    if p!=link:raise ValueError('undeclared compiled symlink')
    dirs.remove(name)
  for name in files:
   p=Path(base)/name
   if p.is_symlink()or not p.is_file():raise ValueError('compiled special member')
   actual.add(str(p.relative_to(compiled)))
 if actual!=set(m['compiled']):raise ValueError('compiled file-set drift')
 for name,pin in m['compiled'].items():
  if (compiled/name).stat().st_size!=pin['bytes']or sha(compiled/name)!=pin['sha256']:raise ValueError('compiled bytes drift')
 return True

def parse_tap(raw):
 text=raw.decode('utf8','strict')
 names=re.findall(r'^ok [0-9]+ - (.+)$',text,re.M)
 if names!=EXPECTED_NAMES or re.search(r'^not ok |# SKIP|# TODO|^Bail out!',text,re.M):raise ValueError('nine exact TAP cases/zero skip/fail required')
 for key,value in {'tests':9,'suites':0,'pass':9,'fail':0,'cancelled':0,'skipped':0,'todo':0}.items():
  if re.findall(r'^# '+key+r' ([0-9]+)$',text,re.M)!=[str(value)]:raise ValueError('strict TAP footer '+key)
 return {'tests':9,'passed':9,'failed':0,'skipped':0,'names':names,'rawSha256':hashlib.sha256(raw).hexdigest()}

def environment(run,nonce,guard=True):
 value={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','NODE_ENV':'test','DATABASE_URL':'postgres://fixture_only:fixture_only@127.0.0.1:55496/fixture_only','MATERIALS_PG_FIXTURE':'materials-library-pg17-isolated-v1','MATERIALS_PG_FIXTURE_NONCE':nonce,'MATERIALS_LIBRARY_ENABLED':'1','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'QA <noreply@fixture.invalid>','APPROVER_EMAIL':'','RECIPIENTS':'','SIGNER':'none','HASH_PEPPER':'QA_MATERIALS_ONLY_NOT_PRODUCTION_0123456789abcdef','MAIL_OUTBOX_DIR':str(run/'mail-outbox'),'FUNCTIONAL_PGDATA':'/var/lib/postgresql/data','FUNCTIONAL_NONCE':nonce,'RUNTIME_SMOKE_RUN':str(run),'HOME':str(run/'empty'),'SECRETS_DIR':str(run/'empty'),'PETICAO_CONFIG_DIR':str(run/'empty'),'CREDENTIALS_DIRECTORY':str(run/'empty'),'GEO_DIR':str(run/'empty'),'TMPDIR':str(run/'tmp'),'CI':'1','NEXT_TELEMETRY_DISABLED':'1','CRON_SECRET':'','WHATSAPP_ENABLED':'0','GOVBR_BASE_ENABLED':'0','GOVBR_BASE_VALIDATION_ENABLED':'0','BATCH_A1_ENABLED':'0','PRESIDENT_OWN_ENABLED':'0','BATCH_PACKAGE_ENABLED':'0','DOCUMENT_REFERENCE_ENABLED':'0','DOCUMENT_VERIFICATION_PUBLIC':'0','ICP_VALIDATOR_URL':'','GOVBR_BASE_VALIDATOR_URL':''}
 if guard:value['NODE_OPTIONS']='--max-old-space-size=1536 --import='+str(ROOT/'node-guard.mjs')
 return value

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
 ids=members(proc.pid)
 for pid in ids:
  path=Path('/proc')/str(pid)
  try:
   if path.stat().st_uid!=os.getuid()or cgroup_of(pid)!=group:raise ValueError('foreign Node group member; no signal')
   if pid==proc.pid and (path/'stat').read_text().rpartition(') ')[2].split()[19]!=ticks:raise ValueError('Node PID reused')
  except FileNotFoundError:pass
 if ids:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:
   for pid in members(proc.pid):
    if cgroup_of(pid)!=group:raise ValueError('foreign group during cleanup')
   os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
 return {'remainingProcesses':members(proc.pid)}

def main():
 os.umask(0o077);cfg=json.loads(CONFIG_PATH.read_text())
 if cfg.get('infra_reviewed')is not True:raise ValueError('Materials PG17 preparation only; independent activation required')
 if os.environ.get('MATERIALS_QA_CONFIG')!=str(CONFIG_PATH):raise ValueError('exact local profile config required')
 verify_local_manifest();limits=live_context(cfg['expected_cgroup']);verify_local_context(cfg)
 node=Path(cfg['node_path'])
 if node.resolve()!=node or sha(node)!=cfg['node_sha256']:raise ValueError('pinned Node identity')
 verify_dependencies();deadline=time.monotonic()+600;cancel=CancellationState()
 for sig in[signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,cancel.handle)
 signal.alarm(600);nonce=uuid.uuid4().hex[:12];run=ROOT/'runs'/nonce;run.mkdir(mode=0o700,parents=True)
 for name in['empty','tmp','mail-outbox']:(run/name).mkdir(mode=0o700)
 clean=environment(run,nonce,False)
 pg=None;child=None;ticks=None
 result={'classification':'LOCAL_MATERIALS_PG17_ONLY','sourceCommit':cfg['source_commit'],'location':'LOCAL','santiagoExecution':False,'workerJob':False,'appHttpExecuted':False,'realSigningOrSending':False,'operationalReady':False,'nonce':nonce,'limits':limits,'exit':1,'requiresIndependentRetainedUnitExitZero':True}
 try:
  staged=subprocess.run([str(node),str(ROOT/'stage.cjs'),str(run)],env=clean,cwd=ROOT,capture_output=True,timeout=min(45,deadline-time.monotonic()))
  (run/'stage-stdout.log').write_bytes(staged.stdout);(run/'stage-stderr.log').write_bytes(staged.stderr)
  if staged.returncode:raise ValueError('source-only staging failed before Docker')
  verify_stage(run);local_cfg={**cfg,'runtime_dir':str(run/'stage/compiled/site')};env=environment(run,nonce);pg=DockerPG(run,nonce,cfg['expected_cgroup'],env,node,local_cfg,deadline,cancel)
  for action in[pg.prepare,pg.initialize,pg.start]:verify_local_context(cfg);action()
  result['postgresHandshake']=pg.bootstrap()
  with(run/'raw-stdout.log').open('xb')as out,(run/'raw-stderr.log').open('xb')as err:
   # Direct node:test in this one process: no runner child, loader, hook, or npm command.
   child=subprocess.Popen([str(node),str(run/'stage/compiled/site/src/lib/materials-store.pg.test.js')],cwd=run/'stage/compiled/site',env=env,stdout=out,stderr=err,start_new_session=True)
   proc=Path('/proc')/str(child.pid);ticks=(proc/'stat').read_text().rpartition(') ')[2].split()[19];(run/'pid.json').write_text(json.dumps({'pid':child.pid,'startTicks':ticks,'cgroup':cfg['expected_cgroup'],'nonce':nonce})+'\n')
   try:child.wait(timeout=max(1,deadline-time.monotonic()))
   except subprocess.TimeoutExpired:raise TimeoutError('Materials cohort deadline; no retry')
  if child.returncode!=0:raise ValueError('Materials test process nonzero; raw logs private')
  result['tap']=parse_tap((run/'raw-stdout.log').read_bytes());result['testExit']=child.returncode
  remain=pg.sql("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 't_materials_%'")
  if remain!='0':raise ValueError('Materials owned schemas remain')
  result['remainingFixtureSchemas']=0
  if list((run/'mail-outbox').iterdir()):raise ValueError('unexpected dev mail spool')
  result['mailSpoolRemaining']=0;result['exit']=0
 except BaseException as exc:result['error']=type(exc).__name__+': '+str(exc)[:700];result['exit']=1
 finally:
  cancel.cleaning=True;signal.alarm(0)
  if child is not None:
   try:result['nodeCleanup']=stop_node(child,cfg['expected_cgroup'],ticks)
   except BaseException as exc:result['nodeCleanup']={'uncertain':True,'error':type(exc).__name__};result['exit']=1
  try:result['postgresCleanup']=pg.stop()if pg is not None else {'stopped':True,'neverCreated':True}
  except BaseException as exc:result['postgresCleanup']={'stopped':False,'uncertain':True,'error':type(exc).__name__};result['exit']=1
  result['postgresLifecycle']=pg.report()if pg is not None else {'neverCreated':True}
  try:result['sourceStable']=verify_stage(run);result['dependenciesStable']=verify_dependencies()
  except BaseException as exc:result['sourceStable']=False;result['integrityError']=type(exc).__name__+': '+str(exc)[:240];result['exit']=1
  group=Path('/sys/fs/cgroup')/cfg['expected_cgroup'].lstrip('/')/'cgroup.procs';result['remainingCgroupProcesses']=[int(x)for x in group.read_text().split()if int(x)!=os.getpid()]
  result['localPortsClosed']=[]
  for port in[55496,31396]:
   with socket.socket()as sock:
    sock.settimeout(.3)
    if sock.connect_ex(('127.0.0.1',port))!=0:result['localPortsClosed'].append(port)
  records=[json.loads(v)for v in(run/'guard.jsonl').read_text().splitlines()]if(run/'guard.jsonl').exists()else[];result['guardInstalledForTestPid']=child is not None and any(v['kind']=='installed'and v['pid']==child.pid for v in records);result['guardDenials']=sum(v['kind']=='denied'for v in records)
  result['cancelSignals']=cancel.signals
  if result['remainingCgroupProcesses']or result['localPortsClosed']!=[55496,31396]or result.get('nodeCleanup',{}).get('remainingProcesses',[])or not result.get('postgresCleanup',{}).get('stopped')or result.get('sourceStable')is not True or result.get('dependenciesStable')is not True or not result['guardInstalledForTestPid']or result['guardDenials']or cancel.signals:result['exit']=1
  if(run/'raw-stdout.log').exists():result['rawStdoutSha256']=sha(run/'raw-stdout.log')
  if(run/'raw-stderr.log').exists():result['rawStderrSha256']=sha(run/'raw-stderr.log')
  (run/'result.json').write_text(json.dumps(result,indent=2)+'\n');(ROOT/'latest-run.json').write_text(json.dumps({'run':str(run),'exit':result['exit']})+'\n')
 cancel.cleaning=False
 if cancel.signals:result['exit']=1;(run/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2));return result['exit']
if __name__=='__main__':raise SystemExit(main())
