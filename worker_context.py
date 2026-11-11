"""Read the existing queue fence. No SQLite, local lease, RPC or new executor."""
from pathlib import Path
import json,hashlib,os,re,pwd
from native_pg import live_context,cgroup_of
class FenceError(RuntimeError):pass
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'))
def verify_values(job,registry,config,state,authority,boot):
 if not re.fullmatch('[a-f0-9]{32}',job):raise FenceError('invalid fixed job id')
 expected={'kind':registry['kind'],'source_commit':registry['source_commit'],'project_subdir':'site'}
 if config.get('id')!=job or config.get('payload')!=expected:raise FenceError('unexpected typed payload; arbitrary paths/env/commands refused')
 digest=hashlib.sha256(canonical(expected).encode()).hexdigest()
 if config.get('digest')!=digest:raise FenceError('config digest mismatch')
 generation=config.get('generation')
 if not isinstance(generation,int) or isinstance(generation,bool) or generation<1:raise FenceError('invalid generation')
 if authority.get('role')!='primary' or authority.get('generation')!=generation or authority.get('armed_boot_id')!=boot:raise FenceError('authority generation/boot fence failed')
 if state.get('id')!=job or state.get('state')!='running' or state.get('generation')!=generation or state.get('boot_id')!=boot:raise FenceError('running job fence failed')
 return {'id':job,'kind':registry['kind'],'generation':generation,'bootId':boot,'configDigest':digest,'sourceCommit':registry['source_commit']}
class WorkerContext:
 def __init__(self,job,registry,worker_root=Path('/srv/admin-v2-worker'),authority_root=Path('/srv/admin-v2-coordinator'),proc_root=Path('/proc')):
  self.job=job;self.registry=registry;self.worker_root=Path(worker_root);self.authority_root=Path(authority_root);self.proc_root=Path(proc_root)
  if not re.fullmatch('[a-f0-9]{32}',job):raise FenceError('invalid job id')
  self.folder=self.worker_root/'jobs'/job;self.cgroup='/system.slice/admin-v2-job-'+job+'.service'
 def read(self,path):
  if path.is_symlink() or not path.is_file() or path.resolve()!=path:raise FenceError('noncanonical queue metadata')
  return json.loads(path.read_text())
 def verify(self):
  if os.getuid()==0 or pwd.getpwuid(os.getuid()).pw_name!='vigia-worker':raise FenceError('worker only')
  boot=(self.proc_root/'sys/kernel/random/boot_id').read_text().strip();config=self.read(self.folder/'config.json');state=self.read(self.folder/'state.json');authority=self.read(self.authority_root/'authority.json')
  result=verify_values(self.job,self.registry,config,state,authority,boot)
  marker=self.folder/'execution.started'
  if marker.is_symlink() or not marker.is_file():raise FenceError('existing exclusive execution marker required')
  pid=state.get('pid')
  if not isinstance(pid,int) or pid<=0:raise FenceError('parent worker pid absent')
  proc=self.proc_root/str(pid);fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
  if proc.stat().st_uid!=os.getuid() or fields[0]=='Z' or fields[19]!=state.get('start_ticks') or cgroup_of(pid,self.proc_root)!=self.cgroup:raise FenceError('parent job process identity mismatch')
  result['limits']=live_context(self.cgroup);return result
