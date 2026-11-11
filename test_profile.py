import unittest,tempfile,json,os,signal,hashlib
from pathlib import Path
from unittest import mock
import local_controller as c,docker_control as d,package_http as h
class ProfileTests(unittest.TestCase):
 def test_owned_names_and_fixed_ports(self):
  n='a'*12;network=d.network_args(n);args=d.container_args(n,'b'*64)
  self.assertEqual(network[-1],'peticao-r0009-'+n+'-net');self.assertIn('peticao-r0009-'+n+'-pg',args);self.assertIn('127.0.0.1:55489:5432',args);self.assertIn('--pull=never',args);self.assertNotIn('--privileged',args)
 def test_foreign_resources_refused(self):
  with self.assertRaises(ValueError):d.verify_owned({'Id':'a'*64,'Name':'foreign','Labels':{}},'a'*12,'network')
 def test_cancellation_defers_only_during_cleanup(self):
  state=c.CancellationState()
  with self.assertRaises(c.Cancelled):state.handle(signal.SIGTERM,None)
  state.cleaning=True;state.handle(signal.SIGTERM,None);self.assertEqual(state.signals,2)
 def test_clean_spool_private_and_bounded(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);(root/'mail-outbox').mkdir();p=root/'mail-outbox/a.json';p.write_text('{}');p.chmod(0o600);self.assertEqual(len(h.spool_state(root)),1);p.chmod(0o644)
   with self.assertRaises(RuntimeError):h.spool_state(root)
 def test_spool_symlink_refused(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);(root/'mail-outbox').mkdir();(root/'file').write_text('{}');(root/'mail-outbox/a.json').symlink_to(root/'file')
   with self.assertRaises(RuntimeError):h.spool_state(root)
 def test_otp_only_from_one_own_approver_message(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);(root/'mail-outbox').mkdir();p=root/'mail-outbox/a.json';p.write_text(json.dumps({'to':'qa-approver@example.test','subject':'QA: 123456'}));p.chmod(0o600)
   self.assertEqual(h.approval_otp(root,{}),'123456')
   with self.assertRaises(RuntimeError):h.approval_otp(root,h.spool_state(root))
 def test_no_sensitive_files_in_allowlist(self):
  for p in ['server.log','private-markers.json','browser-config.json','mail-outbox','fixture.log','seed.log']:self.assertNotIn(p,c.ALLOW)
 def test_controller_bootstrap_names_are_r9(self):
  with tempfile.TemporaryDirectory()as t:
   run=c.ROOT/'runs'/'a'*12 if False else c.ROOT/'runs'/('a'*12)
   with mock.patch.object(c.DockerPG,'fence'),mock.patch.object(d,'docker')as docker,mock.patch.object(d,'inspect_owned')as inspect,mock.patch.object(d,'validate_container',return_value='c'*64):
    pg=c.DockerPG(run,'a'*12,'/mock',{},Path('/node'),{});pg.prepared=True;docker.side_effect=[mock.Mock(stdout='b'*64),mock.Mock(stdout='c'*64)];inspect.side_effect=[{'Id':'b'*64,'Driver':'bridge','Internal':False,'Containers':{}},{}];pg.initialize()
    names=[x.args[0]for x in inspect.call_args_list];self.assertEqual(names,['peticao-r0009-'+('a'*12)+'-net','peticao-r0009-'+('a'*12)+'-pg'])
 def test_current_core_preflight_not_executed_by_import(self):
  self.assertFalse((c.ROOT/'execution.started').exists())
 def test_fixed_runtime_no_copy(self):
  s=(c.ROOT/'functional_smoke.py').read_text();self.assertNotIn('shutil.copytree(RUNTIME_SOURCE',s);self.assertIn("cwd=RUNTIME_SOURCE",s);self.assertIn("verify_runtime_tree(RUNTIME_SOURCE,manifest)",s)
 def test_http_contains_no_retry_loop(self):
  s=(c.ROOT/'package_http.py').read_text();self.assertNotIn('while ',s);self.assertNotIn('sleep(',s);self.assertIn('ThreadPoolExecutor(max_workers=2)',s)
 def test_test_protocol_is_not_real_signature_validation(self):
  s=(c.ROOT/'fixture.cjs').read_text();self.assertIn('cryptographicValidation:false',s);self.assertNotIn('verifyPetitionBasePdf(',s);self.assertNotIn('assertSendable=',s)
if __name__=='__main__':unittest.main()
