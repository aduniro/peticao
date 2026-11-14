"""Canonical normal-lease gate and exact-node SSH transport for mesh changes."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import time

BASE=Path(__file__).resolve().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'


def cli(args):
    p=subprocess.run(['python3',COORD,*args],capture_output=True,text=True,timeout=30)
    if p.returncode:raise RuntimeError('Canonical operation rejected')
    x=json.loads(p.stdout)
    if not x.get('ok'):raise RuntimeError('Canonical operation rejected')
    return x['result']


def gate(args):
    cap=json.loads(Path(args.lease_file).read_text())['result']
    cli(['check','--actor','admin-recuperacao','--lease',cap['lease'],'--token',cap['token'],'--fence',str(cap['fence'])])
    lease=next(x for x in cli(['status'])['leases'] if x['id']==cap['lease'])
    if lease['operation']!='deploy' or 'deploy:peticao-civo-mesh' not in lease['resources']:
        raise ValueError('Exact mesh deployment lease required')
    if lease['expires']-time.time()<240:raise ValueError('Renew own active lease before a node operation')
    acquisition=cli(['history','--after-seq',str(cap['seq']-1),'--limit','1'])[0]
    notice=cli(['history','--after-seq',str(args.manifest_event-1),'--limit','1'])[0]
    if acquisition['data']['manifest_event']!=args.manifest_event or notice['seq']!=args.manifest_event:
        raise ValueError('Wrong canonical manifest')
    data=notice['data'];head=subprocess.run(['git','-C',str(BASE),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    if head!=data['manifest']['commit']:raise ValueError('Source commit changed')
    for name,sha in data['file_sha256'].items():
        p=BASE/name
        if Path(name).name!=name or p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:
            raise ValueError('Reviewed mesh source/policy changed')
    return data


def main(args):
    data=gate(args);policy=json.loads((BASE/'POLICY.json').read_text())
    node=next(x for x in policy['nodes'] if x['name']==args.node)
    if args.node not in data['mesh_scope']['nodes']:raise ValueError('Node not delegated')
    if args.action=='guard' and args.node!='civo':raise ValueError('SSH guard delegated to Civo only')
    files={n:(BASE/n).read_text() for n in ['network_rules.py','apply_node.py','ssh_guard.py']}
    envelope={'policy':policy,'node':args.node,'operation':args.manifest_event,'client_private':{}}
    if args.node=='civo' and args.action=='apply':
        for role in ['user','root']:
            envelope['client_private'][role]=base64.b64encode((BASE/'keys'/('civo-'+role)).read_bytes()).decode()
    code='''import json,sys,pathlib,os,hashlib,subprocess
x=json.load(sys.stdin);os.umask(0o077)
if os.geteuid()!=0:raise ValueError('Root receiver required')
root=pathlib.Path('/var/lib/peticao-mesh-v3')/('source-'+str(OPERATION));root.mkdir(parents=True,exist_ok=True,mode=0o700)
for name,text in x['files'].items():
 if name not in HASHES or hashlib.sha256(text.encode()).hexdigest()!=HASHES[name]:raise ValueError('Source bytes changed in transport')
 p=root/name
 if p.is_symlink():raise ValueError('Source symlink')
 p.write_text(text);p.chmod(0o600)
script='apply_node.py' if ACTION=='apply' else 'ssh_guard.py'
payload=x['envelope'] if ACTION=='apply' else x['envelope']['policy']
r=subprocess.run(['/usr/bin/python3','-B',str(root/script)],input=json.dumps(payload),text=True,capture_output=True,timeout=150)
(root/'last.private.log').write_text(r.stderr)
if r.returncode:raise RuntimeError('Mesh receiver failed: '+r.stdout[-120:])
print(r.stdout.strip())
'''.replace('OPERATION',str(args.manifest_event)).replace('HASHES',repr({n:data['file_sha256'][n] for n in files})).replace('ACTION',repr(args.action))
    wire=json.dumps({'files':files,'envelope':envelope}).encode()
    gate(args)  # Revalidate immediately before each mutating root command.
    if args.node=='local':
        command=['sudo','-n','python3','-c',code]
    elif args.node=='civo':
        command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12','-o','IdentitiesOnly=yes',
                 '-o','StrictHostKeyChecking=yes','-o','HostKeyAlias=212.2.241.70',
                 '-o','UserKnownHostsFile='+str(BASE.parent/'civo-owner-bundle-20261114/known_hosts'),
                 '-i','/home/barre/.ssh/id_ed25519_peticao-civo20261114','civo@100.122.224.82',
                 'sudo -n python3 -c '+shlex.quote(code)]
    else:
        command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12',node['operator_alias'],
                 'python3 -c '+shlex.quote(code)]
    result=subprocess.run(command,input=wire,capture_output=True,timeout=180)
    with (BASE/'transport.private.log').open('ab') as f:f.write(result.stderr)
    if result.returncode:raise RuntimeError('Bound node operation failed; reconcile private result before retry')
    receipt=json.loads(result.stdout);(BASE/('RESULT-'+args.node+'-'+args.action+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--node',required=True)
    p.add_argument('--action',choices=['apply','guard'],default='apply')
    p.add_argument('--lease-file',required=True);p.add_argument('--manifest-event',type=int,required=True)
    try:main(p.parse_args())
    except Exception as error:
        print('Mesh driver failed: '+type(error).__name__)
        raise SystemExit(1)
