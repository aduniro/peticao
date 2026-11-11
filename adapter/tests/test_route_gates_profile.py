from pathlib import Path
import hashlib,importlib.util,json,os,tempfile,unittest
from unittest import mock
SPEC=importlib.util.spec_from_file_location('route_gates_profile',Path(__file__).resolve().parents[1]/'core/route_gates_profile.py');p=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(p)
JOB='1234567890abcdef1234567890abcdef';NONCE='123456abcdef';CG='/system.slice/admin-v2-job-'+JOB+'.service'
def dump(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value));return path
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
class Fixture:
 def __init__(self,root):
  self.root=root;self.worker=root/'worker';self.coord=root/'coord';self.proc=root/'proc';self.cg=root/'cgroup';self.folder=self.worker/'jobs'/JOB
  for d in[self.folder/'work',self.folder/'home',self.coord,self.proc/'sys/kernel/random',self.cg/CG.lstrip('/')]:d.mkdir(parents=True,exist_ok=True)
  self.boot='fixture-boot';(self.proc/'sys/kernel/random/boot_id').write_text(self.boot);self.parent=41111;self.wrapper=os.getpid();self.make_pid(self.parent,'100');self.make_pid(self.wrapper,'200')
  self.config={'id':JOB,'payload':p.fixed_payload(),'digest':hashlib.sha256(p.canonical(p.fixed_payload()).encode()).hexdigest(),'generation':7};self.state={'id':JOB,'state':'running','boot_id':self.boot,'generation':7,'pid':self.parent,'start_ticks':'100'};self.authority={'role':'primary','armed_boot_id':self.boot,'generation':7}
  dump(self.folder/'config.json',self.config);dump(self.folder/'state.json',self.state);dump(self.coord/'authority.json',self.authority);(self.folder/'execution.started').write_text('')
  for name,value in {'memory.max':str(3*1024**3),'cpu.max':'200000 100000','pids.max':'256','memory.swap.max':'0','cgroup.procs':str(self.parent)+'\n'+str(self.wrapper)+'\n'}.items():(self.cg/CG.lstrip('/')/name).write_text(value)
  self.patches=[mock.patch.object(p,'WORKER',self.worker),mock.patch.object(p,'COORDINATOR',self.coord),mock.patch.object(p,'PROC',self.proc),mock.patch.object(p,'CGROUP',self.cg),mock.patch.object(p.pwd,'getpwuid',return_value=type('User',(),{'pw_name':'vigia-worker'})())]
  for patch in self.patches:patch.start()
 def make_pid(self,pid,ticks,cgroup=CG):
  root=self.proc/str(pid);root.mkdir(exist_ok=True);(root/'stat').write_text(str(pid)+' (fixture) '+' '.join(['S']+['0']*18+[ticks]+['0']*8));(root/'cgroup').write_text('0::'+cgroup+'\n')
 def close(self):
  for patch in reversed(self.patches):patch.stop()
 def context(self):return p.queue_context(JOB)
 def receipts(self):
  context=self.context();folder=self.folder/'work/artifacts/govbr-route-gates';folder.mkdir(parents=True);run=self.folder/'work/govbr-route-gates'/NONCE
  guard={'guardInstalled':True,'guardPids':[50001,50002],'testChildPids':[50002],'reportedDenialsTotal':1,'expectedOptionalCliIpcDenials':1,'unexpectedDenials':0}
  proof={'exit':0,'job':JOB,'nonce':NONCE,'run':str(run),'sourceCommit':p.SOURCE,'backendCommit':p.BACKEND,'operationalReady':False,'deployment':False,'testsExecuted':True,'testExit':0,'schemasRemaining':0,'nodeGroupDrained':True,'remainingNodeProcesses':[],'sourceAndDependenciesStable':True,'passedTests':p.EXPECTED_NAMES,'nodePid':50001,'postgresCleanup':{'stopped':True,'identity':{'nonce':NONCE}},'socketCleanup':{'removed':True,'socketDirectory':'/tmp/govbr-route-pg-'+NONCE},**guard}
  att={'id':JOB,'kind':p.KIND,'generation':7,'bootId':self.boot,'configDigest':context['configDigest'],'sourceCommit':p.SOURCE,'limits':{'cgroup':CG,'cpuCores':2,'memoryMaxBytes':3*1024**3,'pidsMax':256}}
  staging={'sourceCommit':p.SOURCE,'backendCommit':p.BACKEND,'sourceFiles':1604,'productionFilesVerified':12043,'devFiles':40,'npmExecuted':False}
  handshake={'version':'PostgreSQL 17.11 (Debian fixture)','database':'fixture_only','nonce':NONCE,'data_directory':str(run/'postgres'),'port':55487}
  lifecycle={'backend':'native-postgresql17','nonce':NONCE,'dataDirectory':str(run/'postgres'),'socketDirectory':'/tmp/govbr-route-pg-'+NONCE,'events':['prepared','initdb-requested','initialized','start-requested','started','verified-postgres','verified-fixture_only','stop-requested','stopped','socket-released'],'binaryPins':{k:{'sha256':v,'version':'fixture (PostgreSQL) 17.11'}for k,v in p.PG_PINS.items()}}
  for name,value in {'result.json':proof,'context.json':att,'staging.json':staging,'pg-handshake.json':handshake,'pg-lifecycle.json':lifecycle,'guard-summary.json':guard}.items():dump(folder/name,value)
  events=[{'kind':'guard-installed','pid':pid,'job':JOB,'nonce':NONCE,'nodeVersion':'v20.19.2','cgroup':CG,'ipcPolicy':'all-blocked','nodeTestContext':'child-v8'if pid==50002 else None}for pid in[50001,50002]]+[{'kind':'denial','pid':50002,'job':JOB,'nonce':NONCE,'category':'expected-optional-cli-ipc-denial','transport':'ipc'}]
  (folder/'guard.jsonl').write_text(''.join(json.dumps(e)+'\n'for e in events));(folder/'tap.log').write_text('\n'.join('ok '+str(i+1)+' - '+name for i,name in enumerate(p.EXPECTED_NAMES))+'\n# fail 0\n# cancelled 0\n');(folder/'stderr.log').write_text('');self.rehash(folder);return folder,context
 def rehash(self,folder):dump(folder/'export-manifest.json',{'job':JOB,'nonce':NONCE,'publication':'COMPLETE_TECHNICAL_EXPORT','requiresOuterJobExitZeroAndDrainedCgroup':True,'files':{name:sha(folder/name)for name in p.RECEIPTS}})
