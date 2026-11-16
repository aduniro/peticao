"""Scoped Neon setup; secret values stay in private files and memory."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

HELPER=Path.home()/'.local/bin/peticao-credentials'
PROJECT='lingering-shape-35933425'
BRANCH='coordination-validation-20261116'
PRIVATE=Path.home()/'.config/peticao/databases'
EVIDENCE=Path(__file__).parent/'evidence'


class Api:
    def __init__(self, credential):
        path=subprocess.check_output([str(HELPER),'path',credential],text=True).strip()
        self.key=Path(path).read_text().strip()

    def call(self,path,body=None):
        req=urllib.request.Request('https://console.neon.tech/api/v2/'+path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization':'Bearer '+self.key,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=40) as r:return json.load(r)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'neon_http_{e.code}:{path.split("?")[0]}') from None

    def pages(self,path,field):
        if 'limit=' not in path:path+=('&' if '?' in path else '?')+'limit=100'
        rows=[];cursor=None;seen=set()
        for _ in range(100):
            q=('&' if '?' in path else '?')+'cursor='+urllib.parse.quote(cursor) if cursor else ''
            x=self.call(path+q)
            if x.get('unavailable'):raise RuntimeError('partial_unavailable_projects')
            rows.extend(x[field]);cursor=x.get('pagination',{}).get('cursor')
            if len(x[field])<100:return rows
            if not cursor:return rows
            if cursor in seen:raise RuntimeError('pagination_cycle')
            seen.add(cursor)
        raise RuntimeError('pagination_limit')


def save(path,value,private=False):
    path.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
    if private:path.parent.chmod(0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f,ensure_ascii=False,indent=2)


def inventory():
    out={'at':datetime.now(timezone.utc).isoformat(),'accounts':[]}
    for key,org in [('api/peticao-neon1','org-fragrant-dawn-99551288'),('api/peticao-neon2-adunir','org-tiny-recipe-04870472')]:
        api=Api(key);orgs=api.call('users/me/organizations')['organizations']
        projects=api.pages('projects?limit=100&org_id='+org,'projects')
        item={'credential_id':key,'organizations':[{k:o.get(k) for k in ['id','name','plan']} for o in orgs], 'projects':[],'pagination_complete':True}
        for p in projects:
            data=api.call('projects/'+p['id'])['project']
            # An explicit metadata allowlist keeps response additions from leaking credentials.
            fields=['id','name','org_id','region_id','pg_version','quota_reset_at','default_endpoint_settings',
                    'data_transfer_bytes','written_data_bytes','compute_time_seconds','active_time','synthetic_storage_size','quota','quotas']
            item['projects'].append({k:data[k] for k in fields if k in data})
        try:
            # Usage-based endpoint may be unavailable on Free: record, do not infer unused quota.
            item['consumption']=api.call('consumption_history/v2/projects?org_id='+org+'&from=2026-11-01T00%3A00%3A00Z&to=2026-11-16T00%3A00%3A00Z&granularity=daily&metrics=compute_unit_seconds,public_network_transfer_bytes')
        except RuntimeError as e:item['consumption_error']=str(e)
        out['accounts'].append(item)
    save(EVIDENCE/'NEON-INVENTORY.json',out)
    print(json.dumps(out,ensure_ascii=False))


def provision():
    api=Api('api/peticao-neon1')
    branches=api.pages(f'projects/{PROJECT}/branches','branches')
    existing=[b for b in branches if b['name']==BRANCH]
    if existing:
        branch=existing[0]
    else:
        parent=next(b for b in branches if b.get('default'))
        result=api.call(f'projects/{PROJECT}/branches',{
            'branch':{'name':BRANCH,'parent_id':parent['id']},
            # Free plan controls suspension itself; overriding it is rejected with HTTP 412.
            'endpoints':[{'type':'read_write','autoscaling_limit_min_cu':0.25,'autoscaling_limit_max_cu':0.25}]})
        branch=result['branch']
        save(EVIDENCE/'BRANCH-CREATED.json',{k:branch[k] for k in ['id','name','parent_id','project_id']})
    bid=branch['id']
    # Reuse the branch-local owner; do not alter existing role credentials.
    roles=api.call(f'projects/{PROJECT}/branches/{bid}/roles')['roles']
    databases=api.call(f'projects/{PROJECT}/branches/{bid}/databases')['databases']
    owners={d['owner_name'] for d in databases}
    candidates=[r['name'] for r in roles if r['name'] in owners]
    if len(candidates)!=1:raise RuntimeError('ambiguous_database_owner')
    owner=candidates[0]
    if not any(d['name']=='peticao_coordination' for d in databases):
        api.call(f'projects/{PROJECT}/branches/{bid}/databases',{'database':{'name':'peticao_coordination','owner_name':owner}})
    cfg={'mode':'isolated','project_id':PROJECT,'branch_id':bid,'database':'peticao_coordination'}
    for pooled,key in [(False,'direct_uri'),(True,'pooled_uri')]:
        query=urllib.parse.urlencode({'branch_id':bid,'database_name':cfg['database'],'role_name':owner,'pooled':str(pooled).lower()})
        uri=api.call(f'projects/{PROJECT}/connection_uri?'+query)['uri']
        cfg[key]=uri
    save(PRIVATE/'config.json',cfg,private=True)
    eps=api.call(f'projects/{PROJECT}/endpoints')['endpoints']
    safe={'project_id':PROJECT,'branch_id':bid,'branch_name':BRANCH,'database':cfg['database'],'mode':'isolated',
          'config_path':str(PRIVATE/'config.json'),
          'endpoints':[{k:e.get(k) for k in ['id','host','branch_id','autoscaling_limit_min_cu','autoscaling_limit_max_cu','suspend_timeout_seconds','current_state']}
                       for e in eps if e['branch_id']==bid]}
    save(EVIDENCE/'TARGET.json',safe)
    print(json.dumps(safe))


if __name__=='__main__':
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('command',choices=['inventory','provision']);a=p.parse_args()
    try:inventory() if a.command=='inventory' else provision()
    except RuntimeError as e:print(json.dumps({'error':str(e)}));raise SystemExit(2)
    except Exception as e:print(json.dumps({'error':type(e).__name__}));raise SystemExit(3)
