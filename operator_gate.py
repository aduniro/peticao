"""Issue one short-lived cloud step permit after checking the REAL local ledger.

The capability token stays on the owner's computer and never enters the model,
cloud permit, logs or command output. Failure messages never contain argv.
"""
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import subprocess

COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
DESTINATION='deploy:peticao-civo-worker-nyc1'


def cli(args):
    try:result=subprocess.run(['python3',COORD,*args],capture_output=True,text=True,timeout=30)
    except Exception:raise RuntimeError('Canonical lease check failed') from None
    if result.returncode:raise RuntimeError('Canonical ledger rejected operation')
    result=json.loads(result.stdout)
    if not result.get('ok'):raise RuntimeError('Canonical ledger rejected operation')
    return result['result']


def issue(capability_file,manifest_event,source,request,policy_sha):
    value=json.loads(Path(capability_file).read_text());cap=value.get('result',value)
    cli(['check','--actor','admin-recuperacao','--lease',cap['lease'],
         '--token',cap['token'],'--fence',str(cap['fence'])])
    status=cli(['status'])
    lease=next((x for x in status['leases'] if x['id']==cap['lease']),None)
    if (not lease or lease['state']!='active' or lease['operation']!='deploy'
            or DESTINATION not in lease['resources']):
        raise ValueError('Own active Civo deployment lease required')
    acquisition=cli(['history','--after-seq',str(cap['seq']-1),'--limit','1'])[0]
    if acquisition.get('data',{}).get('manifest_event')!=manifest_event:
        raise ValueError('Lease belongs to another deployment manifest')
    notice=cli(['history','--after-seq',str(manifest_event-1),'--limit','1'])[0]
    if notice.get('seq')!=manifest_event or notice.get('kind')!='notice' or DESTINATION not in notice['resources']:
        raise ValueError('Immutable Civo deployment notice missing')
    manifest=notice['data'].get('manifest',{});hashes=notice['data'].get('file_sha256',{})
    source=Path(source)
    result=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,timeout=10)
    if result.returncode or manifest.get('commit')!=result.stdout.strip():
        raise ValueError('Working source differs from reviewed commit')
    required={'provision_steps.py','deploy_permit.py','operator_gate.py','durable_api.py',
              'financial_guard.py','financial_runtime.py','runtime_main.py','exclusive_inventory.py',
              'usage_observer.py','ssh_adapter.py','worker_lifecycle.py','queue_finance.py'}
    files=manifest.get('files',[])
    if not required.issubset(files):raise ValueError('Reviewed source closure incomplete')
    for name in files:
        if Path(name).name!=name:raise ValueError('Unsafe manifest file path')
        target=source/name
        if target.is_symlink() or not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=hashes.get(name):
            raise ValueError('Reviewed source hash mismatch')
    now=datetime.now(timezone.utc);lease_expires=datetime.fromtimestamp(lease['expires'],timezone.utc)
    expires=min(now+timedelta(seconds=45),lease_expires)
    if expires-now<timedelta(seconds=15):raise ValueError('Insufficient live lease remaining')
    return {'authority':'normal-deploy-lease-checked','manifest_event':manifest_event,
            'lease_fence':cap['fence'],'lease_expires_at':lease_expires.isoformat(),
            'issued_at':now.isoformat(),'expires_at':expires.isoformat(),'policy_sha256':policy_sha,
            'source_commit':manifest['commit'],
            'request_sha256':hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()}