class AdmissionTests(unittest.TestCase):
 def test_pure_admission_never_reads_worker_or_starts_process(self):
  with mock.patch.object(p,'read_json',side_effect=AssertionError('no private reads')),mock.patch.object(p.subprocess,'Popen',side_effect=AssertionError('no execution')):self.assertEqual(p.payload({'action':'submit','id':JOB,'kind':p.KIND,'source_commit':p.SOURCE}),p.fixed_payload())
 def test_extra_rpc_fields_and_wrong_identity_refused(self):
  good={'action':'submit','id':JOB,'kind':p.KIND,'source_commit':p.SOURCE}
  for key in ['env','command','project_subdir','runtime_path','url','timeout','port']:
   with self.assertRaises(p.ProfileError):p.payload({**good,key:'arbitrary'})
  for key,value in [('id','../escape'),('kind','test'),('source_commit',p.BACKEND),('action','status')]:
   with self.assertRaises(p.ProfileError):p.payload({**good,key:value})
 def test_argv_properties_fixed_and_no_shell(self):
  self.assertEqual(p.harness_argv(JOB),['/usr/bin/python3',str(p.STAGE/'run.py'),JOB]);self.assertEqual(p.launcher_properties(),{'CPUQuota':'200%','MemoryMax':'3G','MemorySwapMax':'0','TasksMax':'256','RuntimeMaxSec':'600','TimeoutStopSec':'120','KillMode':'control-group'});self.assertEqual(p.HARD_SECONDS,p.SOFT_SECONDS+p.CLEANUP_SECONDS)
