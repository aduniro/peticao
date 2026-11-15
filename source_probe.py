"""Future live read-only Santiago observation; never stops/promotes/starts anything."""
from pathlib import Path
import base64,contextlib,datetime as dt,hashlib,json,os,re,socket,sqlite3,stat,subprocess,sys
ROOT=Path('/srv/admin-v2-coordinator')
CODE=Path('/opt/admin-v2-cluster')
UNIT='admin-v2-coordinator.service'
MAX_QUEUE=128*1024*1024
TERMINAL={'completed','failed','interrupted','canceled'}

def encoded(value):
    if isinstance(value, bytes):
        return {'sqlite_blob_base64': base64.b64encode(value).decode()}
    raise TypeError('unsupported SQLite value')

def database_facts(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_QUEUE:
        raise ValueError('bounded existing regular queue required')
    with contextlib.closing(sqlite3.connect(path.absolute().as_uri() + '?mode=ro', uri=True, timeout=10)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('queue integrity failure')
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        tables = [x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        if not {'jobs', 'events'} <= set(tables):
            raise ValueError('legacy queue schema required')
        facts = {'schema_sha256': hashlib.sha256(json.dumps(schema, separators=(',', ':')).encode()).hexdigest(), 'tables': {}}
        for name in tables:
            if not re.fullmatch('[a-zA-Z_][a-zA-Z0-9_]*', name):
                raise ValueError('unexpected table identifier')
            columns = [r[1] for r in db.execute('PRAGMA table_info("' + name + '")')]
            count = db.execute('SELECT count(*) FROM "' + name + '"').fetchone()[0]
            if count > 100000:
                raise ValueError('queue row limit exceeded')
            order = ','.join('"' + col.replace('"', '""') + '"' for col in columns)
            rows = db.execute('SELECT * FROM "' + name + '" ORDER BY ' + order).fetchall()
            raw = json.dumps(rows, separators=(',', ':'), ensure_ascii=False, default=encoded).encode()
            facts['tables'][name] = {'rows': count, 'sha256': hashlib.sha256(raw).hexdigest()}
        states = dict(db.execute('SELECT state,count(*) FROM jobs GROUP BY state'))
        facts['jobs_by_state'] = states
        facts['nonterminal_jobs'] = sum(n for state, n in states.items() if state not in TERMINAL)
        return facts

def file_bytes(path,owner=None,group=None,max_bytes=262144):
 p=Path(path)
 if p.resolve()!=p or p.is_symlink() or not p.is_file():raise ValueError('regular nonlinked file required')
 st=p.stat()
 if st.st_size>max_bytes or st.st_mode&0o002:raise ValueError('unbounded or publicly writable file')
 if owner is not None and st.st_uid!=owner:raise ValueError('unexpected owner')
 if group is not None and st.st_gid!=group:raise ValueError('unexpected group')
 return p.read_bytes()

def root_epoch_control():
 p=Path('/etc/peticao-dev-authority/epoch.json')
 for q in [*reversed(p.parents),p]:
  st=q.lstat()
  if stat.S_ISLNK(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:raise PermissionError('root-controlled epoch ancestry required')
 st=p.stat()
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)!=0o644 or st.st_size>8192:raise PermissionError('single root0644 bounded guard required')
 value=json.loads(p.read_text())
 if set(value)!={'generation','primary_host','coordinator_boot_id','operation_id'} or type(value['generation']) is not int or value['generation']!=2 or value['primary_host']!='civo':raise ValueError('exact DEV epoch2 owner guard required')
 digest=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
 return value,digest

def command(args):
 if not args or args[0] not in {'show','list-units'}:raise PermissionError('only read-only systemd commands permitted')
 p=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=5)
 if p.returncode:raise RuntimeError('systemd observation failed')
 return p.stdout

def worker_inventory():
 rows=command(['list-units','--all','--plain','--no-legend','--no-pager','admin-v2-job-*.service']);names=[]
 for row in rows.splitlines():
  name=row.split()[0]
  if not re.fullmatch(r'admin-v2-job-[0-9a-fA-F-]{32,36}\.service',name):raise ValueError('unexpected worker unit')
  names.append(name)
 return sorted(set(names))

def cgroup_count(value,base=Path('/sys/fs/cgroup')):
 if value=='':return 0
 if not value.startswith('/') or '..' in Path(value).parts:raise ValueError('invalid cgroup path')
 path=base/value.lstrip('/')
 if not path.exists():return 0
 if path.resolve()!=path:raise ValueError('linked cgroup')
 files=list(path.rglob('cgroup.procs'))
 if not (path/'cgroup.procs').is_file():raise ValueError('cgroup process proof missing')
 if len(files)>128:raise ValueError('cgroup subtree too large')
 processes=0
 for f in files:
  if f.is_symlink():raise ValueError('linked cgroup process file')
  values=f.read_text().split()
  if any(not x.isdigit() for x in values):raise ValueError('invalid cgroup process entry')
  processes+=len(values)
 events=path/'cgroup.events'
 if not events.exists():raise ValueError('cgroup-v2 events proof missing')
 if events.exists():
  fields=dict(x.split() for x in events.read_text().splitlines())
  if fields.get('populated')!='0':raise ValueError('cgroup still populated')
 return processes

def unit_state(name):
 text=command(['show',name,'-p','LoadState','-p','ActiveState','-p','MainPID','-p','ControlGroup'])
 v=dict(x.split('=',1) for x in text.splitlines() if '=' in x)
 if set(v)!={'LoadState','ActiveState','MainPID','ControlGroup'} or not v['MainPID'].isdigit():raise ValueError('incomplete unit status')
 count=cgroup_count(v['ControlGroup'])
 return {'unit':name,'load_state':v['LoadState'],'active_state':v['ActiveState'],'main_pid':int(v['MainPID']),'cgroup_processes':count}

def observe(request):
 if os.geteuid()!=0 or socket.gethostname()!='sonda-verifica3':raise PermissionError('source root exact host only')
 if not re.fullmatch('[a-f0-9]{32}',request.get('nonce','')) or not re.fullmatch('[a-f0-9]{32}',request.get('operation_id','')):raise ValueError('live challenge required')
 if type(request.get('source_authority_uid')) is not int or type(request.get('source_authority_gid')) is not int:raise ValueError('frozen source ownership required')
 expected={'recovery.py','fence_primary.py','coordinator.py','runtime_profile.py','standby_guard.py'}
 if not expected<=set(request['source_code_pins']) or len(request['source_code_pins'])>16:raise ValueError('mandatory source/import closure pins required')
 for name,sha in request['source_code_pins'].items():
  if not re.fullmatch(r'[a-z][a-z0-9_]*\.py',name) or not re.fullmatch('[a-f0-9]{64}',sha):raise ValueError('bounded project module pins required')
  p=CODE/name;raw=file_bytes(p,owner=0,max_bytes=524288)
  if p.stat().st_mode&0o022 or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('source code custody changed')
 authority_path=ROOT/'authority.json';raw=file_bytes(authority_path,request['source_authority_uid'],request['source_authority_gid']);a=json.loads(raw)
 if a.get('role')!='suspended' or a.get('armed_boot_id') is not None or type(a.get('generation')) is not int or a['generation']!=1:raise ValueError('source not suspended unarmed generation1')
 epoch,epoch_sha=root_epoch_control()
 boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
 fence_raw=file_bytes(ROOT/'manual-fence.json',owner=0);fence=json.loads(fence_raw)
 if fence.get('state')!='fenced' or fence.get('host')!='sonda-verifica3' or fence.get('generation')!=1 or type(fence.get('generation')) is not int:raise ValueError('matching fence receipt required as context')
 receipt_units=fence.get('checked_units',[])
 if UNIT not in receipt_units or any(n!=UNIT and not re.fullmatch(r'admin-v2-job-[0-9a-fA-F-]{32,36}\.service',n) for n in receipt_units):raise ValueError('invalid fence unit inventory')
 first=worker_inventory();names=sorted(set(first+receipt_units+[UNIT]));states=[unit_state(n) for n in names]
 facts=database_facts(ROOT/'queue.sqlite')
 second=worker_inventory();states2=[unit_state(n) for n in names]
 after=file_bytes(authority_path,request['source_authority_uid'],request['source_authority_gid'])
 if root_epoch_control()!=(epoch,epoch_sha):raise ValueError('epoch control changed while observing')
 if first!=second or states!=states2 or raw!=after or Path('/proc/sys/kernel/random/boot_id').read_text().strip()!=boot:raise ValueError('source changed while observing')
 if facts!=request['queue_facts'] or facts['nonterminal_jobs']!=0:raise ValueError('final source queue differs from checkpoint')
 return {'nonce':request['nonce'],'operation_id':request['operation_id'],'source_host':'sonda-verifica3','generation':1,'role':'suspended','armed_boot_id':None,'source_boot_id':boot,'authority_sha256':hashlib.sha256(raw).hexdigest(),'manual_fence_sha256':hashlib.sha256(fence_raw).hexdigest(),'queue_facts':facts,'checkpoint_sha256':request['checkpoint_sha256'],'units':states,'epoch_control':epoch,'epoch_sha256':epoch_sha,'live_systemd_queried':True,'double_inventory_equal':True,'authority_unchanged':True,'boot_unchanged':True,'code_pins_verified':True,'observed_at_source':dt.datetime.now(dt.timezone.utc).isoformat()}
if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.read(65537)
  if len(raw)>65536:raise ValueError('request too large')
  print(json.dumps(observe(json.loads(raw))))
 except Exception as e:print(json.dumps({'error_type':type(e).__name__,'raw_error_not_recorded':True}));sys.exit(1)
