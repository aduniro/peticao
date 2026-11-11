"""PG17 fixture lifecycle only. Does not install, touch services or manage other clusters."""
from pathlib import Path
import hashlib,json,os,pwd,re,shlex,stat,subprocess,time

PG_BIN=Path('/usr/lib/postgresql/17/bin')
PORT=55485
DATABASE='fixture_only'
USER='fixture_only'
class OwnershipError(RuntimeError):pass
class Cancelled(RuntimeError):pass

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def cgroup_of(pid,proc_root=Path('/proc')):
 rows=(proc_root/str(pid)/'cgroup').read_text().splitlines()
 matches=[x[3:] for x in rows if x.startswith('0::')]
 if len(matches)!=1:raise OwnershipError('unified cgroup required')
 return matches[0]

def live_context(expected):
 if os.getuid()==0 or pwd.getpwuid(os.getuid()).pw_name!='vigia-worker':raise OwnershipError('must run as vigia-worker without root')
 if not re.fullmatch(r'/[A-Za-z0-9_@./:-]+\.(scope|service)',expected or '') or not any(x in expected for x in ['admin-v2','vigia-worker']):raise OwnershipError('dedicated executor cgroup required')
 if cgroup_of(os.getpid())!=expected:raise OwnershipError('wrong executor cgroup')
 root=Path('/sys/fs/cgroup')/expected.lstrip('/')
 memory=(root/'memory.max').read_text().strip();cpu=(root/'cpu.max').read_text().split();pids=(root/'pids.max').read_text().strip()
 if memory=='max' or not 0<int(memory)<=3*1024**3:raise OwnershipError('memory limit must be <=3GiB')
 if cpu[0]=='max' or not 0<int(cpu[0])/int(cpu[1])<=2:raise OwnershipError('CPU limit must be <=2 cores')
 if pids=='max' or not 0<int(pids)<=256:raise OwnershipError('PID limit must be <=256')
 return {'uid':os.getuid(),'cgroup':expected,'memoryMaxBytes':int(memory),'cpuCores':int(cpu[0])/int(cpu[1]),'pidsMax':int(pids)}

