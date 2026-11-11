#!/usr/bin/python3
"""LOCAL draft only. Execute once under the exact reviewed user unit; never a worker job."""
from pathlib import Path
import argparse,hashlib,json,os,re,signal,socket,stat,subprocess,sys,time,uuid
ROOT=Path('/mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111')
sys.path.insert(0,str(ROOT/'frozen'))
from staging import digest,pinned,read_manifest,extract
from receipts import guard_check,export,verify_export
UNIT='peticao-r0007-local-history-core-pg17-qa-20261111.service'
IMAGE='sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994'
LABEL='org.peticao.qa.local-r0007'
PORT=55487
class Uncertain(RuntimeError):pass

def write(path,value):
 with path.open('x')as stream:json.dump(value,stream,indent=2);stream.write('\n')
 path.chmod(0o600)
def call(args,timeout=15):
 # No shell, inherited credentials/config or retry. Docker uses only local socket.
 return subprocess.run(args,text=True,capture_output=True,check=True,timeout=timeout,env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'empty'),'LANG':'C.UTF-8','DOCKER_HOST':'unix:///var/run/docker.sock'})
def docker(*args,timeout=15):return call(['/usr/bin/docker',*args],timeout=timeout)
def cgroup(pid):
 rows=[v[3:]for v in(Path('/proc')/str(pid)/'cgroup').read_text().splitlines()if v.startswith('0::')]
 if len(rows)!=1:raise ValueError('unified cgroup required')
 return rows[0]
def identity(pid,group):
 path=Path('/proc')/str(pid);fields=(path/'stat').read_text().rpartition(') ')[2].split()
 if path.stat().st_uid!=os.getuid()or fields[0]in {'Z','X','x'}or cgroup(pid)!=group:raise ValueError('owned child UID/cgroup changed')
 return fields[19]
def unit_context():
 if os.getuid()==0:raise ValueError('nonroot user required')
 group=cgroup(os.getpid())
 if not group.endswith('/'+UNIT)or not group.startswith('/user.slice/'):raise ValueError('exact bounded user unit required')
 cg=Path('/sys/fs/cgroup')/group.lstrip('/')
 cpu=(cg/'cpu.max').read_text().split();memory=(cg/'memory.max').read_text().strip();tasks=(cg/'pids.max').read_text().strip()
 if cpu[0]=='max'or not 0<int(cpu[0])/int(cpu[1])<=2 or memory=='max'or not 0<int(memory)<=3*1024**3 or tasks=='max'or not 0<int(tasks)<=256:raise ValueError('required CPU2 Memory3G Tasks256 limits absent')
 return {'location':'LOCAL','hostname':socket.gethostname(),'unit':UNIT,'cgroup':group,'uid':os.getuid(),'pid':os.getpid(),'startTicks':identity(os.getpid(),group),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'workerJob':False,'santiagoExecution':False}
def check_context(context):
 if unit_context()!=context:raise ValueError('local context changed')
def owned_labels(nonce):return {LABEL:nonce,LABEL+'.uid':str(os.getuid()),LABEL+'.scope':'fixture-only'}
def verify_owned(obj,nonce,kind):
 if type(obj)is not dict:raise ValueError('Docker object required')
 labels=obj.get('Labels',obj.get('Config',{}).get('Labels',{}))or{};expected_labels=owned_labels(nonce)
 if any(labels.get(k)!=v for k,v in expected_labels.items())or any(k.startswith(LABEL)and k not in expected_labels for k in labels):raise ValueError('foreign or changed Docker labels')
 value=obj.get('Id','')
 if not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('exact Docker ID required')
 expected='peticao-r0007-'+nonce+('-net'if kind=='network'else'-pg')
 if obj.get('Name','').lstrip('/')!=expected:raise ValueError('Docker name changed')
 return value
def inspect_owned(name,nonce,kind):
 args=['network','inspect',name]if kind=='network'else['inspect','--type','container',name]
 values=json.loads(docker(*args).stdout)
 if type(values)is not list or len(values)!=1:raise ValueError('single Docker identity required')
 verify_owned(values[0],nonce,kind);return values[0]
