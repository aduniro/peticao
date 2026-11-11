#!/usr/bin/python3
"""Fixed private draft runner. ONLY existing queue may call this after peer approval."""
from pathlib import Path
import argparse,hashlib,json,os,re,signal,stat,subprocess,time,uuid
from native_pg import NativePG,Cancelled,cgroup_of,PG_BIN
from worker_context import WorkerContext
from staging import digest,pinned,read_manifest,extract
from receipts import tap_check,guard_check,export
class CancellationState:
 def __init__(self):self.cleaning=False;self.signals=0
 def handle(self,signum,frame):
  self.signals+=1
  if not self.cleaning:raise Cancelled('cancelled; no automatic retry')
CANCELLATION=CancellationState()
ROOT=Path('/srv/admin-v2-worker/admin-r0003-route-gates-20261111')
PRODUCTION=Path('/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs/runtime.tar')
def write(p,obj):
 with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n')
 p.chmod(0o600)
def private(p):
 if p.resolve()!=p or not p.is_dir()or p.stat().st_uid!=os.getuid()or stat.S_IMODE(p.stat().st_mode)!=0o700:raise ValueError('own canonical0700 directory required')
def child_identity(pid,cgroup):
 p=Path('/proc')/str(pid);f=(p/'stat').read_text().rsplit(')',1)[1].split()
 if p.stat().st_uid!=os.getuid()or f[0]=='Z'or cgroup_of(pid)!=cgroup:raise ValueError('child pid/cgroup/uid changed')
 return f[19]
def drain_node(child,cgroup,ticks):
 if child.poll()is None:
  if child_identity(child.pid,cgroup)!=ticks:raise ValueError('reused child PID')
  child.terminate()
  try:child.wait(timeout=8)
  except subprocess.TimeoutExpired:
   if child_identity(child.pid,cgroup)!=ticks:raise ValueError('reused child PID before kill')
   child.kill();child.wait(timeout=5)
 # The executor must additionally confirm this job's whole cgroup is empty.
 remaining=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   f=(p/'stat').read_text().rsplit(')',1)[1].split()
   if f[0]!='Z'and int(f[2])==child.pid:
    if p.stat().st_uid!=os.getuid()or cgroup_of(int(p.name))!=cgroup:raise ValueError('foreign process in child group')
    remaining.append({'pid':int(p.name),'startTicks':f[19]})
  except(FileNotFoundError,ProcessLookupError):pass
 if remaining:raise ValueError('Node descendants remain; executor drain required')
 return remaining

def verify_inputs(reg):
 private(ROOT);pinned(Path(reg['node_path']),reg['node_sha256'],128*1024**2)
 code=json.loads((ROOT/'harness-manifest.json').read_text())
 for name,pin in code['files'].items():
  if '/'in name or name.startswith('.')or name not in {'run.py','native_pg.py','worker_context.py','staging.py','receipts.py','guard_policy.cjs','node_guard.cjs','dns_guard.cjs','registry.json','pg-binary-pins.json'}:raise ValueError('unreviewed harness file')
  pinned(ROOT/name,pin,2*1024**2)
 for name,pin in json.loads((ROOT/'pg-binary-pins.json').read_text()).items():
  if name not in ['postgres','initdb','pg_ctl','psql','pg_isready']:raise ValueError('unknown PG binary')
  p=PG_BIN/name
  if p.lstat().st_uid!=0 or stat.S_IMODE(p.lstat().st_mode)!=0o755:raise ValueError('PG ownership/mode')
  pinned(p,pin,128*1024**2)
 return code

def stage(run,reg):
 inputs=ROOT/'artifacts';source=read_manifest(inputs/'source/source-manifest.json',reg['source_manifest_sha256']);dev=read_manifest(inputs/'devdeps-manifest.json',reg['devdeps_manifest_sha256']);prod=read_manifest(inputs/'production-manifest.json',reg['production_manifest_sha256'])
 if source['commit']!=reg['source_commit']or prod['source_commit']!=reg['backend_source_commit']:raise ValueError('source/backend identity')
 source_hashes=extract(inputs/'source/source.tar',reg['source_archive_sha256'],source['files'],run/'source');site=run/'source/site'
 prod_hashes=extract(PRODUCTION,reg['production_archive_sha256'],prod['files'],site,prefix='runtime/',extra={'release-manifest.json':reg['production_manifest_sha256']},existing=True)
 dev_hashes=extract(inputs/'devdeps.tar',reg['devdeps_archive_sha256'],dev['files'],site,existing=True)
 expected={n:p['sha256']for n,p in source['files'].items()};expected.update({'site/'+n:p['sha256']for n,p in prod['files'].items()if n.startswith('node_modules/')});expected.update({'site/'+n:p['sha256']for n,p in dev['files'].items()})
 return site,expected,{'sourceFiles':len(source_hashes),'productionFilesVerified':len(prod_hashes),'devFiles':len(dev_hashes),'npmExecuted':False,'backendCommit':reg['backend_source_commit'],'sourceCommit':reg['source_commit']}
