"""Bounded authenticated browser hook; same synthetic owner session, LOCAL only."""
from pathlib import Path
import os,json,stat,hashlib,re,subprocess,signal,time
ROOT=Path('/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111')
DRIVER=ROOT/'own-browser.cjs'
DRIVER_SHA='1a9756a4d78f6c8a5d04bec7f0df1f3a7ee9db368be48c1f6d4ceb701dbef87f'
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
UNIT='peticao-r0014-own-document-browser-qa-20261111.service'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
EXPECTED_CHECKS=['fresh context without inherited cookies', 'authenticated own portal ready', 'seeded compatible receipt selected', 'own artifact created by one native POST', 'manual same UUID recovery returns same artifact', 'own download bytes match DB', 'history artifact and download bound to same bytes', 'reload restores original request without new POST', 'reload manual GET preserves artifact and bytes', 'exactly one own-document POST', 'no unexpected requests', 'no JavaScript errors', 'no console errors']
class BrowserHookError(RuntimeError):pass

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read_private_json(path,limit=2*1024**2):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  info=os.fstat(fd)
  if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1 or info.st_uid!=os.getuid()or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>limit:raise BrowserHookError('browser JSON identity/budget')
  return json.loads(os.read(fd,limit+1))
 finally:os.close(fd)
def write_private(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w')as stream:json.dump(value,stream,indent=2);stream.write('\n')
 path.chmod(0o600)
def process_identity(pid,group):
 path=Path('/proc')/str(pid);fields=(path/'stat').read_text().rpartition(') ')[2].split();groups=[v[3:]for v in(path/'cgroup').read_text().splitlines()if v.startswith('0::')]
 if path.stat().st_uid!=os.getuid()or groups!=[group]or fields[0]in {'Z','X','x'}:raise BrowserHookError('browser process UID/cgroup/dead identity')
 return {'pid':pid,'startTicks':fields[19],'pgid':int(fields[2])}
def group_snapshot(group):
 path=Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.procs';result={}
 for raw in path.read_text().split():
  pid=int(raw)
  try:result[pid]=process_identity(pid,group)
  except FileNotFoundError:pass
 return result

def cleanup_browser(child,group,baseline,ticks):
 # App Next and the Python controller are baseline. Never signal them. Browser
 # descendants may have separate process groups; same exclusive unit records
 # ownership for each new PID/startTicks instead of assuming one PGID catches all.
 observed=group_snapshot(group)
 for pid,identity in baseline.items():
  if pid in observed and observed[pid]!=identity:raise BrowserHookError('baseline PID reused; no broad cleanup')
 owned={pid:value for pid,value in observed.items()if pid not in baseline}
 if child.pid in owned and owned[child.pid]['startTicks']!=ticks:raise BrowserHookError('browser driver PID reused; do not signal')
 actions=[]
 for sig in [signal.SIGTERM,signal.SIGKILL]:
  for pid,identity in list(owned.items()):
   try:
    if process_identity(pid,group)!=identity:raise BrowserHookError('browser PID changed before signal')
    os.kill(pid,sig);actions.append({'pid':pid,'signal':int(sig)})
   except(ProcessLookupError,FileNotFoundError):pass
  try:child.wait(timeout=8 if sig==signal.SIGTERM else 5)
  except subprocess.TimeoutExpired:pass
  deadline=time.monotonic()+(2 if sig==signal.SIGTERM else 1)
  while time.monotonic()<deadline:
   current=group_snapshot(group);remaining={pid:v for pid,v in current.items()if pid not in baseline}
   if not remaining:break
   time.sleep(.1)
  current=group_snapshot(group);remaining={pid:v for pid,v in current.items()if pid not in baseline}
  if not remaining:return {'browserProcessesDrained':True,'cleanupActions':actions,'wholeUnitDrained':False}
  if any(pid not in owned or owned[pid]!=value for pid,value in remaining.items()):raise BrowserHookError('new/unidentified browser descendants; outer unit reconciliation required')
  owned=remaining
 raise BrowserHookError('browser descendants remain after bounded cleanup')

def make_config(run,cookie,group,assets,seed):
 if run.parent!=ROOT/'runs' or not re.fullmatch('[a-f0-9]{12}',run.name) or run.resolve()!=run:raise BrowserHookError('exact local R14 run')
 if not group.startswith('/user.slice/') or not group.endswith('/'+UNIT):raise BrowserHookError('exact bounded unit')
 if not re.fullmatch(r'adm=[A-Za-z0-9_.~-]{16,4096}',cookie):raise BrowserHookError('synthetic session cookie format')
 return {'run':str(run),'sourceCommit':SOURCE,'origin':'http://127.0.0.1:31394','cgroup':group,'cookie':cookie,'assetPaths':assets,'receiptId':seed['receiptId'],'documentVersion':seed['documentVersion'],'sourceSha256':seed['originalSha256'],'identityPreconditionSeeded':True,'externalIdentityVerified':False}
def browser_environment(run):return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'TMPDIR':str(run/'tmp'),'LANG':'C.UTF-8','PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK':'1'}
def validate_result(run,value,generated):
 if value.get('exit')!=0 or value.get('sourceCommit')!=SOURCE or value.get('identityPreconditionSeeded')is not True or value.get('externalIdentityVerified')is not False or value.get('A1OperationTested')is not False or value.get('approvalOrSendAttempted')is not False or value.get('browserTmpRemoved')is not True:raise BrowserHookError('own browser result scope exit cleanup')
 if [(v.get('name'),v.get('passed'))for v in value.get('checks',[])]!=[(n,True)for n in EXPECTED_CHECKS]:raise BrowserHookError('exact13 browser checks')
 if any(value.get(n)!=[]for n in ['blocked','pageErrors','consoleErrors']):raise BrowserHookError('unexpected browser requests or errors')
 observations=value.get('getObservations',[])
 if [v.get('phase')for v in observations]!=['receipt_inventory_GET','manual_own_recovery_GET','artifact_inventory_GET','receipt_inventory_GET','manual_own_recovery_GET'] or any(v.get('status')!=200 or v.get('finishedResolved')is not True or v.get('finishedTimedOut')is not False or v.get('finishedError')is not None or v.get('requestFailed')is not None or v.get('passed')is not True for v in observations):raise BrowserHookError('all five GET observations must finish and commit valid UI')
 if [v['path']for v in value['requests']if v['method']=='POST']!=['/api/admin/presidente/documentos-proprios']:raise BrowserHookError('one explicit own POST only')
 a=generated['artifact']
 if value.get('artifactId')!=a['artifactId'] or value.get('requestId')!=a['requestId']:raise BrowserHookError('same exact immutable artifact request')
 for name in ['browser-own.pdf','browser-history-own.pdf']:
  p=run/'downloads'/name
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size!=a['byteLength']or sha(p)!=a['sha256']or p.read_bytes()!=(run/'downloads/own-database.pdf').read_bytes():raise BrowserHookError('own download exact bytes')
 auxiliary=[q for q in value.get('requests',[])if q.get('source')=='observer']
 if [(q.get('method'),q.get('path'))for q in auxiliary]!=[('GET','/api/admin/lotes/1/presidente/historico')]:raise BrowserHookError('exactly one auxiliary history GET, not UI proof')
 p=run/'own-browser.png'
 if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size>16*1024**2 or not p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise BrowserHookError('sanitized PNG')
 return {'browserTmpRemoved':True,'passedBrowserChecks':13,'browserOwnDownloadsMatched':True,'screenshotSha256':sha(p)}
