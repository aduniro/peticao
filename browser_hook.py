"""Bounded authenticated browser hook; same synthetic owner session, LOCAL only."""
from pathlib import Path
import os,json,stat,hashlib,re,subprocess,signal,time
ROOT=Path('/mnt/apps/peticao-final/_ops/qa-r0015-a1-admission-browser-20261111')
DRIVER=ROOT/'a1-browser.cjs'
DRIVER_SHA='13262828812956f7d1f2b1cb28c91934e7b5738e97c88ec2df7286e287a37b19'
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
UNIT='peticao-r0015-a1-admission-browser-qa-20261111.service'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
EXPECTED_CHECKS=['fresh context without inherited cookies', 'authenticated original portal ready', 'availability bound to actual original and policy', 'native explicit admission button enabled', 'one native A1 admission HTTP202', 'queued status rendered without success claim', 'DB confirms exact one inert queued job', 'new admission disabled while queued', 'sessionStorage holds exact original intent', 'exact request GET recovers same queued job', 'reload preserves same saved intent', 'reload reconciles queued through GET only', 'same UUID job after reload', 'observer reads separated from native UI reads', 'exactly one A1 POST no replay', 'no unexpected requests', 'no JavaScript errors', 'no console errors']
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
 if run.parent!=ROOT/'runs'or not re.fullmatch('[a-f0-9]{12}',run.name)or run.resolve()!=run:raise BrowserHookError('exact local R15 run')
 if not group.startswith('/user.slice/')or not group.endswith('/'+UNIT):raise BrowserHookError('exact bounded unit')
 if not re.fullmatch(r'adm=[A-Za-z0-9_.~-]{16,4096}',cookie):raise BrowserHookError('synthetic cookie required')
 return {'run':str(run),'sourceCommit':SOURCE,'origin':'http://127.0.0.1:31395','cgroup':group,'cookie':cookie,'assetPaths':assets,'documentVersion':seed['documentVersion'],'sourceSha256':seed['pdfSha256'],'historyVersionId':seed['historyVersionId'],'pdfBytes':seed['pdfBytes'],'policyRevision':1,'cryptographicOperationTested':False}
def browser_environment(run):return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'TMPDIR':str(run/'tmp'),'LANG':'C.UTF-8','PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK':'1'}
def validate_result(run,value,generated):
 if value.get('exit')!=0 or value.get('sourceCommit')!=SOURCE or value.get('cryptographicOperationTested')is not False or value.get('workerExecuted')is not False or value.get('approvalOrSendAttempted')is not False or value.get('browserTmpRemoved')is not True:raise BrowserHookError('admission-only browser scope')
 if [(v.get('name'),v.get('passed'))for v in value.get('checks',[])]!=[(n,True)for n in EXPECTED_CHECKS]:raise BrowserHookError('exact18 browser checks')
 if any(value.get(n)!=[]for n in ['blocked','pageErrors','consoleErrors']):raise BrowserHookError('unexpected browser request/error')
 if [v['path']for v in value['requests']if v['method']=='POST']!=['/api/admin/lotes/1/a1']:raise BrowserHookError('one explicit A1 admission POST')
 if value.get('observerGetCount')!=3 or value.get('appExactRequestGetCount',0)<2:raise BrowserHookError('UI and observer GET sources separate')
 if value.get('jobId')!=generated['job']['jobId']or value.get('requestId')!=generated['job']['requestId']:raise BrowserHookError('same exact queued request')
 p=run/'a1-browser.png'
 if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size>16*1024**2 or not p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise BrowserHookError('sanitized PNG')
 return {'browserTmpRemoved':True,'passedBrowserChecks':18,'screenshotSha256':sha(p)}
def run_browser_hook(run,cookie,group,node,config,cancellation,fixture,seed,assets):
 from local_controller import verify_local_context
 from a1_http import verify_admitted
 verify_local_context(config)
 if DRIVER.resolve()!=DRIVER or sha(DRIVER)!=DRIVER_SHA or sha(node)!=NODE_SHA:raise BrowserHookError('pinned driver or Node changed')
 write_private(run/'browser-config.json',make_config(run,cookie,group,assets,seed));before=fixture('inspect');signals_before=cancellation.signals;baseline=group_snapshot(group);child=None;ticks=None;generated=None;error=None;proof={'classification':'LOCAL_A1_ADMISSION_BROWSER','sourceCommit':SOURCE,'cryptographicOperationTested':False,'workerExecuted':False,'exit':1}
 try:
  with(run/'browser-stdout.log').open('xb')as out,(run/'browser-stderr.log').open('xb')as err:
   child=subprocess.Popen([str(node),str(DRIVER),str(run/'browser-config.json')],cwd=ROOT,env=browser_environment(run),stdout=out,stderr=err,start_new_session=True);ticks=process_identity(child.pid,group)['startTicks'];deadline=time.monotonic()+150
   while child.poll()is None:
    if time.monotonic()>deadline:raise BrowserHookError('A1 browser150s timeout; no retry')
    verify_local_context(config);event=run/'admitted.json'
    if event.exists()and generated is None:
     v=read_private_json(event)
     if set(v)!=set(['nonce','sourceCommit','requestId'])or v['nonce']!=run.name or v['sourceCommit']!=SOURCE or not re.fullmatch('[a-f0-9-]{36}',v['requestId']):raise BrowserHookError('fixed own-created event')
     generated=fixture('inspect');verify_admitted(before,generated,v['requestId'])
     if generated['job']['requestId']!=v['requestId']:raise BrowserHookError('event exact queued job binding')
     write_private(run/'admitted-proof.json',{'nonce':run.name,'sourceCommit':SOURCE,'job':generated['job']})
    time.sleep(.1)
   proof['driverExit']=child.returncode
  if child.returncode!=0 or generated is None:raise BrowserHookError('A1 browser exit or handshake incomplete')
  proof.update(validate_result(run,read_private_json(run/'a1-browser-result.json'),generated));final=fixture('inspect');verify_admitted(before,final)
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
 if proof['exit']!=0:raise BrowserHookError('A1 browser hook failed; see private receipt')from error
 return proof
