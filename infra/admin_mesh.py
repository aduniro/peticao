#!/usr/bin/python3
"""Provision separate administrative SSH mesh. Never reads private key contents."""
import json,os,pathlib,subprocess,sys,textwrap,datetime
BASE=pathlib.Path(__file__).resolve().parent
NODES={
 'local':dict(user='barre',home='/home/barre',v4='100.105.193.63',v6='fd7a:115c:a1e0::e33b:c13f',root=None),
 'santiago':dict(user='sonda',home='/home/sonda',v4='100.80.18.81',v6='fd7a:115c:a1e0::3e2f:1252',root='sonda-verifica3-root'),
 'sp':dict(user='adunir',home='/home/adunir',v4='100.109.6.122',v6='fd7a:115c:a1e0::8e2f:67b',root='peticao-root')}

def execute(node,code):
 cmd=['/usr/bin/python3','-'] if not NODES[node]['root'] else ['/usr/bin/ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes',NODES[node]['root'],'/usr/bin/python3 -']
 p=subprocess.run(cmd,input=code,text=True,capture_output=True,timeout=90)
 if p.returncode:raise RuntimeError(node+': '+p.stdout+' '+p.stderr)
 return p.stdout.strip()

def bootstrap(node):
 d=NODES[node]
 code='D='+repr(d)+'\n'+'''import os,pwd,pathlib,subprocess,json
account=pwd.getpwnam(D['user']);home=pathlib.Path(account.pw_dir)
assert str(home)==D['home']
ssh=home/'.ssh';ssh.mkdir(mode=0o700,exist_ok=True)
os.chown(ssh,account.pw_uid,account.pw_gid) if os.geteuid()==0 else None
key=ssh/'id_admin_v2_mesh'
def keygen(path,owner=False):
 if path.exists():
  assert path.with_suffix(path.suffix+'.pub').exists(), 'Existing key has no public counterpart; not reading private key'
  return
 cmd=['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C','admin-v2-mesh-'+D['user'],'-f',str(path)]
 if owner and os.geteuid()==0:cmd=['/usr/sbin/runuser','-u',D['user'],'--']+cmd
 subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
keygen(key,True)
configdir=(pathlib.Path('/etc/ssh/admin-mesh') if os.geteuid()==0 else home/'.config/admin-v2-mesh')
configdir.mkdir(mode=0o700,parents=True,exist_ok=True)
host=configdir/'ssh_host_ed25519_key';keygen(host)
print(json.dumps({'user_key':key.with_suffix('.pub').read_text().strip(),'host_key':host.with_suffix('.pub').read_text().strip(),'host_key_path':str(host),'configdir':str(configdir),'uid':account.pw_uid,'gid':account.pw_gid,'shell':account.pw_shell}))
'''
 return json.loads(execute(node,code))

