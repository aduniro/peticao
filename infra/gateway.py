#!/usr/bin/python3
import os,sys,json,subprocess,pathlib,socket,hashlib,base64,tempfile,datetime
ROLE='primary' if socket.gethostname().split('.')[0]=='sonda-verifica3' else 'standby'
ROOT=pathlib.Path('/srv/admin-v2-coordinator' if ROLE=='primary' else '/srv/admin-v2-coordinator-standby')
os.environ['ADMIN_CLUSTER_ROOT']=str(ROOT)
os.environ['ADMIN_WORKER_ROOT']='/srv/admin-v2-worker' if ROLE=='primary' else str(ROOT/'recovered-worker')
os.environ['ADMIN_CLUSTER_DISPATCH']='1' if ROLE=='primary' else '0'
os.umask(0o007)
def main():
 raw=sys.stdin.buffer.read(360*1024*1024+1)
 if len(raw)>360*1024*1024:raise ValueError('request_too_large')
 data=json.loads(raw);action=data.get('action')
 peer=os.environ.get('SSH_CONNECTION','').split()
 if ROLE=='primary' and peer and peer[0]=='100.109.6.122' and action not in ('fence-info','node-info'):raise PermissionError('recovery_peer_read_only')
 authority=json.loads((ROOT/'authority.json').read_text())
 effective=authority.get('role') if authority.get('armed_boot_id')==pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip() else 'suspended'
 if action=='fence-info':
  service=subprocess.run(['/usr/bin/systemctl','is-active','admin-v2-coordinator.service'],capture_output=True,text=True).stdout.strip()
  units=subprocess.run(['/usr/bin/systemctl','list-units','--state=active,activating','--no-legend','--plain','admin-v2-job-*.service'],capture_output=True,text=True,check=True).stdout.splitlines()
  return {'active_workers':len(units),'hostname':socket.gethostname(),'generation':authority.get('generation'),'role':authority.get('role'),'service':service,'fenced':authority.get('role')=='suspended' and service in ('inactive','failed','unknown') and not units,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if action=='node-info':
  return {'hostname':socket.gethostname(),'role':ROLE,'authority':json.loads((ROOT/'authority.json').read_text()),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if action=='replica-info':
  p=ROOT/'replication.json';return json.loads(p.read_text()) if p.exists() else {'state':'no_snapshot'}
 if action=='replica-ingest':
  if ROLE!='standby' or effective=='primary' or os.environ.get('SSH_CONNECTION','').split()[0]!='100.80.18.81':raise PermissionError('replication_source_rejected')
  value=base64.b64decode(data['archive_base64'],validate=True)
  if len(value)>250*1024*1024:raise ValueError('snapshot_too_large')
  sha=hashlib.sha256(value).hexdigest()
  if sha!=data['sha256']:raise ValueError('checksum_mismatch')
  dest=ROOT/'snapshots';dest.mkdir(mode=0o770,exist_ok=True)
  used=sum(p.stat().st_size for p in dest.iterdir() if p.is_file())
  path=dest/(sha+'.tar.gz')
  if not path.exists():
   if used+len(value)>2*1024**3:raise ValueError('standby_storage_budget_exceeded')
   tmp=dest/('.'+sha);tmp.write_bytes(value)
   result=subprocess.run(['/usr/bin/python3','/opt/admin-v2-cluster/recovery.py','verify','--snapshot',str(tmp)],capture_output=True,text=True)
   if result.returncode:tmp.unlink(missing_ok=True);raise ValueError('invalid_snapshot')
   tmp.replace(path)
  state={'state':'replicated','sha256':sha,'path':str(path),'received_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'sonda-verifica3'}
  t=ROOT/'replication.json.tmp';t.write_text(json.dumps(state));t.replace(ROOT/'replication.json');return state
 if effective!='primary' and action not in ['health','status','jobs','logs']:
  raise PermissionError('standby_does_not_accept_work')
 p=subprocess.run(['/usr/bin/python3','/opt/admin-v2-cluster/coordinator.py','rpc'],input=json.dumps(data),text=True,capture_output=True,env=os.environ)
 if not p.stdout.strip():raise RuntimeError('coordinator_unavailable')
 result=json.loads(p.stdout)
 if p.returncode and 'error' not in result:raise RuntimeError('coordinator_failed')
 return result
if __name__=='__main__':
 try:print(json.dumps(main()))
 except Exception as e:print(json.dumps({'error':str(e),'error_type':type(e).__name__}));sys.exit(1)