class WithFixture(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.fx=Fixture(Path(self.tmp.name))
 def tearDown(self):self.fx.close();self.tmp.cleanup()
class ContextTests(WithFixture):
 def test_running_fence_allows_only_own_cgroup(self):self.assertEqual(self.fx.context()['configDigest'],self.fx.config['digest'])
 def test_boot_generation_digest_state_pid_and_marker_fail_before_execution(self):
  changes=[('config','id','a'*32),('config','payload',{'kind':'test'}),('config','digest','bad'),('config','generation',True),('state','id','a'*32),('state','state','completed'),('state','start_ticks','reused'),('state','generation',8),('state','boot_id','old'),('authority','generation',True),('authority','role','standby'),('authority','armed_boot_id','old')]
  for which,key,value in changes:
   original=getattr(self.fx,which);path={'config':self.fx.folder/'config.json','state':self.fx.folder/'state.json','authority':self.fx.coord/'authority.json'}[which];dump(path,{**original,key:value})
   with mock.patch.object(p.subprocess,'Popen')as spawn:
    with self.assertRaises(p.ProfileError):self.fx.context()
    spawn.assert_not_called()
   dump(path,original)
  (self.fx.folder/'execution.started').unlink()
  with self.assertRaises(FileNotFoundError):self.fx.context()
 def test_root_wrong_cgroup_and_unbounded_limits_refused(self):
  with mock.patch.object(p.os,'getuid',return_value=0):
   with self.assertRaises(p.ProfileError):self.fx.context()
  (self.fx.proc/str(self.fx.wrapper)/'cgroup').write_text('0::/another.service\n')
  with self.assertRaises(p.ProfileError):self.fx.context()
  (self.fx.proc/str(self.fx.wrapper)/'cgroup').write_text('0::'+CG+'\n')
  for name,bad in [('memory.max','max'),('cpu.max','300000 100000'),('pids.max','max'),('memory.swap.max','100')]:
   path=self.fx.cg/CG.lstrip('/')/name;original=path.read_text();path.write_text(bad)
   with self.assertRaises(p.ProfileError):self.fx.context()
   path.write_text(original)
 def test_marker_exclusive_and_same_id_reconciliation_no_replay(self):
  ctx=self.fx.context();p.claim(JOB,ctx)
  with mock.patch.object(p,'verify_stage')as stage,mock.patch.object(p.subprocess,'Popen')as spawn:
   with self.assertRaises(p.ProfileError):p.run(JOB)
   stage.assert_not_called();spawn.assert_not_called()
  self.assertEqual(p.reconcile(JOB),{'id':JOB,'attempted':True,'receipt':None,'automaticReplay':False})
 def test_whole_cgroup_allows_only_two_verified_controllers(self):
  ctx=self.fx.context();self.assertEqual(p.cgroup_remaining(ctx),[]);(self.fx.cg/CG.lstrip('/')/'cgroup.procs').write_text(str(self.fx.parent)+'\n'+str(self.fx.wrapper)+'\n99999\n');self.assertEqual(p.cgroup_remaining(ctx),[99999])
 def test_reused_controller_pid_refuses_cgroup_waiver(self):
  ctx=self.fx.context();self.fx.make_pid(self.fx.wrapper,'999')
  with self.assertRaises(p.ProfileError):p.cgroup_remaining(ctx)
class ReceiptTests(WithFixture):
 def test_complete_five_guard_pg_proof_admitted_only_with_outer_zero(self):
  folder,ctx=self.fx.receipts();got=p.validate_receipts(folder,ctx,0);self.assertEqual(got['passedTests'],p.EXPECTED_NAMES);self.assertEqual(got['guard']['reportedDenialsTotal'],1)
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,7)
 def test_partial_export_extra_file_hash_tamper_refused(self):
  folder,ctx=self.fx.receipts();(folder/'guard-summary.json').unlink()
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
  folder2=self.fx.folder/'second-export';folder.rename(folder2)
  folder,ctx=self.fx.receipts();(folder/'unexpected').write_text('extra')
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
  (folder/'unexpected').unlink();(folder/'tap.log').write_text('tamper')
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
 def test_semantic_result_failures_cannot_be_hidden_by_rehash(self):
  folder,ctx=self.fx.receipts();original=p.read_json(folder/'result.json')
  mutations={'exit':1,'sourceCommit':p.BACKEND,'backendCommit':p.SOURCE,'nonce':'0'*12,'schemasRemaining':1,'testExit':7,'testsExecuted':False,'sourceAndDependenciesStable':False,'nodeGroupDrained':False,'remainingNodeProcesses':[123],'cleanupErrors':['uncertain'],'postgresCleanup':{'stopped':False},'socketCleanup':{'removed':False},'passedTests':[],'reportedDenialsTotal':0,'testChildPids':[],'deployment':True}
  for key,value in mutations.items():
   dump(folder/'result.json',{**original,key:value});self.fx.rehash(folder)
   with self.assertRaises(p.ProfileError,msg=key):p.validate_receipts(folder,ctx,0)
  dump(folder/'result.json',original);self.fx.rehash(folder)
 def test_context_pins_lifecycle_raw_guard_tap_staging_refused(self):
  folder,ctx=self.fx.receipts()
  for filename,key,value in [('context.json','generation',8),('context.json','sourceCommit',p.BACKEND),('pg-handshake.json','port',5432),('pg-handshake.json','nonce','other'),('pg-lifecycle.json','events',[]),('pg-lifecycle.json','binaryPins',{}),('staging.json','npmExecuted',True),('staging.json','productionFilesVerified',0),('guard-summary.json','unexpectedDenials',1)]:
   original=p.read_json(folder/filename);dump(folder/filename,{**original,key:value});self.fx.rehash(folder)
   with self.assertRaises(p.ProfileError,msg=filename+key):p.validate_receipts(folder,ctx,0)
   dump(folder/filename,original);self.fx.rehash(folder)
  old=(folder/'guard.jsonl').read_text();(folder/'guard.jsonl').write_text(old+json.dumps({'kind':'denial','category':'unexpected-denial','transport':'tls','job':JOB,'nonce':NONCE})+'\n');self.fx.rehash(folder)
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
  (folder/'guard.jsonl').write_text(old);(folder/'tap.log').write_text((folder/'tap.log').read_text()+'ok 6 - extra callback\n');self.fx.rehash(folder)
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
 def test_incomplete_publication_or_traversal_name_refused(self):
  folder,ctx=self.fx.receipts();m=p.read_json(folder/'export-manifest.json');m['files']['../secret']='0'*64;dump(folder/'export-manifest.json',m)
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
 def test_symlink_receipt_refused_before_content_read(self):
  folder,ctx=self.fx.receipts();outside=self.fx.root/'outside';outside.write_text('secret');(folder/'stderr.log').unlink();(folder/'stderr.log').symlink_to(outside)
  with self.assertRaises(p.ProfileError):p.validate_receipts(folder,ctx,0)
