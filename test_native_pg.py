import json,os,pathlib,shutil,subprocess,tempfile,unittest
from unittest import mock
import native_pg as n

NONCE='abcdef123456';CG='/system.slice/admin-v2-job-abcdef123456.service'
class Fixture:
 def __init__(self,root):
  self.run=root/'run';self.run.mkdir(mode=0o700);(self.run/'empty').mkdir(mode=0o700);self.bin=root/'bin';self.bin.mkdir();self.proc=root/'proc';self.proc.mkdir();self.calls=[];self.start_mode=None
  for name in ['postgres','initdb','pg_ctl','psql','pg_isready']:(self.bin/name).write_text('mock binary '+name);(self.bin/name).chmod(0o755)
  self.patch=mock.patch.object(n,'PG_BIN',self.bin);self.patch.start()
  self.pg=n.NativePG(self.run,NONCE,CG,command=self.command,context=lambda cg:{'uid':os.getuid(),'cgroup':cg},proc_root=self.proc,socket_parent=root)
 def close(self):self.patch.stop()
 def make_process(self):
  p=self.proc/'41111';p.mkdir(exist_ok=True);fields=['S']+['0']*18+['98765']+['0']*10;(p/'stat').write_text('41111 (postgres) '+' '.join(fields));(p/'cgroup').write_text('0::'+CG+'\n');(p/'cmdline').write_bytes(b'postgres\0-D\0'+str(self.pg.data).encode()+b'\0-c\0cluster_name='+NONCE.encode()+b'\0');self.pg.pidfile.write_text('\n'.join(['41111',str(self.pg.data),'1794000000','55485',str(self.pg.socket),'127.0.0.1','0 0','ready'])+'\n')
 def command(self,args,*,env,timeout):
  self.calls.append((args,dict(env),timeout));name=pathlib.Path(args[0]).name
  if '--version' in args:return name+' (PostgreSQL) 17.11 (Debian 17.11-0+deb13u1)'
  if name=='initdb':(self.pg.data/'PG_VERSION').write_text('17\n');return 'initialized'
  if name=='pg_ctl' and args[-1]=='start':
   if self.start_mode=='cancel-before-pid':raise n.Cancelled('cancelled')
   self.make_process()
   if self.start_mode=='timeout-after-pid':raise subprocess.TimeoutExpired(args,40)
   return 'started'
  if name=='pg_ctl' and args[-1]=='stop':self.pg.pidfile.unlink();shutil.rmtree(self.proc/'41111');return 'stopped'
  if name=='psql':
   if 'CREATE DATABASE fixture_only' in args:return 'CREATE DATABASE'
   database=next(x.split('=',1)[1] for x in args if x.startswith('--dbname='));return json.dumps({'version':'PostgreSQL 17.11 (Debian native mock)','database':database,'nonce':NONCE,'data_directory':str(self.pg.data),'port':55485})
  raise AssertionError(args)

class LifecycleTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.fx=Fixture(pathlib.Path(self.tmp.name))
 def tearDown(self):self.fx.close();self.tmp.cleanup()
 def prepared(self):self.fx.pg.prepare();self.fx.pg.initialize()
 def test_complete_lifecycle_explicit_args_private_paths(self):
  self.prepared();self.fx.pg.start();row=self.fx.pg.bootstrap();self.assertEqual(row['nonce'],NONCE);out=self.fx.pg.stop();self.assertTrue(out['stopped']);self.assertFalse(self.fx.pg.pidfile.exists())
  for path in [self.fx.run,self.fx.pg.data,self.fx.pg.socket]:self.assertEqual(path.stat().st_mode&0o777,0o700)
  for path in ['pgpass','initdb-password','pg-owner.json']:self.assertEqual((self.fx.run/path).stat().st_mode&0o777,0o600)
  start=next(a for a,e,t in self.fx.calls if pathlib.Path(a[0]).name=='pg_ctl' and a[-1]=='start');options=start[start.index('-o')+1];self.assertIn('listen_addresses=127.0.0.1',options);self.assertIn('unix_socket_permissions=0700',options);self.assertIn('cluster_name='+NONCE,options);self.assertIn('shared_buffers=64MB',options);self.assertNotIn('sudo',str(self.fx.calls));self.assertNotIn('docker',str(self.fx.calls))
 def test_refuse_preexisting_cluster_without_commands(self):
  self.fx.pg.data.mkdir();(self.fx.pg.data/'PG_VERSION').write_text('17')
  with self.assertRaises(n.OwnershipError):self.fx.pg.prepare()
  self.assertEqual(self.fx.calls,[]);self.assertTrue((self.fx.pg.data/'PG_VERSION').exists())
 def test_refuse_symlink_data_without_commands(self):
  other=pathlib.Path(self.tmp.name)/'existing';other.mkdir();self.fx.pg.data.symlink_to(other)
  with self.assertRaises(n.OwnershipError):self.fx.pg.prepare()
  self.assertEqual(self.fx.calls,[])
 def test_wrong_version_refuses_before_datadir(self):
  original=self.fx.pg.command
  self.fx.pg.command=lambda a,**k:'postgres (PostgreSQL) 18.4' if '--version' in a else original(a,**k)
  with self.assertRaises(n.OwnershipError):self.fx.pg.prepare()
  self.assertFalse(self.fx.pg.data.exists())
 def test_never_init_nonempty_directory(self):
  self.fx.pg.prepare();(self.fx.pg.data/'unrelated').write_text('preserve')
  with self.assertRaises(n.OwnershipError):self.fx.pg.initialize()
  self.assertFalse(any(pathlib.Path(a[0]).name=='initdb' and '--version' not in a for a,e,t in self.fx.calls))
 def test_cancelled_start_without_pid_is_uncertain_no_stop(self):
  self.prepared();self.fx.start_mode='cancel-before-pid'
  with self.assertRaises(n.Cancelled):self.fx.pg.start()
  result=self.fx.pg.stop();self.assertTrue(result['uncertain']);self.assertFalse(result['stopped']);self.assertFalse(any(a[-1]=='stop' for a,e,t in self.fx.calls))
 def test_start_timeout_with_owned_pid_can_reconcile_stop(self):
  self.prepared();self.fx.start_mode='timeout-after-pid'
  with self.assertRaises(subprocess.TimeoutExpired):self.fx.pg.start()
  self.assertTrue(self.fx.pg.stop()['stopped'])
 def test_changed_nonce_never_stops(self):
  self.prepared();self.fx.pg.start();marker=json.loads(self.fx.pg.marker.read_text());marker['nonce']='000000000000';self.fx.pg.marker.write_text(json.dumps(marker))
  with self.assertRaises(n.OwnershipError):self.fx.pg.stop()
  self.assertFalse(any(a[-1]=='stop' for a,e,t in self.fx.calls))
 def test_reused_pid_never_stops(self):
  self.prepared();self.fx.pg.start();p=self.fx.proc/'41111/stat';p.write_text(p.read_text().replace('98765','99999'))
  with self.assertRaises(n.OwnershipError):self.fx.pg.stop()
  self.assertFalse(any(a[-1]=='stop' for a,e,t in self.fx.calls))
 def test_wrong_cgroup_never_stops(self):
  self.prepared();self.fx.pg.start();(self.fx.proc/'41111/cgroup').write_text('0::/system.slice/other.service\n')
  with self.assertRaises(n.OwnershipError):self.fx.pg.stop()
 def test_sql_data_directory_or_nonce_mismatch_blocks_create_database(self):
  self.prepared();self.fx.pg.start();original=self.fx.pg.command
  def mismatch(a,**k):
   raw=original(a,**k)
   if pathlib.Path(a[0]).name=='psql' and 'CREATE DATABASE fixture_only' not in a:
    row=json.loads(raw);row['data_directory']='/existing/production';return json.dumps(row)
   return raw
  self.fx.pg.command=mismatch
  with self.assertRaises(n.OwnershipError):self.fx.pg.bootstrap()
  self.assertFalse(any('CREATE DATABASE fixture_only' in a for a,e,t in self.fx.calls));self.fx.pg.command=original;self.fx.pg.stop()
 def test_foreign_datadir_in_pidfile_never_stops(self):
  self.prepared();self.fx.pg.start();self.fx.pg.pidfile.write_text(self.fx.pg.pidfile.read_text().replace(str(self.fx.pg.data),'/existing/cluster'))
  with self.assertRaises(n.OwnershipError):self.fx.pg.stop()
  self.assertFalse(any(a[-1]=='stop' for a,e,t in self.fx.calls))
 def test_binary_drift_never_executes_changed_stop(self):
  self.prepared();self.fx.pg.start();(self.fx.bin/'pg_ctl').write_text('changed binary')
  with self.assertRaises(n.OwnershipError):self.fx.pg.stop()
  self.assertFalse(any(a[-1]=='stop' for a,e,t in self.fx.calls))
 def test_existing_pidfile_never_starts(self):
  self.prepared();self.fx.make_process()
  with self.assertRaises(n.OwnershipError):self.fx.pg.start()
  self.assertFalse(any(a[-1]=='start' for a,e,t in self.fx.calls))
 def test_socket_released_only_after_verified_stop(self):
  self.prepared();self.fx.pg.start()
  with self.assertRaises(n.OwnershipError):self.fx.pg.release_socket()
  self.fx.pg.stop();self.assertTrue(self.fx.pg.release_socket()['removed']);self.assertFalse(self.fx.pg.socket.exists())
 def test_stop_uses_only_exact_own_data_directory(self):
  self.prepared();self.fx.pg.start();self.fx.pg.stop();calls=[a for a,e,t in self.fx.calls if a[-1]=='stop'];self.assertEqual(calls,[[str(self.fx.bin/'pg_ctl'),'-D',str(self.fx.pg.data),'-m','fast','-w','-t','15','stop']])

