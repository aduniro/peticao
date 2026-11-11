#!/usr/bin/python3
"""Fixed-kind extension draft for the existing queue. No new dispatcher/service/RPC."""
from pathlib import Path
import hashlib,json,os,pwd,re,signal,stat,subprocess,time,uuid
KIND='govbr-route-gates-native-pg17-r0003-v1'
SOURCE='93557bfba931f8f731807fc9f30f1d88dbafedf1'
BACKEND='f55595cd348c23ffe559dba2de9150259db9f1e7'
STAGE=Path('/srv/admin-v2-worker/admin-r0003-route-gates-20261111')
COMMON_INPUTS=Path('/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs')
WORKER=Path('/srv/admin-v2-worker');COORDINATOR=Path('/srv/admin-v2-coordinator')
PROC=Path('/proc');CGROUP=Path('/sys/fs/cgroup');NODE=Path('/usr/bin/node');PG_BIN=Path('/usr/lib/postgresql/17/bin')
HARNESS_SHA='77c122ffab177175be4f0ea8ee0c5b9190b4eaf5c12e5a27c342e25d19ff834d'
SOFT_SECONDS=600;CLEANUP_SECONDS=120;HARD_SECONDS=720
CASES=['session','level','stepup','origin','rate']
EXPECTED_NAMES=['real validation route '+v+' refusal creates no intent and recovers only by admitted exact GET'for v in CASES]
RECEIPTS={'result.json','tap.log','stderr.log','guard.jsonl','guard-summary.json','context.json','staging.json','pg-lifecycle.json','pg-handshake.json'}
HARNESS_PINS={'run.py': '62ab4077748800eee50db8e3a404b1229b3ce8864354efea4d9e71b8aacbea8a', 'native_pg.py': 'a69d8c3e7b478d3bc9efdef0db52c97678f1fd48fc5b967c9373da24d26f2ee0', 'worker_context.py': '26a09c95fdd720d8a122371c4c275cb1275f8df6b81861036d39ec2915f2175b', 'staging.py': '3074af928b94c409003097a7ad55e4add37cdf3b53de2844c213a02c4b5714e2', 'receipts.py': 'e3766b2e0c3219252ed853580b5206357a2b2ed434269fca55106d4b293f0c21', 'guard_policy.cjs': 'b1605f3789260ad02ba5c6f4cd67494bacc6797c28894f9213c649ff96bb651e', 'node_guard.cjs': 'f2a0f708159a2d5a081ca084f55496028ba169ce3456d374592ade5c61f2ab20', 'registry.json': '1a894d10f9ff42ce59ec6d0ce7f7c49661ae965a3a140a28833d6a963fa02afb', 'pg-binary-pins.json': '4053a50714cbb68c9b3dfe0b3a015ffe46f73561b175799fc0547b73cbf7e49d', 'dns_guard.cjs': '68a22d886d5218d723b5446931bd70da76bfc9f1fb30ffcc7148fb702ca25268'}
INPUT_PINS={'artifacts/source/source.tar': 'f2440846c29ef84613bc4e005d7acaebf70eb1643816c025c229aa14dff545eb', 'artifacts/source/source-manifest.json': '63f1354863106399306f9d9ef10380c71dac82ca7f7dc4861bea0911b303924e', 'artifacts/devdeps.tar': 'ebf056a98596e670bf68ee53ea4daeb45a9fcc7e302ab0bf4bd6a6ff72f99373', 'artifacts/devdeps-manifest.json': 'db93db3e4c00f4a08d21aa1a775ef180a2e7a5f5e7dbbbbb1b6d143ab84b2f70', 'artifacts/production-manifest.json': '7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3'}
REGISTRY={'schema_version': 1, 'kind': 'govbr-route-gates-native-pg17-r0003-v1', 'source_commit': '93557bfba931f8f731807fc9f30f1d88dbafedf1', 'backend_source_commit': 'f55595cd348c23ffe559dba2de9150259db9f1e7', 'node_sha256': 'ca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e', 'source_archive_sha256': 'f2440846c29ef84613bc4e005d7acaebf70eb1643816c025c229aa14dff545eb', 'source_manifest_sha256': '63f1354863106399306f9d9ef10380c71dac82ca7f7dc4861bea0911b303924e', 'devdeps_archive_sha256': 'ebf056a98596e670bf68ee53ea4daeb45a9fcc7e302ab0bf4bd6a6ff72f99373', 'devdeps_manifest_sha256': 'db93db3e4c00f4a08d21aa1a775ef180a2e7a5f5e7dbbbbb1b6d143ab84b2f70', 'production_archive_sha256': '2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0', 'production_manifest_sha256': '7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3', 'postgres_version_num': '170011', 'db_port': 55487, 'resources': {'cpu_cores': 2, 'memory_bytes': 3221225472, 'pids_max': 256, 'soft_seconds': 600, 'hard_seconds': 720, 'test_timeout_seconds': 480}, 'test_file': 'src/lib/petition-base-route.test.ts', 'test_pattern': '^real validation route (session|level|stepup|origin|rate) refusal creates no intent and recovers only by admitted exact GET$', 'expected_cases': ['session', 'level', 'stepup', 'origin', 'rate'], 'node_version': '20.19.2', 'tsx_version': '4.23.15', 'esbuild_version': '0.28.2', 'integration_state': 'PRIVATE_DRAFT_NOT_REGISTERED_NOT_EXECUTED', 'node_path': '/usr/bin/node', 'local_mock_node_sha256': 'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'}
PG_PINS={'postgres': '6468a969338215cb3912cf9c0b894bdbbd37b9a709926db078e9a5bf8bdc3e16', 'initdb': 'a0363354125bc00f25075bb47fc32a2838fa7668c008326227f5bc04d628ca1d', 'pg_ctl': 'c8a0fa6df90600186575e3f3c47a352bafac73547416cf67675b41991b5b5d74', 'psql': '3c94c29652ea7ff8803ab1ca35e48c38a39c8a94a8c8eeadbb1d87c68494506c', 'pg_isready': 'f02ea2f9ee0119ac00427e700ffe56368d655016c1807e689265afc6138cbf63'}
class ProfileError(RuntimeError):pass
class Canceled(ProfileError):pass

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'))
def job_id(value):
 if not isinstance(value,str)or not re.fullmatch('[a-f0-9]{32}',value):raise ProfileError('invalid_job_id')
 return value