def default_command(args,*,env,timeout):
 p=subprocess.run(args,env=env,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('PG fixture command failed: '+Path(args[0]).name+': '+p.stderr[:1200])
 return p.stdout.strip()

class NativePG:
 def __init__(self,run,nonce,expected_cgroup,*,command=default_command,context=live_context,proc_root=Path('/proc'),socket_parent=Path('/tmp'),expected_pins=None):
  self.run=Path(run);self.nonce=nonce;self.expected_cgroup=expected_cgroup;self.command=command;self.context=context;self.proc_root=Path(proc_root);self.uid=os.getuid();self.identity=None;self.started=False;self.events=[];self.binary_pins={};self.prepared=False;self.expected_pins=expected_pins
  self.data=self.run/'postgres';self.socket=Path(socket_parent)/('history-pg-'+nonce);self.marker=self.run/'pg-owner.json';self.pidfile=self.data/'postmaster.pid'
  if not re.fullmatch('[a-f0-9]{12}',nonce):raise OwnershipError('invalid fixture nonce')
  self.env={'PATH':str(PG_BIN)+':/usr/bin:/bin','HOME':str(self.run/'empty'),'LANG':'C.UTF-8','PGPASSFILE':str(self.run/'pgpass'),'PGCONNECT_TIMEOUT':'3','PGAPPNAME':'history-fixture-'+nonce}
 def private(self,path):
  if path.is_symlink() or path.resolve()!=path or not path.is_dir():raise OwnershipError('noncanonical private directory')
  st=path.stat()
  if st.st_uid!=self.uid or stat.S_IMODE(st.st_mode)!=0o700:raise OwnershipError('private directory must be own0700')
 def write_private(self,path,data):
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:f.write(data)
 def prepare(self):
  self.limits=self.context(self.expected_cgroup);self.private(self.run)
  # No preexisting path is adopted, emptied, initialized or stopped.
  if self.data.exists() or self.data.is_symlink() or self.socket.exists() or self.marker.exists():raise OwnershipError('preexisting fixture path')
  expected=self.expected_pins if self.expected_pins is not None else json.loads((Path(__file__).resolve().parent/'pg-binary-pins.json').read_text())
  if set(expected)!={'postgres','initdb','pg_ctl','psql','pg_isready'}:raise OwnershipError('fixed PG binary pins required')
  for name in ['postgres','initdb','pg_ctl','psql','pg_isready']:
   binary=PG_BIN/name
   if not binary.is_file() or binary.is_symlink() or not os.access(binary,os.X_OK):raise OwnershipError('required native PG binary missing')
   observed_sha=sha(binary)
   if observed_sha!=expected[name]:raise OwnershipError('PG binary not reviewed')
   version=self.command([str(binary),'--version'],env=self.env,timeout=8)
   if not re.search(r'\(PostgreSQL\) 17\.11(?:\s|$)',version):raise OwnershipError('PG17.11 required')
   self.binary_pins[name]={'sha256':observed_sha,'version':version}
  if len(os.fsencode(str(self.socket))+b'/.s.PGSQL.55485')>=108:raise OwnershipError('private socket pathname too long')
  self.data.mkdir(mode=0o700);self.socket.mkdir(mode=0o700);self.private(self.data);self.private(self.socket)
  st=self.data.stat();self.write_private(self.marker,json.dumps({'nonce':self.nonce,'uid':self.uid,'data':str(self.data),'dataDevice':st.st_dev,'dataInode':st.st_ino,'socket':str(self.socket),'socketDevice':self.socket.stat().st_dev,'socketInode':self.socket.stat().st_ino,'cgroup':self.expected_cgroup})+'\n')
  self.write_private(self.run/'initdb-password','fixture_only\n');self.write_private(self.run/'pgpass','127.0.0.1:55485:*:fixture_only:fixture_only\n');self.prepared=True
  self.events.append('prepared')
 def check_marker(self):
  self.context(self.expected_cgroup);self.private(self.run);self.private(self.data);self.private(self.socket)
  if self.marker.is_symlink() or self.marker.stat().st_uid!=self.uid or stat.S_IMODE(self.marker.stat().st_mode)!=0o600:raise OwnershipError('owner marker metadata changed')
  m=json.loads(self.marker.read_text());st=self.data.stat()
  if m!={'nonce':self.nonce,'uid':self.uid,'data':str(self.data),'dataDevice':st.st_dev,'dataInode':st.st_ino,'socket':str(self.socket),'socketDevice':self.socket.stat().st_dev,'socketInode':self.socket.stat().st_ino,'cgroup':self.expected_cgroup}:raise OwnershipError('owner marker mismatch')
 def initialize(self):
  self.check_marker()
  if any(self.data.iterdir()):raise OwnershipError('refuse initdb on nonempty directory')
  self.events.append('initdb-requested')
  self.command([str(PG_BIN/'initdb'),'-D',str(self.data),'-U',USER,'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--no-locale','--pwfile='+str(self.run/'initdb-password')],env=self.env,timeout=60)
  if (self.data/'PG_VERSION').read_text().strip()!='17':raise OwnershipError('initialized wrong PG major')
  self.events.append('initialized')
 def observe(self):
  self.check_marker()
  if not self.pidfile.exists():return None
  if self.pidfile.is_symlink() or self.pidfile.stat().st_uid!=self.uid:raise OwnershipError('pidfile metadata mismatch')
  rows=self.pidfile.read_text().splitlines()
  if len(rows)<6 or not rows[0].isdigit() or rows[1]!=str(self.data) or rows[3]!=str(PORT) or rows[4]!=str(self.socket) or rows[5]!='127.0.0.1':raise OwnershipError('pidfile does not identify own cluster')
  pid=int(rows[0]);proc=self.proc_root/str(pid)
  if proc.stat().st_uid!=self.uid:raise OwnershipError('postmaster uid mismatch')
  fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
  if fields[0]=='Z' or cgroup_of(pid,self.proc_root)!=self.expected_cgroup:raise OwnershipError('postmaster not in own cgroup')
  args=(proc/'cmdline').read_bytes().rstrip(b'\0').split(b'\0');decoded=[x.decode() for x in args]
  if not decoded or Path(decoded[0]).name!='postgres' or '-D' not in decoded or decoded[decoded.index('-D')+1]!=str(self.data) or 'cluster_name='+self.nonce not in decoded:raise OwnershipError('postmaster argv identity mismatch')
  identity={'pid':pid,'startTicks':fields[19],'pidfileStart':rows[2],'data':str(self.data),'nonce':self.nonce,'cgroup':self.expected_cgroup}
  if self.identity is not None and identity!=self.identity:raise OwnershipError('postmaster identity changed; never signal reused PID')
  return identity
 def start(self):
  self.check_marker()
  if self.pidfile.exists():raise OwnershipError('refuse starting with existing postmaster pidfile')
  options=['-p',str(PORT),'-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+str(self.socket),'-c','unix_socket_permissions=0700','-c','cluster_name='+self.nonce,'-c','shared_buffers=64MB','-c','max_connections=20','-c','max_parallel_workers=0']
  self.events.append('start-requested')
  # If interrupted or timed out, no automatic restart. stop() reconciles identity.
  self.command([str(PG_BIN/'pg_ctl'),'-D',str(self.data),'-l',str(self.run/'postgres.log'),'-w','-t','30','-o',shlex.join(options),'start'],env=self.env,timeout=40)
  self.identity=self.observe()
  if self.identity is None:raise OwnershipError('started postmaster missing')
  self.started=True;self.events.append('started')
 def psql(self,database,sql):
  if database not in ['postgres',DATABASE]:raise OwnershipError('unexpected database')
  return self.command([str(PG_BIN/'psql'),'-X','--no-password','--host=127.0.0.1','--port='+str(PORT),'--username='+USER,'--dbname='+database,'--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--command',sql],env=self.env,timeout=8)
 def verify_database(self,database):
  identity=self.observe()
  if identity is None:raise OwnershipError('no own postmaster for SQL handshake')
  self.identity=identity
  sql="SELECT json_build_object('version',version(),'database',current_database(),'nonce',current_setting('cluster_name'),'data_directory',current_setting('data_directory'),'port',inet_server_port())::text"
  row=json.loads(self.psql(database,sql))
  if not row['version'].startswith('PostgreSQL 17.11 ') or row['database']!=database or row['nonce']!=self.nonce or row['data_directory']!=str(self.data) or row['port']!=PORT:raise OwnershipError('SQL database identity mismatch')
  self.events.append('verified-'+database);return row
 def bootstrap(self):
  self.verify_database('postgres');self.psql('postgres','CREATE DATABASE fixture_only');return self.verify_database(DATABASE)
 def stop(self):
  if not self.prepared:return {'stopped':True,'neverPrepared':True}
  self.check_marker();identity=self.observe()
  if identity is None:
   if 'initdb-requested' in self.events and 'initialized' not in self.events:return {'stopped':False,'uncertain':True,'reason':'initdb interrupted; executor must drain only this job cgroup before claiming cleanup','events':self.events}
   if 'start-requested' in self.events and 'started' not in self.events:return {'stopped':False,'uncertain':True,'reason':'start interrupted without durable PID; executor must reconcile and drain only this job cgroup','events':self.events}
   if self.identity is not None:
    try:
     fields=(self.proc_root/str(self.identity['pid'])/'stat').read_text().rsplit(')',1)[1].split()
     if fields[19]==self.identity['startTicks'] and fields[0]!='Z':raise OwnershipError('own live postmaster lost pidfile')
    except FileNotFoundError:pass
   return {'stopped':True,'neverStartedOrAlreadyExited':True,'events':self.events}
  self.identity=identity
  for name,pin in self.binary_pins.items():
   if sha(PG_BIN/name)!=pin['sha256']:raise OwnershipError('PG binary drift before stop')
  self.events.append('stop-requested')
  # Never pg_ctl without the exact own data path and verified nonce/PID/cgroup.
  self.command([str(PG_BIN/'pg_ctl'),'-D',str(self.data),'-m','fast','-w','-t','15','stop'],env=self.env,timeout=20)
  if self.pidfile.exists():raise OwnershipError('postmaster pidfile remained after stop')
  try:
   proc=self.proc_root/str(identity['pid']);fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
   if fields[19]==identity['startTicks'] and fields[0]!='Z':raise OwnershipError('own postmaster remains live')
  except FileNotFoundError:pass
  self.events.append('stopped');return {'stopped':True,'identity':identity,'events':self.events}
 def release_socket(self):
  self.check_marker()
  if self.pidfile.exists():raise OwnershipError('refuse releasing socket while pidfile exists')
  if self.identity is not None:
   try:
    f=(self.proc_root/str(self.identity['pid'])/'stat').read_text().rsplit(')',1)[1].split()
    if f[19]==self.identity['startTicks'] and f[0]!='Z':raise OwnershipError('refuse releasing socket while own postmaster live')
   except FileNotFoundError:pass
  self.socket.rmdir() # Only an empty directory whose device/inode/nonce was checked.
  self.events.append('socket-released')
  return {'removed':True,'socketDirectory':str(self.socket)}
 def report(self):return {'backend':'native-postgresql17','nonce':self.nonce,'dataDirectory':str(self.data),'socketDirectory':str(self.socket),'identity':self.identity,'events':self.events,'binaryPins':self.binary_pins}
