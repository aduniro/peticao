from pathlib import Path
import hashlib,io,json,os,tarfile,tempfile,unittest
from unittest import mock
import worker_context as w,receipts as r,staging as s
REG=json.loads((Path(__file__).parent/'registry.json').read_text());JOB='1234567890abcdef1234567890abcdef';BOOT='fixture-boot';NONCE='123456abcdef'
class FenceTests(unittest.TestCase):
 def fixture(self):
  payload={'kind':REG['kind'],'source_commit':REG['source_commit'],'project_subdir':'site'};config={'id':JOB,'generation':7,'payload':payload,'digest':hashlib.sha256(w.canonical(payload).encode()).hexdigest()};state={'id':JOB,'state':'running','generation':7,'boot_id':BOOT};authority={'role':'primary','generation':7,'armed_boot_id':BOOT};return config,state,authority
 def test_fence_valid(self):
  c,s,a=self.fixture();self.assertEqual(w.verify_values(JOB,REG,c,s,a,BOOT)['generation'],7)
 def test_unknown_command_env_path_rejected(self):
  for key in ['command','env','source_path']:
   c,s,a=self.fixture();c['payload'][key]='arbitrary'
   with self.assertRaises(w.FenceError):w.verify_values(JOB,REG,c,s,a,BOOT)
 def test_digest_boot_generation_state_role(self):
  for which,key,value in [(0,'digest','bad'),(0,'generation',True),(1,'state','complete'),(1,'boot_id','old'),(1,'generation',6),(2,'generation',8),(2,'armed_boot_id','old'),(2,'role','standby')]:
   values=self.fixture();values[which][key]=value
   with self.assertRaises(w.FenceError):w.verify_values(JOB,REG,*values,BOOT)
 def test_root_refused_before_metadata(self):
  with mock.patch.object(w.os,'getuid',return_value=0):
   with self.assertRaises(w.FenceError):w.WorkerContext(JOB,REG).verify()
class ReceiptTests(unittest.TestCase):
 def tap(self):return '\n'.join('ok '+str(i+1)+' - real validation route '+c+' refusal creates no intent and recovers only by admitted exact GET'for i,c in enumerate(REG['expected_cases']))+'\n# fail 0\n# cancelled 0\n'
 def test_exact_five_pass_skips_allowed(self):self.assertEqual(len(r.tap_check(self.tap()+'ok 6 - other # SKIP test name does not match pattern\n',REG['expected_cases'])),5)
 def test_extra_missing_fail_cancel(self):
  for txt in [self.tap()+'ok 6 - unexpected\n',self.tap().replace('ok 1','not ok 1'),self.tap().replace('# fail 0','# fail 1'),self.tap().replace('# cancelled 0','# cancelled 1')]:
   with self.assertRaises(ValueError):r.tap_check(txt,REG['expected_cases'])
 def events(self):return [{'kind':'guard-installed','pid':1,'job':JOB,'nonce':NONCE},{'kind':'denial','category':'expected-optional-cli-ipc-denial','transport':'ipc','job':JOB,'nonce':NONCE}]
 def test_expected_ipc_preserved_in_counts(self):
  got=r.guard_check(self.events(),JOB,NONCE);self.assertEqual(got['reportedDenialsTotal'],1);self.assertEqual(got['expectedOptionalCliIpcDenials'],1);self.assertEqual(got['unexpectedDenials'],0)
 def test_guard_missing_identity_unexpected_refuse(self):
  for events in [[],self.events()[1:],self.events()+[{'kind':'denial','category':'unexpected-denial','transport':'tls','job':JOB,'nonce':NONCE}],self.events()+[{'kind':'allowed','job':'other','nonce':NONCE}]]:
   with self.assertRaises(ValueError):r.guard_check(events,JOB,NONCE)
 def test_export_only_technical_receipts_not_password_db_runtime(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);run=root/NONCE;run.mkdir();(run/'result.json').write_text(json.dumps({'job':JOB,'nonce':NONCE}));(run/'pgpass').write_text('secret');(run/'postgres').mkdir();(run/'source').mkdir();(run/'guard.jsonl').write_text('technical');out=root/'export';r.export(run,out,JOB,NONCE);self.assertEqual({p.name for p in out.iterdir()},{'result.json','guard.jsonl','export-manifest.json'})
 def test_symlink_receipt_refused(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);run=root/NONCE;run.mkdir();(run/'result.json').write_text(json.dumps({'job':JOB,'nonce':NONCE}));(run/'outside').write_text('secret');(run/'tap.log').symlink_to(run/'outside')
   with self.assertRaises(OSError):r.export(run,root/'export',JOB,NONCE)
class ExtractTests(unittest.TestCase):
 def make(self,root,name='file',link=False):
  p=root/'x.tar';data=b'fixture';entry=tarfile.TarInfo(name);entry.size=len(data)
  if link:entry.type=tarfile.SYMTYPE;entry.linkname='/existing/secret'
  with tarfile.open(p,'w')as t:t.addfile(entry,None if link else io.BytesIO(data))
  return p,hashlib.sha256(p.read_bytes()).hexdigest(),{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'mode':0o644}}
 def test_regular_exact(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);p,h,e=self.make(root);self.assertEqual(len(s.extract(p,h,e,root/'out')),1)
 def test_link_traversal_inventory_bad_hash_refused(self):
  for name,link,badhash in [('link',True,False),('../escape',False,False),('file',False,True)]:
   with tempfile.TemporaryDirectory()as tmp:
    root=Path(tmp);p,h,e=self.make(root,name,link)
    if badhash:e[name]['sha256']='0'*64
    with self.assertRaises(s.StagingError):s.extract(p,h,e,root/'out')
 def test_env_is_fixed_no_secrets_or_preview_inheritance(self):
  import run
  env=run.environment(Path('/qa/run'),Path('/qa/site'),Path('/qa/run/guard-config.json'));self.assertEqual(env['DATABASE_URL'],'postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only');self.assertEqual(env['MAIL_PROVIDERS'],'dev');self.assertNotIn('PREVIEW_MODE',env);self.assertNotIn('OPENAI_API_KEY',env)
if __name__=='__main__':unittest.main()

class RunnerTests(unittest.TestCase):
 def test_changed_node_pid_never_terminated(self):
  import run
  child=mock.Mock(pid=61111);child.poll.return_value=None
  with mock.patch.object(run,'child_identity',return_value='reused'):
   with self.assertRaises(ValueError):run.drain_node(child,'/fixture.service','original')
  child.terminate.assert_not_called();child.kill.assert_not_called()
 def test_staged_inventory_changes_fail(self):
  import run
  with tempfile.TemporaryDirectory()as tmp:
   p=Path(tmp);(p/'x').write_bytes(b'fixture');expected={'x':hashlib.sha256(b'fixture').hexdigest()};self.assertTrue(run.verify_staged(p,expected));(p/'x').write_bytes(b'drift')
   with self.assertRaises(ValueError):run.verify_staged(p,expected)
 def test_unknown_job_or_payload_never_reaches_pg(self):
  import run
  with mock.patch.object(run,'NativePG')as pg:
   with self.assertRaises(w.FenceError):w.WorkerContext('../escape',REG)
   pg.assert_not_called()
