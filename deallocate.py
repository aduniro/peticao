#!/usr/bin/env python3
"""One exact Azure deallocation; no create/start/stop/delete or automatic retry."""
import argparse,hashlib,json,os,shlex,subprocess,time
from pathlib import Path
from idle_guard import idle,window
ROOT=Path(__file__).resolve().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
SUB='57298c3f-7cf2-4dbe-9884-c7bafdff4478';RG='peticao-dev-eastus';VM='peticao-azure-dev-01'
ID=f'/subscriptions/{SUB}/resourceGroups/{RG}/providers/Microsoft.Compute/virtualMachines/{VM}'
RESOURCE='deploy:azure-dev-idle'
ART='/mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1/exports/build-1/runtime.tar'
ART_SHA='7e204c3666e8c44258cb5b10edab42066951a5fdc143781d3dd48779475a5557'
QUERY='{id:id,location:location,size:hardwareProfile.vmSize,osDisk:storageProfile.osDisk.managedDisk.id,ephemeralOS:storageProfile.osDisk.diffDiskSettings,network:networkProfile,publicIps:publicIps,tags:tags,powerState:powerState,provisioningState:provisioningState}'

def ledger(*args):
 p=subprocess.run(['/usr/bin/python3',COORD,*args],capture_output=True,text=True,timeout=30);r=json.loads(p.stdout)
 if p.returncode or not r.get('ok'):raise PermissionError('ledger refused')
 return r['result']

def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(ROOT),*args],text=True).strip()

def authorize(capfile,event):
 st=capfile.lstat()
 if capfile.is_symlink() or st.st_uid!=os.getuid() or st.st_mode&0o077:raise PermissionError('private own capability required')
 cap=json.loads(capfile.read_text())['result']
 ledger('check','--actor','apoio','--lease',cap['lease'],'--token',cap['token'],'--fence',str(cap['fence']))
 l=next(x for x in ledger('status')['leases'] if x['id']==cap['lease'])
 if l['actor']!='apoio' or l['operation']!='deploy' or RESOURCE not in l['resources'] or l['expires']-time.time()<600:raise PermissionError('own exact deploy lease with600s margin required')
 a=ledger('history','--after-seq',str(cap['seq']-1),'--limit','1')[0]
 if a['kind']!='lease_acquired' or a['data'].get('lease')!=cap['lease'] or a['data'].get('manifest_event')!=event:raise PermissionError('manifest-bound acquisition required')
 n=ledger('history','--after-seq',str(event-1),'--limit','1')[0]
 if n['seq']!=event or n['kind']!='notice' or n['actor']!='apoio':raise PermissionError('own notice required')
 hashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in git('ls-files').splitlines() if not (ROOT/p).is_symlink()}
 if git('status','--porcelain') or n['data']['manifest']['commit']!=git('rev-parse','HEAD') or n['data']['file_sha256']!=hashes:raise PermissionError('source drift')
 cursor=event;ack=False
 while True:
  events=ledger('history','--after-seq',str(cursor),'--limit','200')
  if not events:break
  ack|=any(x['actor']=='admin-recuperacao' and x['kind']=='ack' and x['data'].get('event_seq')==event for x in events)
  cursor=events[-1]['seq']
  if len(events)<200:break
 if not ack:raise PermissionError('independent Root ACK required')
 return {'lease':cap['lease'],'fence':cap['fence'],'manifest':event}

