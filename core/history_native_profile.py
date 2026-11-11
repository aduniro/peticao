#!/usr/bin/python3
"""Fixed native-PG17 R4 profile in the SAME bounded queue. No RPC commands/environment or local leases."""
from __future__ import annotations
import contextlib,hashlib,json,os,re,shutil,signal,stat,subprocess,time
from pathlib import Path
import runtime_profile as baseline
KIND='history-populated-native-pg17-r4'
SOURCE='0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f'
STAGE=Path('/srv/admin-v2-worker/admin-r0000-history-r4-qa-20261110')
WORKER=Path('/srv/admin-v2-worker')
COORDINATOR=Path('/srv/admin-v2-coordinator')
RUNTIME=Path('/srv/admin-v2-worker/admin-r0000-runtime-qa-20261110/runs/cad43f085e374bc5876e4cf246ca8572-http/runtime')
RELEASE_MANIFEST=Path('/srv/admin-v2-worker/admin-r0000-runtime-qa-20261110/inputs/release-manifest.json')
PG_BIN=Path('/usr/lib/postgresql/17/bin')
NODE=Path('/usr/bin/node')
NODE_SHA=baseline.NODE_SHA
MANIFEST_SHA=baseline.MANIFEST_SHA
HARNESS_SHA='3882061c021ce3a41a069eb5a13a466aac65dab427930a2b6bbd306b961bf3fa'
HARNESS_PINS={'functional_smoke.py': '8f78b152c863aac959affe0a40dbd1796bb9fc7a6c2299c53808206a90feb954', 'native_pg.py': 'f46afdacb85f70b339620f9b025154937e75ead095b1a592f7f0a210f7bcbc34', 'fixture.cjs': 'a34574271520fbefcd1e508601aae6d950873db25f2aad6c0f0226151d32a31e', 'functional-guard.mjs': 'c36d4cdfbf7c892f3696b1a5e2521955651a7057eb6cd33783d36724a00ee62f', 'executor_context.py': 'ff391a3fab460528a7624ab34133e36f8bee551b548833bc3f45989d40e432e1', 'schema-source-manifest.json': '0e837a472ac1274bd433335fa88e98110edd5082de88645d09d8828950810a51', 'pg-binary-pins.json': '4053a50714cbb68c9b3dfe0b3a015ffe46f73561b175799fc0547b73cbf7e49d', 'schema-sources/batch-a1-schema.ts': '1251d5a401ed201859c13fcb65ce5d88ed3ad9890e5f098a041cc7e5bcd4413b', 'schema-sources/batch-package-schema.ts': '7baba1f2fbe3dbcb957d4414ac06ecb25b21ac1f1a713fb7d8c2782b5554eab4', 'schema-sources/db.ts': 'dfb66f502a11a282b37bc0c2cf06d15995e3cfe1da42223e999d9e12e97b5824', 'schema-sources/document-reference-schema.ts': 'b851cfa7990ce006829d4c2aca8e8ffabf913ed198238dafdc61ad844702cc7c', 'schema-sources/petition-base-schema.ts': 'd21a4289e522ca3a9570d8de5a4d80a69b6468a4e5a9744c2a4de3bc3e3c72ab', 'schema-sources/president-own-a1-schema.ts': '24b467607679f30e5cb6d986724c311971c55a136ca9b30b7e73d0f2e28c8408', 'schema-sources/president-own-document-schema.ts': '86516913713b00734a88b74075adad9adf1ebfc0c1b808e9b9b22c30323a63a3'}
SOFT_SECONDS=600
CLEANUP_SECONDS=120
TOTAL_SECONDS=720
EXPECTED_CHECKS=[('unauthenticated history',401),('wrong password',303),('synthetic owner login',303),('step-up enforced',403),('populated document history',200),('history ordinal filter',200),('download version 1',200),('download version 2',200),('cross batch version not found',404),('nonexistent version',404),('malformed version rejected',400),('download without session',401),('reader login',303),('reader history forbidden',403),('reader download forbidden',403),('base documents',200),('president receipts',200),('president artifacts',200),('batch page',200)]
RECEIPTS=['result.json','pid.json','guard.jsonl','source-manifest.json','postgres.log','server.log','pg-owner.json','pdf-fixtures/manifest.json','pdf-fixtures/version-1.pdf','pdf-fixtures/version-2.pdf','downloads/version-1.pdf','downloads/version-2.pdf']
def fixed_payload():return {'kind':KIND,'source_commit':SOURCE,'harness_manifest_sha256':HARNESS_SHA,'runtime_manifest_sha256':MANIFEST_SHA,'node_sha256':NODE_SHA}
def payload(data):
 if set(data)!={'action','id','kind','source_commit'}or data.get('kind')!=KIND or data.get('source_commit')!=SOURCE:raise ValueError('history_fixed_contract_only')
 baseline.job_id(data.get('id'));return fixed_payload()
