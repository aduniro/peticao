"""Read-only existing queue fencing; no lease token, local ledger, RPC or authorization replacement."""
from pathlib import Path
import hashlib,json,os,re,signal,stat
from native_pg import Cancelled,cgroup_of
WORKER=Path('/srv/admin-v2-worker')
COORDINATOR=Path('/srv/admin-v2-coordinator')
PROC_ROOT=Path('/proc')
KIND='history-native-pg17-r0002-v1'
SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7'
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'))
def regular_json(path,limit=65536):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  info=os.fstat(fd)
  if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1 or info.st_size>limit:raise RuntimeError('queue context file invalid')
  with os.fdopen(fd,'rb',closefd=False)as stream:data=stream.read(limit+1)
  if len(data)>limit:raise RuntimeError('queue context too large')
  return json.loads(data,object_pairs_hook=strict_pairs,parse_constant=reject_constant)
 finally:os.close(fd)
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
def current_cgroup(pid):return cgroup_of(pid,PROC_ROOT)
def verify_queue_context(job,digest,expected_cgroup):
 if not isinstance(job,str)or not re.fullmatch('[a-f0-9]{32}',job)or not isinstance(digest,str)or not re.fullmatch('[a-f0-9]{64}',digest):raise RuntimeError('typed job context required')
 fixed='/system.slice/admin-v2-job-'+job+'.service'
 if expected_cgroup!=fixed or current_cgroup(os.getpid())!=fixed:raise RuntimeError('queue job cgroup mismatch')
 folder=WORKER/'jobs'/job
 if folder.resolve()!=folder:raise RuntimeError('queue folder noncanonical')
 config=regular_json(folder/'config.json');authority=regular_json(COORDINATOR/'authority.json');state=regular_json(folder/'state.json')
 if type(config)is not dict or type(authority)is not dict:raise ValueError('queue_context_json_object_required')
 boot=(PROC_ROOT/'sys/kernel/random/boot_id').read_text().strip()
 if not positive_generation(config.get('generation'))or not positive_generation(authority.get('generation'))or authority.get('role')!='primary'or authority.get('armed_boot_id')!=boot or authority['generation']!=config['generation']:raise RuntimeError('queue authority generation/boot changed')
 payload=config.get('payload',{})
 if type(payload)is not dict or config.get('id')!=job or config.get('digest')!=digest or hashlib.sha256(canonical(payload).encode()).hexdigest()!=digest or payload.get('kind')!=KIND or payload.get('source_commit')!=SOURCE:raise RuntimeError('queue configuration digest/context mismatch')
 marker=folder/'execution.started';fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_uid!=os.getuid():raise RuntimeError('queue execution marker invalid')
 finally:os.close(fd)
 parent,ticks=parent_identity(state,job,config['generation'],boot,fixed)
 return {'jobId':job,'configDigest':digest,'generation':config['generation'],'bootId':boot,'cgroup':fixed,'parentPid':parent,'parentStartTicks':ticks}
def verify_context_snapshot(config):
 if type(config)is not dict:raise ValueError('typed executor config required')
 expected={'jobId':config.get('executor_job_id'),'configDigest':config.get('executor_config_digest'),'generation':config.get('executor_generation'),'bootId':config.get('executor_boot_id'),'cgroup':config.get('expected_cgroup'),'parentPid':config.get('executor_parent_pid'),'parentStartTicks':config.get('executor_parent_start_ticks')}
 if not positive_generation(expected['generation'])or type(expected['parentPid'])is not int or expected['parentPid']<=0 or type(expected['parentStartTicks'])is not str or not re.fullmatch('[1-9][0-9]*',expected['parentStartTicks']):raise ValueError('typed executor parent/generation required')
 observed=verify_queue_context(expected['jobId'],expected['configDigest'],expected['cgroup'])
 if observed!=expected:raise ValueError('executor context changed since wrapper verification')
 return observed
class CancellationState:
 def __init__(self):self.cleaning=False;self.signals=0
 def handle(self,signum,frame):
  self.signals+=1
  if not self.cleaning:raise Cancelled('executor cancellation signal')
