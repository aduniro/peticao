"""Bounded authenticated browser hook; same synthetic owner session, LOCAL only."""
from pathlib import Path
import os,json,stat,hashlib,re,subprocess,signal,time
ROOT=Path('/mnt/dev/.peticao-r0006-local-history-browser-qa-20261111')
DRIVER=ROOT/'history-browser.cjs'
DRIVER_SHA='e0a0019d9af52528d574cdcd80d3a5473d75e74fc46ad44afaaf1ed3c0567ffa'
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
UNIT='peticao-r0006-local-history-browser-qa-20261111.service'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
EXPECTED_CHECKS=['fresh context has no inherited cookies','authenticated selected batch renders','history starts closed','no history PDF fetched automatically','history metadata HTTP 200','two historical PDF versions render','newest version is first','opening metadata does not fetch history PDFs',*[s.format(n=n)for n in [2,1]for s in ['version {n} displays exact PDF hash','version {n} has exact protected URL','version {n} downloaded bytes match fixture']],'only the two explicit PDF downloads occurred in order','escape closes history','focus returns to history trigger','no page JavaScript exception','no browser console error','no external application requests','no application mutation attempted']
class BrowserHookError(RuntimeError):pass

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read_private_json(path,limit=2*1024**2):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  info=os.fstat(fd)
  if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1 or info.st_uid!=os.getuid()or info.st_size>limit:raise BrowserHookError('browser JSON identity/budget')
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

def make_config(run,cookie,fixtures,group):
 if run.parent!=ROOT/'runs'or not re.fullmatch('[a-f0-9]{12}',run.name)or run.resolve()!=run:raise BrowserHookError('exact LOCAL R6 run required')
 if not group.startswith('/user.slice/')or not group.endswith('/'+UNIT):raise BrowserHookError('exact LOCAL R6 unit required')
 if not re.fullmatch(r'adm=[A-Za-z0-9_.~-]{16,4096}',cookie):raise BrowserHookError('synthetic owner cookie format')
 return {'run':str(run),'sourceCommit':SOURCE,'origin':'http://127.0.0.1:31385','cgroup':group,'cookie':cookie,'syntheticSession':True,'stepupSeeded':True,'batchId':1,'fixtures':fixtures}
def browser_environment(run):
 return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'TMPDIR':str(run/'tmp'),'LANG':'C.UTF-8','PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK':'1'}
def validate_result(run,result,fixtures):
 if result.get('browserTmpRemoved')is not True:raise BrowserHookError('short private Chromium temp must be removed after close')
 if result.get('exit')!=0 or result.get('sourceCommit')!=SOURCE or result.get('syntheticSession')is not True or result.get('stepupSeeded')is not True or result.get('browserLoginUiTested')is not False or result.get('otpFlowTested')is not False or result.get('realCertificateUsed')is not False or result.get('deployment')is not False:raise BrowserHookError('browser result identity/scope/exit')
 if [(v.get('name'),v.get('passed'))for v in result.get('checks',[])]!=[(name,True)for name in EXPECTED_CHECKS]:raise BrowserHookError('exact21 browser checks required')
 for key in ['pageErrors','consoleErrors','externalRequestsBlocked','mutationsBlocked']:
  if result.get(key)!=[]:raise BrowserHookError('browser unexpected error/request category '+key)
 downloads=[v for v in result.get('requests',[])if re.match(r'^/api/admin/lotes/1/versoes/',v.get('path',''))]
 expected=[{'method':'GET','path':'/api/admin/lotes/1/versoes/'+item['id']}for item in reversed(fixtures)]
 if downloads!=expected:raise BrowserHookError('exact explicit browser downloads order required')
 proofs=[]
 for item in fixtures:
  path=run/'downloads'/('browser-version-'+str(item['ordinal'])+'.pdf')
  if path.resolve()!=path or not path.is_file()or path.is_symlink()or path.stat().st_nlink!=1 or path.stat().st_size!=item['bytes']or sha(path)!=item['sha256']or path.read_bytes()!=(run/'pdf-fixtures'/item['filename']).read_bytes():raise BrowserHookError('browser PDF bytes/hash mismatch')
  proofs.append({'ordinal':item['ordinal'],'sha256':item['sha256'],'bytes':item['bytes']})
 shot=run/'history-desktop.png'
 if shot.resolve()!=shot or not shot.is_file()or shot.is_symlink()or shot.stat().st_size>16*1024**2 or not shot.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise BrowserHookError('technical browser PNG required')
 return {'browserTmpRemoved':True,'passedBrowserChecks':len(EXPECTED_CHECKS),'browserPdfBodiesMatched':True,'browserDownloads':proofs,'screenshotSha256':sha(shot)}