def configure(node,public):
 d=NODES[node];uid=public[node]['uid'];gid=public[node]['gid'];home=d['home']
 client=[];known=[];authorized=[]
 for target,t in NODES.items():
  for suffix,addr,family in [('',t['v4'],'inet'),('-ipv6',t['v6'],'inet6')]:
   client.append(f'''Host cluster-{target}{suffix}
  HostName {addr}
  User {t['user']}
  Port 2223
  AddressFamily {family}
  IdentityFile {home}/.ssh/id_admin_v2_mesh
  IdentitiesOnly yes
  BatchMode yes
  PreferredAuthentications publickey
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  StrictHostKeyChecking yes
  HostKeyAlias admin-mesh-{target}
  UserKnownHostsFile {home}/.ssh/known_hosts_admin_mesh
  GlobalKnownHostsFile /dev/null
  ControlMaster no
  ForwardAgent no
  ConnectTimeout 15
  ServerAliveInterval 15
  ServerAliveCountMax 3
''')
  key=' '.join(public[target]['host_key'].split()[:2])
  known.append(f"admin-mesh-{target},[admin-mesh-{target}]:2223,[{t['v4']}]:2223,[{t['v6']}]:2223 {key}")
  if target!=node:
   key=' '.join(public[target]['user_key'].split()[:2])
   authorized.append(f'restrict,pty,from="{t["v4"]},{t["v6"]}" {key} admin-mesh-{target}')
 conf=f'''Port 2223
AddressFamily any
ListenAddress {d['v4']}
ListenAddress {d['v6']}
HostKey {public[node]['host_key_path']}
PidFile {'/run/admin-mesh/sshd.pid' if node!='local' else '/run/user/'+str(uid)+'/admin-mesh/sshd.pid'}
AllowUsers {d['user']}
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AuthorizedKeysFile {home}/.ssh/authorized_keys_admin_mesh
StrictModes yes
UsePAM {'yes' if node!='local' else 'no'}
AllowTcpForwarding no
AllowStreamLocalForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
PermitTTY yes
PrintMotd no
LogLevel VERBOSE
Subsystem sftp internal-sftp
'''
 unit=f'''[Unit]
Description=Private administrative SSH mesh (Tailnet only, TCP2223)
After={'network-online.target tailscaled.service' if node!='local' else 'default.target'}

[Service]
Type=simple
ExecStart=/usr/sbin/sshd -D -e -f {public[node]['configdir']}/sshd_config
Restart=on-failure
RestartSec=5
RuntimeDirectory=admin-mesh
RuntimeDirectoryMode=0700
UMask=0077

[Install]
WantedBy={'multi-user.target' if node!='local' else 'default.target'}
'''
 payload=dict(d=d,uid=uid,gid=gid,client='\n'.join(client),known='\n'.join(known)+'\n',authorized='\n'.join(authorized)+'\n',conf=conf,unit=unit,configdir=public[node]['configdir'],local=node=='local')
 code='P='+repr(payload)+'\n'+'''import os,pathlib,subprocess,datetime,json,shutil
home=pathlib.Path(P['d']['home']);ssh=home/'.ssh'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
def write(path,text,owner=False):
 if path.exists() and path.read_text()!=text:
  backup=path.with_name(path.name+'.before-admin-mesh-'+stamp)
  if not backup.exists():shutil.copy2(path,backup)
 path.write_text(text);path.chmod(0o600)
 if owner and os.geteuid()==0:os.chown(path,P['uid'],P['gid'])
for name,field in [('config_admin_mesh','client'),('known_hosts_admin_mesh','known'),('authorized_keys_admin_mesh','authorized')]:write(ssh/name,P[field],True)
config=ssh/'config';old=config.read_text() if config.exists() else ''
include='Include '+str(ssh/'config_admin_mesh')
if include not in old.splitlines():write(config,include+'\\n'+old,True)
configdir=pathlib.Path(P['configdir']);write(configdir/'sshd_config',P['conf'])
unitdir=home/'.config/systemd/user' if P['local'] else pathlib.Path('/etc/systemd/system')
unitdir.mkdir(parents=True,exist_ok=True)
write(unitdir/'admin-mesh-sshd.service',P['unit'])
subprocess.run(['/usr/sbin/sshd','-t','-f',str(configdir/'sshd_config')],check=True)
cmd=['/usr/bin/systemctl']+(['--user'] if P['local'] else [])
subprocess.run(cmd+['daemon-reload'],check=True)
subprocess.run(cmd+['enable','--now','admin-mesh-sshd.service'],check=True,stdout=subprocess.DEVNULL)
print(json.dumps({'node':P['d']['user'],'service':subprocess.run(cmd+['is-active','admin-mesh-sshd.service'],capture_output=True,text=True).stdout.strip(),'sshd_config':str(configdir/'sshd_config'),'ssh_include':str(ssh/'config_admin_mesh')}))
'''
 return json.loads(execute(node,code))

if __name__=='__main__':
 if len(sys.argv)!=2 or sys.argv[1] not in ['bootstrap','configure']:raise SystemExit('usage: admin_mesh.py bootstrap|configure')
 public_path=BASE/'admin-mesh-public.json'
 if sys.argv[1]=='bootstrap':
  public={}
  for node in NODES:
   public[node]=bootstrap(node);print(node+': keys ready (public portions only)',flush=True)
  public_path.write_text(json.dumps(public,indent=2)+'\n');public_path.chmod(0o600)
 else:
  public=json.loads(public_path.read_text())
  for node in NODES:
   print(json.dumps(configure(node,public)),flush=True)
