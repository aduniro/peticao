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
spec=importlib.util.spec_from_file_location('installerNative',ROOT/'install_native.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

class InstallTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.plan=copy.deepcopy(m.load_plan());source=self.root/'source';(source/'code').mkdir(parents=True)
  self.plan['sourceRoot']=str(source);self.plan['queue']=str(self.root/'queue.sqlite');self.plan['installPaths']={}
  for name in ['coordinator.py','history_native_profile.py','launch.py']:
   dest=self.root/name;self.plan['installPaths'][name]=str(dest)
   if name!='history_native_profile.py':dest.write_text('old '+name);dest.chmod(0o755);self.plan['oldPins'][name]=sha(dest)
   fresh=source/'code'/name;fresh.write_text('new '+name);self.plan['newPins'][name]=sha(fresh)
  with sqlite3.connect(self.plan['queue'])as c:
   c.execute('PRAGMA journal_mode=WAL');c.execute('CREATE TABLE jobs(id text,state text)');c.execute('CREATE TABLE events(event text)');c.execute("INSERT INTO jobs VALUES('historical','completed')");c.execute("INSERT INTO events VALUES('preserve me')")
  preserved=self.root/'untouched_runtime_profile.py';preserved.write_text('old fixed runtime profile');self.plan['preservedPins']={str(preserved):sha(preserved)}
  self.quiet=mock.patch.object(m,'quiescent',side_effect=lambda plan,*args:m.queue_idle(Path(plan['queue'])));self.quiet.start()
  self.fence={'boot_id':'fixture-boot','role':'primary','generation':7};self.fence_patch=mock.patch.object(m,'read_fence',side_effect=lambda plan:dict(self.fence));self.fence_patch.start();self.inputs_patch=mock.patch.object(m,'verify_inputs');self.inputs_patch.start()
  self.control=[];self.backup=self.root/'backup'
 def tearDown(self):self.inputs_patch.stop();self.fence_patch.stop();self.quiet.stop();self.tmp.cleanup()
 def rows(self):
  with sqlite3.connect(self.plan['queue'])as c:return(c.execute('SELECT * FROM jobs').fetchall(),c.execute('SELECT * FROM events').fetchall())
 def test_default_cli_is_pure_dry_run(self):
  p=subprocess.run(['/usr/bin/python3',str(ROOT/'install_native.py')],capture_output=True,text=True,check=True)
  result=json.loads(p.stdout);self.assertEqual(result['mode'],'DRY_RUN');self.assertFalse(result['mutations']);self.assertEqual(result['futureSubmitOnlyAfterInstallVerification']['id'],'PARENT_MUST_RESERVE_NEW_JOB_ID');self.assertFalse(result['plan']['appReleaseReady'])
 def test_reviewed_plan_pin_rejects_tamper(self):
  fake=self.root/'plan.json';fake.write_text('{}')
  with mock.patch.object(m,'__file__',str(self.root/'install_native.py')):
   with self.assertRaisesRegex(ValueError,'reviewed_plan_changed'):m.load_plan()
 def test_preimage_guard_aborts_without_stopping_or_backup(self):
  Path(self.plan['installPaths']['coordinator.py']).write_text('foreign edit')
  with self.assertRaisesRegex(ValueError,'preimage_changed'):m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertFalse(self.backup.exists());self.assertEqual(self.control,[])
 def test_unexpected_helper_is_never_overwritten(self):
  Path(self.plan['installPaths']['history_native_profile.py']).write_text('do not overwrite')
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
  self.assertEqual(result['exit'],0);self.assertFalse(result['queueRestored']);self.assertEqual(self.rows(),before);self.assertEqual(order,['history_native_profile.py','launch.py','coordinator.py']);self.assertEqual(self.control,['stop','start']);self.assertTrue((self.backup/'queue.sqlite').exists())
 def test_writer_barrier_blocks_arrival_during_rollback_then_preserves_event_after_release(self):
  actual=m.atomic_copy;failed=False
  def failing(src,dst,*args,**kwargs):
   nonlocal failed
   actual(src,dst,*args,**kwargs)
   if dst==Path(self.plan['installPaths']['launch.py'])and not failed:
    failed=True
    with sqlite3.connect(self.plan['queue'],timeout=0)as c:
     with self.assertRaises(sqlite3.OperationalError):c.execute("INSERT INTO events VALUES('blocked during maintenance')")
    raise OSError('fixture after atomic replace')
  with mock.patch.object(m,'atomic_copy',side_effect=failing):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertTrue(result['codeRollback']);self.assertFalse(result['queueRestored']);self.assertEqual(len(self.rows()[1]),1);self.assertFalse(Path(self.plan['installPaths']['history_native_profile.py']).exists())
  with sqlite3.connect(self.plan['queue'])as c:c.execute("INSERT INTO events VALUES('after writer release; preserve')")
  self.assertEqual(len(self.rows()[1]),2)
  for name in ['coordinator.py','launch.py']:self.assertEqual(sha(Path(self.plan['installPaths'][name])),self.plan['oldPins'][name])
  self.assertEqual(self.control,['stop','start'])
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
  with mock.patch.object(sys,'argv',['install_native.py','--apply']),mock.patch.object(m.os,'geteuid',return_value=1000),mock.patch.object(m,'service')as service:
   with self.assertRaises(PermissionError):m.main()
   service.assert_not_called()
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
 def test_new_backup_root_under_sgid_parent_is700_without_parent_change(self):
  parent=self.root/'sgid-parent';parent.mkdir();parent.chmod(0o2770);before=parent.stat().st_mode;child=parent/'backups'
  self.assertTrue(m.create_private_backup_root(child,os.getuid()));self.assertEqual(child.stat().st_mode&0o7777,0o700);self.assertEqual(parent.stat().st_mode,before)
 def test_preexisting_backup_root2700_is_preserved_and_refused(self):
  parent=self.root/'sgid-parent';parent.mkdir();parent.chmod(0o2770);child=parent/'existing';child.mkdir();child.chmod(0o2700);before=parent.stat().st_mode
  with mock.patch.object(m.os,'fchmod')as chmod:
   with self.assertRaisesRegex(ValueError,'directory_not_private_owner'):m.create_private_backup_root(child,os.getuid())
   chmod.assert_not_called()
  self.assertEqual(child.stat().st_mode&0o7777,0o2700);self.assertEqual(parent.stat().st_mode,before)
 def test_preimage_symlink_is_refused(self):
  path=Path(self.plan['installPaths']['coordinator.py']);path.unlink();path.symlink_to('/etc/hostname')
  with self.assertRaises(OSError):m.preimages(self.plan)
 def stage_fixture(self):
  src=Path(self.plan['sourceRoot']);harness=src/'harness';harness.mkdir(mode=0o700);(harness/'schema-sources').mkdir(mode=0o700)
  for name in ['profile-manifest.json','functional_smoke.py','schema-sources/db.ts']:(harness/name).write_text('fixed '+name)
  self.plan['stagePins']={str(p.relative_to(harness)):sha(p)for p in harness.rglob('*')if p.is_file()}
  shared=self.root/'shared';shared.mkdir(mode=0o700);inputs=shared/'inputs';inputs.mkdir(mode=0o700);archive=inputs/'runtime.tar';archive.write_bytes(b'FAKE archive fixture only');manifest=inputs/'release-manifest.json';manifest.write_text(json.dumps({'source_commit':self.plan['applicationSourceCommit'],'release_id':self.plan['releaseId'],'files':{'fixture':{}}}))
  self.plan.update(runtimeInputs=str(inputs),archiveBytes=archive.stat().st_size,archiveSha256=sha(archive),releaseManifestSha256=sha(manifest),releaseFiles=1,stageRoot=str(self.root/'harness-final'))
  return harness,inputs
 def test_shared_runtime_is_verified_without_copy_or_overlay(self):
  harness,inputs=self.stage_fixture();dest=Path(self.plan['stageRoot']);actual=m.atomic_copy;copied=[]
  def tracked(src,dst,*args,**kw):copied.append(src);return actual(src,dst,*args,**kw)
  real_private=m.private_dir
  with mock.patch.object(m,'private_dir',side_effect=lambda path,uid:real_private(path,os.getuid())),mock.patch.object(m.os,'chown'),mock.patch.object(m,'atomic_copy',side_effect=lambda src,dst,mode,*owners:tracked(src,dst,mode)):
   m.stage_runtime(self.plan,'a'*32);before={str(p):sha(p)for p in inputs.iterdir()};m.stage_runtime(self.plan,'a'*32)
  self.assertEqual(len(copied),3);self.assertFalse(any(p.parent==inputs for p in copied));self.assertEqual(before,{str(p):sha(p)for p in inputs.iterdir()});self.assertEqual({str(p.relative_to(dest))for p in dest.rglob('*')if p.is_file()},set(self.plan['stagePins']))
 def test_stage_extras_markers_pycache_symlinks_refused_not_deleted(self):
  harness,inputs=self.stage_fixture()
  for name in ['.staging-owner.json','__pycache__','foreign']:
   path=harness/name
   if name=='__pycache__':path.mkdir()
   else:path.write_text('preserve me')
   with self.assertRaisesRegex(ValueError,'extra|unexpected'):m.verify_harness(self.plan,harness,os.getuid())
   self.assertTrue(path.exists())
   if path.is_dir():path.rmdir()
   else:path.unlink()
  link=harness/'foreign';link.symlink_to(harness/'profile-manifest.json')
  with self.assertRaisesRegex(ValueError,'harness_link'):m.verify_harness(self.plan,harness,os.getuid())
  self.assertTrue(link.is_symlink())
 def test_existing_partial_stage_never_chmod_or_overlay(self):
  harness,inputs=self.stage_fixture();dest=Path(self.plan['stageRoot']);dest.mkdir();dest.chmod(0o2700)
  with mock.patch.object(m,'verify_runtime'),mock.patch.object(m.os,'chmod')as chmod,mock.patch.object(m,'atomic_copy')as copied:
   with self.assertRaises(ValueError):m.stage_runtime(self.plan,'a'*32)
   chmod.assert_not_called();copied.assert_not_called()
  self.assertEqual(dest.stat().st_mode&0o7777,0o2700)
 def test_preexisting_temporary_stage_preserved(self):
  harness,inputs=self.stage_fixture();dest=Path(self.plan['stageRoot']);partial=dest.with_name('.'+dest.name+'.'+'a'*32+'.stage');partial.mkdir(mode=0o700);(partial/'foreign').write_text('preserve')
  with mock.patch.object(m,'verify_runtime'),mock.patch.object(m,'atomic_copy')as copied:
   with self.assertRaisesRegex(ValueError,'partial_stage'):m.stage_runtime(self.plan,'a'*32)
   copied.assert_not_called()
  self.assertEqual((partial/'foreign').read_text(),'preserve')
 def test_cancel_rolls_back_code_only_and_preserves_receipt(self):
  actual=m.atomic_copy;cancelled=False
  def failing(src,dst,*args,**kw):
   nonlocal cancelled
   actual(src,dst,*args,**kw)
   if dst==Path(self.plan['installPaths']['launch.py'])and not cancelled:cancelled=True;raise KeyboardInterrupt('fixture cancelled')
  with mock.patch.object(m,'atomic_copy',side_effect=failing):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertTrue(result['codeRollback']);self.assertFalse(result['queueRestored']);self.assertTrue((self.backup/'result.json').exists());self.assertEqual(self.control,['stop','start'])
 def test_lost_start_response_with_unproved_quiescence_preserves_code(self):
  calls=[]
  def control(action):
   self.control.append(action)
   if action=='start':raise TimeoutError('start response lost')
  def quiet(plan,stopped=False):
   calls.append(stopped)
   if self.control==['stop','start']:raise ValueError('service could be active')
  with mock.patch.object(m,'quiescent',side_effect=quiet):result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['codeRollback']);self.assertEqual(self.control,['stop','start']);self.assertIn('quiescence_unproved',result['rollbackError'])
  for name in self.plan['installOrder']:self.assertEqual(sha(Path(self.plan['installPaths'][name])),self.plan['newPins'][name])
 def test_preserved_runtime_profile_drift_refused(self):
  path=Path(next(iter(self.plan['preservedPins'])));path.write_text('foreign')
  with self.assertRaisesRegex(ValueError,'preserved_runtime'):m.verify_preserved(self.plan)
 def test_failed_unit_observation_blocks_install_quiescence(self):
  # No actual systemctl/PG operation: fixed unit output fixture only.
  row={'Id':'admin-v2-job-'+'a'*32+'.service','LoadState':'loaded','ActiveState':'deactivating','SubState':'stop-sigterm','MainPID':'44','ControlGroup':'/system.slice/admin-v2-job-'+'a'*32+'.service'}
  output=mock.Mock(returncode=0,stdout='\n'.join(k+'='+v for k,v in row.items()))
  with mock.patch.object(m.subprocess,'run',return_value=output)as run:
   with self.assertRaisesRegex(ValueError,'not_drained'):m.verify_job_drain('a'*32,self.root/'unused')
   self.assertEqual(run.call_args.args[0][:2],['/usr/bin/systemctl','show'])
 def test_read_only_check_does_not_stage_backup_or_control_service(self):
  with mock.patch.object(sys,'argv',['install_native.py','--check']),mock.patch.object(m,'check_host',return_value='fixture'),mock.patch.object(m,'preimages'),mock.patch.object(m,'verify_inputs'),mock.patch.object(m,'stage_runtime')as stage,mock.patch.object(m,'install_transaction')as transaction,mock.patch.object(m,'service')as service,contextlib.redirect_stdout(__import__('io').StringIO()):
   self.assertEqual(m.main(),0);stage.assert_not_called();transaction.assert_not_called();service.assert_not_called()
 def test_no_queue_restore_or_automatic_submission_in_operator(self):
  tree=__import__('ast').parse((ROOT/'install_native.py').read_text())
  calls=[node for node in __import__('ast').walk(tree)if isinstance(node,__import__('ast').Call)]
  # Only SQLite backup(source,destination) snapshot; no copying a snapshot onto live queue.
  self.assertFalse(any(isinstance(node.func,__import__('ast').Attribute)and node.func.attr in {'restore','submit'}for node in calls))
  plan=m.load_plan();self.assertFalse(plan['submitAutomatically']);self.assertFalse(plan['rollbackRestoresQueue']);self.assertFalse(plan['appReleaseReady']);self.assertNotIn('runtime_profile.py',plan['installOrder'])

