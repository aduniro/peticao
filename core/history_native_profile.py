#!/usr/bin/python3
"""Fixed native-PG17 R0002 history profile in the SAME bounded queue. No RPC commands/environment or local leases."""
from __future__ import annotations
import contextlib,hashlib,json,os,re,shutil,signal,stat,subprocess,time,importlib.util
from pathlib import Path
import runtime_profile as baseline
KIND='history-native-pg17-r0002-v1'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
STAGE=Path('/srv/admin-v2-worker/admin-r0002-history-native-qa-20261111')
WORKER=Path('/srv/admin-v2-worker')
COORDINATOR=Path('/srv/admin-v2-coordinator')
PROC_ROOT=Path('/proc')
RUNTIME_INPUTS=Path('/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs')
RUNTIME_ARCHIVE=RUNTIME_INPUTS/'runtime.tar'
RELEASE_MANIFEST=RUNTIME_INPUTS/'release-manifest.json'
ARCHIVE_SHA='2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0'
PG_BIN=Path('/usr/lib/postgresql/17/bin')
NODE=Path('/usr/bin/node')
NODE_SHA=baseline.NODE_SHA
MANIFEST_SHA='7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3'
HARNESS_SHA='0c4c2f2ff7b51e19e6084b1112def1a10b2de1c650c1f46074f396f55a1687e6'
HARNESS_PINS={'functional_smoke.py': '84e8640f8ce5915588d3d15bb67d494bd8478889be0f085d185fe47df29cb7a9', 'native_pg.py': 'f46afdacb85f70b339620f9b025154937e75ead095b1a592f7f0a210f7bcbc34', 'fixture.cjs': 'a34574271520fbefcd1e508601aae6d950873db25f2aad6c0f0226151d32a31e', 'functional-guard.mjs': 'c36d4cdfbf7c892f3696b1a5e2521955651a7057eb6cd33783d36724a00ee62f', 'executor_context.py': 'dc0eb17cc1c98ca4f17d2c480322f30d33985295f092c2861ace08ec10ad84a9', 'runtime_extract.py': '97efcbd8a26720baef84795f0344756018b4e28e596f841e70017533137497a2', 'schema-source-manifest.json': 'c46b36c4d4a9b31d5b89b8bb2a4c7373370bdf3c6d9281e3ef63ca4b55185a3a', 'pg-binary-pins.json': '4053a50714cbb68c9b3dfe0b3a015ffe46f73561b175799fc0547b73cbf7e49d', 'schema-sources/batch-a1-schema.ts': '1251d5a401ed201859c13fcb65ce5d88ed3ad9890e5f098a041cc7e5bcd4413b', 'schema-sources/batch-package-schema.ts': '7baba1f2fbe3dbcb957d4414ac06ecb25b21ac1f1a713fb7d8c2782b5554eab4', 'schema-sources/db.ts': 'dfb66f502a11a282b37bc0c2cf06d15995e3cfe1da42223e999d9e12e97b5824', 'schema-sources/document-reference-schema.ts': 'b851cfa7990ce006829d4c2aca8e8ffabf913ed198238dafdc61ad844702cc7c', 'schema-sources/petition-base-schema.ts': '25ea67cd71f653e68a8cc67177f77d39f18b4e56e14d6a8d42e256ddae51764c', 'schema-sources/president-own-a1-schema.ts': '24b467607679f30e5cb6d986724c311971c55a136ca9b30b7e73d0f2e28c8408', 'schema-sources/president-own-document-schema.ts': '86516913713b00734a88b74075adad9adf1ebfc0c1b808e9b9b22c30323a63a3'}
SOFT_SECONDS=600
CLEANUP_SECONDS=120
TOTAL_SECONDS=720
EXPECTED_CHECKS=[('unauthenticated history',401),('wrong password',303),('synthetic owner login',303),('step-up enforced',403),('populated document history',200),('history ordinal filter',200),('download version 1',200),('download version 2',200),('cross batch version not found',404),('nonexistent version',404),('malformed version rejected',400),('download without session',401),('reader login',303),('reader history forbidden',403),('reader download forbidden',403),('base documents',200),('president receipts',200),('president artifacts',200),('batch page',200)]
RECEIPTS=['result.json','pid.json','guard.jsonl','source-manifest.json','postgres.log','server.log','pg-owner.json','pdf-fixtures/manifest.json','pdf-fixtures/version-1.pdf','pdf-fixtures/version-2.pdf','downloads/version-1.pdf','downloads/version-2.pdf']
def fixed_payload():return {'kind':KIND,'source_commit':SOURCE,'harness_manifest_sha256':HARNESS_SHA,'runtime_manifest_sha256':MANIFEST_SHA,'runtime_archive_sha256':ARCHIVE_SHA,'node_sha256':NODE_SHA}
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
  return json.loads(data,object_pairs_hook=strict_pairs,parse_constant=reject_constant)
 finally:os.close(fd)
