"""Bounded authenticated browser hook; same synthetic owner session, LOCAL only."""
from pathlib import Path
import os,json,stat,hashlib,re,subprocess,signal,time
ROOT=Path('/mnt/dev/.peticao-r0010-local-package-browser-qa-20261111')
DRIVER=ROOT/'package-browser.cjs'
DRIVER_SHA='66459b2f62acdeba20941de44eed66e296c8b6068d2e93ddddda74f327c52198'
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
UNIT='peticao-r0010-local-package-browser-qa-20261111.service'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
EXPECTED_CHECKS=['fresh browser has no inherited cookies','batch1 selected authenticated portal','batch1 code requested through exact form','batch1 code cleared after redirect','happy portal shows accepted batch','batch1 receipt accepted on final screen','batch2 selected authenticated portal','batch2 code requested through exact form','batch2 code cleared after redirect','fault portal displays reconciliation warning','fault portal shows accepted transport','portal reconciliation confirms no repeated send','reconciled portal shows accepted batch','batch2 receipt accepted on final screen','exactly five reviewed POSTs occurred','no unexpected browser request','no page JavaScript error','no browser console error']
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

def make_config(run,cookie,packages,group,assets):
 if run.parent!=ROOT/'runs'or not re.fullmatch('[a-f0-9]{12}',run.name)or run.resolve()!=run:raise BrowserHookError('exact LOCAL R10 run required')
 if not group.startswith('/user.slice/')or not group.endswith('/'+UNIT):raise BrowserHookError('exact LOCAL R10 unit required')
 if not re.fullmatch(r'adm=[A-Za-z0-9_.~-]{16,4096}',cookie):raise BrowserHookError('synthetic owner cookie format')
 return {'run':str(run),'sourceCommit':SOURCE,'origin':'http://127.0.0.1:31390','cgroup':group,'cookie':cookie,'syntheticSession':True,'stepupSeeded':True,'packages':packages,'assetPaths':assets}
def browser_environment(run):return {'PATH':'/usr/bin:/bin','HOME':str(run/'empty'),'TMPDIR':str(run/'tmp'),'LANG':'C.UTF-8','PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK':'1'}
def validate_result(run,result):
 if result.get('exit')!=0 or result.get('sourceCommit')!=SOURCE or result.get('syntheticSession')is not True or result.get('stepupSeeded')is not True or result.get('browserLoginUiTested')is not False or result.get('otpApprovalUiTested')is not True or result.get('realCertificateUsed')is not False or result.get('deployment')is not False or result.get('browserTmpRemoved')is not True:raise BrowserHookError('browser result exit identity scope cleanup')
 if [(v.get('name'),v.get('passed'))for v in result.get('checks',[])]!=[(name,True)for name in EXPECTED_CHECKS]:raise BrowserHookError('exact18 browser checks required')
 for name in ['blocked','pageErrors','consoleErrors']:
  if result.get(name)!=[]:raise BrowserHookError('unexpected browser request or error')
 expected=[f'/api/admin/lotes/{n}/{kind}'for n,kind in [(1,'codigo'),(1,'aprovar'),(2,'codigo'),(2,'aprovar'),(2,'conciliar')]]
 if [v['path']for v in result['requests']if v['method']=='POST']!=expected:raise BrowserHookError('exact reviewed POST sequence')
 shots=[]
 for n in [1,2]:
  p=run/f'package-browser-{n}.png'
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size>16*1024**2 or not p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise BrowserHookError('sanitized final PNG required')
  shots.append(sha(p))
 return {'browserTmpRemoved':True,'passedBrowserChecks':18,'sanitizedScreenshotsSha256':shots}