class StageTests(WithFixture):
 def stage_fixture(self):
  stage=self.fx.root/'stage';stage.mkdir(mode=0o700);(stage/'artifacts/source').mkdir(parents=True,mode=0o700)
  for d in [stage,stage/'artifacts',stage/'artifacts/source']:d.chmod(0o700)
  h={}
  for name in p.HARNESS_PINS:
   if name=='registry.json':dump(stage/name,p.REGISTRY)
   else:(stage/name).write_text('fixture-only '+name)
   h[name]=sha(stage/name)
  inputs={}
  for name in p.INPUT_PINS:(stage/name).write_text('fixture-input '+name);inputs[name]=sha(stage/name)
  manifest={'files':h,'sourceCommit':p.SOURCE,'backendCommit':p.BACKEND,'kind':p.KIND};dump(stage/'harness-manifest.json',manifest)
  return stage,h,inputs,sha(stage/'harness-manifest.json')
 def test_external_manifest_ten_pins_input_inventory_before_execution(self):
  stage,h,inputs,m=self.stage_fixture()
  with mock.patch.object(p,'STAGE',stage),mock.patch.object(p,'HARNESS_PINS',h),mock.patch.object(p,'INPUT_PINS',inputs),mock.patch.object(p,'HARNESS_SHA',m),mock.patch.object(p,'verify_tools')as tools,mock.patch.object(p,'verify_shared_runtime')as runtime,mock.patch.object(p.subprocess,'Popen')as child:
   self.assertTrue(p.verify_stage()['stageAndInputsVerified']);tools.assert_called_once();runtime.assert_called_once();child.assert_not_called()
   (stage/'dns_guard.cjs').write_text('drift')
   with self.assertRaises(p.ProfileError):p.verify_stage()
 def test_unpinned_self_manifest_or_extra_path_refused(self):
  stage,h,inputs,m=self.stage_fixture()
  with mock.patch.object(p,'STAGE',stage),mock.patch.object(p,'HARNESS_PINS',h),mock.patch.object(p,'INPUT_PINS',inputs),mock.patch.object(p,'HARNESS_SHA',m),mock.patch.object(p,'verify_tools'),mock.patch.object(p,'verify_shared_runtime'):
   (stage/'unreviewed.py').write_text('extra')
   with self.assertRaises(p.ProfileError):p.verify_stage()
   (stage/'unreviewed.py').unlink();dump(stage/'harness-manifest.json',{'files':h})
   with self.assertRaises(p.ProfileError):p.verify_stage()
 def test_hash_and_regular_bound_symlink_hardlink_refused(self):
  f=self.fx.root/'regular';f.write_text('fixture')
  with self.assertRaises(p.ProfileError):p.pin(f,'0'*64)
  link=self.fx.root/'symlink';link.symlink_to(f)
  with self.assertRaises(p.ProfileError):p.digest(link)
  hard=self.fx.root/'hardlink';os.link(f,hard)
  with self.assertRaises(p.ProfileError):p.digest(hard)
