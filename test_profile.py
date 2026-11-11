import unittest,tempfile,json,hashlib,subprocess,ast
from pathlib import Path
from unittest import mock
import local_runner as r
ROOT=Path(__file__).parent
REG=json.loads((ROOT/'local-registry.json').read_text())
class ProfileTests(unittest.TestCase):
 def tap(self):return '\n'.join('ok '+str(i+1)+' - '+s for i,s in enumerate(REG['expected_cases']))+'\n# tests 13\n# pass 13\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
 def test_exact_thirteen_pass(self):self.assertEqual(len(r.exact_tap(self.tap(),REG['expected_cases'])),13)
 def test_missing_extra_skip_fail_rejected(self):
  for text in [self.tap().replace('ok 1','not ok 1'),self.tap()+'ok 14 - extra\n',self.tap().replace('# skipped 0','# skipped 1'),self.tap().replace('# pass 13','# pass 12'),self.tap().replace(REG['expected_cases'][0],'other')]:
   with self.assertRaises(ValueError):r.exact_tap(text,REG['expected_cases'])
 def test_reused_inventory_detects_byte_drift(self):
  with tempfile.TemporaryDirectory(dir=ROOT)as directory:
   source=Path(directory);source.chmod(0o700);(source/'file').write_bytes(b'fixture');expected={'file':hashlib.sha256(b'fixture').hexdigest()};reg={'reused_source':str(source),'f555_package_pins':expected}
   self.assertTrue(r.verify_reused(reg,expected));(source/'file').write_bytes(b'drift')
   with self.assertRaises(ValueError):r.verify_reused(reg,expected)
 def test_fixed_env_no_mail_no_secrets_and_private_spool(self):
  env=r.environment(Path('/qa/run'),Path('/qa/site'))
  for key in ['APPROVER_EMAIL','RECIPIENTS','CONTACT_BCC','CRON_SECRET']:self.assertEqual(env[key],'')
  self.assertEqual(env['MAIL_PROVIDER'],'dev');self.assertEqual(env['MAIL_PROVIDERS'],'dev');self.assertEqual(env['MAIL_OUTBOX_DIR'],'/qa/run/mail-outbox');self.assertNotIn('ICP_VALIDATOR_URL',env);self.assertNotIn('OPENAI_API_KEY',env)
 def test_exact_one_file_thirteen_cases_no_skips(self):
  self.assertEqual(REG['test_file'],'src/lib/batch-package-delivery.test.ts');self.assertEqual(len(REG['expected_cases']),13);self.assertEqual(len(REG['test_suites']),1);self.assertNotIn('inherited_view',REG);self.assertEqual(REG['kind'],'local-package-approval-pg17-r0008-v1')
 def test_fixture_schema_query_is_bounded_and_includes_rollback(self):
  query=r.schema_cleanup_query(REG['expected_schemas']);self.assertIn('t_packet_rollback_fence',query);self.assertIn('t_code_intent_http',query)
  with self.assertRaises(ValueError):r.schema_cleanup_query(['bad; DROP DATABASE fixture_only'])
 def test_no_source_copy_or_mutation_runner(self):
  text=(ROOT/'local_runner.py').read_text();ast.parse(text);self.assertNotIn('copytree',text);self.assertNotIn('extract(',text);self.assertIn('verify_reused(reg,expected)',text);self.assertNotIn('WorkerContext',text);self.assertIn('256*1024**2',text)
 def test_export_drops_private_assertion_diagnostics_and_stderr(self):
  with tempfile.TemporaryDirectory(dir=ROOT)as directory:
   base=Path(directory);run=base/'012345abcdef';run.mkdir();job='a'*32
   (run/'result.json').write_text(json.dumps({'job':job,'nonce':run.name,'error':'Failure: Cookie adm=PRIVATE_TOKEN'}))
   raw='ok 1 - '+REG['expected_cases'][0]+'\n    Código para aprovar lote1: 123456\n    Cookie adm=PRIVATE_TOKEN\n# tests 13\n# pass 13\n# fail 0\n'
   (run/'tap.log').write_text(raw);(run/'stderr.log').write_text('123456 PRIVATE_TOKEN')
   target=base/'export';r.export(run,target,job,run.name)
   public=''.join(p.read_text()for p in target.iterdir()if p.is_file())
   self.assertNotIn('123456',public);self.assertNotIn('PRIVATE_TOKEN',public);self.assertIn(REG['expected_cases'][0],public);self.assertEqual((run/'tap.log').read_text(),raw)
 def test_guard_sources_unchanged_58cb(self):
  repo='/mnt/apps/peticao-final/_ops/r0003-govbr-route-nativepg-harness-20261111'
  for name in ['node_guard.cjs','guard_policy.cjs','dns_guard.cjs']:
   original=subprocess.check_output(['/usr/bin/git','show','58cb9ce6d90cfb5f8b7fe456810948a4c99bb6f9:'+name],cwd=repo);self.assertEqual((ROOT/'frozen'/name).read_bytes(),original)
if __name__=='__main__':unittest.main()