def cgroup(pid):
 rows=[s[3:]for s in (PROC_ROOT/str(pid)/'cgroup').read_text().splitlines()if s.startswith('0::')]
 if len(rows)!=1:raise ValueError('unified_cgroup_required')
 return rows[0]
def positive_generation(value):return type(value)is int and value>0
def parent_identity(state,job,generation,boot,expected_cgroup):
 if type(state)is not dict or state.get('id')!=job or state.get('state')!='running' or state.get('exit_code')is not None or state.get('finished_at')is not None:raise ValueError('queue_parent_state_not_running_for_job')
 if not positive_generation(state.get('generation'))or state['generation']!=generation or state.get('boot_id')!=boot:raise ValueError('queue_parent_generation_or_boot_changed')
 pid=state.get('pid');ticks=state.get('start_ticks')
 if type(pid)is not int or pid<=0 or type(ticks)is not str or not re.fullmatch('[1-9][0-9]*',ticks):raise ValueError('queue_parent_identity_types')
 path=PROC_ROOT/str(pid)
 if path.stat().st_uid!=os.getuid():raise ValueError('queue_parent_uid_changed')
 def fields():
  data=(path/'stat').read_text();prefix,sep,tail=data.rpartition(') ')
  if not sep or not prefix.startswith(str(pid)+' ('):raise ValueError('queue_parent_proc_stat_invalid')
  values=tail.split()
  if len(values)<20 or values[0]in {'Z','X','x'}or values[19]!=ticks:raise ValueError('queue_parent_start_ticks_changed_or_dead')
  return values
 fields()
 if current_cgroup(pid)!=expected_cgroup:raise ValueError('queue_parent_cgroup_changed')
 fields() # Reject reuse between the cgroup and stat observations too.
 return pid,ticks

def strict_pairs(pairs):
 result={}
 for key,value in pairs:
  if key in result:raise ValueError('duplicate_json_key')
  result[key]=value
 return result
def reject_constant(value):raise ValueError('non_finite_json')
def current_cgroup(pid):return cgroup(pid)
def verify_job(job):
 folder=WORKER/'jobs'/baseline.job_id(job);config=read_json(folder/'config.json');authority=read_json(COORDINATOR/'authority.json');state=read_json(folder/'state.json')
 if type(config)is not dict or type(authority)is not dict:raise ValueError('history_context_json_object_required')
 boot=(PROC_ROOT/'sys/kernel/random/boot_id').read_text().strip();expected='/system.slice/admin-v2-job-'+job+'.service'
 if config.get('id')!=job or config.get('payload')!=fixed_payload() or config.get('digest')!=hashlib.sha256(json.dumps(config['payload'],sort_keys=True,separators=(',',':')).encode()).hexdigest():raise ValueError('history_job_config_changed')
 if not positive_generation(config.get('generation'))or not positive_generation(authority.get('generation'))or authority.get('role')!='primary'or authority.get('armed_boot_id')!=boot or authority['generation']!=config['generation']:raise ValueError('history_authority_generation_boot_changed')
 if cgroup(os.getpid())!=expected:raise ValueError('history_wrong_cgroup')
 marker=folder/'execution.started';fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_uid!=os.getuid():raise ValueError('history_execution_marker_invalid')
 finally:os.close(fd)
 parent,ticks=parent_identity(state,job,config['generation'],boot,expected)
 return {'jobId':job,'configDigest':config['digest'],'generation':config['generation'],'bootId':boot,'cgroup':expected,'parentPid':parent,'parentStartTicks':ticks}
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
 for directory in [RUNTIME_INPUTS.parent,RUNTIME_INPUTS]:
  if directory.resolve()!=directory or not directory.is_dir()or directory.stat().st_uid!=os.getuid()or stat.S_IMODE(directory.stat().st_mode)!=0o700:raise ValueError('history_runtime_inputs_not_private')
 if {x.name for x in RUNTIME_INPUTS.iterdir()}!={'runtime.tar','release-manifest.json'}:raise ValueError('history_runtime_inputs_incomplete_or_extra')
 if baseline.digest(NODE)!=NODE_SHA or baseline.digest(RELEASE_MANIFEST,8*1024*1024)!=MANIFEST_SHA:raise ValueError('history_runtime_tool_pin')
 manifest=read_json(RELEASE_MANIFEST,8*1024*1024)
 if manifest.get('source_commit')!=SOURCE or manifest.get('release_id')!='r0002-portable-f55595c-20261111' or len(manifest.get('files',{}))!=12043:raise ValueError('history_runtime_manifest_contract')
 if RUNTIME_ARCHIVE.stat().st_size!=475576320 or baseline.digest(RUNTIME_ARCHIVE,512*1024*1024)!=ARCHIVE_SHA:raise ValueError('history_runtime_archive_pin')
 for name,expected in read_json(STAGE/'pg-binary-pins.json').items():
  if name not in ['postgres','initdb','pg_ctl','psql','pg_isready']:raise ValueError('history_pg_tool_name')
  p=PG_BIN/name;st=p.lstat()
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o755 or baseline.digest(p)!=expected:raise ValueError('history_pg_binary_pin:'+name)
 # Pinned extraction validates the full archive; the runner checks full extracted inventory/schema before PG.
 return {'harnessSha256':HARNESS_SHA,'runtimeManifestSha256':MANIFEST_SHA,'runtimeArchiveSha256':ARCHIVE_SHA,'runtimeArchiveBytes':475576320,'sourceCommit':SOURCE}