class RunTests(WithFixture):
 def run_with_mocks(self,*,harness_code=0,qual_error=None,remaining=None,drift=False):
  child=mock.Mock(pid=51111,returncode=harness_code);child.poll.return_value=harness_code;qualification={'fixture':'synthetic-no-app'};self.fx.make_pid(51111,'300');ctx=self.fx.context();patches=[mock.patch.object(p,'verify_stage',side_effect=[{'pin':'before'},{'pin':'drift'if drift else 'before'}]),mock.patch.object(p,'validate_receipts',side_effect=qual_error,return_value=qualification),mock.patch.object(p,'cgroup_remaining',return_value=remaining or []),mock.patch.object(p.subprocess,'Popen',return_value=child)]
  with patches[0],patches[1],patches[2],patches[3]as spawn:
   code=p.run(JOB);args=spawn.call_args;self.assertEqual(args.args[0],p.harness_argv(JOB));self.assertEqual(args.kwargs['env']['PYTHONDONTWRITEBYTECODE'],'1');self.assertNotIn('DATABASE_URL',args.kwargs['env']);self.assertFalse(args.kwargs.get('shell',False));self.assertTrue(args.kwargs['start_new_session'])
  return code,p.read_json(self.fx.folder/'work/artifacts/route-gates-profile.json')
 def test_wrapper_fixed_child_marker_success_only_drained(self):
  code,proof=self.run_with_mocks();self.assertEqual(code,0);self.assertTrue(proof['runtimeAndSourceInputsStable']);self.assertTrue(proof['cgroupDrainedExceptControllers']);self.assertTrue((self.fx.folder/'route-gates-profile.started').exists())
 def test_receipt_refusal_is_failure_even_child_zero(self):
  code,proof=self.run_with_mocks(qual_error=p.ProfileError('incomplete export'));self.assertEqual(code,1);self.assertIn('incomplete export',proof['error'])
 def test_input_drift_does_not_promote_zero_result(self):
  code,proof=self.run_with_mocks(drift=True);self.assertEqual(code,1);self.assertIn('drift',proof['error'])
 def test_remaining_cgroup_pid_blocks_success(self):
  code,proof=self.run_with_mocks(remaining=[61111]);self.assertEqual(code,1);self.assertFalse(proof['cgroupDrainedExceptControllers'])
 def test_cancel_signal_forward_only_known_harness_no_group_kill(self):
  child=mock.Mock(pid=51111);child.poll.return_value=None;child.wait.return_value=1;child.returncode=1;self.fx.make_pid(51111,'300');ctx=self.fx.context()
  with mock.patch.object(p.os,'killpg',side_effect=AssertionError('no arbitrary group kill')):self.assertEqual(p.stop_child(child,ctx,'300'),1)
  child.terminate.assert_called_once()
  with self.assertRaises(p.ProfileError):p.stop_child(child,ctx,'reused')
 def test_soft_timeout_leaves_uncertain_for_existing_executor(self):
  child=mock.Mock(pid=51111);child.poll.return_value=None;child.wait.side_effect=TimeoutError('cleanup timeout');self.fx.make_pid(51111,'300')
  with self.assertRaises(TimeoutError):p.stop_child(child,self.fx.context(),'300')
