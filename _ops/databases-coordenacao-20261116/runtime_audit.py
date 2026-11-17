"""Read-only service identity audit; never export environment or process arguments."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def run(args):
    r=subprocess.run(args,capture_output=True,text=True,timeout=20)
    return r.returncode,r.stdout


def audit():
    rc,raw=run(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain','--no-pager'])
    units=[line.split()[0] for line in raw.splitlines() if any(t in line.split()[0].lower() for t in ['peticao','admin','a1','caddy','docker','waha','postgres','tailscale'])]
    services={}
    for u in units:
        _,text=run(['systemctl','show',u,'-p','MainPID','-p','InvocationID','-p','ActiveState','-p','SubState'])
        services[u]=dict(l.split('=',1) for l in text.splitlines() if '=' in l)
    paths=[Path('/etc/environment'),Path('/etc/profile')]+list(Path('/etc/profile.d').glob('*'))
    config={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}
    _,listeners=run(['ss','-H','-lnt'])
    containers=[]
    if shutil.which('docker'):
        code,ids=run(['docker','ps','-q'])
        if code==0 and ids.split():
            _,text=run(['docker','inspect','--format','{{.Id}} {{.Image}} {{.State.Pid}} {{.State.StartedAt}}']+ids.split())
            containers=sorted(text.splitlines())
    return {'services':services,'global_profile_hashes':config,'listeners':sorted(listeners.splitlines()),'containers':containers,'scope':'metadata_only_no_environment'}


if __name__=='__main__':print(json.dumps(audit()))
