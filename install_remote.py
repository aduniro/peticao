"""Bound normal deployment to the owner's exact Civo VM. No secrets stdout."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

BASE=Path(__file__).resolve().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
STAGE='/mnt/apps/peticao-final/_ops/civo-bootstrap-owner-20261114'
HOST='212.2.241.70'
ACTIVE_ARGS=None
SSH=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes',
     '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(BASE/'known_hosts'),
     '-i','/home/barre/.ssh/id_ed25519_peticao-civo20261114','civo@'+HOST]


def cli(args):
    r=subprocess.run(['python3',COORD,*args],capture_output=True,text=True,timeout=30)
    if r.returncode:raise RuntimeError('Canonical ledger rejected deployment')
    x=json.loads(r.stdout)
    if not x.get('ok'):raise RuntimeError('Canonical ledger rejected deployment')
    return x['result']


def gate(args):
    cap=json.loads(Path(args.lease_file).read_text())['result']
    cli(['check','--actor','admin-recuperacao','--lease',cap['lease'],
         '--token',cap['token'],'--fence',str(cap['fence'])])
    lease=next(x for x in cli(['status'])['leases'] if x['id']==cap['lease'])
    if lease['operation']!='deploy' or 'deploy:peticao-civo-bootstrap' not in lease['resources']:
        raise ValueError('Exact normal deployment lease required')
    event=cli(['history','--after-seq',str(args.manifest_event-1),'--limit','1'])[0]
    acquisition=cli(['history','--after-seq',str(cap['seq']-1),'--limit','1'])[0]
    if event['seq']!=args.manifest_event or acquisition['data']['manifest_event']!=args.manifest_event:
        raise ValueError('Lease/manifest mismatch')
    data=event['data'];binding=data['civo_bootstrap']
    if binding['instance_id']!='3d6e5117-e1db-4e7f-b97e-967a3ab91f0f' or binding['public_ip']!=HOST:
        raise ValueError('Wrong VM binding')
    head=subprocess.run(['git','-C',str(BASE),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    if head!=data['manifest']['commit']:raise ValueError('Source commit differs')
    for name,sha in data['file_sha256'].items():
        if Path(name).name!=name or hashlib.sha256((BASE/name).read_bytes()).hexdigest()!=sha:
            raise ValueError('Reviewed source changed')
    outer=Path('/mnt/apps/peticao-final/peticao-civo-bootstrap-completo.tar.gz')
    if hashlib.sha256(outer.read_bytes()).hexdigest()!=binding['archive_sha256']:
        raise ValueError('Encrypted archive changed')
    return binding


def remote(code,data=b'',timeout=60):
    gate(ACTIVE_ARGS)  # Fresh fence/manifest check before EVERY SSH operation.
    r=subprocess.run(SSH+['python3 -c '+shlex.quote(code)],input=data,capture_output=True,timeout=timeout)
    # Even error output is private: never print raw remote messages/argv.
    with (BASE/'remote.private.log').open('ab') as log:log.write(r.stderr)
    if r.returncode:raise RuntimeError('Remote operation failed; inspect private log')
    return r.stdout


def main(args):
    global ACTIVE_ARGS
    ACTIVE_ARGS=args
    binding=gate(args)
    if args.step=='stage':
        remote("import subprocess; subprocess.run(['sudo','-n','install','-d','-o','civo','-g','civo','-m','0700',"+repr(STAGE)+"],check=True)")
        code='''import sys,pathlib,hashlib,tarfile,io,os
p=pathlib.Path(STAGE);os.umask(0o077);raw=sys.stdin.buffer.read(2097152)
if hashlib.sha256(raw).hexdigest()!=EXPECTED:raise ValueError('Archive SHA mismatch')
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as a:
 names={'bootstrap.sh','credentials.tar.gpg','MANIFEST.json','restore_credentials.py','SHA256SUMS'}
 if {m.name for m in a.getmembers()}!=names or any(not m.isfile() for m in a.getmembers()):raise ValueError('Unexpected archive')
 a.extractall(p,filter='data')
import subprocess
subprocess.run(['sha256sum','-c','SHA256SUMS'],cwd=p,stdout=subprocess.DEVNULL,check=True)
print('stage_verified')
'''.replace('pathlib.Path(STAGE)','pathlib.Path('+repr(STAGE)+')').replace('!=EXPECTED','!='+repr(binding['archive_sha256']))
        result=remote(code,Path('/mnt/apps/peticao-final/peticao-civo-bootstrap-completo.tar.gz').read_bytes())
        # Unlock key travels separately over the pinned SSH channel, never in the tar.
        code="import os,sys; p="+repr(STAGE+'/unlock.key')+"; fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); os.write(fd,sys.stdin.buffer.read(4096)); os.close(fd); print('unlock_key_staged_privately')"
        remote(code,(BASE/'unlock.key').read_bytes())
        print(result.decode().strip())
    elif args.step=='start':
        command=['sudo','-n','systemd-run','--unit=peticao-bootstrap-owner-20261114',
                 '--property=Type=oneshot','--property=RemainAfterExit=yes','--property=TimeoutStartSec=2700',
                 '--property=StandardOutput=append:'+STAGE+'/operator.log',
                 '--property=StandardError=append:'+STAGE+'/operator.log',
                 '/usr/bin/bash',STAGE+'/bootstrap.sh','--apply','--new-vm','--user','civo']
        hashes=binding['remote_sha256']
        code='''import pathlib,hashlib,os,subprocess
p=pathlib.Path(STAGE)
if p.is_symlink():raise ValueError('Stage symlink')
for name,sha in HASHES.items():
 f=p/name
 if f.is_symlink() or not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=sha:raise ValueError('Remote artifact changed')
for f in p.iterdir():
 if f.is_symlink() or not f.is_file():raise ValueError('Unexpected stage member')
 os.chown(f,0,0);os.chmod(f,0o600)
os.chown(p,0,0);os.chmod(p,0o700)
subprocess.run(COMMAND,check=True)
print('bootstrap_started')
'''.replace('pathlib.Path(STAGE)','pathlib.Path('+repr(STAGE)+')').replace('HASHES',repr(hashes)).replace('COMMAND',repr(command))
        remote('import subprocess;subprocess.run(["sudo","-n","python3","-c",'+repr(code)+'],check=True)')
        print('bootstrap_started')
    elif args.step=='status':
        command=['systemctl','show','peticao-bootstrap-owner-20261114.service',
                 '-p','ActiveState','-p','SubState','-p','ExecMainStatus','-p','Result']
        print(remote('import subprocess;subprocess.run('+repr(command)+',check=True)').decode().strip())
    elif args.step=='finish':
        code='''import subprocess,json,pathlib,hashlib
p=pathlib.Path(STAGE)
for name,sha in HASHES.items():
 f=p/name
 if f.is_symlink() or not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=sha:raise ValueError('Remote artifact changed before restore')
x=subprocess.run(['systemctl','show','peticao-bootstrap-owner-20261114.service','-p','Result','--value'],capture_output=True,text=True,check=True)
y=subprocess.run(['systemctl','show','peticao-bootstrap-owner-20261114.service','-p','ActiveState','--value'],capture_output=True,text=True,check=True)
z=subprocess.run(['systemctl','show','peticao-bootstrap-owner-20261114.service','-p','SubState','--value'],capture_output=True,text=True,check=True)
if x.stdout.strip()!='success' or y.stdout.strip()!='active' or z.stdout.strip()!='exited':raise ValueError('Bootstrap not complete')
command=['sudo','-n','python3',str(p/'restore_credentials.py'),'--folder',str(p),'--key-file',str(p/'unlock.key'),'--user','civo']
subprocess.run(command,check=True)
key=p/'unlock.key';key.unlink()
status=subprocess.run(['sudo','-n','tailscale','status','--json'],capture_output=True,text=True)
try:running=json.loads(status.stdout).get('BackendState')=='Running'
except Exception:running=False
if not running:
 with (p/'tailscale-join.private.log').open('wb') as f:
  subprocess.run(['sudo','-n','tailscale','up','--auth-key=file:/home/civo/.config/peticao/credentials/sanciona-integral','--hostname=peticao-civo','--accept-dns=true'],stdout=f,stderr=f,check=True,timeout=120)
print('credentials_restored_and_tailnet_join_requested')
subprocess.run(['systemctl','stop','peticao-bootstrap-owner-20261114.service'],check=True)
'''.replace('pathlib.Path(STAGE)','pathlib.Path('+repr(STAGE)+')').replace('HASHES',repr(binding['remote_sha256']))
        print(remote('import subprocess;subprocess.run(["sudo","-n","python3","-c",'+repr(code)+'],check=True)',timeout=180).decode().strip())


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--lease-file',required=True)
    p.add_argument('--manifest-event',type=int,required=True)
    p.add_argument('--step',choices=['stage','start','status','finish'],required=True)
    try:main(p.parse_args())
    except Exception as error:
        print('Bound Civo operation failed: '+type(error).__name__)
        raise SystemExit(1)