if __name__=='__main__':unittest.main()

class CollectorTests(WithFixture):
 def prepared(self):
  import shutil
  inner,previous=self.fx.receipts();qualification=p.validate_receipts(inner,previous,0);p.claim(JOB,previous)
  result={'kind':p.KIND,'jobId':JOB,'sourceCommit':p.SOURCE,'backendCommit':p.BACKEND,'context':previous,'exit':0,'harnessExit':0,'requiresOuterQueueExitZero':True,'cgroupDrainedExceptControllers':True,'remainingCgroupPids':[],'runtimeAndSourceInputsStable':True,'qualification':qualification,'deployment':False,'operationalReady':False}
  dump(self.fx.folder/'work/artifacts/route-gates-profile.json',result);shutil.copytree(self.fx.folder/'work/artifacts',self.fx.folder/'artifacts');current={**previous,'wrapperPid':previous['parentPid'],'wrapperStartTicks':previous['parentStartTicks']};return previous,current
 def test_collector_requires_external_zero_complete_artifacts_and_only_queue_pid(self):
  previous,current=self.prepared()
  with mock.patch.object(p,'queue_context',return_value=current),mock.patch.object(p,'cgroup_remaining',return_value=[])as remaining:
   result=p.qualify_collected(self.fx.folder,0);self.assertTrue(result['qualified']);remaining.assert_called_once_with(current,wrapper_allowed=False)
  with self.assertRaises(p.ProfileError):p.qualify_collected(self.fx.folder,7)
 def test_zero_internal_result_never_overrides_remaining_pid(self):
  previous,current=self.prepared()
  with mock.patch.object(p,'queue_context',return_value=current),mock.patch.object(p,'cgroup_remaining',return_value=[99999]):
   with self.assertRaises(p.ProfileError):p.qualify_collected(self.fx.folder,0)
 def test_profile_tamper_generation_marker_extra_output_refused(self):
  previous,current=self.prepared();path=self.fx.folder/'artifacts/route-gates-profile.json';original=p.read_json(path)
  for key,value in [('exit',1),('harnessExit',7),('runtimeAndSourceInputsStable',False),('remainingCgroupPids',[999]),('sourceCommit',p.BACKEND),('qualification',{}),('cleanupError','uncertain')]:
   dump(path,{**original,key:value})
   with mock.patch.object(p,'queue_context',return_value=current),mock.patch.object(p,'cgroup_remaining',return_value=[]):
    with self.assertRaises(p.ProfileError,msg=key):p.qualify_collected(self.fx.folder,0)
  dump(path,original);(self.fx.folder/'artifacts/extra.txt').write_text('extra')
  with mock.patch.object(p,'queue_context',return_value=current):
   with self.assertRaises(p.ProfileError):p.qualify_collected(self.fx.folder,0)
  (self.fx.folder/'artifacts/extra.txt').unlink();dump(self.fx.folder/'route-gates-profile.started',{**previous,'generation':8})
  with mock.patch.object(p,'queue_context',return_value=current):
   with self.assertRaises(p.ProfileError):p.qualify_collected(self.fx.folder,0)
 def test_final_gate_must_run_in_existing_queue_controller(self):
  previous,current=self.prepared()
  with mock.patch.object(p,'queue_context',return_value=previous):
   with self.assertRaises(p.ProfileError):p.qualify_collected(self.fx.folder,0)