class ContextTests(unittest.TestCase):
 def test_root_is_rejected(self):
  with mock.patch.object(n.os,'getuid',return_value=0):
   with self.assertRaises(n.OwnershipError):n.live_context(CG)
 def test_caps_and_wrong_cgroup(self):
  def contents(path,*args,**kwargs):return {'memory.max':str(3*1024**3),'cpu.max':'200000 100000','pids.max':'256'}[path.name]
  with mock.patch.object(n.os,'getuid',return_value=997),mock.patch.object(n.pwd,'getpwuid',return_value=type('User',(),{'pw_name':'vigia-worker'})()),mock.patch.object(n,'cgroup_of',return_value=CG),mock.patch.object(pathlib.Path,'read_text',contents):self.assertEqual(n.live_context(CG)['cpuCores'],2)
  with mock.patch.object(n.os,'getuid',return_value=997),mock.patch.object(n.pwd,'getpwuid',return_value=type('User',(),{'pw_name':'vigia-worker'})()),mock.patch.object(n,'cgroup_of',return_value='/other'):
   with self.assertRaises(n.OwnershipError):n.live_context(CG)
 def test_unbounded_or_excessive_resources_rejected(self):
  for values in [('max','200000 100000','256'),(str(3*1024**3),'300000 100000','256'),(str(3*1024**3),'200000 100000','max')]:
   def contents(path,*args,**kwargs):return dict(zip(['memory.max','cpu.max','pids.max'],values))[path.name]
   with self.subTest(values=values),mock.patch.object(n.os,'getuid',return_value=997),mock.patch.object(n.pwd,'getpwuid',return_value=type('User',(),{'pw_name':'vigia-worker'})()),mock.patch.object(n,'cgroup_of',return_value=CG),mock.patch.object(pathlib.Path,'read_text',contents):
    with self.assertRaises(n.OwnershipError):n.live_context(CG)

if __name__=='__main__':unittest.main()