def run_browser_hook(run,cookie,fixtures,group,node,config,cancellation):
 from local_controller import verify_local_context
 verify_local_context(config)
 if DRIVER.resolve()!=DRIVER or sha(DRIVER)!=DRIVER_SHA or sha(node)!=NODE_SHA:raise BrowserHookError('pinned driver/Node changed')
 cfg=make_config(run,cookie,fixtures,group);filename=run/'browser-config.json';write_private(filename,cfg)
 signals_before=cancellation.signals
 proof={'cancelSignalsDuringHook':0,'classification':'LOCAL_R6_BROWSER_HOOK','driverSha256':DRIVER_SHA,'sourceCommit':SOURCE,'syntheticSessionReused':True,'newLoginCreated':False,'otpFlowTested':False,'deployment':False,'exit':1};child=None;ticks=None;baseline=group_snapshot(group);error=None
 try:
  with(run/'browser-stdout.log').open('xb')as out,(run/'browser-stderr.log').open('xb')as err:
   child=subprocess.Popen([str(node),str(DRIVER),str(filename)],cwd=ROOT,env=browser_environment(run),stdout=out,stderr=err,start_new_session=True)
   ticks=process_identity(child.pid,group)['startTicks'];proof['driverPid']=child.pid
   try:proof['driverExit']=child.wait(timeout=90)
   except subprocess.TimeoutExpired:raise BrowserHookError('browser90s timeout; no automatic retry')
  if proof['driverExit']!=0:raise BrowserHookError('browser driver nonzero')
  result=read_private_json(run/'history-browser-result.json');proof.update(validate_result(run,result,fixtures));verify_local_context(config);proof['exit']=0
 except BaseException as exc:error=exc;proof['error']=(type(exc).__name__+': '+str(exc)).replace(cookie,'[redacted]').replace(cookie[4:],'[redacted]')[:700]
 finally:
  previous_cleaning=cancellation.cleaning;cancellation.cleaning=True
  try:
   if child is not None:
    try:proof.update(cleanup_browser(child,group,baseline,ticks))
    except BaseException as exc:proof['exit']=1;proof['cleanupError']=type(exc).__name__+': '+str(exc)[:500]
   proof['cancelSignalsDuringHook']=cancellation.signals-signals_before
   if proof['cancelSignalsDuringHook']:proof['exit']=1
   write_private(run/'browser-hook-result.json',proof)
   # A deferred signal during receipt writing must not survive as exit0.
   if cancellation.signals-signals_before!=proof['cancelSignalsDuringHook']:
    proof['exit']=1;proof['cancelSignalsDuringHook']=cancellation.signals-signals_before
    temporary=run/'browser-hook-result-cancelled.tmp';write_private(temporary,proof);os.replace(temporary,run/'browser-hook-result.json')
  finally:cancellation.cleaning=previous_cleaning
 if cancellation.signals>signals_before:
  proof['exit']=1;proof['cancelSignalsDuringHook']=cancellation.signals-signals_before
  previous_cleaning=cancellation.cleaning;cancellation.cleaning=True
  try:
   temporary=run/'browser-hook-result-final-cancelled.tmp';write_private(temporary,proof);os.replace(temporary,run/'browser-hook-result.json')
  finally:cancellation.cleaning=previous_cleaning
 if proof['exit']!=0:raise BrowserHookError('authenticated history browser hook failed; see private technical receipt')from error
 return proof