def label_flags(nonce):
 return [item for key,value in owned_labels(nonce).items()for item in ['--label',key+'='+value]]
def network_args(nonce):return ['network','create','--driver','bridge',*label_flags(nonce),'peticao-r0007-'+nonce+'-net']
def container_args(nonce,nid):
 return ['create','--pull=never','--name','peticao-r0007-'+nonce+'-pg',*label_flags(nonce),'--network',nid,'--publish','127.0.0.1:55487:5432','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=128','--read-only','--tmpfs','/var/lib/postgresql/data:rw,size=256m','--tmpfs','/var/run/postgresql:rw,size=16m','--tmpfs','/tmp:rw,size=16m','--env','POSTGRES_USER=fixture_only','--env','POSTGRES_PASSWORD=fixture_only','--env','POSTGRES_DB=fixture_only',IMAGE,'-c','cluster_name=local_r0007_'+nonce]
def validate_container(obj,nonce,nid,*,phase='before_start',expected_cid=None):
 cid=verify_owned(obj,nonce,'container');h=obj['HostConfig'];bindings={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55487'}]}
 if expected_cid is not None and cid!=expected_cid:raise ValueError('container ID changed after create')
 if obj['Image']!=IMAGE or h['PortBindings']!=bindings or h['Memory']!=512*1024**2 or h['NanoCpus']!=10**9 or h['PidsLimit']!=128 or not h['ReadonlyRootfs']or h.get('Binds')or set(h.get('Tmpfs',{}))!={'/var/lib/postgresql/data','/var/run/postgresql','/tmp'}:raise ValueError('Docker isolation drift')
 # create config binds the exact owned network ID even before Docker allocates its endpoint.
 if h.get('NetworkMode')!=nid:raise ValueError('configured network ID changed')
 networks=obj['NetworkSettings']['Networks'];network_name='peticao-r0007-'+nonce+'-net'
 if len(networks)!=1 or next(iter(networks))not in {network_name,nid}:raise ValueError('unexpected Docker network map')
 actual=next(iter(networks.values())).get('NetworkID');state=obj.get('State',{})
 if phase=='before_start':
  if state.get('Status')!='created'or state.get('Running')is not False or actual not in {'',nid}:raise ValueError('created container/endpoint identity changed')
 elif phase=='after_start':
  if state.get('Status')!='running'or state.get('Running')is not True or actual!=nid:raise ValueError('running container endpoint not proven')
 else:raise ValueError('unknown container lifecycle phase')
 return cid

def verify_inputs(reg):
 if ROOT.resolve()!=ROOT or ROOT.stat().st_uid!=os.getuid()or stat.S_IMODE(ROOT.stat().st_mode)!=0o700:raise ValueError('private root required')
 pinned(Path(reg['node_path']),reg['node_sha256'],128*1024**2)
 if reg['source_commit']!='93557bfba931f8f731807fc9f30f1d88dbafedf1'or reg['backend_source_commit']!='f55595cd348c23ffe559dba2de9150259db9f1e7'or reg['docker_image']!=IMAGE:raise ValueError('fixed sources/image required')
 image=json.loads(docker('image','inspect',IMAGE).stdout)
 if len(image)!=1 or image[0]['Id']!=IMAGE or image[0]['Architecture']!='amd64'or image[0]['Os']!='linux':raise ValueError('cached image mismatch')
 with socket.socket()as sock:
  sock.bind(('127.0.0.1',PORT)) # Availability observation only, no listener.
 return {'image':IMAGE,'os':'linux','arch':'amd64','observedPortFree':PORT}
def expected_inventory(reg):
 base=Path(reg['artifacts_path']);source=read_manifest(base/'source/source-manifest.json',reg['source_manifest_sha256']);prod=read_manifest(base/'production-manifest.json',reg['production_manifest_sha256']);dev=read_manifest(base/'devdeps-manifest.json',reg['devdeps_manifest_sha256'])
 if source['commit']!=reg['source_commit']or prod['source_commit']!=reg['backend_source_commit']:raise ValueError('reused source manifest identity')
 expected={n:p['sha256']for n,p in source['files'].items()};expected.update({'site/'+n:p['sha256']for n,p in prod['files'].items()if n.startswith('node_modules/')});expected.update({'site/'+n:p['sha256']for n,p in dev['files'].items()})
 return expected

def verify_reused(reg,expected):
 source=Path(reg['reused_source']);actual={}
 if source.resolve()!=source or not source.is_dir()or source.stat().st_uid!=os.getuid()or stat.S_IMODE(source.stat().st_mode)!=0o700:raise ValueError('reused source private/canonical identity')
 for path in source.rglob('*'):
  if path.is_symlink()or not(path.is_dir()or path.is_file()):raise ValueError('reused source special/link')
  if path.is_file():actual[str(path.relative_to(source))]=digest(path,256*1024**2)
 if actual!=expected:raise ValueError('reused source bytes/inventory drift; no fallback copy')
 for name,pin in reg['f555_history_pins'].items():
  if actual.get(name)!=pin:raise ValueError('core history source not identical to f555')
 return True

def exact_tap(text,names):
 passed=[]
 for line in text.splitlines():
  match=re.fullmatch(r'ok \d+ - (.*)',line)
  if match and ' # SKIP'not in match[1]and ' # TODO'not in match[1]:passed.append(match[1])
 if any(not re.search(r'^# '+key+' '+str(value)+r'$',text,re.M)for key,value in [('tests',len(names)),('pass',len(names)),('skipped',0),('todo',0)]):raise ValueError('exact TAP totals and no skips required')
 if passed!=names or re.search(r'^not ok ',text,re.M)or not re.search(r'^# fail 0$',text,re.M)or not re.search(r'^# cancelled 0$',text,re.M):raise ValueError('exact core history TAP cases required')
 return passed

def make_guard(run,site,reg,job,nonce,context):
 node=Path(reg['node_path']);loader=site/'node_modules/tsx/dist/loader.mjs';bins=[site/'node_modules/esbuild/bin/esbuild',site/'node_modules/@esbuild/linux-x64/bin/esbuild']
 cfg={'schema':1,'job':job,'nonce':nonce,'cgroup':context['cgroup'],'sourceCommit':reg['source_commit'],'dbPort':PORT,'tsxVersion':reg['tsx_version'],'esbuildVersion':reg['esbuild_version'],'tmpdir':str(run/'tmp'),'site':str(site),'log':str(run/'guard.jsonl'),'node':str(node),'loader':str(loader),'testFile':str(site/reg['test_file']),'pattern':reg['test_pattern'],'esbuildBinaries':[str(p)for p in bins],'pins':{str(p):digest(p,128*1024**2)for p in [node,loader,*bins]}}
 write(run/'guard-config.json',cfg);return cfg

def environment(run,site):
 return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'LANG':'C.UTF-8','NODE_ENV':'test','DATABASE_URL':'postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only','HASH_PEPPER':'QA-ONLY-NOT-PRODUCTION-PEPPER-93557bfba931','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'qa@example.test','ADMIN_PASSWORD':'QA-ONLY-NEVER-A-REAL-PASSWORD','ADMIN_PASSWORD_FILE':str(run/'empty/nonexistent-admin-password'),'CONTACT_TO':'qa@example.test','CONTACT_BCC':'','RECIPIENTS':'','APPROVER_EMAIL':'','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SECRETS_DIR':str(run/'empty'),'PETICAO_CONFIG_DIR':str(run/'empty'),'CREDENTIALS_DIRECTORY':str(run/'empty'),'GEO_DIR':str(run/'empty'),'APP_URL':'http://qa.local','SIGNER':'none','TMPDIR':str(run/'tmp'),'TSX_DISABLE_CACHE':'1','TSX_TSCONFIG_PATH':str(site/'tsconfig.json'),'QA_GUARD_CONFIG':str(run/'guard-config.json'),'MAIL_OUTBOX_DIR':str(run/'mail-outbox'),'NODE_OPTIONS':'--require='+str(ROOT/'frozen/node_guard.cjs')}

def drain(child,context,ticks):
 if child is None:return {'nodeGroupDrained':True}
 def members():
  found=[]
  for path in Path('/proc').iterdir():
   if not path.name.isdigit():continue
   try:
    f=(path/'stat').read_text().rpartition(') ')[2].split()
    if f[0]!='Z'and int(f[2])==child.pid:found.append(int(path.name))
   except(FileNotFoundError,ProcessLookupError):pass
  return found
 if child.poll()is None:
  if identity(child.pid,context['cgroup'])!=ticks:raise ValueError('Node PID reused; do not signal')
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=8)
  except subprocess.TimeoutExpired:
   if identity(child.pid,context['cgroup'])!=ticks:raise ValueError('Node PID reused before KILL')
   os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
 remaining=members()
 if remaining:raise ValueError('owned Node descendants remain; outer cgroup drain needed')
 return {'nodeGroupDrained':True,'remainingNodeProcesses':remaining}

