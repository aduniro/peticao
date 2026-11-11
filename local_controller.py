"""Explicit LOCAL fixture controller; no worker queue authority or remote fencing identity."""
from pathlib import Path
import os,json,stat,hashlib,subprocess,socket,time,signal,re,shutil
import docker_control as d
ROOT=Path('/mnt/dev/.peticao-r0013-create-reconciliation-draft-20261111/profile-v2')
UNIT='peticao-r0013-create-reconciliation-v2-20261111.service'
CONFIG=ROOT/'config.json'
SNAPSHOT=None
class Cancelled(RuntimeError):pass
class CancellationState:
 def __init__(self):self.cleaning=False;self.signals=0
 def handle(self,signum,frame):
  self.signals+=1
  if not self.cleaning:raise Cancelled('cancelled; no automatic retry')
def digest(path):
 if path.resolve()!=path or not path.is_file()or path.is_symlink():raise ValueError('canonical regular input required')
 return hashlib.sha256(path.read_bytes()).hexdigest()
def cgroup_of(pid,proc_root=Path('/proc')):
 rows=[x[3:]for x in(proc_root/str(pid)/'cgroup').read_text().splitlines()if x.startswith('0::')]
 if len(rows)!=1:raise ValueError('unified cgroup required')
 return rows[0]
def live_context(expected):
 group=cgroup_of(os.getpid())
 if os.getuid()==0 or group!=expected or not group.startswith('/user.slice/')or not group.endswith('/'+UNIT):raise ValueError('own exact LOCAL bounded user unit required')
 path=Path('/sys/fs/cgroup')/group.lstrip('/');cpu=(path/'cpu.max').read_text().split();mem=(path/'memory.max').read_text().strip();pids=(path/'pids.max').read_text().strip()
 if cpu[0]=='max'or mem=='max'or pids=='max':raise ValueError('finite LOCAL limits required')
 limits={'cgroup':group,'cpuCores':int(cpu[0])/int(cpu[1]),'memoryMaxBytes':int(mem),'pidsMax':int(pids)}
 if not 0<limits['cpuCores']<=2 or not 0<limits['memoryMaxBytes']<=3*1024**3 or not 0<limits['pidsMax']<=256:raise ValueError('LOCAL limits exceeded')
 return limits