def run_browser_hook(run,cookie,packages,group,node,config,cancellation,fixture,assets):
 from local_controller import verify_local_context
 from package_http import verify_sent_batch,spool_state
 verify_local_context(config)
 if DRIVER.resolve()!=DRIVER or sha(DRIVER)!=DRIVER_SHA or sha(node)!=NODE_SHA:raise BrowserHookError('pinned driver/Node changed')
 cfg=make_config(run,cookie,packages,group,assets);filename=run/'browser-config.json';write_private(filename,cfg)
 signals_before=cancellation.signals;proof={'classification':'LOCAL_R10_PACKAGE_BROWSER','sourceCommit':SOURCE,'driverSha256':DRIVER_SHA,'syntheticSessionReused':True,'newLoginCreated':False,'deployment':False,'exit':1};child=None;ticks=None;baseline=group_snapshot(group);error=None;fault_cleared=False;reconcile_spool=None;reconcile_counts=None
 try:
  with(run/'browser-stdout.log').open('xb')as out,(run/'browser-stderr.log').open('xb')as err:
   child=subprocess.Popen([str(node),str(DRIVER),str(filename)],cwd=ROOT,env=browser_environment(run),stdout=out,stderr=err,start_new_session=True);ticks=process_identity(child.pid,group)['startTicks'];proof['driverPid']=child.pid;deadline=time.monotonic()+150
   while child.poll()is None:
    if time.monotonic()>deadline:raise BrowserHookError('browser150s timeout; no automatic retry')
    verify_local_context(config)
    ready=run/'browser-fault-ready.json'
    if ready.exists()and not fault_cleared:
     event=read_private_json(ready)
     if event!={'nonce':run.name,'sourceCommit':SOURCE,'phase':'accepted-fault-ui-rendered'}:raise BrowserHookError('fixed browser fixture event required')
     observed=fixture('snapshot');verify_sent_batch(observed,1)
     if len([m for m in observed['messages']if m['kind']=='lote'and m['status']=='accepted'])!=2 or any(v['batch_id']==2 for v in observed['sends']):raise BrowserHookError('fault acceptance without recipient not proven')
     reconcile_spool=spool_state(run);reconcile_counts={k:observed['counts'][k]for k in ['mail_messages','mail_message_attempts','mail_outbox']}
     result=fixture('fault-off')
     if result!={'faultRemoved':True}:raise BrowserHookError('fixed fixture fault removal failed')
     fault_cleared=True;write_private(run/'browser-fault-cleared.json',{'nonce':run.name,'sourceCommit':SOURCE,'faultRemoved':True,'acceptedJournalWithoutRecipient':True})
    time.sleep(.1)
   proof['driverExit']=child.returncode
  if proof['driverExit']!=0 or not fault_cleared:raise BrowserHookError('driver exit or fixed fault handshake incomplete')
  after=fixture('snapshot')
  if reconcile_spool!=spool_state(run)or reconcile_counts!={k:after['counts'][k]for k in ['mail_messages','mail_message_attempts','mail_outbox']}:raise BrowserHookError('reconciliation changed transport spool or journal counts')
  proof['noRetransportDuringReconciliation']=True
  result=read_private_json(run/'package-browser-result.json');proof.update(validate_result(run,result));verify_local_context(config);proof['exit']=0
 except BaseException as exc:error=exc;proof['error']=(type(exc).__name__+': '+str(exc)).replace(cookie,'[REDACTED]').replace(cookie[4:],'[REDACTED]')[:700]
 finally:
  previous_cleaning=cancellation.cleaning;cancellation.cleaning=True
  try:
   if child is not None:
    try:proof.update(cleanup_browser(child,group,baseline,ticks))
    except BaseException as exc:proof['exit']=1;proof['cleanupError']=type(exc).__name__+': '+str(exc)[:500]
   proof['cancelSignalsDuringHook']=cancellation.signals-signals_before
   if proof['cancelSignalsDuringHook']:proof['exit']=1
   write_private(run/'browser-hook-result.json',proof)
   if cancellation.signals-signals_before!=proof['cancelSignalsDuringHook']:
    proof['exit']=1;proof['cancelSignalsDuringHook']=cancellation.signals-signals_before;temporary=run/'browser-hook-cancelled.tmp';write_private(temporary,proof);os.replace(temporary,run/'browser-hook-result.json')
  finally:cancellation.cleaning=previous_cleaning
 if cancellation.signals>signals_before:proof['exit']=1
 if proof['exit']!=0:raise BrowserHookError('package browser hook failed; see private technical receipt')from error
 return proof
