"""Bounded authenticated browser hook; same synthetic owner session, LOCAL only."""
from pathlib import Path
import os,json,stat,hashlib,re,subprocess,signal,time
ROOT=Path('/mnt/dev/.peticao-r0013-create-reconciliation-draft-20261111/profile-v2')
DRIVER=ROOT/'preparation-browser.cjs'
DRIVER_SHA='028bb4c55b35d87528f23144c59f521e6caaa5eb893bd740a4ee06a4a5aa268a'
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
UNIT='peticao-r0013-create-reconciliation-v2-20261111.service'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
EXPECTED_CHECKS=['fresh context has no inherited cookies','empty president portal authenticated','native final button enabled','native final creation303','selected final document ready','final creation button disabled','modern A1 render and separate reference snapshot bound','original generated PDF download matches DB','one generated history version displayed','history PDF download matches DB','history closes and restores focus','exactly one reviewed creation POST','no unexpected browser request','no page JavaScript error','no browser console error']
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

def make_config(run,cookie,group,assets):
 if run.parent!=ROOT/'runs'or not re.fullmatch('[a-f0-9]{12}',run.name)or run.resolve()!=run:raise BrowserHookError('exact LOCAL R13 run required')
 if not group.startswith('/user.slice/')or not group.endswith('/'+UNIT):raise BrowserHookError('exact LOCAL R13 unit required')
 if not re.fullmatch(r'adm=[A-Za-z0-9_.~-]{16,4096}',cookie):raise BrowserHookError('synthetic cookie format')
 return {'run':str(run),'sourceCommit':SOURCE,'origin':'http://127.0.0.1:31393','cgroup':group,'cookie':cookie,'syntheticSession':True,'stepupSeeded':True,'assetPaths':assets}
def browser_environment(run):return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'TMPDIR':str(run/'tmp'),'LANG':'C.UTF-8','PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK':'1'}
def validate_result(run,result,generated):
 if result.get('exit')!=0 or result.get('sourceCommit')!=SOURCE or result.get('syntheticSession')is not True or result.get('browserLoginUiTested')is not False or result.get('realCertificateUsed')is not False or result.get('signingOrApprovalAttempted')is not False or result.get('referenceExternalNavigation')is not False or result.get('deployment')is not False or result.get('browserTmpRemoved')is not True:raise BrowserHookError('browser scope/exit/cleanup')
 if [(v.get('name'),v.get('passed'))for v in result.get('checks',[])]!=[(name,True)for name in EXPECTED_CHECKS]:raise BrowserHookError('exact15 browser checks required')
 if any(result.get(k)!=[]for k in ['blocked','pageErrors','consoleErrors']):raise BrowserHookError('unexpected browser request/error')
 if [v['path']for v in result['requests']if v['method']=='POST']!=['/api/admin/lotes/criar']:raise BrowserHookError('one native creation POST required')
 for name in ['browser-generated.pdf','browser-history.pdf']:
  p=run/'downloads'/name
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size!=generated['pdfBytes']or sha(p)!=generated['pdfSha256']or p.read_bytes()!=(run/'downloads/database.pdf').read_bytes():raise BrowserHookError('protected generated PDF bytes mismatch')
 p=run/'preparation-browser.png'
 if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size>16*1024**2 or not p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise BrowserHookError('sanitized portal PNG required')
 return {'browserTmpRemoved':True,'passedBrowserChecks':15,'browserGeneratedPdfBodiesMatched':True,'portalScreenshotSha256':sha(p)}
def run_browser_hook(run,cookie,group,node,config,cancellation,fixture,seed,assets):
 from local_controller import verify_local_context
 from preparation_http import verify_prepared
 verify_local_context(config)
 if DRIVER.resolve()!=DRIVER or sha(DRIVER)!=DRIVER_SHA or sha(node)!=NODE_SHA:raise BrowserHookError('driver or Node pin drift')
 write_private(run/'browser-config.json',make_config(run,cookie,group,assets));signals_before=cancellation.signals;baseline=group_snapshot(group);child=None;ticks=None;generated=None;error=None;proof={'classification':'LOCAL_R13_NATIVE_MODERN_PDF_CREATION_BROWSER','sourceCommit':SOURCE,'syntheticA1RenderPolicyOnly':True,'realSignatureUsed':False,'referenceExternalNavigation':False,'exit':1}
 try:
  with(run/'browser-stdout.log').open('xb')as out,(run/'browser-stderr.log').open('xb')as err:
   child=subprocess.Popen([str(node),str(DRIVER),str(run/'browser-config.json')],cwd=ROOT,env=browser_environment(run),stdout=out,stderr=err,start_new_session=True);ticks=process_identity(child.pid,group)['startTicks'];deadline=time.monotonic()+150
   while child.poll()is None:
    if time.monotonic()>deadline:raise BrowserHookError('browser150s timeout; never retry native creation')
    verify_local_context(config)
    event=run/'browser-created.json'
    if event.exists()and generated is None:
     if read_private_json(event)!={'nonce':run.name,'sourceCommit':SOURCE,'phase':'native-final-prepared'}:raise BrowserHookError('only fixed created event admitted')
     generated=fixture('inspect');verify_prepared(seed,generated)
     write_private(run/'browser-created-proof.json',{'nonce':run.name,'sourceCommit':SOURCE,**{n:generated[n]for n in ['snapshotVersion','signaturePreparation','preparedSignedNote','pdfSha256','pdfBytes','historyVersionId','documentReference']}})
    time.sleep(.1)
   proof['driverExit']=child.returncode
  if proof['driverExit']!=0 or generated is None:raise BrowserHookError('driver or generated snapshot handshake failed')
  proof.update(validate_result(run,read_private_json(run/'preparation-browser-result.json'),generated));final=fixture('inspect');verify_prepared(seed,final)
  if final!=generated:raise BrowserHookError('reading/downloading changed prepared document state')
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
    proof['exit']=1;proof['cancelSignalsDuringHook']=cancellation.signals-signals_before;tmp=run/'browser-hook-cancelled.tmp';write_private(tmp,proof);os.replace(tmp,run/'browser-hook-result.json')
  finally:cancellation.cleaning=old_cleaning
 if cancellation.signals>signals_before:proof['exit']=1
 if proof['exit']!=0:raise BrowserHookError('modern preparation browser hook failed; see private receipt')from error
 return proof