def verify_reconciled_previous_attempt():
 prior=json.loads((ROOT/'PREVIOUS-ATTEMPT-TERMINAL.json').read_text());oldroot=Path('/mnt/dev/.peticao-r0013-local-pdf-preparation-browser-qa-20261111');oldrun=oldroot/'runs/97b317f6483b'
 if prior.get('classification')!='EXPLICIT_NEW_CREATE90_ATTEMPT_AFTER_RECONCILED_R13_FAILURE'or prior.get('oldRun')!=str(oldrun)or prior.get('oldNonce')!='97b317f6483b'or prior.get('newMarker')!='execution.create90-v2.started'or prior.get('noAutomaticRetry')is not True:raise ValueError('explicit reconciled old attempt required')
 for name,pin in prior['files'].items():
  if name not in ['root-failure-receipt.json','root-retained-unit.txt','root-manual-reconciliation.json','outer-result.json']or digest(oldrun/name)!=pin:raise ValueError('old root failure proof pin drift')
 if set(prior['files'])!={'root-failure-receipt.json','root-retained-unit.txt','root-manual-reconciliation.json','outer-result.json'}or prior.get('oldMarker')!=str(oldroot/'execution.started')or digest(oldroot/'execution.started')!=prior.get('oldMarkerSha256'):raise ValueError('preserved old marker and exact proof set required')
 failed=json.loads((oldrun/'root-failure-receipt.json').read_text());outer=json.loads((oldrun/'outer-result.json').read_text());manual=json.loads((oldrun/'root-manual-reconciliation.json').read_text());unit=dict(v.split('=',1)for v in(oldrun/'root-retained-unit.txt').read_text().splitlines()if'='in v)
 if failed.get('classification')!='FAILED_PRE_APPLICATION_DOCKER_CREATE_TIMEOUT_RECONCILED'or failed.get('exit')!=1 or failed.get('httpChecks')!=0 or failed.get('browserExecuted')is not False or failed.get('applicationPdfGenerated')is not False or failed.get('retryPerformed')is not False or failed.get('sourceCommit')!='f55595cd348c23ffe559dba2de9150259db9f1e7':raise ValueError('root pre-app failure receipt required')
 if unit.get('Result')!='exit-code'or unit.get('ExecMainStatus')!='1'or unit.get('InvocationID')!='00244f062c8e45218469297c1400875e'or failed.get('invocation')!=unit.get('InvocationID'):raise ValueError('original retained failed unit required')
 for name in ['outer-result.json','root-retained-unit.txt','root-manual-reconciliation.json']:
  if failed.get('files',{}).get(name)!=prior['files'][name]:raise ValueError('root receipt file binding')
 if outer.get('exit')!=1 or outer.get('checks')!=[]or outer.get('guardInstalled')is not False or outer.get('runtimeStable')is not True or outer.get('originRuntimeStable')is not True:raise ValueError('old outer failure must remain failure')
 if manual.get('containerId')!='4a46dbb47ced33665c4362f450510cb8bf384a0b568d80fc62bbe5685d74ad48'or manual.get('identityAndIsolationVerified')is not True or manual.get('lateCompletionAfterTimeout')is not True or manual.get('oldOuterResultPreserved')is not True or manual.get('cleanup')!={'containerRemoved':True,'networkAbsent':True}or manual.get('portsClosed')!=[55493,31393]:raise ValueError('root exact own-ID manual reconciliation required')
 # Fresh read-only checks concern ONLY old nonce. Absence alone would be insufficient without ROOT reconciliation above.
 for args in [['ps','--all','--filter','label=org.peticao.qa.local-r0013=97b317f6483b','--format','{{.ID}}'],['network','ls','--filter','label=org.peticao.qa.local-r0013=97b317f6483b','--format','{{.ID}}']]:
  if d.docker(*args,timeout=8).stdout.strip():raise ValueError('old nonce resources reappeared; manual reconciliation required')
 for port in [55493,31393]:
  with socket.socket()as sock:
   sock.settimeout(.3)
   if sock.connect_ex(('127.0.0.1',port))==0:raise ValueError('old/shared fixture port is occupied')
 return prior