def argv(job):return ['/usr/bin/python3','/opt/admin-v2-cluster/history_native_profile.py','run',baseline.job_id(job)]
def read_json(path,limit=1024*1024):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>limit:raise ValueError('history_json_invalid')
  with os.fdopen(fd,'rb',closefd=False)as stream:data=stream.read(limit+1)
  if len(data)>limit:raise ValueError('history_json_too_large')
  return json.loads(data)
 finally:os.close(fd)
def cgroup(pid):
 rows=[s[3:]for s in (Path('/proc')/str(pid)/'cgroup').read_text().splitlines()if s.startswith('0::')]
 if len(rows)!=1:raise ValueError('unified_cgroup_required')
 return rows[0]
def verify_job(job):
 folder=WORKER/'jobs'/baseline.job_id(job);config=read_json(folder/'config.json');authority=read_json(COORDINATOR/'authority.json')
 boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();expected='/system.slice/admin-v2-job-'+job+'.service'
 if config.get('id')!=job or config.get('payload')!=fixed_payload() or config.get('digest')!=hashlib.sha256(json.dumps(config['payload'],sort_keys=True,separators=(',',':')).encode()).hexdigest():raise ValueError('history_job_config_changed')
 if authority.get('role')!='primary'or authority.get('armed_boot_id')!=boot or authority.get('generation')!=config.get('generation'):raise ValueError('history_authority_changed')
 if cgroup(os.getpid())!=expected:raise ValueError('history_wrong_cgroup')
 marker=folder/'execution.started';fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_uid!=os.getuid():raise ValueError('history_execution_marker_invalid')
 finally:os.close(fd)
 state=read_json(folder/'state.json')
 if state.get('boot_id')!=boot or state.get('generation')!=config['generation']or cgroup(state['pid'])!=expected:raise ValueError('history_parent_state_changed')
 return {'jobId':job,'configDigest':config['digest'],'generation':config['generation'],'bootId':boot,'cgroup':expected,'parentPid':state['pid']}
def verify_inputs():
 if STAGE.resolve()!=STAGE or not STAGE.is_dir()or STAGE.stat().st_uid!=os.getuid()or stat.S_IMODE(STAGE.stat().st_mode)!=0o700:raise ValueError('history_stage_not_private')
 for path in STAGE.rglob('*'):
  if path.is_symlink()or not(path.is_file()or path.is_dir())or(path.is_dir()and str(path.relative_to(STAGE))!='schema-sources'):raise ValueError('history_unreviewed_stage_entry')
 actual={str(p.relative_to(STAGE))for p in STAGE.rglob('*')if not p.is_dir()}
 if actual!=set(HARNESS_PINS)|{'profile-manifest.json'}:raise ValueError('history_unreviewed_stage_files')
 if baseline.digest(STAGE/'profile-manifest.json',2*1024*1024)!=HARNESS_SHA:raise ValueError('history_manifest_pin')
 for name,expected in HARNESS_PINS.items():
  p=STAGE/name
  if p.resolve()!=p or baseline.digest(p,2*1024*1024)!=expected:raise ValueError('history_harness_pin:'+name)
 if baseline.digest(NODE)!=NODE_SHA or baseline.digest(RELEASE_MANIFEST,8*1024*1024)!=MANIFEST_SHA:raise ValueError('history_runtime_tool_pin')
 manifest=read_json(RELEASE_MANIFEST,8*1024*1024)
 if manifest.get('source_commit')!=SOURCE or len(manifest.get('files',{}))!=12043:raise ValueError('history_runtime_manifest_contract')
 if RUNTIME.resolve()!=RUNTIME or not RUNTIME.is_dir():raise ValueError('history_runtime_path')
 for name,expected in read_json(STAGE/'pg-binary-pins.json').items():
  if name not in ['postgres','initdb','pg_ctl','psql','pg_isready']:raise ValueError('history_pg_tool_name')
  p=PG_BIN/name;st=p.lstat()
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o755 or baseline.digest(p)!=expected:raise ValueError('history_pg_binary_pin:'+name)
 # The pinned R4 runner verifies every runtime/schema byte before native PG prepare/start.
 return {'harnessSha256':HARNESS_SHA,'runtimeManifestSha256':MANIFEST_SHA,'sourceCommit':SOURCE}