def prepare(job,context):
 root=WORKER/'jobs'/job/'work/history-native-r0002';root.mkdir(mode=0o700);root.chmod(0o700) # ONLY freshly-created own job directory; clear inherited SGID.
 for name in HARNESS_PINS:
  dst=root/name;dst.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(STAGE/name,dst);dst.chmod(0o600)
  if baseline.digest(dst,2*1024*1024)!=HARNESS_PINS[name]:raise ValueError('history_copy_pin')
 spec=importlib.util.spec_from_file_location('r0002_runtime_extract',root/'runtime_extract.py');extractor=importlib.util.module_from_spec(spec);spec.loader.exec_module(extractor)
 extracted=extractor.extract_verified(RUNTIME_ARCHIVE,RELEASE_MANIFEST,root/'runtime-source')
 if extracted.get('verifiedFiles')!=12043:raise ValueError('history_extraction_inventory')
 config={'node_path':str(NODE),'node_sha256':NODE_SHA,'expected_cgroup':context['cgroup'],'executor_job_id':job,'executor_config_digest':context['configDigest'],'executor_generation':context['generation'],'executor_boot_id':context['bootId'],'executor_parent_pid':context['parentPid'],'executor_parent_start_ticks':context['parentStartTicks'],'schema_source_dir':str(root/'schema-sources'),'runtime_dir':str(root/'runtime-source/runtime'),'release_manifest':str(root/'runtime-source/release-manifest.json')}
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
 if any(proof.get('executorContext',{}).get(k)!=context[k]for k in ['jobId','configDigest','generation','bootId','cgroup','parentPid','parentStartTicks']):raise ValueError('history_result_context_changed')

def cgroup_remaining(context):
 path=Path('/sys/fs/cgroup')/context['cgroup'].lstrip('/')/'cgroup.procs';allowed={os.getpid(),context['parentPid']};remaining=[]
 for item in path.read_text().split():
  pid=int(item)
  if pid in allowed:continue
  try:
   state=(PROC_ROOT/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[0]
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

def export_extraction(root,target,required):
 path=root/'runtime-source/extraction-proof.json'
 if not path.exists():
  if required:raise ValueError('history_extraction_receipt_missing')
  return
 proof=read_json(path)
 if proof.get('archiveSha256')!=ARCHIVE_SHA or proof.get('manifestSha256')!=MANIFEST_SHA or proof.get('verifiedFiles')!=12043 or proof.get('runtimeStarted')is not False:raise ValueError('history_extraction_receipt_changed')
 dest=target/'runtime-extraction-proof.json';dest.write_text(json.dumps(proof,indent=2)+'\n');dest.chmod(0o660)

def child_identity(child,context):
 path=PROC_ROOT/str(child.pid);fields=(path/'stat').read_text().rsplit(')',1)[1].split()
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
   if root:
    export_extraction(root,target,required=result['exit']==0)
    export(checked_run(root),target,strict=result['exit']==0)
  except Exception as exc:result['exit']=1;result['exportError']=type(exc).__name__+':'+str(exc)[:300]
  (target/'history-profile-result.json').write_text(json.dumps(result,indent=2)+'\n');(target/'history-profile-result.json').chmod(0o660)
  for sig,handler in old.items():signal.signal(sig,handler)
 return result['exit']
if __name__=='__main__':
 import sys
 if len(sys.argv)!=3 or sys.argv[1]!='run':raise SystemExit(2)
 raise SystemExit(run(sys.argv[2]))