class TimingTests(WithFixture):
 def test_timeout_attempts_known_child_cleanup_and_never_qualifies(self):
  child=mock.Mock(pid=51111,returncode=1);child.poll.return_value=None;child.wait.return_value=1;self.fx.make_pid(51111,'300')
  with mock.patch.object(p,'verify_stage',return_value={'pins':'fixture'}),mock.patch.object(p.subprocess,'Popen',return_value=child),mock.patch.object(p.time,'monotonic',side_effect=[0,601]),mock.patch.object(p,'cgroup_remaining',return_value=[]),mock.patch.object(p,'validate_receipts')as qualify:
   self.assertEqual(p.run(JOB),1);qualify.assert_not_called();child.terminate.assert_called_once()
  proof=p.read_json(self.fx.folder/'work/artifacts/route-gates-profile.json');self.assertIn('soft_deadline',proof['error'])
 def test_cancel_attempts_cleanup_without_replay_or_group_kill(self):
  child=mock.Mock(pid=51111,returncode=1);child.poll.return_value=None;child.wait.return_value=1;self.fx.make_pid(51111,'300')
  with mock.patch.object(p,'verify_stage',return_value={'pins':'fixture'}),mock.patch.object(p.subprocess,'Popen',return_value=child),mock.patch.object(p.time,'sleep',side_effect=p.Canceled('fixture cancellation')),mock.patch.object(p,'cgroup_remaining',return_value=[]),mock.patch.object(p.os,'killpg',side_effect=AssertionError('no group signals')):
   self.assertEqual(p.run(JOB),1);child.terminate.assert_called_once();self.assertTrue(p.reconcile(JOB)['attempted'])
 def test_cleanup_deadline_never_signals_reused_pid_or_arbitrary_descendants(self):
  child=mock.Mock(pid=51111);child.poll.return_value=None;child.wait.side_effect=p.subprocess.TimeoutExpired('fixed harness',110);self.fx.make_pid(51111,'300')
  with self.assertRaises(p.ProfileError):p.stop_child(child,self.fx.context(),'300')
  child.kill.assert_not_called();self.assertEqual(child.wait.call_args.kwargs['timeout'],110)

class RepeatedSignalCleanupTests(WithFixture):
 def test_unit_term_then_repeated_term_during_wait_preserves_receipt(self):
  import signal
  child=mock.Mock(pid=51111,returncode=1);child.poll.return_value=None;self.fx.make_pid(51111,'300')
  def term_in_execution(_):signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
  def term_during_cleanup(timeout=None):
   signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None);signal.getsignal(signal.SIGINT)(signal.SIGINT,None);return 1
  child.wait.side_effect=term_during_cleanup
  with mock.patch.object(p,'verify_stage',return_value={'pins':'fixture'}),mock.patch.object(p.subprocess,'Popen',return_value=child),mock.patch.object(p.time,'sleep',side_effect=term_in_execution),mock.patch.object(p,'cgroup_remaining',return_value=[]):self.assertEqual(p.run(JOB),1)
  child.terminate.assert_called_once();child.wait.assert_called_once();proof=p.read_json(self.fx.folder/'work/artifacts/route-gates-profile.json');self.assertEqual(proof['cancelSignals'],3);self.assertNotIn('cleanupError',proof);self.assertTrue(p.reconcile(JOB)['attempted'])
 def test_term_during_atomic_publication_cannot_return_success(self):
  import signal
  child=mock.Mock(pid=51111,returncode=0);child.poll.return_value=0;self.fx.make_pid(51111,'300');publish=p.atomic_json
  def repeated(path,data):
   signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None);signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None);return publish(path,data)
  old=signal.getsignal(signal.SIGTERM)
  with mock.patch.object(p,'verify_stage',return_value={'pins':'fixture'}),mock.patch.object(p,'validate_receipts',return_value={'fixture':True}),mock.patch.object(p.subprocess,'Popen',return_value=child),mock.patch.object(p,'cgroup_remaining',return_value=[]),mock.patch.object(p,'atomic_json',side_effect=repeated):self.assertEqual(p.run(JOB),1)
  self.assertTrue((self.fx.folder/'work/artifacts/route-gates-profile.json').is_file());self.assertIs(signal.getsignal(signal.SIGTERM),old)