def fixed_payload():return {'kind':KIND,'source_commit':SOURCE,'project_subdir':'site'}
def payload(data):
 # Coordinator admission is PURE: never inspect STAGE, PG or worker-owned0700 paths.
 if not isinstance(data,dict)or set(data)!={'action','id','kind','source_commit'}or data['action']!='submit'or data['kind']!=KIND or data['source_commit']!=SOURCE:raise ProfileError('fixed_rpc_contract_only')
 job_id(data['id']);return fixed_payload()
def argv(job):return ['/usr/bin/python3','/opt/admin-v2-cluster/route_gates_profile.py','run',job_id(job)]
def harness_argv(job):return ['/usr/bin/python3',str(STAGE/'run.py'),job_id(job)]
def launcher_properties():
 return {'CPUQuota':'200%','MemoryMax':'3G','MemorySwapMax':'0','TasksMax':'256','RuntimeMaxSec':'600','TimeoutStopSec':'120','KillMode':'control-group'}

def regular(path,limit=8*1024**2):
 if path.resolve()!=path:raise ProfileError('noncanonical_file:'+path.name)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>limit:raise ProfileError('bounded_regular_file_required')
  with os.fdopen(fd,'rb',closefd=False)as f:data=f.read(limit+1)
  if len(data)!=st.st_size:raise ProfileError('file_changed_during_read')
  return data
 finally:os.close(fd)
def read_json(path,limit=8*1024**2):return json.loads(regular(path,limit))
def digest(path,limit=512*1024**2):
 if path.resolve()!=path:raise ProfileError('noncanonical_pin')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>limit:raise ProfileError('bounded_single_regular_pin')
  h=hashlib.sha256()
  with os.fdopen(fd,'rb',closefd=False)as f:
   for b in iter(lambda:f.read(1024**2),b''):h.update(b)
  return h.hexdigest()
 finally:os.close(fd)
def pin(path,expected,limit=512*1024**2):
 if digest(path,limit)!=expected:raise ProfileError('pin_changed:'+path.name)
def private(path):
 st=path.lstat()
 if path.resolve()!=path or not stat.S_ISDIR(st.st_mode)or st.st_uid!=os.getuid()or stat.S_IMODE(st.st_mode)!=0o700:raise ProfileError('private_own0700_required')