def prepare(job,context):
 root=WORKER/'jobs'/job/'work/history-native-r4';root.mkdir(mode=0o700);root.chmod(0o700) # ONLY freshly-created own job directory; clear inherited SGID.
 for name in HARNESS_PINS:
  dst=root/name;dst.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(STAGE/name,dst);dst.chmod(0o600)
  if baseline.digest(dst,2*1024*1024)!=HARNESS_PINS[name]:raise ValueError('history_copy_pin')
 config={'node_path':str(NODE),'node_sha256':NODE_SHA,'expected_cgroup':context['cgroup'],'executor_job_id':job,'executor_config_digest':context['configDigest'],'schema_source_dir':str(root/'schema-sources'),'runtime_dir':str(RUNTIME),'release_manifest':str(RELEASE_MANIFEST)}
 path=root/'config.json';path.write_text(json.dumps(config));path.chmod(0o600);return root,path
def checked_run(root):
 latest=read_json(root/'latest-run.json');run=Path(latest.get('run',''))
 if run.parent!=root/'runs'or run.resolve()!=run or not re.fullmatch('[a-f0-9]{12}',run.name):raise ValueError('history_run_identity')
 return run

def validate_result(proof,run,context):
 if proof.get('exit')!=0 or proof.get('sourceCommit')!=SOURCE or proof.get('nonce')!=run.name or proof.get('run')!=str(run):raise ValueError('history_result_identity_or_failure')
 if [(v.get('check'),v.get('status'))for v in proof.get('checks',[])]!=EXPECTED_CHECKS:raise ValueError('history_exact19_checks_required')
 if proof.get('guardInstalled')is not True or proof.get('guardDenials')!=0 or proof.get('runtimeStable')is not True or proof.get('originRuntimeStable')is not True or proof.get('remainingAppProcesses')!=[]:raise ValueError('history_guard_or_runtime_or_node_cleanup')
 if proof.get('postgresCleanup',{}).get('stopped')is not True or proof.get('socketCleanup',{}).get('removed')is not True:raise ValueError('history_pg_cleanup_required')
 handshake=proof.get('postgresHandshake',{})
 if not str(handshake.get('version','')).startswith('PostgreSQL 17.11 ')or handshake.get('database')!='fixture_only'or handshake.get('nonce')!=run.name or handshake.get('data_directory')!=str(run/'postgres')or handshake.get('port')!=55485:raise ValueError('history_pg_handshake_identity')
 limits=proof.get('limits',{})
 if limits.get('cgroup')!=context['cgroup']or not 0<limits.get('cpuCores',0)<=2 or not 0<limits.get('memoryMaxBytes',0)<=3*1024**3 or not 0<limits.get('pidsMax',0)<=256:raise ValueError('history_limits_changed')
 lifecycle=proof.get('postgresLifecycle',{})
 if lifecycle.get('nonce')!=run.name or lifecycle.get('dataDirectory')!=str(run/'postgres')or not {'prepared','initialized','started','verified-postgres','verified-fixture_only','stopped','socket-released'}<=set(lifecycle.get('events',[])):raise ValueError('history_pg_lifecycle_incomplete')
 if proof.get('documentMutatingRequests')!=0 or proof.get('deployment')is not False or proof.get('operationalReady')is not False:raise ValueError('history_scope_changed')
 if read_json(run/'source-manifest.json')!=read_json(STAGE/'schema-source-manifest.json'):raise ValueError('history_schema_proof_changed')
 expected_pg=read_json(STAGE/'pg-binary-pins.json');observed_pg=lifecycle.get('binaryPins',{})
 if set(observed_pg)!=set(expected_pg)or any(observed_pg[n].get('sha256')!=v for n,v in expected_pg.items()):raise ValueError('history_pg_pins_proof_changed')
 if any(proof.get('executorContext',{}).get(k)!=context[k]for k in ['jobId','configDigest','generation','bootId','cgroup']):raise ValueError('history_result_context_changed')