def environment(run,site,guard):
 return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'LANG':'C.UTF-8','NODE_ENV':'test','DATABASE_URL':'postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only','HASH_PEPPER':'QA-ONLY-NOT-PRODUCTION-PEPPER-93557bfba931','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'qa@example.test','ADMIN_PASSWORD':'QA-ONLY-NEVER-A-REAL-PASSWORD','ADMIN_PASSWORD_FILE':str(run/'empty/nonexistent-admin-password'),'CONTACT_TO':'qa@example.test','CONTACT_BCC':'','RECIPIENTS':'','APPROVER_EMAIL':'','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SECRETS_DIR':str(run/'empty'),'PETICAO_CONFIG_DIR':str(run/'empty'),'CREDENTIALS_DIRECTORY':str(run/'empty'),'GEO_DIR':str(run/'empty'),'APP_URL':'http://qa.local','SIGNER':'none','TMPDIR':str(run/'tmp'),'TSX_DISABLE_CACHE':'1','TSX_TSCONFIG_PATH':str(site/'tsconfig.json'),'QA_GUARD_CONFIG':str(guard),'NODE_OPTIONS':'--require='+str(ROOT/'node_guard.cjs')}
def make_guard(run,site,reg,job,nonce,cgroup):
 loader=site/'node_modules/tsx/dist/loader.mjs';bins=[site/'node_modules/esbuild/bin/esbuild',site/'node_modules/@esbuild/linux-x64/bin/esbuild'];node=Path(reg['node_path']);test=site/reg['test_file']
 value={'schema':1,'job':job,'nonce':nonce,'cgroup':cgroup,'sourceCommit':reg['source_commit'],'dbPort':reg['db_port'],'tsxVersion':reg['tsx_version'],'esbuildVersion':reg['esbuild_version'],'tmpdir':str(run/'tmp'),'site':str(site),'log':str(run/'guard.jsonl'),'node':str(node),'loader':str(loader),'testFile':str(test),'pattern':reg['test_pattern'],'esbuildBinaries':[str(p)for p in bins],'pins':{str(p):digest(p,128*1024**2)for p in [node,loader,*bins]}}
 write(run/'guard-config.json',value);return value

def verify_staged(source,expected):
 actual={}
 for p in source.rglob('*'):
  if p.is_symlink()or not(p.is_dir()or p.is_file()):raise ValueError('staged link/special changed')
  if p.is_file():actual[str(p.relative_to(source))]=digest(p,256*1024**2)
 if actual!=expected:raise ValueError('source/dependency inventory changed')
 return True

def cleanup_owned(child,cgroup,ticks,pg):
 proof={};errors=[]
 if child is not None and ticks is not None:
  try:proof['remainingNodeProcesses']=drain_node(child,cgroup,ticks);proof['nodeGroupDrained']=True
  except BaseException as exc:errors.append('node: '+type(exc).__name__+': '+str(exc)[:600]);proof['nodeGroupDrained']=False
 try:proof['postgresCleanup']=pg.stop()
 except BaseException as exc:errors.append('postgres: '+type(exc).__name__+': '+str(exc)[:600])
 if proof.get('postgresCleanup',{}).get('stopped')and pg.prepared:
  try:proof['socketCleanup']=pg.release_socket()
  except BaseException as exc:errors.append('socket: '+type(exc).__name__+': '+str(exc)[:600])
 if errors:proof['cleanupErrors']=errors
 return proof