def verify_local_manifest(create_intent=True):
 expected=os.environ.get('LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256','')
 if not re.fullmatch('[a-f0-9]{64}',expected)or digest(ROOT/'local-manifest.json')!=expected:raise ValueError('reviewed LOCAL manifest SHA required')
 value=json.loads((ROOT/'local-manifest.json').read_text())
 for name,pin in value['files'].items():
  if not name or Path(name).is_absolute()or '..'in Path(name).parts or digest(ROOT/name)!=pin:raise ValueError('LOCAL reviewed file drift')
 if create_intent:
  live_context(json.loads(CONFIG.read_text())['expected_cgroup']);prior=verify_reconciled_previous_attempt()
  fd=os.open(ROOT/'execution.create90-v2.started',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w')as out:json.dump({'mode':'LOCAL_R13_CREATE90_EXPLICIT_NEW_INTENT','at':time.time(),'unit':UNIT,'oldMarkerSha256':prior['oldMarkerSha256'],'oldFailureReceiptSha256':prior['files']['root-failure-receipt.json'],'oldManualReconciliationSha256':prior['files']['root-manual-reconciliation.json']},out)

 return value

def verify_local_context(config):
 global SNAPSHOT
 if config.get('local_only')is not True or config.get('workerJob')is not False or config.get('expected_cgroup')!=json.loads(CONFIG.read_text())['expected_cgroup']:raise ValueError('explicit LOCAL identity required')
 verify_local_manifest(False);live_context(config['expected_cgroup'])
 proc=Path('/proc')/str(os.getpid());fields=(proc/'stat').read_text().rpartition(') ')[2].split()
 if proc.stat().st_uid!=os.getuid()or fields[0]in {'Z','X','x'}:raise ValueError('LOCAL parent identity invalid')
 value={'location':'LOCAL','workerJob':False,'santiagoExecution':False,'unit':UNIT,'uid':os.getuid(),'pid':os.getpid(),'startTicks':fields[19],'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'cgroup':config['expected_cgroup']}
 if SNAPSHOT is not None and value!=SNAPSHOT:raise ValueError('LOCAL identity changed')
 SNAPSHOT=value;return value

class DockerPG:
 def __init__(self,run,nonce,group,environment,node,config,job_deadline,cancellation):
  if not re.fullmatch('[a-f0-9]{12}',nonce)or run.parent!=ROOT/'runs'or run.name!=nonce:raise ValueError('LOCAL nonce/run identity')
  self.run=run;self.nonce=nonce;self.group=group;self.environment=environment;self.node=node;self.config=config;self.cid=None;self.nid=None;self.prepared=False;self.attempted=False;self.started=False;self.uncertain=False;self.events=[];self.job_deadline=job_deadline;self.cancellation=cancellation;self.phase='not-mutated';self.record_seq=0
  self.data=Path('/var/lib/postgresql/data') # Container namespace only; never a host PGDATA path/mount.
 def fence(self):verify_local_context(self.config)
 def prepare(self):
  self.fence();image=json.loads(d.docker('image','inspect',d.IMAGE).stdout)
  if len(image)!=1 or image[0]['Id']!=d.IMAGE or image[0]['Os']!='linux'or image[0]['Architecture']!='amd64':raise ValueError('cached Docker image identity')
  for port in [55493,31393]:
   with socket.socket()as sock:sock.bind(('127.0.0.1',port))
  self.prepared=True;self.events.append('prepared')
  (self.run/'docker-intent.json').write_text(json.dumps({'mode':'LOCAL','nonce':self.nonce,'labels':d.owned_labels(self.nonce),'image':d.IMAGE,'dataDirectoryContainer':str(self.data),'hostPgPort':55493,'containerPgPort':5432},indent=2)+'\n')
 def record_operation(self,error_class=None):
  self.record_seq+=1;target=self.run/'docker-operation-state.json';tmp=self.run/f'docker-operation-{self.record_seq}.tmp'
  value={'nonce':self.nonce,'phase':self.phase,'uncertain':self.uncertain,'dependencyHeld':self.uncertain,'containerId':self.cid,'networkId':self.nid,'image':d.IMAGE,'expectedContainerName':'peticao-r0013-'+self.nonce+'-pg','expectedNetworkName':'peticao-r0013-'+self.nonce+'-net','createBudgetSeconds':90,'noRetry':True,'resourceAbsenceEstablished':False,'errorClass':error_class}
  fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w')as out:json.dump(value,out,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
  os.replace(tmp,target);fd=os.open(self.run,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 def admit_mutation(self,phase):
  self.fence()
  required={'network-create-intent':30,'container-create-intent':105,'start-intent':35}[phase]
  if self.cancellation.signals or time.monotonic()+required>=self.job_deadline:raise Cancelled('cancelled/insufficient global deadline; no Docker mutation admitted')
  self.uncertain=True;self.phase=phase;self.record_operation()
 def verify_completion(self,phase):
  self.fence()
  if self.cancellation.signals or time.monotonic()>=self.job_deadline:raise Cancelled('cancel/deadline after Docker response; keep dependency held')
  self.phase=phase;self.uncertain=False;self.record_operation()
 def uncertain_failure(self,exc):
  self.uncertain=True;self.phase+='-uncertain'
  try:self.record_operation(type(exc).__name__)
  except BaseException:pass # Original exception identity remains the cause; never make this success.
 def initialize(self):
  self.fence()
  if not self.prepared or self.attempted:raise ValueError('prepare once before unique create')
  self.attempted=True
  try:
   self.admit_mutation('network-create-intent')
   self.nid=d.docker(*d.network_args(self.nonce)).stdout.strip();net=d.inspect_owned('peticao-r0013-'+self.nonce+'-net',self.nonce,'network')
   if net['Id']!=self.nid or net.get('Driver')!='bridge'or net.get('Internal')is not False or net.get('Containers'):raise ValueError('exclusive normal bridge identity')
   self.admit_mutation('container-create-intent')
   self.cid=d.docker(*d.container_args(self.nonce,self.nid),timeout=90).stdout.strip();obj=d.inspect_owned('peticao-r0013-'+self.nonce+'-pg',self.nonce,'container')
   if d.validate_container(obj,self.nonce,self.nid)!=self.cid:raise ValueError('created ID changed')
   self.verify_completion('created-verified');self.events.append('created')
  except BaseException as exc:
   self.uncertain_failure(exc);raise Cancelled('Docker creation/inspection uncertain; never repeat; dependency held for manual reconciliation')from exc
 def start(self):
  self.fence()
  if not self.cid or self.started or self.uncertain:raise ValueError('single start only after fully verified creation')
  try:
   self.admit_mutation('start-intent');d.docker('start',self.cid,timeout=20)
   obj=d.inspect_owned('peticao-r0013-'+self.nonce+'-pg',self.nonce,'container');d.validate_container(obj,self.nonce,self.nid,phase='after_start',expected_cid=self.cid)
   self.verify_completion('started-verified');self.started=True;self.events.append('started')
  except BaseException as exc:
   self.uncertain_failure(exc);raise Cancelled('Docker start/inspection uncertain; dependency held for manual reconciliation')from exc
 def sql(self,query):return d.docker('exec','--env','PGPASSWORD=fixture_only',self.cid,'psql','-h','127.0.0.1','-X','-At','-U','fixture_only','-d','fixture_only','-c',query,timeout=5).stdout.strip()
 def bootstrap(self):
  self.fence();query="SELECT json_build_object('version',current_setting('server_version_num'),'cluster',current_setting('cluster_name'),'database',current_database(),'dataDirectory',current_setting('data_directory'),'containerPort',inet_server_port())";deadline=time.monotonic()+40
  if not self.started:raise ValueError('container must be running before SQL')
  while True:
   try:inside=json.loads(self.sql(query));break
   except subprocess.CalledProcessError:
    if time.monotonic()>deadline:raise TimeoutError('PG17 TCP readiness; no alternate path')
    time.sleep(.5)
  expected={'version':'170011','cluster':self.nonce,'database':'fixture_only','dataDirectory':str(self.data),'containerPort':5432}
  if inside!=expected:raise ValueError('container PostgreSQL nonce/version/namespace changed')
  host="const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});(async()=>{try{await c.connect();console.log(JSON.stringify((await c.query("+json.dumps(query)+")).rows[0].json_build_object));}finally{await c.end();}})().catch(e=>{console.error(e);process.exitCode=1;});"
  p=subprocess.run([str(self.node),'-e',host],cwd=Path(self.config['runtime_dir']),env=self.environment,text=True,capture_output=True,timeout=12,check=True)
  host_value=json.loads(p.stdout)
  if host_value!=expected:raise ValueError('HOST TCP PostgreSQL nonce/version/namespace changed')
  self.events.append('host-tcp-verified');proof={'location':'LOCAL','docker':inside,'hostTCP':host_value,'hostPgPort':55493,'containerPgPort':5432,'image':d.IMAGE,'productionDatabase':False}
  (self.run/'pg-handshake.json').write_text(json.dumps(proof,indent=2)+'\n');return proof
 def stop(self):
  if self.uncertain:
   with socket.socket()as sock:
    sock.settimeout(.3);closed=sock.connect_ex(('127.0.0.1',55493))!=0
   return {'stopped':False,'uncertain':True,'dependencyHeld':True,'manualReconciliationRequired':True,'cleanupAttempted':False,'resourceAbsenceEstablished':False,'containerId':self.cid,'networkId':self.nid,'phase':self.phase,'hostPgPortClosed':closed,'postgresStarted':None if self.phase.startswith('start')else self.started}
  if not self.attempted:return {'stopped':True,'neverCreated':True,'postgresStarted':False}
  result=d.cleanup(self.nonce,expected_cid=self.cid,expected_nid=self.nid)
  with socket.socket()as sock:result['hostPgPortClosed']=sock.connect_ex(('127.0.0.1',55493))!=0
  result['stopped']=not result.get('cleanupErrors')and result['hostPgPortClosed']and not self.uncertain
  if self.uncertain:result['requiresManualDockerReconciliation']=True
  result['postgresStarted']=self.started;self.events.append('cleanup-observed');return result
 def report(self):return {'backend':'LOCAL_DOCKER_17_11','nonce':self.nonce,'containerId':self.cid,'networkId':self.nid,'image':d.IMAGE,'events':self.events,'dataDirectoryContainer':str(self.data),'hostPgPort':55493,'containerPgPort':5432,'uncertain':self.uncertain}

ALLOW=['result.json','pid.json','guard.jsonl','source-manifest.json','pg-handshake.json','docker-operation-state.json','downloads/database.pdf','downloads/browser-generated.pdf','downloads/browser-history.pdf','downloads/reference-page.png','preparation-browser-result.json','browser-hook-result.json','preparation-browser.png']
def finalize_local(run,result,group):
 try:
  if result.get('exit')==0:
   if result.get('browser',{}).get('exit')!=0 or result.get('browser',{}).get('browserProcessesDrained')is not True or result.get('browser',{}).get('browserTmpRemoved')is not True:raise ValueError('browser close/drain/private TMP cleanup mandatory')
   if (result.get('protocol',{}).get('complete')is not True or result.get('protocol',{}).get('realPdfGeneratedByRuntime')is not True) or result.get('remainingAppProcesses')or not result.get('postgresCleanup',{}).get('stopped'):raise ValueError('local history gates incomplete')
  path=Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.procs';remaining=[int(x)for x in path.read_text().split()if int(x)!=os.getpid()]
  result['remainingLocalCgroupProcesses']=remaining
  if remaining:raise ValueError('LOCAL cgroup children remain')
  for port in [55493,31393]:
   with socket.socket()as sock:
    if sock.connect_ex(('127.0.0.1',port))==0:raise ValueError('local reserved port remains open')
  result['localPortsClosed']=[55493,31393]
  target=ROOT/'exports'/run.name;target.parent.mkdir(mode=0o700,exist_ok=True);stage=run/'export-staging';stage.mkdir(mode=0o700);entries={};budget=0
  sensitive=[]
  if(run/'private-markers.json').exists():sensitive=[x.encode()for x in json.loads((run/'private-markers.json').read_text())]
  for name in ALLOW:
   p=run/name
   if not p.exists():continue
   if p.resolve()!=p or not p.is_file()or p.stat().st_nlink!=1 or p.stat().st_size>16*1024**2:raise ValueError('technical export metadata')
   if any(marker in p.read_bytes()for marker in sensitive):raise ValueError('private credential must never enter export')
   budget+=p.stat().st_size
   if budget>32*1024**2:raise ValueError('technical export budget')
   dest=stage/name;dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(p,dest);dest.chmod(0o600);entries[name]={'sha256':digest(dest),'bytes':dest.stat().st_size}
  if result.get('exit')==0 and set(entries)!=set(ALLOW):raise ValueError('success export incomplete')
  (stage/'export-manifest.json').write_text(json.dumps({'publication':'COMPLETE_TECHNICAL_EXPORT','location':'LOCAL','nonce':run.name,'requiresRetainedUnitExitZeroAndWholeCgroupDrained':True,'files':entries},indent=2)+'\n')
  for name,pin in entries.items():
   if digest(stage/name)!=pin['sha256']:raise ValueError('export bytes changed')
  if target.exists():raise ValueError('preserve earlier export')
  os.rename(stage,target);result['technicalExport']=str(target)
 except BaseException as exc:result['exit']=1;result['outerProofError']=type(exc).__name__+': '+str(exc)[:500]
 result['outerUnitExitIndependentlyRequired']=True
 (run/'outer-result.json').write_text(json.dumps(result,indent=2)+'\n');(run/'outer-result.json').chmod(0o600)
 return result