def cgroup(pid):
 lines=(PROC/str(pid)/'cgroup').read_text().splitlines();values=[x[3:]for x in lines if x.startswith('0::')]
 if len(values)!=1:raise ProfileError('unified_cgroup_required')
 return values[0]
def identity(pid,expected):
 if isinstance(pid,bool)or not isinstance(pid,int)or pid<=0:raise ProfileError('invalid_process_pid')
 root=PROC/str(pid);fields=(root/'stat').read_text().rsplit(')',1)[1].split()
 if root.stat().st_uid!=os.getuid()or fields[0]=='Z'or cgroup(pid)!=expected:raise ProfileError('process_identity_changed')
 return fields[19]
def resource_limits(expected):
 root=CGROUP/expected.lstrip('/');mem=(root/'memory.max').read_text().strip();cpu=(root/'cpu.max').read_text().split();pids=(root/'pids.max').read_text().strip();swap=(root/'memory.swap.max').read_text().strip()
 if mem=='max'or not 0<int(mem)<=3*1024**3 or cpu[0]=='max'or not 0<int(cpu[0])/int(cpu[1])<=2 or pids=='max'or not 0<int(pids)<=256 or swap!='0':raise ProfileError('fixed_resource_caps_required')
 return {'memoryMaxBytes':int(mem),'cpuCores':int(cpu[0])/int(cpu[1]),'pidsMax':int(pids),'swapMaxBytes':0}
def queue_context(job):
 job=job_id(job)
 if os.getuid()==0 or pwd.getpwuid(os.getuid()).pw_name!='vigia-worker':raise ProfileError('worker_uid_only')
 folder=WORKER/'jobs'/job;config=read_json(folder/'config.json');state=read_json(folder/'state.json');authority=read_json(COORDINATOR/'authority.json');boot=(PROC/'sys/kernel/random/boot_id').read_text().strip();expected='/system.slice/admin-v2-job-'+job+'.service';generation=config.get('generation')
 if config.get('id')!=job or config.get('payload')!=fixed_payload()or config.get('digest')!=hashlib.sha256(canonical(fixed_payload()).encode()).hexdigest():raise ProfileError('config_identity_or_digest')
 if type(generation)is not int or generation<1 or authority.get('role')!='primary'or authority.get('armed_boot_id')!=boot or type(authority.get('generation'))is not int or authority['generation']!=generation:raise ProfileError('authority_boot_generation')
 if state.get('id')!=job or state.get('state')!='running'or state.get('boot_id')!=boot or type(state.get('generation'))is not int or state['generation']!=generation:raise ProfileError('running_state_identity')
 marker=folder/'execution.started';regular(marker,1024)
 if marker.stat().st_uid!=os.getuid():raise ProfileError('execution_marker_owner')
 parent=state.get('pid');parent_ticks=identity(parent,expected)
 if parent_ticks!=state.get('start_ticks'):raise ProfileError('queue_parent_pid_reused')
 own=os.getpid();own_ticks=identity(own,expected);limits=resource_limits(expected)
 return {'jobId':job,'configDigest':config['digest'],'generation':generation,'bootId':boot,'cgroup':expected,'parentPid':parent,'parentStartTicks':parent_ticks,'wrapperPid':own,'wrapperStartTicks':own_ticks,'limits':limits}
def same_fence(a,b):
 if a!=b:raise ProfileError('queue_fence_changed')
