#!/usr/bin/python3 -I
"""Future root-only READ-ONLY fencing verifier; no stop/promote/start operations."""
from pathlib import Path
import datetime as dt,hashlib,importlib.util,json,os,shlex,socket,stat,subprocess,sys,time
LIB=Path('/opt/peticao-dev-fence')
POLICY=Path('/etc/peticao-dev-fence/operation.json')
KNOWN=Path('/etc/peticao-dev-fence/known_hosts')
IDENTITY=Path('/root/.ssh/id_ed25519_peticao_civo_node')
TARGET=Path('/srv/admin-v2-coordinator')
EXPECTED_CONTRACT_SHA='706a81a70c2539ff8f417ac245d36eae60e8e747d20c5a28437dad4ab9874c57'
EXPECTED_PROBE_SHA='73f9df3c67bd2490ae7b0828f5e60b86e0abe656cab7778487558486de4bd3d7'
EXPECTED_KNOWN_SHA='09875860bc82358b1fd913c9dbff9cb693e9a78577eca51e7a8d83e5fac8cbcb'
ARCHIVE=Path('/mnt/apps/peticao-final/_ops/civo-passive-restore-20261114-attempt2/checkpoint.tar.gz')

def trusted_metadata(path,mode=None):
 p=Path(path)
 if p.resolve()!=p or not p.is_file() or p.is_symlink():raise PermissionError('regular root file required')
 for q in [p,*p.parents]:
  st=q.stat()
  if st.st_uid!=0 or st.st_mode&0o022 or q.is_symlink():raise PermissionError('root-owned non-writable ancestry required')
 if mode is not None and stat.S_IMODE(p.stat().st_mode)!=mode:raise PermissionError('private mode required')
 return p

def public_bytes(path,pin=None,mode=None,limit=1048576):
 p=trusted_metadata(path,mode)
 if p.stat().st_size>limit:raise ValueError('bounded public metadata required')
 raw=p.read_bytes()
 if pin is not None and hashlib.sha256(raw).hexdigest()!=pin:raise ValueError('reviewed code/hostpin changed')
 return raw

def module(name,pin):
 p=LIB/(name+'.py');public_bytes(p,pin)
 spec=importlib.util.spec_from_file_location('qualified_dev_'+name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def ssh_command(probe):
 return ['/usr/bin/ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=5','-o','HostKeyAlias=[sonda-verifica3.tail1a6d71.ts.net]:2224','-o','UserKnownHostsFile='+str(KNOWN),'-i',str(IDENTITY),'-p','2224','root@100.80.18.81','/usr/bin/python3 -I -B -c '+shlex.quote(probe)]

def target_state(policy,helper):
 if policy.get('checkpoint_archive')!=str(ARCHIVE):raise ValueError('future operation must pin exact reviewed archive path')
 def data(name):
  p=TARGET/name
  if p.resolve()!=p or not p.is_file() or p.stat().st_uid!=999 or p.stat().st_mode&0o077:raise PermissionError('reviewed private restored state required')
  return json.loads(p.read_text())
 authority=data('authority.json');origin=data('recovery-origin.json');floor=data('generation-floor.json')['generation']
 archive=trusted_metadata(ARCHIVE,0o600)
 if archive.stat().st_size>512*1024**2:raise ValueError('bounded checkpoint required')
 with archive.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
 if sha!=policy['checkpoint_sha256']:raise ValueError('actual checkpoint changed')
 names=['admin-v2-coordinator.service','admin-v2-coordinator-standby.service',*helper.worker_inventory()]
 active=False
 for name in sorted(set(names)):
  state=helper.unit_state(name)
  if state['load_state']!='loaded' or state['active_state'] not in {'inactive','failed'} or state['main_pid']!=0 or state['cgroup_processes']!=0:raise ValueError('target not qualified passive service state')
 return {'host':socket.gethostname(),'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'role':authority['role'],'generation':authority['generation'],'armed_boot_id':authority.get('armed_boot_id'),'generation_floor':floor,'source_host':origin['source_host'],'snapshot_id':origin['snapshot_id'],'checkpoint_sha256':sha,'queue_facts':helper.database_facts(TARGET/'queue.sqlite'),'service_active':active,'active_workers':0,'epoch_control':helper.root_epoch_control()[0]}

def main():
 if os.geteuid()!=0 or socket.gethostname()!='peticao-civo':raise PermissionError('fixed DEV target root only')
 nonce=os.environ.get('ADMIN_CLUSTER_FENCE_NONCE','')
 raw=sys.stdin.buffer.read(65537)
 if len(raw)>65536:raise ValueError('bounded proof required')
 proof=json.loads(raw)
 contract=module('contract',EXPECTED_CONTRACT_SHA)
 policy=json.loads(public_bytes(POLICY,mode=0o600));contract.policy_ready(policy)
 probe=public_bytes(LIB/'source_probe.py',EXPECTED_PROBE_SHA).decode();helper=module('source_probe',EXPECTED_PROBE_SHA)
 public_bytes(KNOWN,EXPECTED_KNOWN_SHA);trusted_metadata(IDENTITY,0o600)  # No private content read; SSH alone consumes it.
 before=target_state(policy,helper);contract.target_ready(before,policy)
 request={k:policy[k] for k in ['operation_id','source_authority_uid','source_authority_gid','source_code_pins','queue_facts','checkpoint_sha256']};request['nonce']=nonce
 started=dt.datetime.now(dt.timezone.utc).isoformat();tick=time.monotonic()
 p=subprocess.run(ssh_command(probe),input=json.dumps(request),capture_output=True,text=True,timeout=20,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C.UTF-8'})
 received=dt.datetime.now(dt.timezone.utc).isoformat();elapsed=time.monotonic()-tick
 if p.returncode:raise RuntimeError('live SSH observation failed; no inference or retry')
 observation=json.loads(p.stdout)
 after=target_state(policy,helper)
 if before!=after:raise ValueError('target state changed during live fencing observation')
 result=contract.validate(proof,nonce,observation,policy,started,received,elapsed)
 print(json.dumps(result))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'confirmed':False,'error_type':type(e).__name__,'raw_error_not_recorded':True}),file=sys.stderr);sys.exit(1)
