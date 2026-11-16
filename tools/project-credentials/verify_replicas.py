"""Read-only verification of copied credentials. Emits metadata, never secrets/hashes."""
import concurrent.futures,configparser,hashlib,importlib.util,json,shlex,subprocess
from pathlib import Path
base=Path(__file__).parent
s=importlib.util.spec_from_file_location('v',base/'vault_sync.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
local=json.loads((Path.home()/'.config/peticao/shared-credentials/CATALOG.json').read_text())
expected={x['id']:hashlib.sha256(Path(x['path']).read_bytes()).hexdigest()for x in local['entries']if x['kind']!='oci-config'}
aws=configparser.RawConfigParser();aws.read(Path.home()/'.aws/credentials')
expected_aws={name:hashlib.sha256(json.dumps(dict(aws[name]),sort_keys=True).encode()).hexdigest()for name in local['aws_profiles']}
code='''import configparser,hashlib,json,os,pwd,stat,subprocess,sys
from pathlib import Path
p=json.load(sys.stdin);out=[]
for account in dict.fromkeys([p['user'],'root']):
 u=pwd.getpwnam(account);home=Path(u.pw_dir);base=home/'.config/peticao/shared-credentials'
 c=json.loads((base/'CATALOG.json').read_text());errors=[];count=0
 if c['sync_id']!=p['sync_id']:errors.append('wrong_sync_id')
 for x in c['entries']:
  f=Path(x['path']);s=f.stat()
  if s.st_uid!=u.pw_uid or stat.S_IMODE(s.st_mode)!=0o600 or f.is_symlink():errors.append('permissions:'+x['id'])
  if x['kind']!='oci-config'and hashlib.sha256(f.read_bytes()).hexdigest()!=p['expected'].get(x['id']):errors.append('content:'+x['id'])
  if x['kind']=='oci-config':
   cfg=configparser.RawConfigParser();cfg.read(f)
   for section in cfg.sections():
    key=cfg.get(section,'key_file',fallback='')
    if key and not Path(key).is_file():errors.append('oci_key_path:'+section)
  count+=1
 if count!=len(p['expected'])+p['oci_count']:errors.append('entry_count')
 cfg=configparser.RawConfigParser();cfg.read(home/'.aws/credentials')
 for name,want in p['expected_aws'].items():
  if not cfg.has_section(name)or hashlib.sha256(json.dumps(dict(cfg[name]),sort_keys=True).encode()).hexdigest()!=want:errors.append('aws_profile:'+name)
 for f in [base,base/'current',home/'.aws']:
  if stat.S_IMODE(f.stat().st_mode)!=0o700:errors.append('directory_mode:'+f.name)
 guide=home/'.codex/AGENTS.md'
 if not guide.exists()or'Credenciais compartilhadas do projeto'in guide.read_text():
  pass
 else:errors.append('agent_guide')
 if not guide.exists():errors.append('agent_guide_missing')
 helper=home/'.local/bin/peticao-credentials'
 if not os.access(helper,os.X_OK):errors.append('helper_not_executable')
 # Exercise path lookup as the actual user, without printing file content.
 def demote():
  os.initgroups(u.pw_name,u.pw_gid);os.setgid(u.pw_gid);os.setuid(u.pw_uid)
 env=os.environ.copy();env['HOME']=u.pw_dir
 r=subprocess.run([str(helper),'path','api/peticao-azure-admin'],env=env,preexec_fn=demote,capture_output=True,text=True)
 if r.returncode or not Path(r.stdout.strip()).is_file():errors.append('helper_path_lookup')
 out.append({'account':account,'home':u.pw_dir,'files_verified':count,'aws_profiles_verified':len(p['expected_aws']),'errors':errors,'status':'PASS'if not errors else'FAIL'})
print(json.dumps(out))
'''
def run(host):
 payload={'user':host['user'],'sync_id':local['sync_id'],'expected':expected,'expected_aws':expected_aws,'oci_count':sum(x['kind']=='oci-config'for x in local['entries'])}
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',host['alias']or'cluster-local-root','python3 -c '+shlex.quote(code)],input=json.dumps(payload),capture_output=True,text=True,timeout=90)
 if r.returncode:return {'host':host['name'],'status':'FAIL','error':'remote_verification_failed'}
 out=json.loads(r.stdout)
 for item in out:item['host']=host['name']
 return {'host':host['name'],'status':'PASS'if all(x['status']=='PASS'for x in out)else'FAIL','accounts':out}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for result in pool.map(run,m.HOSTS):results.append(result);print(json.dumps(result),flush=True)
(base/'POST-VERIFICATION.json').write_text(json.dumps(results,indent=2))
assert len(results)==8 and all(x['status']=='PASS'for x in results)
print(json.dumps({'status':'PASS','hosts':8,'accounts':16,'files_per_account':len(local['entries']),'sync_id':local['sync_id']}))
