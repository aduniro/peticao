#!/usr/bin/env python3
"""Execute once after independent Root ACK, own reservation and immutable source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time
ROOT=Path(__file__).resolve().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
RESOURCE='deploy:civo-neon-infra-readonly-verify'

def ledger(*args):
 p=subprocess.run(['/usr/bin/python3',COORD,*args],capture_output=True,text=True,timeout=30)
 r=json.loads(p.stdout)
 if p.returncode or not r.get('ok'):raise PermissionError('ledger refused')
 return r['result']

def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(ROOT),*args],text=True).strip()

def authorize(capfile,event):
 st=capfile.lstat()
 if capfile.is_symlink() or st.st_uid!=os.getuid() or st.st_mode&0o077:raise PermissionError('private own capability required')
 cap=json.loads(capfile.read_text())['result']
 ledger('check','--actor','apoio','--lease',cap['lease'],'--token',cap['token'],'--fence',str(cap['fence']))
 lease=next(x for x in ledger('status')['leases'] if x['id']==cap['lease'])
 if lease['actor']!='apoio' or lease['operation']!='test' or RESOURCE not in lease['resources'] or lease['expires']-time.time()<300:raise PermissionError('own exact test reservation with300s margin required')
 acquisition=ledger('history','--after-seq',str(cap['seq']-1),'--limit','1')[0]
 if acquisition['kind']!='lease_acquired' or acquisition['data'].get('lease')!=cap['lease'] or acquisition['data'].get('manifest_event')!=event:raise PermissionError('reservation bound to notice required')
 notice=ledger('history','--after-seq',str(event-1),'--limit','1')[0]
 if notice['kind']!='notice' or notice['seq']!=event or notice['actor']!='apoio':raise PermissionError('own immutable notice required')
 data=notice['data']; tracked=git('ls-files').splitlines()
 hashes={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in tracked if not (ROOT/n).is_symlink()}
 if git('status','--porcelain') or git('rev-parse','HEAD')!=data['manifest']['commit'] or hashes!=data['file_sha256']:raise PermissionError('source mismatch')
 cursor=event; ack=False
 while True:
  events=ledger('history','--after-seq',str(cursor),'--limit','200')
  if not events:break
  ack|=any(e['kind']=='ack' and e['actor']=='admin-recuperacao' and e['data'].get('event_seq')==event for e in events)
  cursor=events[-1]['seq']
  if len(events)<200:break
 if not ack:raise PermissionError('independent Root ACK required')
 return {'lease':cap['lease'],'fence':cap['fence'],'manifest_event':event,'actor':'apoio','commit':git('rev-parse','HEAD')}

def execute(capfile,event,output):
 execution=authorize(capfile,event)
 request={'execution':execution}
 code=(ROOT/'verify.py').read_text()
 with output.open('x') as f:
  os.chmod(output,0o600)
  f.write(json.dumps({'phase':'transport_started','execution':execution})+'\n');f.flush();os.fsync(f.fileno())
  cmd=['/usr/bin/ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','ConnectTimeout=15','-o','HostKeyAlias=peticao-civo.tail1a6d71.ts.net','-o','UserKnownHostsFile='+str(ROOT/'known_hosts'),'-i','/home/barre/.ssh/id_ed25519_peticao_tailnet_v2','civo@100.122.224.82','/usr/bin/python3 -c '+shlex.quote(code)]
  try:
   p=subprocess.run(cmd,input=json.dumps(request),capture_output=True,text=True,timeout=180)
   result={'exit':p.returncode,'stdout':p.stdout,'stderr_present':bool(p.stderr), 'raw_stderr_not_recorded':True,'automatic_retry':False,'execution':execution}
  except (subprocess.TimeoutExpired,OSError) as e:
   result={'transport_uncertain':True,'error':type(e).__name__,'automatic_retry':False,'execution':execution}
  f.seek(0);f.truncate();f.write(json.dumps(result,indent=2)+'\n')
 return {'record':str(output),'exit':result.get('exit'),'uncertain':result.get('transport_uncertain',False)}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--lease',type=Path,required=True);p.add_argument('--manifest',type=int,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();
 try:print(json.dumps(execute(a.lease,a.manifest,a.output)))
 except Exception as e:print(json.dumps({'ok':False,'error_type':type(e).__name__,'raw_error_not_recorded':True}));raise SystemExit(1)
