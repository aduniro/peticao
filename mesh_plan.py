"""Deterministic source-only mesh/Remmina drafts. No network, keys or installers."""
import argparse,base64,configparser,hashlib,ipaddress,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ROUTES=('ipv4','ipv6','dns')
ROLES=('normal','root')

def public(value):
 parts=value.split()
 if len(parts)<2 or parts[0]!='ssh-ed25519':raise ValueError('Ed25519 public only')
 raw=base64.b64decode(parts[1],validate=True)
 if len(raw)!=51 or raw[:19]!=b'\0\0\0\x0bssh-ed25519\0\0\0\x20':raise ValueError('invalid public wire format')
 return ' '.join(parts[:2])

def validate_nodes(nodes):
 if len(nodes)!=7 or {x['name'] for x in nodes}!={'local','sp','santiago','waha','akamai','civo','azure'}:raise ValueError('exact seven nodes required')
 for n in nodes:
  if ipaddress.ip_address(n['ipv4']) not in ipaddress.ip_network('100.64.0.0/10') or ipaddress.ip_address(n['ipv6']) not in ipaddress.ip_network('fd7a:115c:a1e0::/48'):raise ValueError('Tailnet addresses only')
  if not re.fullmatch(r'[a-z0-9-]+\.tail1a6d71\.ts\.net',n['dns']):raise ValueError('fixed Tailnet DNS required')
  if n['port']!=(22 if n['name']=='civo' else 2224):raise ValueError('reviewed private port only')
  public(n['host_key'])
  if [a['user'] for a in n['accounts']]!=[n['user'],'root']:raise ValueError('two reviewed account roles required')
 return nodes

def nodes():
 b=json.loads((ROOT/'BASELINE.json').read_text());a=json.loads((ROOT/'AZURE.json').read_text());return validate_nodes(b['nodes']+[a])

def role_account(node,role):return node['accounts'][1 if role=='root' else 0]

def matrix(allnodes):
 validate_nodes(allnodes);result=[]
 for src in allnodes:
  for dst in allnodes:
   if src['name']==dst['name']:continue
   for source_role in ROLES:
    for target_role in ROLES:
     for route in ROUTES:
      a=role_account(src,source_role);target=role_account(dst,target_role)
      result.append({'source_node':src['name'],'source_role':source_role,'source_user':a['user'],'identity_path':a['client_identity'],'target_node':dst['name'],'target_role':target_role,'target_user':target['user'],'route':route,'host':dst[route],'port':dst['port'],'host_key_alias':dst['dns'] if dst['port']==22 else'['+dst['dns']+']:'+str(dst['port']),'expected_source_hostname':src['hostname'],'expected_source_uid_kind':'zero' if source_role=='root' else'nonzero','expected_hostname':dst['hostname'],'expected_uid_kind':'zero' if target_role=='root' else'nonzero'})
 return result

def qualify(records,expected):
 keys=lambda r:tuple(r[k] for k in ['source_node','source_role','target_node','target_role','route'])
 wanted={keys(x):x for x in expected}
 if len(wanted)!=504:raise ValueError('complete matrix must contain504 unique edges')
 got={}
 for r in records:
  k=keys(r)
  if k in got or k not in wanted:raise ValueError('duplicate or unexpected connection')
  e=wanted[k]
  if type(r.get('uid')) is not int or type(r.get('origin_uid')) is not int or r['uid']<0 or r['origin_uid']<0:raise ValueError('numeric UID proofs required')
  if r.get('origin_hostname')!=e['expected_source_hostname'] or r.get('origin_user')!=e['source_user'] or (r['origin_uid']==0)!=(e['expected_source_uid_kind']=='zero'):raise ValueError('wrong origin account/host')
  if r.get('hostkey_verified') is not True or r.get('strict_hostkey_checking') is not True:raise ValueError('host pin proof required')
  if not r.get('fresh_connection') or r.get('exit')!=0 or r.get('hostname')!=e['expected_hostname'] or r.get('user')!=e['target_user'] or (r.get('uid')==0)!=(e['expected_uid_kind']=='zero'):raise ValueError('identity/fresh/auth proof failed')
  got[k]=r
 if set(got)!=set(wanted):raise ValueError('partial mesh is not504-qualified')
 batches={x.get('batch_id') for x in records}
 if len(batches)!=1 or not all(isinstance(x,str) and x for x in batches):raise ValueError('one fresh qualification batch required')
 return {'full_mesh_qualified':True,'connections':504,'gui_tested':False}

