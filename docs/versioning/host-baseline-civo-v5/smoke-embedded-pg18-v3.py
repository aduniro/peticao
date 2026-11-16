import pathlib,subprocess,json,tempfile,os,shutil,shlex,pwd,argparse,hashlib,re
ap=argparse.ArgumentParser();ap.add_argument("--prefix",required=True);ap.add_argument("--node-modules");ap.add_argument("--runtime-user");ap.add_argument("--node",default=shutil.which("node"));a=ap.parse_args();runtime=a.runtime_user or pwd.getpwuid(os.getuid()).pw_name;u=pwd.getpwnam(runtime);assert u.pw_uid!=0,"Use a non-root runtime user"
P=pathlib.Path(a.prefix).resolve();N=pathlib.Path(a.node_modules).resolve()if a.node_modules else P/'dependencies/node_modules';B=N/'@embedded-postgres/linux-x64/native/bin'
assert a.node and pathlib.Path(a.node).is_file(),"Pass explicit --node Node22.23.5 executable"
assert subprocess.check_output([a.node,"--version"],text=True).strip()=="v22.23.5","Pinned Node22.23.5 required"
(P/"cache").mkdir(parents=True,exist_ok=True);(P/"checks").mkdir(exist_ok=True)
L=N/'@embedded-postgres/linux-x64/native/lib';SONAMES=P/'compat/embedded-pg18-sonames';I=P/'compat/icu60/usr/lib/x86_64-linux-gnu';loader=':'.join(map(str,[SONAMES,I,L]));env=dict(os.environ,LD_LIBRARY_PATH=loader);closure={}
assert (SONAMES/'libpq.so.5').resolve()==(L/'libpq.so.5.18').resolve()
assert hashlib.sha256((L/'libpq.so.5.18').read_bytes()).hexdigest()=='fc25b6ab756b056aba0c4df23d5504db65fa9125ea309ceafb199bc546d785ee'
for tool in ['postgres','initdb','pg_ctl']:
 z=subprocess.run(['ldd',str(B/tool)],env=env,capture_output=True,text=True);assert z.returncode==0 and 'not found'not in z.stdout,(tool,z.stdout);closure[tool]=z.stdout
m=re.search(r'libpq\.so\.5 => (\S+)',closure['initdb']);assert m and pathlib.Path(m[1])==SONAMES/'libpq.so.5','Native LIBPQ masking detected' 
D=pathlib.Path(tempfile.mkdtemp(prefix='pg18-smoke-',dir=P/'cache'));S=pathlib.Path(tempfile.mkdtemp(prefix='civo-pg18-',dir='/tmp'))
for d in [D,S]:os.chown(d,u.pw_uid,u.pw_gid) if os.getuid()==0 else None;d.chmod(0o700)
def run(args):
 if args[0].startswith(str(B)):args=['env','LD_LIBRARY_PATH='+loader]+args
 r=subprocess.run((['runuser','-u',runtime,'--']if os.getuid()==0 else [])+args,capture_output=True,text=True,timeout=90);assert r.returncode==0,(args,r.stderr);return r.stdout
started=False;result={'node_executable':str(pathlib.Path(a.node).resolve()),'private_libpq':str(SONAMES/'libpq.so.5'),'private_libpq_target_sha256':hashlib.sha256((L/'libpq.so.5.18').read_bytes()).hexdigest(),'closure':closure,'native_libpq_masking_excluded':True}
try:
 result['version']=run([str(B/'postgres'),'--version']).strip()
 run([str(B/'initdb'),'-D',str(D/'data'),'--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject'])
 opts=shlex.join(['-k',str(S),'-h','','-p','55439','-c','max_connections=10','-c','shared_buffers=16MB'])
 run([str(B/'pg_ctl'),'-D',str(D/'data'),'-l',str(D/'server.log'),'-o',opts,'-w','start']);started=True
 script="const {Client}=require('"+str(N/"pg")+"');(async()=>{const c=new Client({host:"+json.dumps(str(S))+",port:55439,user:"+json.dumps(runtime)+",database:'postgres'});await c.connect();let v=await c.query('select version()');await c.query('create temporary table synthetic_test as select generate_series(1,10) as n');let r=await c.query('select sum(n)::int as total from synthetic_test');if(r.rows[0].total!==55)throw Error('SQL');console.log(JSON.stringify({version:v.rows[0].version,sql_sum:r.rows[0].total}));await c.end()})().catch(e=>{console.error(e);process.exit(1)})"
 result['sql']=json.loads(run([a.node,'-e',script]));result['unix_socket_only']=True
finally:
 if started:run([str(B/'pg_ctl'),'-D',str(D/'data'),'-m','fast','-w','stop'])
 result['server_stopped']=not (D/'data/postmaster.pid').exists()
 if result['server_stopped']:shutil.rmtree(D);shutil.rmtree(S)
 result['synthetic_data_removed']=not D.exists()and not S.exists()
 (P/'checks/embedded-pg18-smoke-v3.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));assert result['server_stopped']and result['synthetic_data_removed']
