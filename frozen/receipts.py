"""Exact TAP and guard gates, and technical-artifact allowlist."""
from pathlib import Path
import json,re,os,stat,shutil,hashlib
ALLOWLIST=('result.json','tap.log','stderr.log','guard.jsonl','guard-summary.json','context.json','staging.json','pg-lifecycle.json','pg-handshake.json')
def tap_check(text,cases):
 expected=['real validation route '+v+' refusal creates no intent and recovers only by admitted exact GET'for v in cases]
 passed=[]
 for line in text.splitlines():
  m=re.fullmatch(r'ok \d+ - (.*)',line)
  if m and ' # SKIP'not in m[1]and ' # TODO'not in m[1]:passed.append(m[1])
 if passed!=expected or re.search(r'^not ok ',text,re.M)or not re.search(r'^# fail 0$',text,re.M)or not re.search(r'^# cancelled 0$',text,re.M):raise ValueError('exact five TAP callbacks required')
 return passed

def guard_check(events,job,nonce,*,allow_unexpected=False):
 if not events or any(e.get('job')!=job or e.get('nonce')!=nonce for e in events):raise ValueError('guard receipt identity')
 installed={e['pid']for e in events if e.get('kind')=='guard-installed'}
 if not installed:raise ValueError('guardInstalled required')
 denials=[e for e in events if e.get('kind')=='denial'];expected=[e for e in denials if e.get('category')=='expected-optional-cli-ipc-denial'and e.get('transport')=='ipc'];unexpected=[e for e in denials if e not in expected]
 out={'guardInstalled':True,'guardPids':sorted(installed),'testChildPids':sorted({e['pid']for e in events if e.get('kind')=='guard-installed'and e.get('nodeTestContext')=='child-v8'}),'reportedDenialsTotal':len(denials),'expectedOptionalCliIpcDenials':len(expected),'unexpectedDenials':len(unexpected)}
 if unexpected and not allow_unexpected:raise ValueError('unexpected guard denials: '+str(len(unexpected)))
 return out

def verify_export(folder):
 manifest=json.loads((folder/'export-manifest.json').read_text());expected=set(manifest['files'])|{'export-manifest.json'}
 if {p.name for p in folder.iterdir()}!=expected or manifest.get('publication')!='COMPLETE_TECHNICAL_EXPORT':raise ValueError('incomplete export inventory')
 for name,pin in manifest['files'].items():
  if name not in ALLOWLIST:raise ValueError('unexpected export name')
  p=folder/name
  if p.is_symlink()or not p.is_file()or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise ValueError('export bytes changed')
 return manifest

def export(run,target,job,nonce):
 if run.resolve()!=run or run.name!=nonce or target.exists():raise ValueError('export identity/destination')
 proof=json.loads((run/'result.json').read_text())
 if proof.get('job')!=job or proof.get('nonce')!=nonce:raise ValueError('result identity')
 # Staging is private under the run, OUTSIDE the collector's work/artifacts tree.
 stage=run/'export-staging';stage.mkdir(mode=0o700);stage.chmod(0o700);budget=0;files={};gid=target.parent.stat().st_gid
 for name in ALLOWLIST:
  p=run/name
  if not p.exists():continue
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   st=os.fstat(fd)
   if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>8*1024**2:raise ValueError('receipt metadata')
   budget+=st.st_size
   if budget>24*1024**2:raise ValueError('receipt budget')
   with os.fdopen(fd,'rb',closefd=False)as src,(stage/name).open('xb')as dest:
    shutil.copyfileobj(src,dest);dest.flush();os.fsync(dest.fileno())
  finally:os.close(fd)
  files[name]=hashlib.sha256((stage/name).read_bytes()).hexdigest()
 manifest=stage/'export-manifest.json';manifest.write_text(json.dumps({'job':job,'nonce':nonce,'publication':'COMPLETE_TECHNICAL_EXPORT','requiresOuterJobExitZeroAndDrainedCgroup':True,'files':files,'excluded':['postgres','pgpass','initdb-password','source','node_modules','local lease','credentials']},indent=2)+'\n')
 verify_export(stage)
 for p in stage.iterdir():os.chown(p,-1,gid);p.chmod(0o660)
 os.chown(stage,-1,gid);stage.chmod(0o2770)
 if target.exists():raise ValueError('export destination appeared')
 os.rename(stage,target) # Same job/work filesystem; publish only complete checked receipts.
 return files