class Revision2Tests(unittest.TestCase):
 setUp=InstallTests.setUp
 tearDown=InstallTests.tearDown
 rows=InstallTests.rows
 def test_stop_effect_then_lost_response_recovers_from_observed_inactive(self):
  active=True
  def control(action):
   nonlocal active
   self.control.append(action)
   if action=='stop':active=False;raise subprocess.TimeoutExpired('fixed systemctl stop',30)
   active=True
  def observed(plan,stopped=False):
   if stopped and active:raise ValueError('service still active')
   return m.queue_idle(Path(plan['queue']))
  before=self.rows()
  with mock.patch.object(m,'quiescent',side_effect=observed):result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],1);self.assertTrue(result['stopObserved']);self.assertTrue(result['codeRollback']);self.assertTrue(result['recoveryStartReturned']);self.assertEqual(self.control,['stop','start']);self.assertTrue(active);self.assertEqual(self.rows(),before)
 def test_stop_without_effect_does_not_claim_safe_restart(self):
  def control(action):self.control.append(action);raise subprocess.TimeoutExpired('stop failed without effect',30)
  def observed(plan,stopped=False):
   if stopped:raise ValueError('service still active')
   return m.queue_idle(Path(plan['queue']))
  with mock.patch.object(m,'quiescent',side_effect=observed):result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(self.control,['stop']);self.assertFalse(result['codeRollback']);self.assertFalse(result['stopObserved'])
 def test_two_connections_exclude_rpc_writer_but_not_reader(self):
  queue=Path(self.plan['queue']);before=self.rows();barrier=m.QueueWriterBarrier(queue);barrier.acquire()
  try:
   barrier.assert_held()
   with sqlite3.connect(queue,timeout=0)as rpc:
    self.assertEqual(rpc.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
    with self.assertRaises(sqlite3.OperationalError):rpc.execute("INSERT INTO events VALUES('RPC blocked')")
   self.assertEqual(self.rows(),before)
  finally:barrier.release()
  with sqlite3.connect(queue,timeout=0)as rpc:rpc.execute("INSERT INTO events VALUES('RPC admitted after cutover')")
  self.assertEqual(len(self.rows()[1]),2)
 def test_start_service_fake_can_write_sqlite_only_after_qualified_cutover(self):
  def control(action):
   self.control.append(action)
   if action=='start':
    checkpoint=json.loads((self.backup/'result.json').read_text());self.assertTrue(checkpoint['cutoverQualified']);self.assertEqual(checkpoint['phase'],'QUALIFIED_CODE_AND_INPUTS_SERVICE_STOPPED')
    with sqlite3.connect(self.plan['queue'],timeout=0)as c:c.execute("INSERT INTO events VALUES('fake daemon startup write; no deadlock')")
  result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],0);self.assertTrue(result['writerBarrierReleasedBeforeStart']);self.assertEqual(len(self.rows()[1]),2);self.assertEqual(self.control,['stop','start'])
 def test_generation_change_after_stop_forbids_mutation_rollback_restart(self):
  before=self.rows()
  def control(action):
   self.control.append(action)
   if action=='stop':self.fence['generation']=8
  result=m.install_transaction(self.plan,self.backup,control,False,expected_fence={'boot_id':'fixture-boot','role':'primary','generation':7})
  self.assertEqual(result['exit'],1);self.assertEqual(result['changed'],[]);self.assertFalse(result['codeRollback']);self.assertEqual(self.control,['stop']);self.assertEqual(self.rows(),before)
 def test_generation_drift_after_atomic_replace_preserves_partial_code_no_restart(self):
  actual=m.atomic_copy
  def copied(src,dst,*args,**kw):
   actual(src,dst,*args,**kw)
   if dst==Path(self.plan['installPaths']['launch.py']):self.fence['generation']=8
  with mock.patch.object(m,'atomic_copy',side_effect=copied):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['codeRollback']);self.assertEqual(self.control,['stop']);self.assertEqual(sha(Path(self.plan['installPaths']['launch.py'])),self.plan['newPins']['launch.py']);self.assertEqual(sha(Path(self.plan['installPaths']['coordinator.py'])),self.plan['oldPins']['coordinator.py'])
 def test_new_queued_job_after_cutover_blocks_rollback_not_lost(self):
  def control(action):
   self.control.append(action)
   if action=='start':
    with sqlite3.connect(self.plan['queue'],timeout=0)as c:c.execute("INSERT INTO jobs VALUES('new accepted after qualified cutover','queued')")
    raise TimeoutError('fake startup response uncertain')
  result=m.install_transaction(self.plan,self.backup,control,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['codeRollback']);self.assertEqual(self.control,['stop','start']);self.assertIn(('new accepted after qualified cutover','queued'),self.rows()[0]);self.assertFalse(result['queueRestored'])
 def test_inputs_refusal_before_cutover_rolls_back_baseline_then_releases_for_start(self):
  with mock.patch.object(m,'verify_inputs',side_effect=ValueError('fixture staging drift')):result=m.install_transaction(self.plan,self.backup,self.control.append,False)
  self.assertEqual(result['exit'],1);self.assertFalse(result['cutoverQualified']);self.assertTrue(result['codeRollback']);self.assertEqual(self.control,['stop','start'])
 def test_main_apply_requires_expected_context_before_staging(self):
  args=['install_native.py','--apply','--lease-id','a'*32]
  with mock.patch.object(sys,'argv',args),mock.patch.object(m.os,'geteuid',return_value=0),mock.patch.object(m,'check_host',return_value=self.fence),mock.patch.object(m,'preimages'),mock.patch.object(m,'stage_runtime')as stage:
   with self.assertRaisesRegex(ValueError,'expected_boot_and_generation'):m.main()
   stage.assert_not_called()
 def test_main_stale_approved_generation_refused_before_staging(self):
  args=['install_native.py','--apply','--lease-id','a'*32,'--expected-generation','8','--expected-boot-id','11111111-1111-1111-1111-111111111111']
  with mock.patch.object(sys,'argv',args),mock.patch.object(m.os,'geteuid',return_value=0),mock.patch.object(m,'check_host',return_value=self.fence),mock.patch.object(m,'preimages'),mock.patch.object(m,'stage_runtime')as stage:
   with self.assertRaisesRegex(ValueError,'boot_generation_changed'):m.main()
   stage.assert_not_called()

if __name__=='__main__':unittest.main()