def known_hosts(allnodes):
 lines=[]
 for n in allnodes:
  names=[n['ipv4'],n['ipv6'],n['dns'],n['hostname']]
  if n['port']!=22:names=['['+x+']:'+str(n['port']) for x in names]
  lines.append(','.join(names)+' '+public(n['host_key']))
 return '\n'.join(lines)+'\n'

def ssh_config(targets,identity):
 if not identity.startswith('/') or '\n' in identity:raise ValueError('absolute fixed identity path only')
 lines=[]
 for n in targets:
  for role in ROLES:
   user=role_account(n,role)['user'];stem='cluster-'+n['name']+('-root' if role=='root' else'')
   for route in ROUTES:
    aliases=[stem+'-'+route]
    if route=='dns':aliases.append(stem)
    lines+=['Host '+' '.join(aliases),'  HostName '+n[route],'  User '+user,'  Port '+str(n['port']),'  IdentityFile '+identity,'  IdentitiesOnly yes','  BatchMode yes','  PasswordAuthentication no','  KbdInteractiveAuthentication no','  StrictHostKeyChecking yes','  HostKeyAlias '+(n['dns'] if n['port']==22 else'['+n['dns']+']:'+str(n['port'])),'  UserKnownHostsFile ~/.ssh/known_hosts_peticao_mesh_v4','  UpdateHostKeys no','  ForwardAgent no','  ControlMaster no','  ControlPath none','']
 return '\n'.join(lines)

def azure_sshd(azure):
 return '\n'.join(['Port 2224','AddressFamily any','ListenAddress '+azure['ipv4']+':2224','ListenAddress ['+azure['ipv6']+']:2224','HostKey /etc/ssh/ssh_host_ed25519_key','PidFile /run/peticao-tailnet-v2.pid','AuthorizedKeysFile .ssh/authorized_keys_peticao_tailnet_v2','PermitRootLogin prohibit-password','PubkeyAuthentication yes','AuthenticationMethods publickey','PasswordAuthentication no','KbdInteractiveAuthentication no','PermitEmptyPasswords no','UsePAM yes','AllowUsers root builder','AllowAgentForwarding no','X11Forwarding no','StrictModes yes','LogLevel VERBOSE','Subsystem sftp internal-sftp',''])

def service():
 return '[Unit]\nDescription=Peticao Azure private Tailnet SSH\nAfter=network-online.target tailscaled.service\nWants=network-online.target\nRequires=tailscaled.service\nConditionPathExists=/sys/class/net/tailscale0\n[Service]\nType=simple\nExecStartPre=/usr/sbin/sshd -t -f /etc/ssh/peticao-tailnet-v2/sshd_config\nExecStart=/usr/sbin/sshd -D -e -f /etc/ssh/peticao-tailnet-v2/sshd_config\nExecReload=/bin/kill -HUP $MAINPID\nRestart=on-failure\nRestartSec=5\n[Install]\nWantedBy=multi-user.target\n'

def authorization(origin,account):
 return 'from="'+origin['ipv4']+','+origin['ipv6']+'",no-agent-forwarding,no-X11-forwarding '+public(account['client_public'])+' peticao-mesh-v4-'+origin['name']+'-'+account['user']

