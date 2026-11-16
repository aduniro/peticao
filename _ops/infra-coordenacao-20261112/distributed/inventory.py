#!/usr/bin/env python3
"""Bounded, read-only inventory. No credentials, environment dumps or job execution."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

HOSTS = {
    'local': None,
    'akamai': 'cluster-akamai-root',
    'santiago': 'cluster-santiago-root',
    'sp': 'cluster-sp-root',
    'waha': 'cluster-waha-root',
}

PROBE = r'''
import json, os, socket, sqlite3, subprocess
from datetime import datetime, timezone
from pathlib import Path

def run(argv, timeout=12):
    try:
        p=subprocess.run(argv,capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=timeout)
        return {'exit':p.returncode,'stdout':p.stdout[:131072], 'stderr':p.stderr[:2000]}
    except (OSError,subprocess.TimeoutExpired) as e:
        return {'error':type(e).__name__}

mem={}
for l in Path('/proc/meminfo').read_text().splitlines():
    k,v=l.split(':',1)
    if k in ['MemTotal','MemAvailable','SwapTotal','SwapFree']:
        mem[k]=int(v.split()[0])*1024
disk=os.statvfs('/')
out={'at':datetime.now(timezone.utc).isoformat(),'hostname':socket.gethostname(),
     'uid':os.getuid(),'cpu_count':os.cpu_count(),'load':list(os.getloadavg()),
     'memory_bytes':mem,'root_disk':{'total':disk.f_blocks*disk.f_frsize,'available':disk.f_bavail*disk.f_frsize},
     'services':{},'commands':{}}
for unit in ['peticao-k3s','admin-v2-coordinator','docker','tailscaled','peticao-tailnet-ssh']:
    out['services'][unit]=run(['systemctl','show',unit,'--no-pager','-p','LoadState','-p','ActiveState','-p','SubState','-p','MainPID','-p','User','-p','FragmentPath'])
for key,argv in {
    'docker_version':['docker','--version'],
    'docker_networks':['docker','network','ls','--format','{{json .}}'],
    'docker_containers':['docker','ps','--format','{{json .}}'],
    'addresses':['ip','-j','address'],
    'routes':['ip','-j','route','show','table','all'],
}.items():out['commands'][key]=run(argv)
queue=Path('/srv/admin-v2-coordinator/queue.sqlite')
out['queue']={'present':queue.is_file()}
if queue.is_file():
    try:
        db=sqlite3.connect(queue.as_uri()+'?mode=ro',uri=True,timeout=3)
        db.execute('PRAGMA query_only=ON')
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        out['queue']['tables']=tables
        if 'jobs' in tables:
            cols=[r[1] for r in db.execute('PRAGMA table_info(jobs)')]
            state=next((n for n in ['state','status'] if n in cols),None)
            out['queue']['job_count']=db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
            if state:out['queue']['states']=dict(db.execute('SELECT '+state+',COUNT(*) FROM jobs GROUP BY '+state))
        db.close()
    except sqlite3.Error as e:out['queue']['error']=type(e).__name__
k3s=Path('/usr/local/lib/peticao-k3s/k3s')
if k3s.is_file() and out['services']['peticao-k3s'].get('stdout','').find('ActiveState=active')>=0:
    candidates=[Path('/etc/rancher/k3s/k3s.yaml')]
    rancher=Path('/etc/rancher')
    if rancher.is_dir():candidates+=sorted(rancher.glob('*/*.yaml'))
    config=next((p for p in candidates if p.is_file() and p.name in ['k3s.yaml','kubeconfig.yaml']),None)
    out['kubernetes']={'kubeconfig_path':str(config) if config else None}
    if config:
        for kind in ['nodes','pods']:
            args=[str(k3s),'kubectl','--kubeconfig',str(config),'get',kind,'-o','json']
            if kind=='pods':args+=['-A']
            r=run(args,18)
            if r.get('exit')==0:
                try:
                    rows=json.loads(r['stdout'])['items']; result=[]
                    for v in rows:
                        m=v['metadata'];s=v.get('status',{})
                        result.append({'name':m['name'],'namespace':m.get('namespace'),
                          'phase':s.get('phase'),'node':v.get('spec',{}).get('nodeName'),
                          'conditions':[{k:c.get(k) for k in ['type','status','reason']} for c in s.get('conditions',[])],
                          'taints':v.get('spec',{}).get('taints',[]),
                          'allocatable':s.get('allocatable')})
                    out['kubernetes'][kind]=result
                except (ValueError,KeyError):out['kubernetes'][kind]={'parse_error':True}
            else:out['kubernetes'][kind]=r
print(json.dumps(out))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hosts', nargs='+', choices=list(HOSTS), default=list(HOSTS))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    summaries = {}
    for name in args.hosts:
        command = [sys.executable, '-'] if HOSTS[name] is None else [
            'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectTimeout=12', HOSTS[name], 'python3', '-']
        try:
            p = subprocess.run(command, input=PROBE, capture_output=True, text=True, timeout=150)
            if p.returncode:
                result = {'collection_error': 'process_exit', 'exit': p.returncode}
            else:
                result = json.loads(p.stdout)
        except (OSError, ValueError, subprocess.TimeoutExpired) as e:
            result = {'collection_error': type(e).__name__}
        dest = args.output / (name + '.json')
        with dest.open('x') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        summaries[name] = {k: result.get(k) for k in ['hostname', 'cpu_count', 'load', 'memory_bytes', 'root_disk', 'collection_error']}
        print(name + ': ' + ('ERROR' if result.get('collection_error') else 'collected'), flush=True)
    with (args.output / 'summary.json').open('x') as f:
        json.dump({'at': datetime.now(timezone.utc).isoformat(), 'hosts': summaries}, f, indent=2)
    print('Evidence: ' + str(args.output))


if __name__ == '__main__':
    main()
