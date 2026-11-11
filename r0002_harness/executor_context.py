"""Read-only existing queue fencing; no lease token, local ledger, RPC or authorization replacement."""
from pathlib import Path
import hashlib,json,os,re,signal,stat
from native_pg import Cancelled,cgroup_of
WORKER=Path('/srv/admin-v2-worker')
COORDINATOR=Path('/srv/admin-v2-coordinator')
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
  return json.loads(data)
 finally:os.close(fd)
def verify_queue_context(job,digest,expected_cgroup):
 if not isinstance(job,str)or not re.fullmatch('[a-f0-9]{32}',job)or not isinstance(digest,str)or not re.fullmatch('[a-f0-9]{64}',digest):raise RuntimeError('typed job context required')
 fixed='/system.slice/admin-v2-job-'+job+'.service'
 if expected_cgroup!=fixed or cgroup_of(os.getpid())!=fixed:raise RuntimeError('queue job cgroup mismatch')
 folder=WORKER/'jobs'/job
 if folder.resolve()!=folder:raise RuntimeError('queue folder noncanonical')
 config=regular_json(folder/'config.json');authority=regular_json(COORDINATOR/'authority.json')
 boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
 if authority.get('role')!='primary'or authority.get('armed_boot_id')!=boot or authority.get('generation')!=config.get('generation'):raise RuntimeError('queue authority generation/boot changed')
 payload=config.get('payload',{})
 if config.get('id')!=job or config.get('digest')!=digest or hashlib.sha256(canonical(payload).encode()).hexdigest()!=digest or payload.get('kind')!=KIND or payload.get('source_commit')!=SOURCE:raise RuntimeError('queue configuration digest/context mismatch')
 marker=folder/'execution.started'
 fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_uid!=os.getuid():raise RuntimeError('queue execution marker invalid')
 finally:os.close(fd)
 return {'jobId':job,'configDigest':digest,'generation':config['generation'],'bootId':boot,'cgroup':fixed}
class CancellationState:
 def __init__(self):self.cleaning=False;self.signals=0
 def handle(self,signum,frame):
  self.signals+=1
  if not self.cleaning:raise Cancelled('executor cancellation signal')
