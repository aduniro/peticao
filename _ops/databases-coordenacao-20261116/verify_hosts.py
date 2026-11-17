"""Independent read-only checks of deployed profiles on all sixteen accounts."""
import concurrent.futures
import json
from pathlib import Path
import shlex
import subprocess
from deployment import HOSTS
from neon_admin import EVIDENCE,save

PROBE='''
import hashlib,json,os,pathlib,sys
home=pathlib.Path.home();root=home/'.local/share/peticao/databases/current';sys.path.insert(0,str(root))
from coordination import Store
out={'home':str(home),'profile_exists':root.is_dir(),'roles':[],'owner_config_present':(home/'.config/peticao/databases/migration-config.json').exists()}
for name in ['query-config.json','config.json']:
 p=home/'.config/peticao/databases'/name;s=Store(p)
 with s.connect() as db:
  r=db.execute("SELECT current_user AS role,rolcreatedb,rolcreaterole,has_table_privilege(current_user,'peticao_coord.tasks','INSERT') AS may_insert FROM pg_roles WHERE rolname=current_user").fetchone()
  r['client_tls']=db.pgconn.ssl_in_use;r['config_mode']=oct(p.stat().st_mode&0o777);r['profile']=name
  expected_insert=name=='config.json'
  r['pass']=r['rolcreatedb'] is False and r['rolcreaterole'] is False and r['may_insert']==expected_insert and r['client_tls'] is True and r['config_mode']=='0o600'
  out['roles'].append(r)
out['source_sha256']=hashlib.sha256((root/'coordination.py').read_bytes()).hexdigest()
catalog=json.loads((home/'.config/peticao/shared-credentials/CATALOG.json').read_text());out['catalog_profile_ids']=sorted(e['id'] for e in catalog['entries'] if e['id'].startswith('coordination/'))
print(json.dumps(out))
'''


def host_check(h):
    hostname,alias,user=h;rows=[]
    for account in [user,'root']:
        if alias:
            rootcmd=['python3','-c',f'import pathlib,runpy,sys;sys.path.insert(0,str(pathlib.Path.home()/".local/share/peticao/databases/current"));exec(sys.stdin.read())']
            # The profile's own interpreter is selected explicitly, independent of global Python/PATH.
            home='/root' if account=='root' else '/home/'+account
            command=[home+'/.local/share/peticao/databases/current/venv/bin/python','-c',PROBE]
            if account!='root':command=['sudo','-H','-u',account]+command
            args=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12',alias,shlex.join(command)]
        else:
            home=Path.home() if account==user else Path('/root');args=[str(home/'.local/share/peticao/databases/current/venv/bin/python'),'-c',PROBE]
            if account=='root':args=['sudo','-H']+args
        r=subprocess.run(args,capture_output=True,text=True,timeout=60)
        if r.returncode:rows.append({'account':account,'error':'probe_failed','rc':r.returncode})
        else:rows.append({'account':account,'proof':json.loads(r.stdout)})
    return {'host':hostname,'accounts':rows}


if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:results=list(p.map(host_check,HOSTS))
    result={'hosts':len(results),'accounts':sum(len(h['accounts']) for h in results),
            'role_checks_passed':sum(r['pass'] for h in results for a in h['accounts'] for r in a.get('proof',{}).get('roles',[])),
            'results':results}
    save(EVIDENCE/'HOSTS-INDEPENDENT-VERIFICATION.json',result)
    print(json.dumps({k:v for k,v in result.items() if k!='results'}))