def inbound_azure(allnodes):
 return '\n'.join(authorization(n,a) for n in allnodes if n['name']!='azure' for a in n['accounts'])+'\n'

def existing_node_additions(allnodes,azure_public):
 azure=next(x for x in allnodes if x['name']=='azure')
 if set(azure_public)!={'root','builder'}:raise ValueError('two real Azure public keys required')
 old={public(a['client_public']) for n in allnodes if n['name']!='azure' for a in n['accounts']}
 fresh={public(x) for x in azure_public.values()}
 if len(fresh)!=2 or fresh&old:raise ValueError('Azure-specific distinct identities required; no Owner/private redistribution')
 return '\n'.join(authorization(azure,{**a,'client_public':azure_public[a['user']]}) for a in azure['accounts'])+'\n'

def remmina_profiles(azure):
 result={}
 for role in ROLES:
  user=role_account(azure,role)['user']
  for route in ROUTES:
   host=azure[route];server=('['+host+']' if route=='ipv6' else host)+':2224'
   content='[remmina]\nname=Petição — Azure '+user+' SSH '+route.upper()+'\nprotocol=SSH\nserver='+server+'\nusername='+user+'\nssh_auth=1\nssh_privatekey=/home/barre/.ssh/id_ed25519_peticao_tailnet_v2\nssh_stricthostkeycheck=1\nssh_tunnel_enabled=0\nviewmode=1\n'
   result['remmina/peticao-azure-'+user+'-ssh-'+route+'.remmina']=content
 return result

def artifacts(allnodes,azure_public=None):
 azure=next(x for x in allnodes if x['name']=='azure');data={'known_hosts_peticao_mesh_v4':known_hosts(allnodes),'azure/sshd_config':azure_sshd(azure),'azure/peticao-tailnet-ssh.service':service(),'azure/authorized_keys_builder_and_root.PUBLIC':inbound_azure(allnodes),'matrix504.json':json.dumps(matrix(allnodes),indent=2)+'\n'}
 for n in allnodes:
  for a in n['accounts']:
   targets=allnodes if n['name']=='azure' else[azure]
   data['ssh/'+n['name']+'-'+a['user']+'-azure-v4.conf']=ssh_config(targets,a['client_identity'])
 data.update(remmina_profiles(azure))
 data['remmina/known_hosts_azure.PUBLIC']=known_hosts([azure])
 if azure_public is not None:data['pending-authorization/azure-additions.PUBLIC']=existing_node_additions(allnodes,azure_public)
 data['STATUS.json']=json.dumps({'prepared_only':True,'applied':False,'vm_started':False,'keys_generated':False,'azure_public_keys_frozen':azure_public is not None,'rollout_authorized':False,'gui_tested':False,'actual_ssh_connections_tested':0,'expected_complete_future_count':504,'pending':['Legitimate Azure auth and authorized wake/discovery','Actual Azure-specific keypair metadata/public discovery or separately authorized remote generation','Freeze14actualpublickeys/hostpin+current config preimages in NEW rollout manifest','Root review, own exact lease and Infra global release','Live private-SSH checks and one fresh504 batch; actual Remmina GUI validation']},indent=2)+'\n'
 return data

def render(out,azure_public=None):
 out=Path(out)
 if out.exists() or out.is_symlink() or not out.resolve().is_relative_to(ROOT.parent) or out.resolve().is_relative_to(ROOT):raise ValueError('new output directory only inside preparation workspace, outside immutable source')
 out.mkdir(parents=True,mode=0o700)
 data=artifacts(nodes(),azure_public)
 for name,text in data.items():
  p=out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);p.chmod(0o600)
 return {'draft_files':len(data),'path':str(out),'applied':False,'azure_keys_frozen':azure_public is not None}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--azure-public-json',type=Path);a=p.parse_args();print(json.dumps(render(a.out,json.loads(a.azure_public_json.read_text()) if a.azure_public_json else None)))