def cgroup_remaining(context):
 path=Path('/sys/fs/cgroup')/context['cgroup'].lstrip('/')/'cgroup.procs';allowed={os.getpid(),context['parentPid']};remaining=[]
 for item in path.read_text().split():
  pid=int(item)
  if pid in allowed:continue
  try:
   state=(Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[0]
   if state!='Z':remaining.append(pid)
  except FileNotFoundError:pass
 return remaining

def export(run,target,strict=False):
 if strict:
  required=['result.json','pid.json','guard.jsonl','source-manifest.json','pdf-fixtures/manifest.json','pdf-fixtures/version-1.pdf','pdf-fixtures/version-2.pdf','downloads/version-1.pdf','downloads/version-2.pdf']
  if any(not(run/name).is_file()for name in required):raise ValueError('history_required_receipts_missing')
  fixtures=read_json(run/'pdf-fixtures/manifest.json')
  if not isinstance(fixtures,list)or len(fixtures)!=2 or {x.get('filename')for x in fixtures}!={'version-1.pdf','version-2.pdf'}:raise ValueError('history_pdf_fixture_manifest')
  for entry in fixtures:
   if not re.fullmatch('[a-f0-9]{64}',entry.get('sha256',''))or not isinstance(entry.get('bytes'),int)or not 0<entry['bytes']<=1024*1024:raise ValueError('history_pdf_fixture_entry')
   for prefix in ['pdf-fixtures','downloads']:
    path=run/prefix/entry['filename']
    if path.stat().st_size!=entry['bytes']or baseline.digest(path)!=entry['sha256']:raise ValueError('history_pdf_fixture_hash')
 total=0
 for relative in RECEIPTS:
  p=run/relative
  if not p.exists()and not p.is_symlink():continue
  if p.resolve()!=p:raise ValueError('history_receipt_link')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   st=os.fstat(fd)
   if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>16*1024*1024:raise ValueError('history_receipt_invalid')
   total+=st.st_size
   if total>32*1024*1024:raise ValueError('history_receipt_budget')
   dst=target/relative;dst.parent.mkdir(mode=0o770,parents=True,exist_ok=True)
   with os.fdopen(fd,'rb',closefd=False)as src,dst.open('xb')as out:shutil.copyfileobj(src,out)
   dst.chmod(0o660)
  finally:os.close(fd)

def child_identity(child,context):
 path=Path('/proc')/str(child.pid);fields=(path/'stat').read_text().rsplit(')',1)[1].split()
 if path.stat().st_uid!=os.getuid()or cgroup(child.pid)!=context['cgroup']:raise ValueError('history_child_identity_changed')
 return fields[19]
def signal_child(child,context,start_ticks,sig):
 if child.poll()is not None:return
 try:
  if child_identity(child,context)!=start_ticks:raise ValueError('history_child_pid_reused_do_not_signal')
 except FileNotFoundError:return
 os.killpg(child.pid,sig)

def run(job):
 baseline.job_id(job);folder=WORKER/'jobs'/job
 marker=folder/'history-native-profile.started';fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o660);os.close(fd)
 result={'kind':KIND,'source_commit':SOURCE,'originalHarnessCommit':'ca53ba684fc4021760069e6f79a1ca75475d3e6b','harnessSha256':HARNESS_SHA,'exit':1,'operationalReady':False,'signals':0};child=None;child_start=None;root=None;context=None;cleaning=False
 target=folder/'work/artifacts';target.mkdir(mode=0o770)
 def interrupted(signum,frame):
  result['signals']+=1
  if not cleaning:raise KeyboardInterrupt('history profile cancellation')
 old={sig:signal.signal(sig,interrupted)for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]};signal.alarm(SOFT_SECONDS)
 try:
  context=verify_job(job);result['executorContext']=context;result.update(verify_inputs());root,config=prepare(job,context)
  env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','HISTORY_SMOKE_CONFIG':str(config)}
  child=subprocess.Popen(['/usr/bin/python3',str(root/'functional_smoke.py')],cwd=root,env=env,stdin=subprocess.DEVNULL,start_new_session=True)
  child_start=child_identity(child,context)
  result['harnessExit']=child.wait()
  runpath=checked_run(root);proof=read_json(runpath/'result.json');validate_result(proof,runpath,context)
  if result['harnessExit']!=0:raise ValueError('history_harness_exit_nonzero')
  remaining=cgroup_remaining(context);result['remainingCgroupProcesses']=remaining
  if remaining:raise ValueError('history_cgroup_not_drained')
  result['exit']=0
 except BaseException as exc:result['error']=type(exc).__name__+':'+str(exc)[:500]
 finally:
  cleaning=True;signal.alarm(0)
  try:
   if child and child.poll()is None:
    signal_child(child,context,child_start,signal.SIGTERM)
    try:child.wait(timeout=110)
    except subprocess.TimeoutExpired:
     signal_child(child,context,child_start,signal.SIGKILL);child.wait(timeout=5)
  except BaseException as exc:result['exit']=1;result['cleanupError']=type(exc).__name__+':'+str(exc)[:300]
  try:
   if root:export(checked_run(root),target,strict=result['exit']==0)
  except Exception as exc:result['exit']=1;result['exportError']=type(exc).__name__+':'+str(exc)[:300]
  (target/'history-profile-result.json').write_text(json.dumps(result,indent=2)+'\n');(target/'history-profile-result.json').chmod(0o660)
  for sig,handler in old.items():signal.signal(sig,handler)
 return result['exit']
if __name__=='__main__':
 import sys
 if len(sys.argv)!=3 or sys.argv[1]!='run':raise SystemExit(2)
 raise SystemExit(run(sys.argv[2]))
