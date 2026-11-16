import concurrent.futures,datetime,json,os,shlex,subprocess
from pathlib import Path
os.umask(0o077);P=Path(__file__).resolve().parent
NODES=[{'id':'local','user':'barre','ip':'100.105.193.63','bootstrap':None},{'id':'sp','user':'adunir','ip':'100.109.6.122','bootstrap':'cluster-sp'},{'id':'santiago','user':'sonda','ip':'100.80.18.81','bootstrap':'cluster-santiago'},{'id':'waha','user':'wa','ip':'100.115.154.25','bootstrap':'cluster-waha'},{'id':'akamai','user':'builder','ip':'100.74.19.123','bootstrap':'peticao-akamai-root'}]
def rpc(node,code,data=None,timeout=60):
 cmd=['sudo','-n','/usr/bin/python3','-c',code] if node['bootstrap'] is None else ['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',node['bootstrap'],('' if node['id']=='akamai' else 'sudo -n ')+'/usr/bin/python3 -c '+shlex.quote(code)]
 r=subprocess.run(cmd,input=json.dumps(data or {}),capture_output=True,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError(node['id']+': '+r.stderr[-800:])
 return json.loads(r.stdout)
PREP=r'''
import json,os,pwd,subprocess,sys
from pathlib import Path
os.umask(0o077);d=json.load(sys.stdin);pub=[]
for username in [d['user'],'root']:
 account=pwd.getpwnam(username);home=Path(account.pw_dir);ssh=home/'.ssh';ssh.mkdir(exist_ok=True,mode=0o700);os.chown(ssh,account.pw_uid,account.pw_gid)
 key=ssh/'id_ed25519_peticao_tailnet_v2'
 if not key.exists():subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-C','peticao-tailnet-v2:'+d['id']+':'+username,'-f',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for p in [key,Path(str(key)+'.pub')]:p.chmod(0o600);os.chown(p,account.pw_uid,account.pw_gid)
 pub.append({'user':username,'key':Path(str(key)+'.pub').read_text().strip()})
host=Path('/etc/ssh/ssh_host_ed25519_key.pub');assert host.exists()
print(json.dumps({'id':d['id'],'user':d['user'],'ip':d['ip'],'publicKeys':pub,'hostKey':host.read_text().strip()}))
'''
INSTALL=r"""
import json,os,pwd,shutil,subprocess,sys
from pathlib import Path
os.umask(0o077);d=json.load(sys.stdin);node=d['node'];peers=d['peers'];backup=Path('/var/backups/peticao-tailnet-mesh-v2-20261112');backup.mkdir(parents=True,exist_ok=True,mode=0o700)
def write(p,text,account=None,mode=0o600):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():
  b=backup/(str(p).strip('/').replace('/','__'))
  if not b.exists():shutil.copy2(p,b)
 p.write_text(text);p.chmod(mode)
 if account:os.chown(p,account.pw_uid,account.pw_gid)
authorized='\n'.join('from="'+peer['ip']+'",no-agent-forwarding,no-X11-forwarding,no-port-forwarding '+key['key'] for peer in peers for key in peer['publicKeys'])+'\n'
known='\n'.join('['+peer['ip']+']:2224 '+' '.join(peer['hostKey'].split()[:2]) for peer in peers)+'\n'
for username in [node['user'],'root']:
 account=pwd.getpwnam(username);home=Path(account.pw_dir);ssh=home/'.ssh';key=ssh/'id_ed25519_peticao_tailnet_v2'
 write(ssh/'authorized_keys_peticao_tailnet_v2',authorized,account);write(ssh/'known_hosts_peticao_tailnet_v2',known,account)
 config=''
 for peer in peers:
  for root in [False,True]:
   alias='peticao-'+peer['id']+('-root' if root else '')+'-tailnet'
   config+='Host '+alias+'\n  HostName '+peer['ip']+'\n  User '+('root' if root else peer['user'])+'\n  Port 2224\n  AddressFamily inet\n  IdentityFile '+str(key)+'\n  IdentitiesOnly yes\n  BatchMode yes\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n  PreferredAuthentications publickey\n  StrictHostKeyChecking yes\n  UserKnownHostsFile '+str(ssh/'known_hosts_peticao_tailnet_v2')+'\n  GlobalKnownHostsFile /dev/null\n  ForwardAgent no\n  ConnectTimeout 8\n  ServerAliveInterval 15\n  ServerAliveCountMax 3\n\n'
 write(ssh/'config_peticao_tailnet_v2',config,account)
 main=ssh/'config';old=main.read_text() if main.exists() else '';include='Include '+str(ssh/'config_peticao_tailnet_v2')
 if include not in old.splitlines():write(main,include+'\n'+old,account)
# Only the Akamai project account needs additional sudo: other project users already passed sudo -n.
if node['id']=='akamai':
 sudo=Path('/etc/sudoers.d/90-peticao-builder-tailnet');temp=backup/'sudoers-to-validate';temp.write_text(node['user']+' ALL=(ALL:ALL) NOPASSWD: ALL\n');temp.chmod(0o440)
 subprocess.run(['/usr/sbin/visudo','-cf',str(temp)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);write(sudo,temp.read_text(),mode=0o440)
base=Path('/etc/ssh/peticao-tailnet-v2');base.mkdir(exist_ok=True,mode=0o700);Path('/run/sshd').mkdir(exist_ok=True,mode=0o755)
config='''Port 2224
AddressFamily inet
ListenAddress IPADDRESS
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/peticao-tailnet-ssh/sshd.pid
AllowUsers root PROJECTUSER
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AuthorizedKeysFile .ssh/authorized_keys_peticao_tailnet_v2
StrictModes yes
UsePAM yes
UseDNS no
PermitUserEnvironment no
AllowTcpForwarding no
AllowStreamLocalForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
PermitTTY yes
PrintMotd no
MaxAuthTries 3
LogLevel VERBOSE
Subsystem sftp internal-sftp
'''.replace('IPADDRESS',node['ip']).replace('PROJECTUSER',node['user'])
write(base/'sshd_config',config)
subprocess.run(['/usr/sbin/sshd','-t','-f',str(base/'sshd_config')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
unit='''[Unit]
Description=Peticao dedicated key-only SSH over Tailnet
After=network-online.target tailscaled.service
Wants=network-online.target
Requires=tailscaled.service
[Service]
Type=simple
RuntimeDirectory=peticao-tailnet-ssh
RuntimeDirectoryMode=0755
ExecStartPre=/usr/sbin/sshd -t -f /etc/ssh/peticao-tailnet-v2/sshd_config
ExecStart=/usr/sbin/sshd -D -e -f /etc/ssh/peticao-tailnet-v2/sshd_config
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
'''
write('/etc/systemd/system/peticao-tailnet-ssh.service',unit,mode=0o644)
subprocess.run(['systemctl','daemon-reload'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
subprocess.run(['systemctl','enable','--now','peticao-tailnet-ssh.service'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
status=subprocess.run(['systemctl','is-active','peticao-tailnet-ssh.service'],capture_output=True,text=True).stdout.strip()
print(json.dumps({'id':node['id'],'status':status,'port':2224,'listen':node['ip'],'publicKeysInstalled':len(peers)*2,'users':[node['user'],'root'],'backup':str(backup)}))
"""
print('Preparando chaves distintas por máquina/conta; somente públicas são distribuídas.',flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:peers=list(ex.map(lambda n:rpc(n,PREP,n),NODES))
(P/'public-inventory.json').write_text(json.dumps(peers,indent=2)+'\n')
results=[]
# Akamai first so the Remmina can move to the verified dedicated listener before the remaining installs.
for n in sorted(NODES,key=lambda n:n['id']!='akamai'):
 result=rpc(n,INSTALL,{'node':n,'peers':peers});results.append(result);print(json.dumps(result),flush=True)
(P/'installed.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'nodes':NODES,'results':results},indent=2)+'\n')
