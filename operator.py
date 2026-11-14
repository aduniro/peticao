#!/usr/bin/env python3
"""Civo user-owned isolated credential and read-only Neon INFRA verification."""
import json,os,pwd,socket,ssl,stat,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
PROJECT='lingering-shape-35933425'
DEST=Path('/home/civo/.config/peticao-neon-infra')
API=Path('/home/civo/.config/neon/credentials.peticao-coordenacao.json')
CA='/etc/ssl/certs/ca-certificates.crt'
SQL="BEGIN TRANSACTION READ ONLY; SELECT 1,current_database(),current_user,current_setting('transaction_read_only'); SELECT ssl,version,cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid(); ROLLBACK;"

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise PermissionError('API redirect forbidden')

def validate(value):
 if value.get('project')!=PROJECT or value.get('database')!='infra' or value.get('role')!='infra_owner' or value.get('port')!=5432:raise ValueError('exact infrastructure project/database/role/port required')
 host=value.get('host','')
 if not isinstance(host,str) or not host.endswith('.neon.tech') or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-.' for c in host):raise ValueError('Neon hostname required')
 password=value.get('password')
 if not isinstance(password,str) or not password or len(password)>512 or any(c in password for c in '\r\n\0'):raise ValueError('valid bounded password required')
 return value

def private(path,directory=False):
 st=path.lstat()
 if path.is_symlink() or st.st_uid!=os.getuid() or stat.S_IMODE(st.st_mode)!=(0o700 if directory else 0o600):raise PermissionError('own private path required')
 if (directory and not path.is_dir()) or (not directory and not path.is_file()):raise ValueError('path type mismatch')

def api_check(host):
 private(API);key=json.loads(API.read_text())['api_key']
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
 def get(suffix):
  req=urllib.request.Request('https://console.neon.tech/api/v2/projects/'+PROJECT+suffix,headers={'Authorization':'Bearer '+key,'Accept':'application/json'})
  with opener.open(req,timeout=25) as response:
   if response.status!=200:raise PermissionError('API read denied')
   return json.load(response)
 project=get('');endpoints=get('/endpoints')
 if project.get('project',{}).get('id')!=PROJECT:raise ValueError('wrong project')
 normalized=host.replace('-pooler.','.')
 if not any(x.get('host')==normalized for x in endpoints.get('endpoints',[])):raise ValueError('database host not bound to project')
 return {'project_get_http':200,'endpoints_get_http':200,'expected_project':PROJECT,'host_binding_verified':True,'https_tls_ca_verified':True}

def escape(value):return value.replace('\\','\\\\').replace(':','\\:')

def parse_sql(stdout):
 lines=[s for s in stdout.splitlines() if s and s not in {'BEGIN','ROLLBACK'}]
 if len(lines)!=2 or lines[0]!='1|infra|infra_owner|on':raise ValueError('unexpected SQL identity/read-only result')
 tls=lines[1].split('|')
 if len(tls)!=3 or tls[0]!='t' or tls[1] not in {'TLSv1.2','TLSv1.3'}:raise ValueError('TLS session not proven')
 return {'select_one':1,'database':'infra','role':'infra_owner','transaction_read_only':'on','ssl':True,'protocol':tls[1],'cipher':tls[2]}

def main(request):
 os.umask(0o077)
 if os.getuid()!=1000 or pwd.getpwuid(os.getuid()).pw_name!='civo' or socket.gethostname()!='peticao-civo':raise PermissionError('Civo non-root account only')
 data=validate(request['credential'])
 private(DEST.parent,True)
 if DEST.resolve()!=DEST or DEST.exists() or DEST.is_symlink():raise FileExistsError('existing/redirected destination; no takeover or blind retry')
 result={'phase':'api_check','uid':os.getuid(),'scope':'Neon INFRA only','execution':request['execution'],'automatic_retry':False}
 result['api']=api_check(data['host'])
 DEST.mkdir(mode=0o700);DEST.chmod(0o700)
 def record():
  p=DEST/'receipt.json';p.write_text(json.dumps(result,indent=2)+'\n');p.chmod(0o600)
 result['phase']='destination_created';record()
 binding={k:data[k] for k in ['project','host','port','database','role']}
 f=DEST/'binding.json'
 with f.open('x') as out:json.dump(binding,out)
 f.chmod(0o600)
 pgpass=DEST/'.pgpass'
 with pgpass.open('x') as out:out.write(':'.join(escape(str(data[k])) for k in ['host','port','database','role','password'])+'\n')
 pgpass.chmod(0o600);private(pgpass);private(f);private(DEST,True)
 result.update(phase='credential_installed_private',credential_present=True,credential_mode='0600',directory_mode='0700',credential_transit='SSH host-key-pinned encrypted channel; no password/token/URI argv or logs');record()
 env={'PATH':'/usr/bin:/bin','HOME':'/home/civo','LANG':'C.UTF-8','PGHOST':data['host'],'PGPORT':str(data['port']),'PGDATABASE':'infra','PGUSER':'infra_owner','PGPASSFILE':str(pgpass),'PGSSLMODE':'verify-full','PGSSLROOTCERT':CA,'PGCHANNELBINDING':'require','PGCONNECT_TIMEOUT':'20','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000'}
 p=subprocess.run(['/usr/bin/psql','-X','--no-password','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--command',SQL],capture_output=True,text=True,env=env,timeout=45)
 if p.returncode:
  result.update(phase='sql_failed',psql_exit=p.returncode,error_class='TLS verification' if 'certificate' in p.stderr.lower() else 'authentication' if 'authentication' in p.stderr.lower() else 'connection_or_query',raw_stderr_not_recorded=True);record();print(json.dumps(result));return 1
 result['sql']=parse_sql(p.stdout);result.update(phase='INFRA_READONLY_TLS_VERIFIED',sslmode='verify-full',ca_file=CA,channel_binding='require',read_permission_verified=True,write_permission_not_tested=True,queue_connected=False,app_database_accessed=False);record();print(json.dumps(result));return 0

if __name__=='__main__':
 try:sys.exit(main(json.load(sys.stdin)))
 except Exception as e:
  # Do not include exception text: libraries may echo credential-bearing input.
  print(json.dumps({'ok':False,'error_type':type(e).__name__,'automatic_retry':False,'raw_error_not_recorded':True}));sys.exit(1)
