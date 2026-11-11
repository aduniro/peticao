import json,os,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'core'))
import coordinator as c
class DrainTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.job='a'*32;self.worker=self.root/'worker';self.folder=self.worker/'jobs'/self.job;self.folder.mkdir(parents=True);(self.folder/'execution.started').write_text('');(self.folder/'state.json').write_text(json.dumps({'id':self.job,'state':'failed'}));self.cg=self.root/'cgroup';self.group=self.cg/'system.slice'/('admin-v2-job-'+self.job+'.service');self.group.mkdir(parents=True);(self.group/'cgroup.events').write_text('populated 0\nfrozen 0\n');(self.group/'cgroup.procs').write_text('');self.row={'id':self.job,'started_at':'fixture','state':'failed'};self.values={'Id':'admin-v2-job-'+self.job+'.service','LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlGroup':'/system.slice/admin-v2-job-'+self.job+'.service'}
  self.patch=mock.patch.multiple(c,WORKER=self.worker,CGROUP_ROOT=self.cg);self.patch.start();self.env=mock.patch.dict(os.environ,ADMIN_CLUSTER_TEST_INLINE='0');self.env.start()
 def tearDown(self):self.env.stop();self.patch.stop();self.tmp.cleanup()
 def observe(self,**change):return mock.Mock(returncode=0,stdout='\n'.join(k+'='+v for k,v in {**self.values,**change}.items()))
 def test_terminal_db_waits_for_unit_and_cgroup(self):
  for state in ['failed','canceled','interrupted','completed']:
   self.row['state']=state
   for change in [{'ActiveState':'deactivating','SubState':'stop-sigterm'},{'ActiveState':'active','MainPID':'123'},{'ControlGroup':'/foreign'},{'LoadState':'error'}]:
    with self.subTest(state=state,change=change),mock.patch.object(c.subprocess,'run',return_value=self.observe(**change)):self.assertFalse(c.managed_job_drain(self.row)['drained'])
  with mock.patch.object(c.subprocess,'run',return_value=self.observe()):
   self.assertTrue(c.managed_job_drain(self.row)['drained']);(self.group/'cgroup.events').write_text('populated 1\n');self.assertFalse(c.managed_job_drain(self.row)['drained'])
 def test_unknown_cannot_release_queue_and_no_control_commands(self):
  with mock.patch.object(c.subprocess,'run',side_effect=TimeoutError('fixture')):
   self.assertFalse(c.managed_job_drain(self.row)['drained'])
  with mock.patch.object(c.subprocess,'run',return_value=self.observe())as run:
   c.managed_job_drain(self.row);self.assertEqual(run.call_args.args[0][:3],['/usr/bin/systemctl','show','admin-v2-job-'+self.job+'.service'])
 def test_launch_uncertain_not_found_never_proves_no_launch(self):
  (self.folder/'execution.started').unlink()
  with mock.patch.object(c.subprocess,'run',return_value=self.observe(LoadState='not-found')):self.assertFalse(c.managed_job_drain(self.row)['drained'])
 def test_canceled_queued_without_any_starting_event_skips_unit(self):
  import shutil
  shutil.rmtree(self.folder);self.row.update(state='canceled',started_at=None)
  with mock.patch.object(c.subprocess,'run')as run:self.assertTrue(c.managed_job_drain(self.row,False)['drained']);run.assert_not_called()
  self.assertFalse(c.managed_job_drain(self.row,True)['drained'])
 def test_empty_cgroup_and_finished_job_prove_drained(self):
  with mock.patch.object(c.subprocess,'run',return_value=self.observe()):
   self.assertTrue(c.managed_job_drain(self.row)['drained']);(self.group/'cgroup.procs').write_text('123\n');self.assertFalse(c.managed_job_drain(self.row)['drained'])
 def test_garbage_collected_unit_requires_finished_execution_and_no_cgroup(self):
  import shutil
  shutil.rmtree(self.group);obs=self.observe(LoadState='not-found');obs.returncode=4
  with mock.patch.object(c.subprocess,'run',return_value=obs):self.assertTrue(c.managed_job_drain(self.row)['drained'])
  (self.folder/'execution.started').unlink()
  with mock.patch.object(c.subprocess,'run',return_value=obs):self.assertFalse(c.managed_job_drain(self.row)['drained'])
 def test_dispatch_will_not_create_next_job_when_drain_unknown(self):
  coord=self.root/'coord'
  with mock.patch.object(c,'ROOT',coord),mock.patch.dict(os.environ,ADMIN_CLUSTER_BOOT='fixture',ADMIN_CLUSTER_DISPATCH='1'):
   c.initialize();c.atomic(coord/'authority.json',{'role':'primary','generation':1,'armed_boot_id':'fixture'})
   c.submit({'action':'submit','id':self.job,'kind':'fixture-pass'})
   with c.connect()as db:db.execute("UPDATE jobs SET state='failed',started_at='fixture' WHERE id=?",(self.job,))
   other='b'*32;c.submit({'action':'submit','id':other,'kind':'fixture-pass'})
   with mock.patch.object(c,'managed_job_drain',return_value={'drained':False,'reason':'unknown'}),mock.patch.object(c.subprocess,'run')as launch:
    self.assertIsNone(c.dispatch_once());self.assertFalse((self.worker/'jobs'/other).exists());launch.assert_not_called()
   with c.connect()as db:self.assertEqual(db.execute("SELECT count(*) FROM events WHERE kind='dispatch_drain_blocked'").fetchone()[0],1)
if __name__=='__main__':unittest.main()