def main(job):
 os.umask(0o077);reg=json.loads((ROOT/'registry.json').read_text());ctx=WorkerContext(job,reg);attest=ctx.verify();verify_inputs(reg)
 base=ctx.folder/'work/govbr-route-gates';base.mkdir(mode=0o700);base.chmod(0o700);nonce=uuid.uuid4().hex[:12];run=base/nonce;run.mkdir(mode=0o700)
 for name in ['empty','tmp']:(run/name).mkdir(mode=0o700)
 write(run/'context.json',attest);pg=NativePG(run,nonce,ctx.cgroup);child=None;ticks=None;ok=False
 proof={'job':job,'nonce':nonce,'run':str(run),'sourceCommit':reg['source_commit'],'backendCommit':reg['backend_source_commit'],'operationalReady':False,'deployment':False,'testsExecuted':False,'exit':1,'nodeGroupDrained':False,'cgroupDrainMustBeVerifiedByExecutor':True}
 try:
  site,expected,staging=stage(run,reg);write(run/'staging.json',staging);ctx.verify()
  pg.prepare();pg.initialize();pg.start();handshake=pg.bootstrap();write(run/'pg-handshake.json',handshake);ctx.verify()
  guard=make_guard(run,site,reg,job,nonce,ctx.cgroup);env=environment(run,site,run/'guard-config.json')
  args=[reg['node_path'],'--import',guard['loader'],'--test','--test-concurrency=1','--test-name-pattern='+reg['test_pattern'],'--test-reporter=tap',guard['testFile']]
  with(run/'tap.log').open('xb')as out,(run/'stderr.log').open('xb')as err:
   child=subprocess.Popen(args,cwd=site,env=env,stdout=out,stderr=err,start_new_session=True);ticks=child_identity(child.pid,ctx.cgroup);proof['nodePid']=child.pid;proof['testsExecuted']=True;
   deadline=time.monotonic()+480
   while child.poll()is None:
    if time.monotonic()>deadline:raise TimeoutError('fixed test deadline')
    if any((run/n).stat().st_size>8*1024**2 for n in ['tap.log','stderr.log']):raise ValueError('log budget exceeded')
    ctx.verify();time.sleep(0.5)
   proof['testExit']=child.returncode
  ctx.verify();proof['remainingNodeProcesses']=drain_node(child,ctx.cgroup,ticks);proof['nodeGroupDrained']=True
  proof['passedTests']=tap_check((run/'tap.log').read_text(),reg['expected_cases']);events=[json.loads(s)for s in(run/'guard.jsonl').read_text().splitlines()];summary=guard_check(events,job,nonce,allow_unexpected=True);write(run/'guard-summary.json',summary);proof.update(summary)
  if summary['unexpectedDenials']!=0:raise ValueError('unexpected guard denials')
  if child.pid not in summary['guardPids'] or len(summary['testChildPids'])!=1 or summary['testChildPids'][0]==child.pid:raise ValueError('parent test runner guard not installed')
  if proof['testExit']!=0:raise ValueError('test process failed')
  names=','.join("'t_base_http_gate_"+x+"'"for x in reg['expected_cases']);remaining=pg.psql('fixture_only','SELECT count(*) FROM pg_namespace WHERE nspname IN ('+names+')')
  if remaining.strip()!='0':raise ValueError('test schemas not cleaned')
  proof['schemasRemaining']=0;pg.verify_database('fixture_only');proof['sourceAndDependenciesStable']=verify_staged(run/'source',expected);ctx.verify();ok=True
 except BaseException as exc:proof['error']=type(exc).__name__+': '+str(exc)[:1200]
 finally:
  CANCELLATION.cleaning=True # Unit TERM/retransmission cannot abort owned cleanup or receipt export.
  cleanup=cleanup_owned(child,ctx.cgroup,ticks,pg);proof.update(cleanup)
  if cleanup.get('cleanupErrors'):ok=False

  if (run/'guard.jsonl').exists()and not(run/'guard-summary.json').exists():
   try:
    events=[json.loads(v)for v in(run/'guard.jsonl').read_text().splitlines()];summary=guard_check(events,job,nonce,allow_unexpected=True);write(run/'guard-summary.json',summary);proof.update(summary)
   except BaseException as exc:proof['guardReceiptError']=str(exc)[:300]
  proof['cancelSignals']=CANCELLATION.signals
  write(run/'pg-lifecycle.json',pg.report());proof['exit']=0 if CANCELLATION.signals==0 and ok and proof.get('postgresCleanup',{}).get('stopped')and proof.get('socketCleanup',{}).get('removed')and proof['nodeGroupDrained']else 1;write(run/'result.json',proof)
  target=ctx.folder/'work/artifacts/govbr-route-gates';
  if not target.parent.exists():
   target.parent.mkdir(mode=0o770);os.chown(target.parent,-1,(ctx.folder/'work').stat().st_gid);target.parent.chmod(0o2770)
  export(run,target,job,nonce)
 return 1 if CANCELLATION.signals else proof['exit']
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('job');a=parser.parse_args()
 signal.signal(signal.SIGTERM,CANCELLATION.handle);signal.signal(signal.SIGINT,CANCELLATION.handle);raise SystemExit(main(a.job))
