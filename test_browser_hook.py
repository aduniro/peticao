import unittest,tempfile,json,os,stat
from pathlib import Path
from unittest import mock
import browser_hook as b,local_controller as c,docker_control as d
class BrowserHookTests(unittest.TestCase):
 def test_exact_eighteen_checks_and_no_generic_post(self):
  self.assertEqual(len(b.EXPECTED_CHECKS),18);self.assertEqual(len(set(b.EXPECTED_CHECKS)),18)
 def test_config_only_own_run_and_unit(self):
  run=b.ROOT/'runs'/('a'*12);g='/user.slice/user-1000.slice/user@1000.service/app.slice/'+b.UNIT
  cfg=b.make_config(run,'adm='+'a'*32,[],g,[]);self.assertEqual(cfg['origin'],'http://127.0.0.1:31390')
  with self.assertRaises(b.BrowserHookError):b.make_config(Path('/tmp/other'),'adm='+'a'*32,[],g,[])
 def test_browser_env_never_inherits_app_pepper_or_provider(self):
  env=b.browser_environment(b.ROOT/'runs'/('a'*12));self.assertNotIn('DATABASE_URL',env);self.assertNotIn('HASH_PEPPER',env);self.assertNotIn('NODE_OPTIONS',env)
 def test_private_json_refuses_public_file(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=Path(tmp)/'data.json';p.write_text('{}');p.chmod(0o644)
   with self.assertRaises(b.BrowserHookError):b.read_private_json(p)
   p.chmod(0o600);self.assertEqual(b.read_private_json(p),{})
 def test_private_json_refuses_symlink(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=Path(tmp)/'data.json';p.write_text('{}');p.chmod(0o600);q=Path(tmp)/'link';q.symlink_to(p)
   with self.assertRaises(OSError):b.read_private_json(q)
 def test_cancellation_deferred_through_cleanup(self):
  s=c.CancellationState();s.cleaning=True;s.handle(15,None);self.assertEqual(s.signals,1);s.cleaning=False
  with self.assertRaises(c.Cancelled):s.handle(15,None)
 def test_browser_sensitive_files_not_exported(self):
  for n in ['browser-config.json','browser-stdout.log','browser-stderr.log','private-markers.json','server.log']:self.assertNotIn(n,c.ALLOW)
  self.assertIn('package-browser-1.png',c.ALLOW)
 def test_owned_docker_names_are_r10_and_ports_exact(self):
  self.assertEqual(d.network_args('a'*12)[-1],'peticao-r0010-'+('a'*12)+'-net');self.assertIn('127.0.0.1:55490:5432',d.container_args('a'*12,'b'*64))
 def test_main_has_no_http_package_mutations(self):
  s=(b.ROOT/'functional_smoke.py').read_text();self.assertIn("method=='POST'and path=='/api/admin/login'",s);self.assertNotIn('from package_http import exercise',s);self.assertNotIn('shutil.copytree(RUNTIME_SOURCE',s)
if __name__=='__main__':unittest.main()