def verify_stage():
 private(STAGE)
 expected=set(HARNESS_PINS)|{'harness-manifest.json'}|set(INPUT_PINS)
 actual=set()
 for p in STAGE.rglob('*'):
  if p.is_symlink()or not(p.is_dir()or p.is_file()):raise ProfileError('stage_link_or_special')
  if p.is_dir():
   private(p)
   if str(p.relative_to(STAGE))not in {'artifacts','artifacts/source'}:raise ProfileError('unexpected_stage_directory')
  else:actual.add(str(p.relative_to(STAGE)))
 if actual!=expected:raise ProfileError('stage_exact_inventory')
 pin(STAGE/'harness-manifest.json',HARNESS_SHA,2*1024**2);manifest=read_json(STAGE/'harness-manifest.json')
 if manifest.get('files')!=HARNESS_PINS or manifest.get('sourceCommit')!=SOURCE or manifest.get('backendCommit')!=BACKEND or manifest.get('kind')!=KIND:raise ProfileError('external_harness_manifest_contract')
 for name,value in HARNESS_PINS.items():pin(STAGE/name,value,2*1024**2)
 for name,value in INPUT_PINS.items():pin(STAGE/name,value,64*1024**2)
 reg=read_json(STAGE/'registry.json')
 if reg!=REGISTRY:raise ProfileError('registry_exact_contract')
 verify_tools();verify_shared_runtime()
 return {'harnessManifestSha256':HARNESS_SHA,'runtimeSha256':REGISTRY['production_archive_sha256'],'runtimeManifestSha256':REGISTRY['production_manifest_sha256'],'sourceArchiveSha256':REGISTRY['source_archive_sha256'],'devdepsArchiveSha256':REGISTRY['devdeps_archive_sha256'],'stageAndInputsVerified':True}

def verify_tools():
 pin(NODE,REGISTRY['node_sha256'],128*1024**2)
 for name,value in PG_PINS.items():
  p=PG_BIN/name;st=p.lstat()
  if st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o755:raise ProfileError('pg_root_owned_tools')
  pin(p,value,128*1024**2)

def verify_shared_runtime():
 private(COMMON_INPUTS);archive=COMMON_INPUTS/'runtime.tar';pin(archive,REGISTRY['production_archive_sha256'],512*1024**2)
 if archive.stat().st_size!=475576320:raise ProfileError('shared_runtime_exact_size')
 pin(COMMON_INPUTS/'release-manifest.json',REGISTRY['production_manifest_sha256'],8*1024**2)
 runtime=read_json(COMMON_INPUTS/'release-manifest.json')
 if runtime.get('source_commit')!=BACKEND or runtime.get('release_id')!='r0002-portable-f55595c-20261111'or len(runtime.get('files',{}))!=12043:raise ProfileError('shared_runtime_manifest_contract')