def az(args,timeout=90):
 p=subprocess.run(['/usr/bin/az',*args,'--subscription',SUB,'--only-show-errors','-o','json'],capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Azure CLI failed: '+p.stderr[-2000:])
 return json.loads(p.stdout) if p.stdout.strip() else None

def vm():
 v=az(['vm','show','-g',RG,'-n',VM,'--show-details','--query',QUERY])
 if v['id'].lower()!=ID.lower() or v['tags'].get('Operation')!='APOIO-AZURE-20261114' or v['size']!='Standard_E8ads_v7' or v['ephemeralOS'] is not None or not v['osDisk']:raise ValueError('unexpected VM identity/persistent storage')
 return v

def invariant(v):return {k:v[k] for k in ['id','location','size','osDisk','ephemeralOS','network','publicIps','tags']}

def fresh():
 code=(ROOT/'observe.py').read_text()
 probe='''from pathlib import Path
import json,hashlib,subprocess
r=sample()
p=Path(ART)
if p.is_symlink() or not p.is_file():raise ValueError('regular export required')
h=hashlib.sha256()
with p.open('rb') as f:
 for c in iter(lambda:f.read(4*1024*1024),b''):h.update(c)
r['artifact']={'sha256':h.hexdigest(),'bytes':p.stat().st_size,'path':str(p)}
r['build_status']=subprocess.check_output(['/usr/bin/systemctl','show','peticao-azure-qualified-build-20261114-attempt1.service','-p','MainPID','-p','ExecMainStatus','-p','ActiveState','-p','SubState'],text=True)
print(json.dumps(r))'''.replace('ART',repr(ART))
 code=code.split("if __name__=='__main__':")[0]+'\n'+probe
 cmd=['/usr/bin/ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','ConnectTimeout=15','-o','HostKeyAlias=20.85.215.204','-o','UserKnownHostsFile='+str(ROOT/'known_hosts'),'-i','/home/barre/.ssh/id_ed25519_peticao_tailnet_v2','builder@100.76.178.21','/usr/bin/sudo -n /usr/bin/python3 -u -']
 p=subprocess.run(cmd,input=code,capture_output=True,text=True,timeout=60)
 if p.returncode:raise RuntimeError('fresh occupancy probe failed:'+p.stderr[-1000:])
 r=json.loads(p.stdout);idle(r)
 if r['artifact']['sha256']!=ART_SHA or r['artifact']['bytes']!=475893760:raise ValueError('export custody mismatch')
 fields=dict(line.split('=',1) for line in r['build_status'].splitlines())
 if fields.get('MainPID')!='0' or fields.get('ExecMainStatus')!='0' or fields.get('SubState')!='exited':raise ValueError('build not successfully exited')
 return r

def execute(cap,event,samples,output):
 authority=authorize(cap,event)
 with output.open('x') as f:
  os.chmod(output,0o600)
  r={'phase':'checking','authority':authority,'automatic_retry':False}
  def save():f.seek(0);f.truncate();f.write(json.dumps(r,indent=2)+'\n');f.flush();os.fsync(f.fileno())
  save()
  try:
   before=vm();r['before']=before;save()
   if before['powerState']=='VM deallocated':r['phase']='already_deallocated_no_action';save();return r['phase']
   if before['powerState']!='VM running':raise ValueError('unexpected transitional power state; no action')
   rows=[json.loads(x) for x in samples.read_text().splitlines()];r['window']=window(rows);r['sample_sha256']=hashlib.sha256(samples.read_bytes()).hexdigest()
   r['fresh']=fresh();save()
   if time.time()-r['fresh']['unix']>15:raise ValueError('fresh probe too old')
   authority=authorize(cap,event)
   if time.time()-r['fresh']['unix']>15:raise ValueError('fresh probe expired during fencing')
   r['phase']='deallocation_requested';save()
   az(['vm','deallocate','-g',RG,'-n',VM,'--no-wait'])
   for _ in range(30):
    after=vm();r['after']=after;save()
    if invariant(after)!=invariant(before):raise ValueError('persistent configuration changed; inspect without recovery')
    if after['powerState']=='VM deallocated':r['phase']='deallocated_verified_persistent_resources_unchanged';save();return r['phase']
    time.sleep(5)
   raise TimeoutError('deallocation pending; inspect without repeat')
  except Exception as e:
   r.update(error=type(e).__name__,detail=str(e),uncertain=r['phase']=='deallocation_requested');save();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--lease',type=Path,required=True);p.add_argument('--manifest',type=int,required=True);p.add_argument('--samples',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps({'phase':execute(a.lease,a.manifest,a.samples,a.output)}))