def cleanup(nonce,*,expected_cid=None,expected_nid=None):
 # Inspect exact nonce/name/ID again before every control command; never prune.
 proof={};errors=[]
 for kind,name in [('container','peticao-r0007-'+nonce+'-pg'),('network','peticao-r0007-'+nonce+'-net')]:
  try:
   args=['network','ls','--filter','name=^'+name+'$','--format','{{.ID}}']if kind=='network'else['ps','--all','--filter','name=^/'+name+'$','--format','{{.ID}}']
   if not docker(*args).stdout.strip():proof[kind+'Absent']=True;continue
   obj=inspect_owned(name,nonce,kind);oid=verify_owned(obj,nonce,kind)
   expected_id=expected_cid if kind=='container'else expected_nid
   if expected_id is not None and oid!=expected_id:raise ValueError('owned Docker ID changed; do not remove replacement')
   if kind=='container'and obj.get('Image')!=IMAGE:raise ValueError('container image changed; do not remove')
   if kind=='network'and (obj.get('Driver')!='bridge'or obj.get('Internal')is not False):raise ValueError('network config changed; do not remove')
   docker(*(['rm','--force',oid]if kind=='container'else['network','rm',oid]),timeout=25)
   # Inspection uses list metadata only; a zero rm exit is not the sole proof.
   if docker(*args).stdout.strip():raise ValueError('owned Docker resource still visible')
   proof[kind+'Removed']=True
  except BaseException as exc:errors.append(kind+': '+type(exc).__name__+': '+str(exc)[:300])
 if errors:proof['cleanupErrors']=errors
 return proof

