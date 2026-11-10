import copy
import contextlib
import os
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('installer480',ROOT/'install_480.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

class InstallTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.plan=copy.deepcopy(m.load_plan());source=self.root/'source';(source/'code').mkdir(parents=True)
  self.plan['sourceRoot']=str(source);self.plan['queue']=str(self.root/'queue.sqlite');self.plan['installPaths']={}
  for name in ['coordinator.py','runtime_profile.py','launch.py']:
   dest=self.root/name;self.plan['installPaths'][name]=str(dest)
   if name!='runtime_profile.py':dest.write_text('old '+name);dest.chmod(0o755);self.plan['oldPins'][name]=sha(dest)
   fresh=source/'code'/name;fresh.write_text('new '+name);self.plan['newPins'][name]=sha(fresh)
  with sqlite3.connect(self.plan['queue'])as c:
   c.execute('PRAGMA journal_mode=WAL');c.execute('CREATE TABLE jobs(id text,state text)');c.execute('CREATE TABLE events(event text)');c.execute("INSERT INTO jobs VALUES('historical','completed')");c.execute("INSERT INTO events VALUES('preserve me')")
  self.control=[];self.backup=self.root/'backup'
 def tearDown(self):self.tmp.cleanup()
 def rows(self):
  with sqlite3.connect(self.plan['queue'])as c:return(c.execute('SELECT * FROM jobs').fetchall(),c.execute('SELECT * FROM events').fetchall())
 def test_default_cli_is_pure_dry_run(self):
  p=subprocess.run(['/usr/bin/python3',str(ROOT/'install_480.py')],capture_output=True,text=True,check=True)
  result=json.loads(p.stdout);self.assertEqual(result['mode'],'DRY_RUN');self.assertFalse(result['mutations']);self.assertEqual(result['futureSubmitOnlyAfterInstallVerification']['id'],'cad43f085e374bc5876e4cf246ca8572')
 def test_reviewed_plan_pin_rejects_tamper(self):
  fake=self.root/'plan.json';fake.write_text('{}')
  with mock.patch.object(m,'__file__',str(self.root/'install_480.py')):
   with self.assertRaisesRegex(ValueError,'reviewed_plan_changed'):m.load_plan()
 def test_preimage_guard_aborts_without_stopping_or_backup(self):
  Path(self.plan['installPaths']['coordinator.py']).write_text('foreign edit')
  with self.assertRaisesRegex(ValueError,'preimage_changed'):m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertFalse(self.backup.exists());self.assertEqual(self.control,[])
 def test_unexpected_helper_is_never_overwritten(self):
  Path(self.plan['installPaths']['runtime_profile.py']).write_text('do not overwrite')
  with self.assertRaisesRegex(ValueError,'unexpected_existing_helper'):m.preimages(self.plan)
 def test_sqlite_backup_api_captures_wal_consistently(self):
  source=sqlite3.connect(self.plan['queue']);source.execute("INSERT INTO events VALUES('live committed WAL')");source.commit()
  target=self.root/'snapshot.sqlite';m.backup_queue(Path(self.plan['queue']),target)
  with sqlite3.connect(target)as c:self.assertEqual(c.execute('SELECT count(*) FROM events').fetchone()[0],2)
  source.close();self.assertEqual(target.stat().st_mode&0o777,0o600)
 def test_helper_first_coordinator_last_and_queue_preserved(self):
  before=self.rows();actual=m.atomic_copy;order=[]
  def tracked(src,dst,*args,**kwargs):
   if dst in [Path(v)for v in self.plan['installPaths'].values()]:order.append(dst.name)
   return actual(src,dst,*args,**kwargs)
  with mock.patch.object(m,'atomic_copy',side_effect=tracked):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],0);self.assertFalse(result['queueRestored']);self.assertEqual(self.rows(),before);self.assertEqual(order,['runtime_profile.py','launch.py','coordinator.py']);self.assertEqual(self.control,['stop','start']);self.assertTrue((self.backup/'queue.sqlite').exists())
 def test_rollback_code_preserves_new_queue_event_after_snapshot(self):
  actual=m.atomic_copy;failed=False
  def failing(src,dst,*args,**kwargs):
   nonlocal failed
   actual(src,dst,*args,**kwargs)
   if dst==Path(self.plan['installPaths']['launch.py'])and not failed:
    failed=True
    with sqlite3.connect(self.plan['queue'])as c:c.execute("INSERT INTO events VALUES('arrived after backup; never lose')")
    raise OSError('fixture after atomic replace')
  with mock.patch.object(m,'atomic_copy',side_effect=failing):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertTrue(result['codeRollback']);self.assertFalse(result['queueRestored']);self.assertEqual(len(self.rows()[1]),2);self.assertFalse(Path(self.plan['installPaths']['runtime_profile.py']).exists())
  for name in ['coordinator.py','launch.py']:self.assertEqual(sha(Path(self.plan['installPaths'][name])),self.plan['oldPins'][name])
  self.assertEqual(self.control,['stop','start'])
 def test_job_queued_after_stop_is_preserved_and_install_aborts(self):
  def control(action):
   self.control.append(action)
   if action=='stop':
    with sqlite3.connect(self.plan['queue'])as c:c.execute("INSERT INTO jobs VALUES('new','queued')")
  result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],1);self.assertIn(('new','queued'),self.rows()[0]);self.assertFalse((self.backup/'queue.sqlite').exists());self.assertEqual(self.control,['stop','start'])
 def test_foreign_rollback_change_is_preserved_and_service_not_restarted(self):
  actual=m.atomic_copy
  def failing(src,dst,*args,**kwargs):
   actual(src,dst,*args,**kwargs)
   if dst==Path(self.plan['installPaths']['launch.py']):dst.write_text('foreign change');raise OSError('fixture foreign change')
  with mock.patch.object(m,'atomic_copy',side_effect=failing):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['codeRollback']);self.assertIn('foreign_change_preserved',result['rollbackError']);self.assertEqual(self.control,['stop']);self.assertEqual(Path(self.plan['installPaths']['launch.py']).read_text(),'foreign change')
 def test_preimage_changed_after_stop_does_not_restart_unknown_code(self):
  path=Path(self.plan['installPaths']['coordinator.py'])
  def control(action):
   self.control.append(action)
   if action=='stop':path.write_text('foreign code after stop')
  result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['codeRollback']);self.assertEqual(self.control,['stop']);self.assertEqual(path.read_text(),'foreign code after stop')
 def test_non_root_apply_rejected_without_service_operation(self):
  with mock.patch.object(sys,'argv',['install_480.py','--apply']),mock.patch.object(m.os,'geteuid',return_value=1000),mock.patch.object(m,'service')as service:
   with self.assertRaises(PermissionError):m.main()
   service.assert_not_called()
 def stage_fixture(self):
  dest=self.root/'qa-stage';dest.mkdir();(dest/'inputs').mkdir();(dest/'runs').mkdir();(dest/'probe.py').write_text('reviewed fixture probe')
  (dest/'inputs/runtime.tar').write_bytes(b'fake runtime artifact only');(dest/'inputs/release-manifest.json').write_text('{}')
  self.plan['stageRoot']=str(dest);self.plan['stagePins']={'probe.py':sha(dest/'probe.py')};self.plan['archiveSha256']=sha(dest/'inputs/runtime.tar');self.plan['releaseManifestSha256']=sha(dest/'inputs/release-manifest.json');return dest
 def test_verified_existing_stage_is_reused_read_only_without_overlay(self):
  dest=self.stage_fixture();before={str(p):sha(p)for p in dest.rglob('*')if p.is_file()}
  with mock.patch.object(m,'private_dir')as roles,mock.patch.object(m,'atomic_copy')as copy:
   self.assertEqual(m.stage_runtime(self.plan,'1'*32),dest);copy.assert_not_called();self.assertTrue(all(call.args[1]==997 for call in roles.call_args_list))
  self.assertEqual({str(p):sha(p)for p in dest.rglob('*')if p.is_file()},before)
 def test_partial_runtime_transfer_is_not_overlaid_or_completed(self):
  dest=self.stage_fixture();(dest/'inputs/runtime.tar').rename(dest/'inputs/runtime.tar.partial')
  with mock.patch.object(m,'private_dir'),mock.patch.object(m,'atomic_copy')as copy:
   with self.assertRaisesRegex(ValueError,'stage_incomplete_or_extra_input'):m.stage_runtime(self.plan,'1'*32)
   copy.assert_not_called()
  self.assertTrue((dest/'inputs/runtime.tar.partial').exists())
 def marker_fixture(self):
  dest=self.stage_fixture();h=dest/'harness-manifest.json';h.write_text('reviewed fixture manifest');self.plan['stagePins'][h.name]=sha(h)
  value={'createdAt':'2026-11-10T23:00:00Z','verifiedAt':'2026-11-10T23:10:00Z','jobIntent':self.plan['jobId'],'harnessManifestSha256':sha(h),'archiveSha256':self.plan['archiveSha256'],'phase':'archive-and-harness-staged-verified-not-executed','archiveVerified':True,'archiveBytes':475678720,'runtimeStarted':False,'serviceChanged':False}
  marker=dest/'.staging-owner.json';marker.write_text(json.dumps(value));marker.chmod(0o600);return dest,marker,value
 @contextlib.contextmanager
 def marker_metadata(self,path,uid=0,mode=0o600,nlink=1):
  inode=path.stat().st_ino;actual=m.os.fstat
  def observed(fd):
   info=actual(fd)
   if info.st_ino==inode:
    values=list(info);values[4]=uid;values[0]=(info.st_mode&~0o777)|mode;values[3]=nlink;return os.stat_result(values)
   return info
  with mock.patch.object(m.os,'fstat',side_effect=observed):yield
 def test_optional_valid_root_marker_preserved_and_role_groups_separate(self):
  real=m.load_plan();self.assertEqual(real['roles']['coordinator']['gid'],988);self.assertEqual(real['serviceGroup']['gid'],989);self.assertEqual(real['archiveBytes'],475678720)
  dest,marker,value=self.marker_fixture();before=marker.read_bytes()
  with self.marker_metadata(marker),mock.patch.object(m,'private_dir'),mock.patch.object(m,'atomic_copy')as copy:
   self.assertEqual(m.stage_runtime(self.plan,'1'*32),dest);copy.assert_not_called()
  self.assertEqual(marker.read_bytes(),before)
 def test_marker_foreign_tamper_and_other_extra_refused(self):
  dest,marker,value=self.marker_fixture()
  for key,changed in [('jobIntent','f'*32),('harnessManifestSha256','0'*64),('archiveSha256','0'*64),('phase','executed'),('archiveVerified',False),('archiveBytes',475678721),('archiveBytes','475678720'),('runtimeStarted',True),('serviceChanged',True)]:
   marker.write_text(json.dumps({**value,key:changed}))
   with self.marker_metadata(marker),mock.patch.object(m,'private_dir'):
    with self.assertRaisesRegex(ValueError,'stage_marker_binding_changed'):m.verify_stage(self.plan,dest)
  marker.write_text(json.dumps(value));(dest/'foreign-note.json').write_text('{}')
  with self.marker_metadata(marker),mock.patch.object(m,'private_dir'):
   with self.assertRaisesRegex(ValueError,'unexpected_stage_entry'):m.verify_stage(self.plan,dest)
  self.assertTrue((dest/'foreign-note.json').exists())
 def test_marker_wrong_owner_mode_or_link_count_refused(self):
  dest,marker,value=self.marker_fixture()
  for options in [dict(uid=1000),dict(mode=0o644),dict(nlink=2)]:
   with self.marker_metadata(marker,**options),mock.patch.object(m,'private_dir'):
    with self.assertRaisesRegex(ValueError,'stage_marker_not_root_private_regular'):m.verify_stage(self.plan,dest)
 def test_marker_symlink_refused_without_deleting_evidence(self):
  dest,marker,value=self.marker_fixture();target=self.root/'root-receipt.json';marker.rename(target);marker.symlink_to(target)
  with mock.patch.object(m,'private_dir'):
   with self.assertRaises(OSError):m.verify_stage(self.plan,dest)
  self.assertTrue(marker.is_symlink());self.assertTrue(target.exists())
 def test_worker_parent_full_sgid2770_accepted_and_0770_drift_refused(self):
  expected=m.load_plan()['workerParent'];self.assertEqual(expected['mode'],0o2770);self.assertEqual(expected['mode'],1528)
  path=Path('/fixture-worker-parent');values=list(self.root.stat());values[4]=999;values[5]=989
  with mock.patch.object(Path,'resolve',return_value=path),mock.patch.object(Path,'is_symlink',return_value=False):
   for mode,valid in [(0o2770,True),(0o770,False)]:
    values[0]=0o040000|mode
    with mock.patch.object(Path,'stat',return_value=os.stat_result(values)):
     if valid:m.verify_worker_parent(path,expected)
     else:
      with self.assertRaisesRegex(ValueError,'worker_parent_changed_do_not_chmod'):m.verify_worker_parent(path,expected)
 def test_preimage_symlink_is_refused(self):
  path=Path(self.plan['installPaths']['coordinator.py']);path.unlink();path.symlink_to('/etc/hostname')
  with self.assertRaises(OSError):m.preimages(self.plan)

if __name__=='__main__':unittest.main()