def run_browser_hook(run,cookie,group,node,config,cancellation,fixture,seed,assets):
 from local_controller import verify_local_context
 from own_http import verify_own_state
 verify_local_context(config)
 if DRIVER.resolve()!=DRIVER or sha(DRIVER)!=DRIVER_SHA or sha(node)!=NODE_SHA:raise BrowserHookError('pinned driver or Node changed')
 write_private(run/'browser-config.json',make_config(run,cookie,group,assets,seed));before=fixture('inspect');signals_before=cancellation.signals;baseline=group_snapshot(group);child=None;ticks=None;generated=None;error=None;proof={'classification':'LOCAL_OWN_DOCUMENT_BROWSER','sourceCommit':SOURCE,'consumedIdentityFixtureSeeded':True,'externalIdentityVerified':False,'exit':1}
 try:
  with(run/'browser-stdout.log').open('xb')as out,(run/'browser-stderr.log').open('xb')as err:
   child=subprocess.Popen([str(node),str(DRIVER),str(run/'browser-config.json')],cwd=ROOT,env=browser_environment(run),stdout=out,stderr=err,start_new_session=True);ticks=process_identity(child.pid,group)['startTicks'];deadline=time.monotonic()+150
   while child.poll()is None:
    if time.monotonic()>deadline:raise BrowserHookError('own browser150s timeout; no retry')
    verify_local_context(config);event=run/'own-created.json'
    if event.exists()and generated is None:
     v=read_private_json(event)
     if set(v)!=set(['nonce','sourceCommit','requestId','artifactId'])or v['nonce']!=run.name or v['sourceCommit']!=SOURCE or not re.fullmatch('[a-f0-9-]{36}',v['requestId'])or not re.fullmatch('[a-f0-9-]{36}',v['artifactId']):raise BrowserHookError('fixed own-created event')
     generated=fixture('inspect');verify_own_state(seed,before,generated);proof['generatedState']=generated
     if generated['artifact']['requestId']!=v['requestId']or generated['artifact']['artifactId']!=v['artifactId']:raise BrowserHookError('event exact artifact binding')
     write_private(run/'own-created-proof.json',{'nonce':run.name,'sourceCommit':SOURCE,'artifact':generated['artifact']})
    time.sleep(.1)
   proof['driverExit']=child.returncode
  if child.returncode!=0 or generated is None:raise BrowserHookError('own browser exit or handshake incomplete')
  proof.update(validate_result(run,read_private_json(run/'own-browser-result.json'),generated));final=fixture('inspect');verify_own_state(seed,before,final)
  if final!=generated:raise BrowserHookError('reload recovery/history changed immutable own state')
  proof['generatedState']=generated;proof['exit']=0;verify_local_context(config)
 except BaseException as exc:error=exc;proof['error']=(type(exc).__name__+': '+str(exc)).replace(cookie,'[REDACTED]').replace(cookie[4:],'[REDACTED]')[:700]
 finally:
  old_cleaning=cancellation.cleaning;cancellation.cleaning=True
  try:
   if child is not None:
    try:proof.update(cleanup_browser(child,group,baseline,ticks))
    except BaseException as exc:proof['exit']=1;proof['cleanupError']=type(exc).__name__+': '+str(exc)[:500]
   proof['cancelSignalsDuringHook']=cancellation.signals-signals_before
   if proof['cancelSignalsDuringHook']:proof['exit']=1
   write_private(run/'browser-hook-result.json',proof)
   if cancellation.signals-signals_before!=proof['cancelSignalsDuringHook']:
    proof['exit']=1;proof['cancelSignalsDuringHook']=cancellation.signals-signals_before;temporary=run/'hook-cancelled.tmp';write_private(temporary,proof);os.replace(temporary,run/'browser-hook-result.json')
  finally:cancellation.cleaning=old_cleaning
 if cancellation.signals>signals_before:proof['exit']=1
 if proof['exit']!=0:raise BrowserHookError('own browser hook failed; see private receipt')from error
 return proof
