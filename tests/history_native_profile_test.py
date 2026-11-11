import ast,copy,hashlib,json,os,signal,sys,tempfile,time,unittest
from pathlib import Path
from unittest import mock
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/'core'));sys.path.insert(0,str(BASE/'r0002_harness'))
import history_native_profile as p
import coordinator as c
import executor_context as e
import native_pg as n

class HistoryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.job='4'*32;self.group='/system.slice/admin-v2-job-'+self.job+'.service';self.context={'jobId':self.job,'configDigest':'a'*64,'generation':7,'bootId':'fixture','cgroup':self.group,'parentPid':499999}
  self.worker=self.root/'worker';self.work=self.worker/'jobs'/self.job/'work';self.work.mkdir(parents=True);self.stage=self.root/'stage';self.stage.mkdir(mode=0o700)
  self.schemas=json.loads((BASE/'r0002_harness/schema-source-manifest.json').read_text());self.pg=json.loads((BASE/'r0002_harness/pg-binary-pins.json').read_text());(self.stage/'schema-source-manifest.json').write_text(json.dumps(self.schemas));(self.stage/'pg-binary-pins.json').write_text(json.dumps(self.pg))
  self.patches=[mock.patch.object(p,'WORKER',self.worker),mock.patch.object(p,'STAGE',self.stage)]
  for patch in self.patches:patch.start()
 def tearDown(self):
  for patch in reversed(self.patches):patch.stop()
  self.temp.cleanup()
 def data(self,**kwargs):return dict(action='submit',id=self.job,kind=p.KIND,source_commit=p.SOURCE,**kwargs)
 def make_run(self,root):
  run=root/'runs'/'abcdef123456';run.mkdir(parents=True)
  (root/'latest-run.json').write_text(json.dumps({'run':str(run),'exit':0}));(run/'source-manifest.json').write_text(json.dumps(self.schemas))
  for name in ['pdf-fixtures','downloads','postgres','runtime']:(run/name).mkdir()
  fixtures=[]
  for index in [1,2]:
   name='version-'+str(index)+'.pdf';data=b'%PDF synthetic fixture '+str(index).encode();fixtures.append({'filename':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
   for prefix in ['pdf-fixtures','downloads']:(run/prefix/name).write_bytes(data)
  (run/'pdf-fixtures/manifest.json').write_text(json.dumps(fixtures));(run/'guard.jsonl').write_text('{"kind":"installed"}\n');(run/'pid.json').write_text('{}')
  for name in ['pgpass','initdb-password','queue.sqlite','postgres/PG_VERSION','runtime/NEVER_EXPORT']:(run/name).write_text('EXCLUDED FIXTURE')
  proof={'exit':0,'sourceCommit':p.SOURCE,'nonce':run.name,'run':str(run),'checks':[{'check':label,'status':status}for label,status in p.EXPECTED_CHECKS],'guardInstalled':True,'guardDenials':0,'runtimeStable':True,'originRuntimeStable':True,'remainingAppProcesses':[],'postgresCleanup':{'stopped':True},'socketCleanup':{'removed':True},'documentMutatingRequests':0,'deployment':False,'operationalReady':False,'executorContext':self.context,'postgresHandshake':{'version':'PostgreSQL 17.11 (fixture)','database':'fixture_only','nonce':run.name,'data_directory':str(run/'postgres'),'port':55485},'limits':{'cgroup':self.group,'cpuCores':2,'memoryMaxBytes':3*1024**3,'pidsMax':256},'postgresLifecycle':{'nonce':run.name,'dataDirectory':str(run/'postgres'),'events':['prepared','initialized','started','verified-postgres','verified-fixture_only','stopped','socket-released'],'binaryPins':{name:{'sha256':v}for name,v in self.pg.items()}}}
  (run/'result.json').write_text(json.dumps(proof));return run,proof
 def prepare(self,job,context):
  root=self.work/'history-native-r0002';root.mkdir(mode=0o700);cfg=root/'config.json';cfg.write_text('{}');(root/'runtime-source').mkdir();(root/'runtime-source/extraction-proof.json').write_text(json.dumps({'archiveSha256':p.ARCHIVE_SHA,'manifestSha256':p.MANIFEST_SHA,'verifiedFiles':12043,'runtimeStarted':False}));return root,cfg
 def test_fixed_contract_rejects_arbitrary_environment_shell_paths(self):
  self.assertEqual(p.payload(self.data()),p.fixed_payload())
  for extra in [{'env':{}},{'command':'/bin/sh'},{'runtime':'/tmp/x'},{'project_subdir':'site'},{'duration_seconds':999}]:
   with self.assertRaises(ValueError):p.payload(self.data(**extra))
  data=self.data();data['source_commit']='f'*40
  with self.assertRaises(ValueError):p.payload(data)
 def test_same_queue_both_fixed_profiles_and_identity(self):
  with mock.patch.multiple(c,ROOT=self.root/'coordinator',WORKER=self.worker),mock.patch.dict(os.environ,ADMIN_CLUSTER_BOOT='fixture',ADMIN_CLUSTER_DISPATCH='1'):
   c.initialize();c.atomic(c.ROOT/'authority.json',dict(role='primary',generation=1,armed_boot_id='fixture'))
   self.assertFalse(c.submit(self.data())['existing']);self.assertTrue(c.submit(self.data())['existing']);self.assertEqual(c.commands(p.fixed_payload(),self.job),[p.argv(self.job)])
   self.assertIn('runtime-http-r0000-v1',c.KINDS)
   with c.connect()as db:self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
   self.assertFalse((c.ROOT/'sources'/p.SOURCE).exists())
 def test_f555_runtime_and_all_seven_schema_pins_match_and_480_unchanged(self):
  self.assertEqual(p.SOURCE,'f55595cd348c23ffe559dba2de9150259db9f1e7');self.assertEqual(p.ARCHIVE_SHA,'2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0')
  self.assertEqual(len(self.schemas),7)
  for name,want in self.schemas.items():self.assertEqual(hashlib.sha256((BASE/'r0002_harness/schema-sources'/name).read_bytes()).hexdigest(),want)
  self.assertEqual(self.schemas['petition-base-schema.ts'],'25ea67cd71f653e68a8cc67177f77d39f18b4e56e14d6a8d42e256ddae51764c')
  self.assertEqual(hashlib.sha256((BASE/'core/runtime_profile.py').read_bytes()).hexdigest(),'afcb73273b0f35835012ec9a5a523114afc2da2566d20a30f8c05c47647aa3b8')
  self.assertNotIn('history-populated-native-pg17-r4',c.KINDS)
 def test_prepare_uses_only_new_private_root_and_fixed_extraction_before_config(self):
  self.work.chmod(0o2770);source=self.stage/'runtime_extract.py';source.write_text('fixture-only extractor; never executed');pin=hashlib.sha256(source.read_bytes()).hexdigest()
  spec=mock.Mock();module=mock.Mock();module.extract_verified.return_value={'verifiedFiles':12043}
  with mock.patch.object(p,'HARNESS_PINS',{'runtime_extract.py':pin}),mock.patch.object(p.importlib.util,'spec_from_file_location',return_value=spec),mock.patch.object(p.importlib.util,'module_from_spec',return_value=module):root,config=p.prepare(self.job,self.context)
  self.assertEqual(root.stat().st_mode&0o7777,0o700);self.assertEqual(self.work.stat().st_mode&0o7777,0o2770);self.assertEqual(config.stat().st_mode&0o777,0o600)
  module.extract_verified.assert_called_once_with(p.RUNTIME_ARCHIVE,p.RELEASE_MANIFEST,root/'runtime-source');data=json.loads(config.read_text());self.assertEqual(data['runtime_dir'],str(root/'runtime-source/runtime'));self.assertEqual(data['executor_config_digest'],self.context['configDigest'])
 def test_tampered_or_extra_staging_refused_before_any_child(self):
  with self.assertRaisesRegex(ValueError,'history_unreviewed_stage_files'):p.verify_inputs()
 def test_exact_proof_guard19_pgcleanup_schema_and_limits_required(self):
  root,_=self.prepare(self.job,self.context);run,proof=self.make_run(root);p.validate_result(proof,run,self.context)
  changes=[{'guardInstalled':False},{'checks':proof['checks'][:-1]},{'guardDenials':1},{'postgresCleanup':{'stopped':False}},{'socketCleanup':{'removed':False}},{'remainingAppProcesses':[123]},{'sourceCommit':'f'*40},{'limits':{**proof['limits'],'cpuCores':3}},{'postgresHandshake':{**proof['postgresHandshake'],'nonce':'foreign'}},{'executorContext':{**self.context,'generation':8}},{'executorContext':{**self.context,'jobId':'f'*32}}]
  for change in changes:
   with self.assertRaises(ValueError):p.validate_result({**proof,**change},run,self.context)
 def test_export_never_copies_pgdata_password_or_runtime_and_checks_pdf_hash(self):
  root,_=self.prepare(self.job,self.context);run,proof=self.make_run(root);target=self.work/'artifacts';target.mkdir();p.export(run,target,strict=True)
  for excluded in ['postgres','runtime','pgpass','initdb-password','queue.sqlite']:self.assertFalse((target/excluded).exists())
  self.assertEqual((target/'downloads/version-1.pdf').stat().st_mode&0o777,0o660)
  (run/'downloads/version-1.pdf').write_bytes(b'tampered')
  with self.assertRaisesRegex(ValueError,'history_pdf_fixture_hash'):p.export(run,self.work/'other',strict=True)
 def test_wrapper_success_and_replay_marker(self):
  owner=self
  class Fake:
   pid=499998
   def __init__(self,argv,**kwargs):
    owner.assertEqual(argv[0],'/usr/bin/python3');owner.assertNotIn('shell',kwargs);owner.assertEqual(set(kwargs['env']),{'PATH','LANG','TZ','HISTORY_SMOKE_CONFIG'});owner.make_run(Path(kwargs['cwd']))
   def wait(self,timeout=None):return 0
   def poll(self):return 0
  with mock.patch.object(p,'verify_job',return_value=self.context),mock.patch.object(p,'verify_inputs',return_value={}),mock.patch.object(p,'prepare',side_effect=self.prepare),mock.patch.object(p.subprocess,'Popen',Fake),mock.patch.object(p,'child_identity',return_value='start'),mock.patch.object(p,'cgroup_remaining',return_value=[]):
   self.assertEqual(p.run(self.job),0)
   before=(self.work/'artifacts/history-profile-result.json').read_bytes()
   with self.assertRaises(FileExistsError):p.run(self.job)
   self.assertEqual((self.work/'artifacts/history-profile-result.json').read_bytes(),before)
 def test_cancel_and_sigterm_during_cleanup_preserve_receipt(self):
  owner=self
  class Fake:
   pid=499998
   def __init__(self,argv,**kwargs):self.calls=0;owner.make_run(Path(kwargs['cwd']))
   def poll(self):return None if self.calls<2 else 0
   def wait(self,timeout=None):
    self.calls+=1
    if self.calls==1:raise KeyboardInterrupt('fixture cancellation')
    signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None);return 0
  with mock.patch.object(p,'verify_job',return_value=self.context),mock.patch.object(p,'verify_inputs',return_value={}),mock.patch.object(p,'prepare',side_effect=self.prepare),mock.patch.object(p.subprocess,'Popen',Fake),mock.patch.object(p,'child_identity',return_value='start'),mock.patch.object(p,'signal_child')as stop:
   self.assertEqual(p.run(self.job),1);stop.assert_called_once()
  result=json.loads((self.work/'artifacts/history-profile-result.json').read_text());self.assertGreaterEqual(result['signals'],1);self.assertIn('KeyboardInterrupt',result['error'])
 def test_reused_child_pid_is_never_signalled(self):
  child=mock.Mock(pid=42);child.poll.return_value=None
  with mock.patch.object(p,'child_identity',return_value='changed'),mock.patch.object(p.os,'killpg')as kill:
   with self.assertRaisesRegex(ValueError,'pid_reused'):p.signal_child(child,self.context,'original',signal.SIGTERM)
   kill.assert_not_called()
 def test_launcher_total720_and_old_profile_preserved(self):
  tree=ast.parse((BASE/'infra/launch.py').read_text());node=next(x for x in tree.body if isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='cmd'for t in x.targets));code=compile(ast.Expression(node.value),'<fixed-launcher>','eval')
  for history,old,runtime,stop,cpu,memory in [(True,False,600,120,'200%','3G'),(False,True,120,15,'300%','5G'),(False,False,7200,15,'300%','5G')]:
   argv=eval(code,{'history':history,'profile':old,'unit':'admin-v2-job-'+self.job,'id':self.job});self.assertIn('--property=RuntimeMaxSec='+str(runtime),argv);self.assertIn('--property=TimeoutStopSec='+str(stop),argv);self.assertIn('--property=CPUQuota='+cpu,argv);self.assertIn('--property=MemoryMax='+memory,argv);self.assertIn('--property=KillMode=control-group',argv)
   if history:self.assertEqual(runtime+stop,p.TOTAL_SECONDS)
 def test_harness_second_term_during_cleanup_does_not_interrupt_ownership_receipt(self):
  state=e.CancellationState()
  with self.assertRaises(e.Cancelled):state.handle(signal.SIGTERM,None)
  state.cleaning=True;state.handle(signal.SIGTERM,None);self.assertEqual(state.signals,2)
 def test_queue_context_generation_digest_marker_and_no_local_lease(self):
  coord=self.root/'coord';coord.mkdir();folder=self.worker/'jobs'/self.job;cfg={'id':self.job,'payload':p.fixed_payload(),'generation':7};cfg['digest']=hashlib.sha256(e.canonical(cfg['payload']).encode()).hexdigest();(folder/'config.json').write_text(json.dumps(cfg));(folder/'execution.started').write_text('');boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();authority={'role':'primary','armed_boot_id':boot,'generation':7};(coord/'authority.json').write_text(json.dumps(authority))
  with mock.patch.multiple(e,WORKER=self.worker,COORDINATOR=coord),mock.patch.object(e,'cgroup_of',return_value=self.group):
   self.assertEqual(e.verify_queue_context(self.job,cfg['digest'],self.group)['generation'],7)
   with self.assertRaises(RuntimeError):e.verify_queue_context(self.job,'0'*64,self.group)
   (coord/'authority.json').write_text(json.dumps({**authority,'generation':8}))
   with self.assertRaisesRegex(RuntimeError,'generation/boot'):e.verify_queue_context(self.job,cfg['digest'],self.group)
   (coord/'authority.json').write_text(json.dumps({**authority,'armed_boot_id':'old-boot'}))
   with self.assertRaisesRegex(RuntimeError,'generation/boot'):e.verify_queue_context(self.job,cfg['digest'],self.group)
   (coord/'authority.json').write_text(json.dumps(authority));(folder/'execution.started').unlink()
   with self.assertRaises(FileNotFoundError):e.verify_queue_context(self.job,cfg['digest'],self.group)
  code=(BASE/'r0002_harness/functional_smoke.py').read_text();self.assertNotIn('COORD_PREFIX',code);self.assertNotIn('active-lease.json',code)
if __name__=='__main__':unittest.main()
