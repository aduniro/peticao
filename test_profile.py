from pathlib import Path
from unittest import mock
import unittest,json,re,tempfile,hashlib,os
import run as r,local_controller as c
ROOT=Path(__file__).parent
class Profile(unittest.TestCase):
 def good(self):return ('TAP version 13\n'+''.join(f'ok {i} - {name}\n'for i,name in enumerate(r.EXPECTED_NAMES,1))+'# tests 9\n# suites 0\n# pass 9\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n').encode()
 def test_exact_nine_tap(self):self.assertEqual(r.parse_tap(self.good())['passed'],9)
 def test_no_skip_fail_or_partial_success(self):
  for a,b in[(b'# pass 9',b'# pass 8'),(b'# skipped 0',b'# skipped 1'),(b'ok 1 - ',b'not ok 1 - '),(b'# todo 0',b'# todo 1')]:
   with self.assertRaises(ValueError):r.parse_tap(self.good().replace(a,b))
 def test_no_duplicate_footer_or_cases(self):
  for value in[self.good()+b'# pass 9\n',self.good()+b'ok 10 - extra\n']:
   with self.assertRaises(ValueError):r.parse_tap(value)
 def test_infra_false_blocks_before_docker_or_stage(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);cfg=root/'config.json';cfg.write_text('{"infra_reviewed":false}')
   with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'CONFIG_PATH',cfg),mock.patch.object(c,'ROOT',root),mock.patch.object(r.subprocess,'run')as call,mock.patch.object(r.subprocess,'Popen')as start,mock.patch.object(c.d,'docker')as docker:
    with self.assertRaisesRegex(ValueError,'preparation only'):r.main()
    call.assert_not_called();start.assert_not_called();docker.assert_not_called()
   self.assertFalse((root/'execution.started').exists())
 def test_manifest_gate_cannot_mark_unreviewed_profile(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);cfg=root/'config.json';cfg.write_text('{"infra_reviewed":false}');(root/'manifest.json').write_text('{"files":{}}');pin=hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',cfg),mock.patch.dict(os.environ,{'MATERIALS_REVIEWED_MANIFEST_SHA256':pin}):
    with self.assertRaisesRegex(ValueError,'not reviewed'):c.verify_local_manifest()
   self.assertFalse((root/'execution.started').exists())
 def test_environment_does_not_inherit_credentials_or_features(self):
  env=r.environment(ROOT/'runs/abcdef012345','abcdef012345');self.assertEqual(env['DATABASE_URL'],'postgres://fixture_only:fixture_only@127.0.0.1:55496/fixture_only');self.assertNotIn('NODE_PATH',env);self.assertNotIn('PGPASSFILE',env)
  for key in['PRESIDENT_OWN_ENABLED','BATCH_A1_ENABLED','GOVBR_BASE_ENABLED','BATCH_PACKAGE_ENABLED','WHATSAPP_ENABLED']:self.assertEqual(env[key],'0')
  self.assertEqual(env['MAIL_PROVIDER'],'dev');self.assertEqual(env['APPROVER_EMAIL'],'');self.assertEqual(env['RECIPIENTS'],'')
 def test_expected_names_match_pinned_test_source(self):
  repo=Path(json.loads((ROOT/'config.json').read_text())['source_repo']);file=repo/'site/src/lib/materials-store.pg.test.ts';graph=json.loads((ROOT/'source-preflight.json').read_text());self.assertEqual(r.sha(file),graph['files']['site/src/lib/materials-store.pg.test.ts']['sha256']);self.assertEqual(re.findall(r'test\("([^"\n]+)"',file.read_text()),r.EXPECTED_NAMES)
 def test_dependency_inventory_read_only(self):self.assertTrue(r.verify_dependencies())
if __name__=='__main__':unittest.main()
