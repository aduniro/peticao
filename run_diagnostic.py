import hashlib,importlib.util,json,os,shlex,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent.parent
SOURCE=BASE/'source'
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
ROOT='/mnt/apps/peticao-final/.runtime/civo-export-namespace-diagnostic-20261114'
UNIT='peticao-civo-export-namespace-diagnostic-20261114.service'
PUBLIC_HOST_KEY='/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-export-recovery/source/known_hosts'
OLD='/mnt/apps/peticao-final/.runtime/civo-export-c472-20261114-attempt2'
RETAINED='/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2'

def gate():
 cap=json.loads((BASE/'state/inspect-lease.private.json').read_text())['result']
 r=subprocess.run(['/usr/bin/python3',COORD,'check','--actor','apoio','--lease',cap['lease'],'--token',cap['token'],'--fence',str(cap['fence'])],capture_output=True,text=True,timeout=30);x=json.loads(r.stdout)
 if r.returncode or not x.get('ok') or x['result']['expires']-time.time()<180:raise RuntimeError('Own inspection lease required')

def ssh(command):
 gate()
 r=subprocess.run(['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','ConnectTimeout=12','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','HostKeyAlias=peticao-civo.tail1a6d71.ts.net','-o','UserKnownHostsFile='+PUBLIC_HOST_KEY,'-i','/home/barre/.ssh/id_ed25519_peticao_tailnet_v2','root@100.122.224.82',command],capture_output=True,text=True,timeout=150)
 if r.returncode:
  (BASE/'state/FAILED-TRANSPORT.json').write_text(json.dumps({'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr},indent=2));raise RuntimeError('Diagnostic SSH failed preserve evidence')
 return r.stdout,r.stderr

def main():
 os.umask(0o077);gate();journal=BASE/'state/ATTEMPT.json'
 with journal.open('x') as f:f.write(json.dumps({'phase':'submitting','root':ROOT,'unit':UNIT})+'\n')
 probe=(SOURCE/'probe.py').read_text()
 paths=[RETAINED,RETAINED+'/snapshot/site/.next',OLD,OLD+'/tools',OLD+'/inputs',ROOT,ROOT+'/work',ROOT+'/outputs','/run/docker.sock','/run/containerd','/var/lib/tailscale','/run/tailscale']
 command='/usr/bin/env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B -c '+shlex.quote(probe)+''.join(' --path '+shlex.quote(p) for p in paths)
 raw,stderr=ssh(command);host=json.loads(raw);(BASE/'state/HOST.json').write_text(json.dumps(host,indent=2)+'\n')
 prep="import pathlib,os,pwd; p=pathlib.Path("+repr(ROOT)+"); assert not p.exists() and not p.is_symlink() and p.parent.is_dir(); a=pwd.getpwnam('civo');p.mkdir(mode=0o750);p.chmod(0o750);os.chown(p,0,a.pw_gid);exec(\"for name in ['work','outputs','work/empty','work/tmp']:\\n q=p/name;q.mkdir(mode=0o700);os.chown(q,a.pw_uid,a.pw_gid)\")"
 ssh('/usr/bin/python3 -c '+shlex.quote(prep))
 # Exact same namespace/resource properties as export; only diagnostic output is piped instead of old logs.
 args=['systemd-run','--unit='+UNIT,'--wait','--pipe','--collect','--property=Type=oneshot','--property=User=civo','--property=Group=civo','--property=MemoryMax=8G','--property=CPUQuota=400%','--property=TasksMax=256','--property=TimeoutStartSec=120','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=ProtectHome=tmpfs','--property=PrivateNetwork=yes','--property=PrivateDevices=yes','--property=CapabilityBoundingSet=','--property=RestrictSUIDSGID=yes','--property=ProtectProc=invisible','--property=ReadWritePaths='+ROOT+'/work '+ROOT+'/outputs','--property=ReadOnlyPaths='+RETAINED+' '+OLD+'/tools '+OLD+'/inputs','--property=InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale','--property=TemporaryFileSystem=/tmp:ro /var/tmp:ro','--working-directory='+ROOT+'/work','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1','TMPDIR='+ROOT+'/work/tmp','TMP='+ROOT+'/work/tmp','TEMP='+ROOT+'/work/tmp','HOME='+ROOT+'/work/empty','/usr/bin/python3','-B','-c',probe]
 for p in paths:args+=['--path',p]
 raw,stderr=ssh(shlex.join(args));ns=json.loads(raw);(BASE/'state/NAMESPACE.json').write_text(json.dumps(ns,indent=2)+'\n');(BASE/'state/UNIT-RECEIPT.txt').write_text(stderr)
 journal.write_text(json.dumps({'phase':'complete','root':ROOT,'unit':UNIT,'probe_sha256':hashlib.sha256(probe.encode()).hexdigest()})+'\n')
 print(json.dumps({'diagnostic_complete':True,'export_executed':False,'evidence_dir':str(BASE/'state')}))
if __name__=='__main__':main()
