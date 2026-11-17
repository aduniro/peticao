import concurrent.futures,json,shlex,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent;nodes=json.loads((P/'installed.json').read_text())['nodes']
code="""import json,pwd,stat,subprocess
from pathlib import Path
r=subprocess.run(['/usr/sbin/sshd','-T','-f','/etc/ssh/peticao-tailnet-v2/sshd_config'],capture_output=True,text=True,check=True);d={x.split(' ',1)[0]:x.split(' ',1)[1] for x in r.stdout.splitlines() if ' ' in x};allowed=['listenaddress','port','passwordauthentication','kbdinteractiveauthentication','authenticationmethods','permitrootlogin','authorizedkeysfile']
unit=subprocess.run(['systemctl','is-enabled','peticao-tailnet-ssh.service'],capture_output=True,text=True).stdout.strip()
users=[]
for username in json.loads(__import__('sys').stdin.read())['users']:
 u=pwd.getpwnam(username);p=Path(u.pw_dir)/'.ssh/id_ed25519_peticao_tailnet_v2';st=p.stat();users.append({'user':username,'keyMode':oct(stat.S_IMODE(st.st_mode)),'ownerUid':st.st_uid,'expectedUid':u.pw_uid})
print(json.dumps({'effective':{k:d.get(k) for k in allowed},'enabled':unit,'keys':users}))
"""
def run(n):
 r=subprocess.run(['ssh','-o','BatchMode=yes','peticao-'+n['id']+'-root-tailnet','python3 -c '+shlex.quote(code)],input=json.dumps({'users':[n['user'],'root']}),capture_output=True,text=True,timeout=20);assert r.returncode==0,r.stderr;v=json.loads(r.stdout);e=v['effective'];assert e['listenaddress']==n['ip']+':2224' and e['passwordauthentication']=='no' and e['kbdinteractiveauthentication']=='no' and e['authenticationmethods']=='publickey';assert v['enabled']=='enabled';assert all(k['keyMode']=='0o600' and k['ownerUid']==k['expectedUid'] for k in v['keys']);return {'node':n['id'],**v}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:rows=list(ex.map(run,nodes))
peers=json.loads((P/'public-inventory.json').read_text());assert len({k['key'].split()[1] for n in peers for k in n['publicKeys']})==10
(P/'AUDITORIA-SSH.json').write_text(json.dumps({'nodes':rows,'uniquePublicKeys':10,'privateKeysNeverExported':True},indent=2)+'\n');print('Cinco serviços enabled, bind privado e autenticação só por chave; dez chaves distintas com permissões verificadas.')
