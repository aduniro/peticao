"""Persist allocation identity on Akamai from OWN completed POST responses.

No project-name lookup or timestamp inference is ownership evidence. Partial
intentions never become IDs. A dropped SSH connection can safely rebuild this
receipt from a completed local creation journal without repeating any POST.
"""
from datetime import datetime,timezone
import json
import os
from pathlib import Path

from durable_api import atomic
from financial_guard import deadlines
from provision_steps import owned_id,HOSTNAME,NETWORK


def allocation_clock(root):
    root=Path(root);path=root/'allocation-clock.json'
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:
        if path.is_symlink():raise ValueError('Clock symlink refused')
        return json.loads(path.read_text())['allocated_at']
    value={'allocated_at':datetime.now(timezone.utc).isoformat()}
    with os.fdopen(fd,'w') as handle:
        json.dump(value,handle);handle.flush();os.fsync(handle.fileno())
    directory=os.open(root,os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
    return value['allocated_at']


def reconcile(root,policy):
    root=Path(root);journal=root/'journal'
    ident=owned_id(journal,'create-instance','/v2/instances')
    clock_path=root/'allocation-clock.json'
    if not clock_path.is_file() or clock_path.is_symlink():raise ValueError('Owned allocation clock missing')
    allocated_at=json.loads(clock_path.read_text())['allocated_at']
    resources=[{'kind':'instances','id':ident,'creation_key':'create-instance',
                'expected':{'hostname':HOSTNAME,'size':'g4c.medium','network_id':NETWORK}}]
    volume_path=journal/'create-volume.json'
    if volume_path.exists():
        entry=json.loads(volume_path.read_text())
        if entry.get('state')=='completed':
            vid=owned_id(journal,'create-volume','/v2/volumes')
            resources.append({'kind':'volumes','id':vid,'creation_key':'create-volume',
                              'expected':{'name':'peticao-civo-worker-data','size_gb':200}})
        elif entry.get('state')!='pending':raise ValueError('Unknown partial volume journal state')
    schedule=deadlines(policy['grant'],policy['quote'],allocated_at)
    path=root/'allocation.json'
    result={'account_scope_id':policy['account_scope_id'],'resources':resources,'schedule':schedule,
            'lifecycle_phase':'bootstrap-pending','worker_tailnet_ip':None,
            'creation_response_bound':True,'development_jobs_enabled':False}
    if path.exists():
        if path.is_symlink():raise ValueError('Allocation receipt symlink refused')
        old=json.loads(path.read_text())
        if (old.get('account_scope_id')!=result['account_scope_id'] or old.get('schedule')!=schedule
                or not any(x.get('kind')=='instances' and x.get('id')==ident for x in old.get('resources',[]))):
            raise ValueError('Existing allocation cannot be adopted or rebased')
        known={(x['kind'],x['id']) for x in resources}
        if any((x.get('kind'),x.get('id')) not in known for x in old['resources']):
            raise ValueError('Existing receipt contains unrelated resource')
        result.update({k:v for k,v in old.items() if k not in {'resources','schedule','account_scope_id'}})
    atomic(path,result)
    return {'instance_id':ident,'resource_count':len(resources),'receipt_durable':True}
