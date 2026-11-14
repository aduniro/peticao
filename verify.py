"""Read existing private Neon credential; prove client TLS and SQL in one process."""
from pathlib import Path
import json,os,pwd,re,socket,ssl,stat,subprocess,sys,urllib.request
PROJECT='lingering-shape-35933425';ROOT=Path('/home/civo/.config/peticao-neon-infra');CA='/etc/ssl/certs/ca-certificates.crt'
SQL="\\conninfo\nBEGIN TRANSACTION READ ONLY;\nSELECT 1,current_database(),current_user,current_setting('transaction_read_only');\nSELECT ssl,version,cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid();\nROLLBACK;\n"
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise PermissionError('redirect')

def private(path,directory=False):
 st=path.lstat()
 if path.is_symlink() or st.st_uid!=os.getuid() or stat.S_IMODE(st.st_mode)!=(0o700 if directory else 0o600):raise PermissionError('private owner/mode required')
 if not (path.is_dir() if directory else path.is_file()):raise ValueError('path type')

def binding(value):
 if value.get('project')!=PROJECT or value.get('database')!='infra' or value.get('role')!='infra_owner' or value.get('port')!=5432:raise ValueError('exact project/database/role/port required')
 host=value.get('host','')
 if not isinstance(host,str) or not re.fullmatch(r'[a-z0-9.-]+\.neon\.tech',host):raise ValueError('Neon host required')
 return value

def project_binding(host):
 p=Path('/home/civo/.config/neon/credentials.peticao-coordenacao.json');private(p);key=json.loads(p.read_text())['api_key']
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
 result={}
 for label,suffix in [('project',''),('endpoints','/endpoints')]:
  req=urllib.request.Request('https://console.neon.tech/api/v2/projects/'+PROJECT+suffix,headers={'Authorization':'Bearer '+key,'Accept':'application/json'})
  with opener.open(req,timeout=25) as response:
   if response.status!=200:raise PermissionError('read permission denied')
   value=json.load(response);result[label+'_http']=response.status
  if label=='project' and value.get('project',{}).get('id')!=PROJECT:raise ValueError('wrong project')
  if label=='endpoints' and not any(x.get('host')==host.replace('-pooler.','.') for x in value.get('endpoints',[])):raise ValueError('host not bound to project')
 result.update(expected_project=PROJECT,host_binding_verified=True,https_tls_ca_verified=True)
 return result

def parse(stdout):
 lines=stdout.splitlines()
 if lines.count('1|infra|infra_owner|on')!=1:raise ValueError('identity/read-only proof missing')
 if lines.count('BEGIN')!=1 or lines.count('ROLLBACK')!=1:raise ValueError('transaction status missing')
 ssl_lines=[x for x in lines if x.startswith('SSL connection')]
 if len(ssl_lines)!=1:raise ValueError('client SSL connection proof missing')
 version=re.search(r'protocol: (TLSv1\.[23])(?:,|\))',ssl_lines[0]);cipher=re.search(r'cipher: ([A-Za-z0-9_-]+)(?:,|\))',ssl_lines[0])
 if not version or not cipher:raise ValueError('client TLS version/cipher missing')
 server=[x for x in lines if re.fullmatch(r'[tf]\|[A-Za-z0-9.]*\|[A-Za-z0-9_-]*',x)]
 if len(server)!=1:raise ValueError('backend SSL observation missing')
 return {'one':1,'database':'infra','role':'infra_owner','transaction_read_only':'on','client_tls':{'ssl':True,'protocol':version.group(1),'cipher':cipher.group(1)},'backend_pg_stat_ssl':server[0],'same_psql_process_and_connection':True}

def main(request):
 if os.getuid()!=1000 or pwd.getpwuid(os.getuid()).pw_name!='civo' or socket.gethostname()!='peticao-civo':raise PermissionError('Civo user only')
 if ROOT.resolve()!=ROOT:raise ValueError('redirected credential root')
 private(ROOT,True);private(ROOT/'binding.json');private(ROOT/'.pgpass')
 before={str(p):(p.stat().st_mode,p.stat().st_uid,p.stat().st_size,p.stat().st_mtime_ns) for p in [ROOT,ROOT/'binding.json',ROOT/'.pgpass',ROOT/'receipt.json']}
 b=binding(json.loads((ROOT/'binding.json').read_text()));api=project_binding(b['host'])
 env={'PATH':'/usr/bin:/bin','HOME':'/home/civo','LANG':'C.UTF-8','PGHOST':b['host'],'PGPORT':'5432','PGDATABASE':'infra','PGUSER':'infra_owner','PGPASSFILE':str(ROOT/'.pgpass'),'PGSSLMODE':'verify-full','PGSSLROOTCERT':CA,'PGCHANNELBINDING':'require','PGCONNECT_TIMEOUT':'20','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000'}
 p=subprocess.run(['/usr/bin/psql','-X','--no-password','--tuples-only','--no-align','--set=ON_ERROR_STOP=1'],input=SQL,capture_output=True,text=True,env=env,timeout=45)
 if p.returncode:raise RuntimeError('psql failed; raw output suppressed')
 proof=parse(p.stdout)
 after={str(p):(p.stat().st_mode,p.stat().st_uid,p.stat().st_size,p.stat().st_mtime_ns) for p in [ROOT,ROOT/'binding.json',ROOT/'.pgpass',ROOT/'receipt.json']}
 if before!=after:raise ValueError('credential metadata changed')
 print(json.dumps({'ok':True,'status':'NEON_INFRA_CLIENT_TLS_AND_SQL_READONLY_VERIFIED','uid':os.getuid(),'api':api,'sql':proof,'sslmode':'verify-full','ca_file':CA,'channel_binding':'require','host_context':'pooled Neon proxy' if '-pooler.' in b['host'] else 'Neon direct endpoint/proxy','backend_tls_interpretation':'Server pg_stat_ssl observation retained separately; it is not substituted for libpq client TLS. No claim about unobserved provider internal links.','credential_metadata_unchanged':True,'credential_copied_again':False,'remote_files_written':False,'write_permission_tested':False,'queue_connected':False,'app_database_accessed':False,'execution':request['execution']}))
if __name__=='__main__':
 try:main(json.load(sys.stdin))
 except Exception as e:print(json.dumps({'ok':False,'error_type':type(e).__name__,'raw_error_not_recorded':True}));sys.exit(1)