def main(review_sha):
 os.umask(0o077)
 manifest=ROOT/'local-manifest.json';pinned(manifest,review_sha,2*1024**2);data=json.loads(manifest.read_text())
 for name,pin in data['files'].items():pinned(ROOT/name,pin,2*1024**2)
 context=unit_context();reg=json.loads((ROOT/'local-registry.json').read_text())
 signal.alarm(600)
 if (ROOT/'execution.started').exists():raise ValueError('single execution only; reconcile existing attempt')
 write(ROOT/'execution.started',{'classification':'LOCAL_EXECUTION_INTENT','context':context})
 nonce=uuid.uuid4().hex[:12];job=uuid.uuid4().hex;runs=ROOT/'runs';runs.mkdir(mode=0o700,exist_ok=True);run=runs/nonce;run.mkdir(mode=0o700)
 for name in ['tmp','empty','mail-outbox']:(run/name).mkdir(mode=0o700)
 write(run/'context.json',{**context,'job':job,'nonce':nonce,'jobMeaning':'local correlation identifier; not a worker queue job'})
 child=None;ticks=None;cid=None;nid=None;container_intent=False;network_intent=False
 proof={'classification':'LOCAL_REAL_CORE_HISTORY6_PG17_NOT_SANTIAGO','job':job,'nonce':nonce,'sourceCommit':reg['source_commit'],'backendCommit':reg['backend_source_commit'],'testsExecuted':False,'productionDatabaseAccessed':False,'realPostgresFixtureStarted':False,'operationalReady':False,'deployment':False,'exit':1}
 try:
  proof['preflight']=verify_inputs(reg);expected=expected_inventory(reg);proof['sourceInventoryBefore']=verify_reused(reg,expected);site=Path(reg['reused_source'])/'site';write(run/'staging.json',{'reusedReadOnlySource':reg['reused_source'],'sourceCommit':reg['source_commit'],'backendCommit':reg['backend_source_commit'],'filesVerifiedBefore':len(expected),'newLargeCopy':False,'newTestsExpected':6,'inheritedViewTests':8});check_context(context)
  write(run/'docker-intent.json',{'nonce':nonce,'labels':owned_labels(nonce),'networkArgs':network_args(nonce),'image':IMAGE,'source':'LOCAL'})
  network_intent=True
  try:nid=docker(*network_args(nonce)).stdout.strip()
  except subprocess.TimeoutExpired:raise Uncertain('network create timeout; do not retry; reconcile exact nonce/name')
  net=inspect_owned('peticao-r0003-'+nonce+'-net',nonce,'network')
  if net['Id']!=nid or net.get('Driver')!='bridge'or net.get('Internal')is not False or net.get('Containers'):raise ValueError('exclusive new bridge identity changed')
  container_intent=True
  try:cid=docker(*container_args(nonce,nid),timeout=30).stdout.strip()
  except subprocess.TimeoutExpired:raise Uncertain('container create timeout; do not retry; reconcile exact nonce/name')
  obj=inspect_owned('peticao-r0003-'+nonce+'-pg',nonce,'container')
  if validate_container(obj,nonce,nid)!=cid:raise ValueError('created ID mismatch')
  write(run/'docker-identities.json',{'networkId':nid,'containerId':cid,'nonce':nonce,'image':IMAGE})
  docker('start',cid,timeout=20) # Timeout is uncertain; no second start.
  running=inspect_owned('peticao-r0003-'+nonce+'-pg',nonce,'container')
  validate_container(running,nonce,nid,phase='after_start',expected_cid=cid)
  query="SELECT json_build_object('version',current_setting('server_version_num'),'cluster',current_setting('cluster_name'),'database',current_database())"
  expected_db={'version':'170011','cluster':'local_r0007_'+nonce,'database':'fixture_only'}
  deadline=time.monotonic()+40
  while True:
   try:handshake=json.loads(docker('exec','--env','PGPASSWORD=fixture_only',cid,'psql','-h','127.0.0.1','-X','-At','-U','fixture_only','-d','fixture_only','-c',query,timeout=4).stdout);break
   except subprocess.CalledProcessError:
    if time.monotonic()>deadline:raise TimeoutError('owned fixture PG17 readiness deadline')
    time.sleep(.5)
  if handshake!=expected_db:raise ValueError('Docker PG nonce/version/database mismatch')
  proof['realPostgresFixtureStarted']=True
  guard=make_guard(run,site,reg,job,nonce,context);env=environment(run,site)
  host="import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});try{await c.connect();console.log(JSON.stringify((await c.query(\"SELECT current_setting('server_version_num') version,current_setting('cluster_name') cluster,current_database() database\")).rows[0]));}finally{await c.end();}"
  host_result=subprocess.run([reg['node_path'],'--input-type=module','-e',host],cwd=site,env=env,capture_output=True,text=True,check=True,timeout=12)
  if json.loads(host_result.stdout)!=expected_db:raise ValueError('host TCP PG nonce/version/database mismatch')
  write(run/'pg-handshake.json',{'docker':handshake,'hostTCP':json.loads(host_result.stdout),'location':'LOCAL','productionDatabase':False});check_context(context)
  args=[reg['node_path'],'--import',guard['loader'],'--test','--test-concurrency=1','--test-name-pattern='+reg['test_pattern'],'--test-reporter=tap',guard['testFile']]
  with(run/'tap.log').open('xb')as tap,(run/'stderr.log').open('xb')as err:
   child=subprocess.Popen(args,cwd=site,env=env,stdout=tap,stderr=err,start_new_session=True);ticks=identity(child.pid,context['cgroup']);proof['testsExecuted']=True;proof['nodePid']=child.pid;deadline=time.monotonic()+480
   while child.poll()is None:
    if time.monotonic()>deadline:raise TimeoutError('five callbacks deadline')
    if any((run/n).stat().st_size>8*1024**2 for n in ['tap.log','stderr.log']):raise ValueError('QA log budget exceeded')
    check_context(context);time.sleep(.5)
   proof['testExit']=child.returncode
  proof.update(drain(child,context,ticks));proof['passedTests']=exact_tap((run/'tap.log').read_text(),reg['expected_cases'])
  events=[json.loads(v)for v in(run/'guard.jsonl').read_text().splitlines()];summary=guard_check(events,job,nonce,allow_unexpected=True);write(run/'guard-summary.json',summary);proof.update(summary)
  if proof['testExit']!=0 or summary['unexpectedDenials']!=0 or child.pid not in summary['guardPids']or len(summary['testChildPids'])!=1 or summary['testChildPids'][0]==child.pid:raise ValueError('real five callbacks/guard gate failed')
  remaining=docker('exec','--env','PGPASSWORD=fixture_only',cid,'psql','-h','127.0.0.1','-X','-At','-U','fixture_only','-d','fixture_only','-c',"SELECT count(*) FROM pg_namespace WHERE nspname LIKE 't_document_history_%'").stdout.strip()
  if remaining!='0':raise ValueError('core history test schemas remain')
  spool=list((run/'mail-outbox').rglob('*'));proof['mailSpoolFiles']=len(spool)
  if spool:raise ValueError('history tests must not emit mail')
  proof['schemasRemaining']=0;proof['sourceAndDependenciesStable']=verify_reused(reg,expected);check_context(context);proof['exit']=0
 except BaseException as exc:
  proof['exit']=1;proof['error']=type(exc).__name__+': '+str(exc)[:1000]
  if isinstance(exc,(Uncertain,subprocess.TimeoutExpired)):proof['requiresManualDockerReconciliation']=True
 finally:
  signal.alarm(0)
  try:proof.update(drain(child,context,ticks))
  except BaseException as exc:proof['exit']=1;proof['nodeCleanupError']=type(exc).__name__+': '+str(exc)[:500]
  if network_intent or container_intent:
   own=cleanup(nonce,expected_cid=cid,expected_nid=nid);proof['dockerCleanup']=own
   if own.get('cleanupErrors'):proof['exit']=1
  try:
   with socket.socket()as sock:proof['localPgPortClosed']=sock.connect_ex(('127.0.0.1',PORT))!=0
   if not proof['localPgPortClosed']:proof['exit']=1
  except BaseException as exc:proof['exit']=1;proof['portDrainError']=str(exc)[:200]
  cg=Path('/sys/fs/cgroup')/context['cgroup'].lstrip('/')/'cgroup.procs'
  try:
   remaining=[int(v)for v in cg.read_text().split()if int(v)!=os.getpid()];proof['remainingLocalCgroupProcesses']=remaining
   if remaining:proof['exit']=1
  except BaseException as exc:proof['exit']=1;proof['cgroupDrainError']=str(exc)[:200]
  write(run/'result.json',proof)
  try:
   target=ROOT/'exports'/nonce;target.parent.mkdir(mode=0o700,exist_ok=True);export(run,target,job,nonce);verify_export(target);proof['exportPath']=str(target)
  except BaseException as exc:proof['exit']=1;proof['exportError']=type(exc).__name__+': '+str(exc)[:300]
  # Authoritative outer receipt is written AFTER export; collector also needs unit exit/drain.
  write(run/'outer-result.json',proof);write(ROOT/'LAST-RUN.json',{'run':str(run),'nonce':nonce,'classification':proof['classification'],'outerResult':str(run/'outer-result.json')})
 return proof['exit']
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--execute-reviewed-manifest-sha256',required=True);args=parser.parse_args()
 if not re.fullmatch('[a-f0-9]{64}',args.execute_reviewed_manifest_sha256):raise SystemExit('exact reviewed manifest SHA required')
 def cancelled(signum,frame):raise InterruptedError('cancelled; no automatic rerun')
 signal.signal(signal.SIGTERM,cancelled);signal.signal(signal.SIGINT,cancelled);signal.signal(signal.SIGALRM,cancelled)
 raise SystemExit(main(args.execute_reviewed_manifest_sha256))