def atomic_json(path,data):
 # Temporary file stays OUTSIDE collector artifacts until complete publication.
 temp=path.parent.parent/('.route-profile-'+uuid.uuid4().hex+'.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w')as f:json.dump(data,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chown(temp,-1,path.parent.stat().st_gid);temp.chmod(0o660);os.rename(temp,path)
def claim(job,context):
 marker=WORKER/'jobs'/job/'route-gates-profile.started';fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w')as f:json.dump(context,f,sort_keys=True);f.flush();os.fsync(f.fileno())
 return marker
def reconcile(job):
 # Read-only same-ID recovery, no automatic restart or marker deletion.
 folder=WORKER/'jobs'/job_id(job);marker=folder/'route-gates-profile.started';result=folder/'work/artifacts/route-gates-profile.json'
 return {'id':job,'attempted':marker.exists(),'receipt':read_json(result)if result.exists()else None,'automaticReplay':False}
def cgroup_remaining(context,*,wrapper_allowed=True):
 allowed={context['parentPid']}
 if wrapper_allowed:allowed.add(context['wrapperPid'])
 for key,ticks in [('parentPid','parentStartTicks')]+([('wrapperPid','wrapperStartTicks')]if wrapper_allowed else []):
  if identity(context[key],context['cgroup'])!=context[ticks]:raise ProfileError('controller_pid_reused')
 members={int(x)for x in(CGROUP/context['cgroup'].lstrip('/')/'cgroup.procs').read_text().split()}
 return sorted(members-allowed)
def read_complete_export(folder):
 if folder.resolve()!=folder or not folder.is_dir():raise ProfileError('export_directory_canonical')
 manifest=read_json(folder/'export-manifest.json');names=set(manifest.get('files',{}))
 if manifest.get('publication')!='COMPLETE_TECHNICAL_EXPORT'or manifest.get('requiresOuterJobExitZeroAndDrainedCgroup')is not True or names!=RECEIPTS or {p.name for p in folder.iterdir()}!=RECEIPTS|{'export-manifest.json'}:raise ProfileError('complete_receipt_inventory_required')
 for name,value in manifest['files'].items():
  if not re.fullmatch('[a-f0-9]{64}',value):raise ProfileError('receipt_hash_format')
  pin(folder/name,value,8*1024**2)
 return manifest

def exact_tap(text):
 names=[]
 for line in text.splitlines():
  m=re.fullmatch(r'ok \d+ - (.*)',line)
  if m and ' # SKIP'not in m[1]and ' # TODO'not in m[1]:names.append(m[1])
 if names!=EXPECTED_NAMES or re.search(r'^not ok ',text,re.M)or not re.search(r'^# fail 0$',text,re.M)or not re.search(r'^# cancelled 0$',text,re.M):raise ProfileError('exact_five_tap_required')
 return names

def validate_receipts(folder,context,harness_exit):
 if harness_exit!=0:raise ProfileError('outer_harness_exit_not_zero')
 manifest=read_complete_export(folder);proof=read_json(folder/'result.json');nonce=proof.get('nonce');job=context['jobId'];run=WORKER/'jobs'/job/'work/govbr-route-gates'/str(nonce)
 if not re.fullmatch('[a-f0-9]{12}',nonce or '')or manifest.get('job')!=job or manifest.get('nonce')!=nonce:raise ProfileError('nonce_or_manifest_identity')
 if proof.get('exit')!=0 or proof.get('job')!=job or proof.get('run')!=str(run)or proof.get('sourceCommit')!=SOURCE or proof.get('backendCommit')!=BACKEND:raise ProfileError('proof_identity_or_failure')
 if proof.get('operationalReady')is not False or proof.get('deployment')is not False or proof.get('testsExecuted')is not True or proof.get('testExit')!=0 or proof.get('schemasRemaining')!=0 or proof.get('nodeGroupDrained')is not True or proof.get('remainingNodeProcesses')!=[]or proof.get('sourceAndDependenciesStable')is not True or proof.get('cleanupErrors')or proof.get('error'):raise ProfileError('proof_scope_stability_or_cleanup')
 if exact_tap(regular(folder/'tap.log').decode())!=proof.get('passedTests'):raise ProfileError('proof_exact_tests_changed')
 att=read_json(folder/'context.json')
 for name,value in {'id':job,'kind':KIND,'generation':context['generation'],'bootId':context['bootId'],'configDigest':context['configDigest'],'sourceCommit':SOURCE}.items():
  if att.get(name)!=value:raise ProfileError('harness_context_changed:'+name)
 limits=att.get('limits',{})
 if limits.get('cgroup')!=context['cgroup']or not 0<limits.get('cpuCores',0)<=2 or not 0<limits.get('memoryMaxBytes',0)<=3*1024**3 or not 0<limits.get('pidsMax',0)<=256:raise ProfileError('harness_limits_changed')
 staging=read_json(folder/'staging.json')
 if staging.get('sourceCommit')!=SOURCE or staging.get('backendCommit')!=BACKEND or staging.get('sourceFiles')!=1604 or staging.get('productionFilesVerified')!=12043 or staging.get('devFiles')!=40 or staging.get('npmExecuted')is not False:raise ProfileError('staging_inventory_proof')
 handshake=read_json(folder/'pg-handshake.json')
 if not str(handshake.get('version','')).startswith('PostgreSQL 17.11 ')or handshake.get('database')!='fixture_only'or handshake.get('nonce')!=nonce or handshake.get('data_directory')!=str(run/'postgres')or handshake.get('port')!=55487:raise ProfileError('own_pg_handshake_required')
 lifecycle=read_json(folder/'pg-lifecycle.json')
 required={'prepared','initdb-requested','initialized','start-requested','started','verified-postgres','verified-fixture_only','stop-requested','stopped','socket-released'}
 if lifecycle.get('backend')!='native-postgresql17'or lifecycle.get('nonce')!=nonce or lifecycle.get('dataDirectory')!=str(run/'postgres')or lifecycle.get('socketDirectory')!='/tmp/govbr-route-pg-'+nonce or not required<=set(lifecycle.get('events',[])):raise ProfileError('pg_lifecycle_identity')
 observed=lifecycle.get('binaryPins',{})
 if set(observed)!=set(PG_PINS)or any(observed[k].get('sha256')!=v or not re.search(r'\(PostgreSQL\) 17\.11(?:\s|$)',observed[k].get('version',''))for k,v in PG_PINS.items()):raise ProfileError('pg_binary_pins_proof')
 if proof.get('postgresCleanup',{}).get('stopped')is not True or proof.get('postgresCleanup',{}).get('identity',{}).get('nonce')!=nonce or proof.get('socketCleanup',{}).get('removed')is not True or proof.get('socketCleanup',{}).get('socketDirectory')!=lifecycle['socketDirectory']:raise ProfileError('pg_socket_cleanup_required')
 events=[json.loads(line)for line in regular(folder/'guard.jsonl').decode().splitlines()];summary=read_json(folder/'guard-summary.json')
 if not events or any(e.get('job')!=job or e.get('nonce')!=nonce for e in events):raise ProfileError('guard_log_identity')
 installed={e.get('pid')for e in events if e.get('kind')=='guard-installed'};test_children={e.get('pid')for e in events if e.get('kind')=='guard-installed'and e.get('nodeTestContext')=='child-v8'}
 denials=[e for e in events if e.get('kind')=='denial'];expected=[e for e in denials if e.get('category')=='expected-optional-cli-ipc-denial'and e.get('transport')=='ipc']
 if len(installed)!=2 or len(test_children)!=1 or proof.get('nodePid')not in installed or proof['nodePid']in test_children or installed!={proof['nodePid'],*test_children}or len(expected)!=len(denials):raise ProfileError('parent_child_guard_or_unexpected_denial')
 counted={'guardInstalled':True,'guardPids':sorted(installed),'testChildPids':sorted(test_children),'reportedDenialsTotal':len(denials),'expectedOptionalCliIpcDenials':len(expected),'unexpectedDenials':0}
 if summary!=counted or any(proof.get(k)!=v for k,v in counted.items()):raise ProfileError('guard_counts_must_match_raw_log')
 for event in events:
  if event.get('kind')=='guard-installed'and(event.get('nodeVersion')!='v20.19.2'or event.get('cgroup')!=context['cgroup']or event.get('ipcPolicy')!='all-blocked'):raise ProfileError('guard_install_contract')
 return {'nonce':nonce,'receiptManifestSha256':digest(folder/'export-manifest.json'),'passedTests':EXPECTED_NAMES,'guard':counted,'sourceAndDependenciesStable':True,'postgresStopped':True,'socketRemoved':True}

def stop_child(child,context,ticks):
 # Only the known Python harness controller; its own SIGTERM cleans fixture resources.
 if child.poll()is None:
  if identity(child.pid,context['cgroup'])!=ticks:raise ProfileError('harness_pid_reused_never_signal')
  child.terminate()
  try:child.wait(timeout=CLEANUP_SECONDS-10)
  except subprocess.TimeoutExpired:raise ProfileError('harness_cleanup_timeout_executor_must_drain_own_cgroup')
 return child.returncode

def run(job):
 job=job_id(job);context=queue_context(job);folder=WORKER/'jobs'/job
 if (folder/'route-gates-profile.started').exists():raise ProfileError('already_attempted_reconcile_same_id_do_not_replay')
 before=verify_stage();same_fence(context,queue_context(job));claim(job,context);same_fence(context,queue_context(job))
 artifacts=folder/'work/artifacts'
 if not artifacts.exists():artifacts.mkdir(mode=0o2770);artifacts.chmod(0o2770)
 child=None;ticks=None;result={'kind':KIND,'jobId':job,'sourceCommit':SOURCE,'backendCommit':BACKEND,'context':context,'exit':1,'harnessExit':None,'requiresOuterQueueExitZero':True,'cgroupDrainedExceptControllers':False,'deployment':False,'operationalReady':False};old={}
 cleaning=False;signals=0
 def cancel(*_):
  nonlocal signals
  signals+=1
  if not cleaning:raise Canceled('canceled_no_replay')
 for signum in [signal.SIGTERM,signal.SIGINT]:old[signum]=signal.signal(signum,cancel)
 try:
  env={'PATH':'/usr/bin:/bin','HOME':str(folder/'home'),'LANG':'C.UTF-8','PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1'}
  log=folder/'route-gates-wrapper.log'
  with log.open('xb')as out:
   child=subprocess.Popen(harness_argv(job),cwd=STAGE,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);ticks=identity(child.pid,context['cgroup']);deadline=time.monotonic()+SOFT_SECONDS
   while child.poll()is None:
    if time.monotonic()>=deadline:raise TimeoutError('route_profile_soft_deadline')
    if log.stat().st_size>8*1024**2:raise ProfileError('wrapper_log_limit')
    same_fence(context,queue_context(job));time.sleep(0.5)
   result['harnessExit']=child.returncode

  if child.returncode!=0:raise ProfileError('harness_exit_not_zero')
  same_fence(context,queue_context(job));result['qualification']=validate_receipts(artifacts/'govbr-route-gates',context,child.returncode);after=verify_stage()
  if before!=after:raise ProfileError('runtime_source_input_drift')
  same_fence(context,queue_context(job));result['runtimeAndSourceInputsStable']=True;remaining=cgroup_remaining(context)
  if remaining:raise ProfileError('whole_cgroup_not_drained:'+str(remaining))
  result['cgroupDrainedExceptControllers']=True;result['exit']=0
 except BaseException as exc:result['error']=type(exc).__name__+':'+str(exc)[:1000]
 finally:
  cleaning=True # Repeated unit TERM must not abort owned cleanup/receipt publication.
  if child is not None and ticks is not None:
   try:stop_child(child,context,ticks)
   except BaseException as exc:result['exit']=1;result['cleanupError']=type(exc).__name__+':'+str(exc)[:1000]
  try:
   remaining=cgroup_remaining(context);result['remainingCgroupPids']=remaining
   if remaining:result['exit']=1;result['cgroupDrainedExceptControllers']=False
  except BaseException as exc:result['exit']=1;result['cgroupError']=str(exc)[:300]
  result['cancelSignals']=signals
  if signals:result['exit']=1
  try:
   atomic_json(artifacts/'route-gates-profile.json',result)
   if signals:
    result['exit']=1;result['cancelSignals']=signals
    atomic_json(artifacts/'route-gates-profile.json',result)
  finally:
   for signum,handler in old.items():signal.signal(signum,handler)
 return 1 if signals else result['exit']

def qualify_collected(folder,outer_exit):
 # Called in the EXISTING queue worker after wrapper exit and generic artifact copy.
 if outer_exit!=0:raise ProfileError('outer_queue_child_failed')
 folder=Path(folder);job=job_id(folder.name)
 if folder!=WORKER/'jobs'/job:raise ProfileError('collected_job_path')
 current=queue_context(job)
 if current['wrapperPid']!=current['parentPid']:raise ProfileError('final_qualification_only_existing_queue_controller')
 root=folder/'artifacts'
 if {x.name for x in root.iterdir()}!={'route-gates-profile.json','govbr-route-gates'}:raise ProfileError('collected_exact_profile_artifacts')
 proof=read_json(root/'route-gates-profile.json');previous=proof.get('context',{})
 if proof.get('kind')!=KIND or proof.get('jobId')!=job or proof.get('sourceCommit')!=SOURCE or proof.get('backendCommit')!=BACKEND or proof.get('deployment')is not False or proof.get('operationalReady')is not False:raise ProfileError('collected_profile_scope')
 for key in ['jobId','configDigest','generation','bootId','cgroup','parentPid','parentStartTicks']:
  if previous.get(key)!=current[key]:raise ProfileError('collected_context_changed')
 marker=read_json(folder/'route-gates-profile.started')
 if marker!=previous:raise ProfileError('exclusive_profile_marker_changed')
 if proof.get('exit')!=0 or proof.get('harnessExit')!=0 or proof.get('requiresOuterQueueExitZero')is not True or proof.get('runtimeAndSourceInputsStable')is not True or proof.get('cgroupDrainedExceptControllers')is not True or proof.get('remainingCgroupPids')!=[]or proof.get('error')or proof.get('cleanupError'):raise ProfileError('wrapper_qualification_failed')
 checked=validate_receipts(root/'govbr-route-gates',previous,0)
 if checked!=proof.get('qualification'):raise ProfileError('collected_receipts_changed')
 # The wrapper has now exited. Only this existing queue controller may remain.
 if cgroup_remaining(current,wrapper_allowed=False):raise ProfileError('whole_cgroup_not_drained_after_wrapper')
 return {'qualified':True,'jobId':job,'sourceCommit':SOURCE,'backendCommit':BACKEND,'outerExit':0,'wholeCgroupDrainedExceptQueueController':True,'receiptManifestSha256':checked['receiptManifestSha256']}

if __name__=='__main__':
 import sys
 if len(sys.argv)!=3 or sys.argv[1]!='run':raise SystemExit(2)
 raise SystemExit(run(sys.argv[2]))
