"""Mocks only; no browser, Node, PG, Docker, network or real signals."""
import unittest,tempfile,json,hashlib,subprocess,os,ast
from pathlib import Path
from unittest import mock
import browser_hook as b,local_controller as c
COOKIE='adm=FixtureOnlyToken1234567890'
GROUP='/user.slice/user-1000.slice/user@1000.service/app.slice/'+b.UNIT
class HookTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).parent);self.root=Path(self.temp.name);self.run=self.root/'runs'/'012345abcdef';self.run.mkdir(parents=True)
  for name in ['downloads','pdf-fixtures','tmp','empty']:(self.run/name).mkdir()
  self.driver=self.root/'history-browser.cjs';self.driver.write_text('MOCK NEVER EXECUTED');self.node=self.root/'node';self.node.write_text('MOCK NEVER EXECUTED');self.state=c.CancellationState();self.child=mock.Mock(pid=222);self.child.wait.return_value=0
  self.fixtures=[]
  for n in [1,2]:
   data=b'%PDF-MOCK-'+str(n).encode();name='version-'+str(n)+'.pdf';(self.run/'pdf-fixtures'/name).write_bytes(data);(self.run/'downloads'/('browser-'+name)).write_bytes(data);self.fixtures.append({'ordinal':n,'id':str(n)*8+'-'+str(n)*4+'-4'+str(n)*3+'-8'+str(n)*3+'-'+str(n)*12,'filename':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
  (self.run/'history-desktop.png').write_bytes(b'\x89PNG\r\n\x1a\nMOCK')
  self.value={'exit':0,'sourceCommit':b.SOURCE,'syntheticSession':True,'stepupSeeded':True,'browserLoginUiTested':False,'otpFlowTested':False,'realCertificateUsed':False,'deployment':False,'checks':[{'name':name,'passed':True}for name in b.EXPECTED_CHECKS],'pageErrors':[],'consoleErrors':[],'externalRequestsBlocked':[],'mutationsBlocked':[],'requests':[{'method':'GET','path':'/api/admin/lotes/1/versoes/'+v['id']}for v in reversed(self.fixtures)]}
  self.patches=[mock.patch.object(b,'ROOT',self.root),mock.patch.object(b,'DRIVER',self.driver),mock.patch.object(c,'verify_local_context'),mock.patch.object(b,'group_snapshot',return_value={}),mock.patch.object(b,'process_identity',return_value={'pid':222,'startTicks':'222','pgid':222}),mock.patch.object(b,'cleanup_browser',return_value={'browserProcessesDrained':True,'cleanupActions':[],'wholeUnitDrained':False})]
  for p in self.patches:p.start()
  original=b.sha
  self.hash=mock.patch.object(b,'sha',side_effect=lambda path:b.DRIVER_SHA if path==self.driver else b.NODE_SHA if path==self.node else original(path));self.hash.start()
 def tearDown(self):
  self.hash.stop()
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def invoke(self):
  (self.run/'history-browser-result.json').write_text(json.dumps(self.value))
  with mock.patch.object(b.subprocess,'Popen',return_value=self.child):return b.run_browser_hook(self.run,COOKIE,self.fixtures,GROUP,self.node,{},self.state)
 def test_success_reuses_session_private_config_and_clean_environment(self):
  proof=self.invoke();self.assertEqual(proof['exit'],0);self.assertEqual(proof['passedBrowserChecks'],21);self.assertFalse(proof['newLoginCreated']);self.assertEqual((self.run/'browser-config.json').stat().st_mode&0o777,0o600)
  text=(self.run/'browser-hook-result.json').read_text();self.assertNotIn(COOKIE,text);self.assertNotIn(COOKIE[4:],text);self.assertFalse(self.state.cleaning)
 def test_driver_failure_reaches_external_node_and_pg_cleanup(self):
  self.child.wait.return_value=1;node=mock.Mock();pg=mock.Mock()
  try:
   with self.assertRaises(b.BrowserHookError):self.invoke()
  finally:node();pg()
  node.assert_called_once();pg.assert_called_once();self.assertEqual(json.loads((self.run/'browser-hook-result.json').read_text())['exit'],1)
 def test_timeout_still_cleans_browser_and_fails(self):
  self.child.wait.side_effect=subprocess.TimeoutExpired('MOCK',90)
  with self.assertRaises(b.BrowserHookError):self.invoke()
  self.assertEqual(json.loads((self.run/'browser-hook-result.json').read_text())['exit'],1)
 def test_term_during_cleanup_deferred_and_never_success(self):
  def cleanup(*args):self.state.handle(15,None);return {'browserProcessesDrained':True}
  with mock.patch.object(b,'cleanup_browser',side_effect=cleanup),self.assertRaises(b.BrowserHookError):self.invoke()
  proof=json.loads((self.run/'browser-hook-result.json').read_text());self.assertEqual(proof['exit'],1);self.assertEqual(proof['cancelSignalsDuringHook'],1);self.assertFalse(self.state.cleaning)
 def test_term_during_receipt_rewrites_failure_and_external_cleanup_runs(self):
  original=b.write_private;fired=False
  def write(path,value):
   nonlocal fired
   if path.name=='browser-hook-result.json'and not fired:fired=True;self.state.handle(2,None)
   return original(path,value)
  node=mock.Mock();pg=mock.Mock()
  try:
   with mock.patch.object(b,'write_private',side_effect=write),self.assertRaises(b.BrowserHookError):self.invoke()
  finally:node();pg()
  node.assert_called_once();pg.assert_called_once();proof=json.loads((self.run/'browser-hook-result.json').read_text());self.assertEqual(proof['exit'],1);self.assertEqual(proof['cancelSignalsDuringHook'],1)
 def test_repeated_term_during_cleanup_and_write_never_succeeds(self):
  original=b.write_private
  def cleanup(*args):self.state.handle(15,None);self.state.handle(2,None);return {'browserProcessesDrained':True}
  def write(path,value):
   if path.name=='browser-hook-result.json':self.state.handle(15,None)
   return original(path,value)
  with mock.patch.object(b,'cleanup_browser',side_effect=cleanup),mock.patch.object(b,'write_private',side_effect=write),self.assertRaises(b.BrowserHookError):self.invoke()
  proof=json.loads((self.run/'browser-hook-result.json').read_text());self.assertEqual(proof['exit'],1);self.assertEqual(proof['cancelSignalsDuringHook'],3);self.assertFalse(self.state.cleaning)
 def test_empty_checks_are_not_vacuous_success(self):
  self.value['checks']=[]
  with self.assertRaises(b.BrowserHookError):self.invoke()
 def test_browser_error_categories_reject(self):
  for key in ['pageErrors','consoleErrors','externalRequestsBlocked','mutationsBlocked']:
   value={**self.value,key:['MOCK']}
   with self.subTest(key=key),self.assertRaises(b.BrowserHookError):b.validate_result(self.run,value,self.fixtures)
 def test_pdf_drift_rejected(self):
  (self.run/'downloads/browser-version-1.pdf').write_bytes(b'DRIFT')
  with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,self.value,self.fixtures)
 def test_download_order_and_duplicates_rejected(self):
  for rows in [list(reversed(self.value['requests'])),self.value['requests']*2]:
   with self.assertRaises(b.BrowserHookError):b.validate_result(self.run,{**self.value,'requests':rows},self.fixtures)
 def test_no_node_options_credentials_or_model_environment(self):
  with mock.patch.dict(os.environ,NODE_OPTIONS='FAKE',DATABASE_URL='FAKE',OPENAI_API_KEY='FAKE'):
   env=b.browser_environment(self.run)
  self.assertEqual(env['PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK'],'1')
  for key in ['NODE_OPTIONS','DATABASE_URL','OPENAI_API_KEY']:self.assertNotIn(key,env)
 def test_export_excludes_cookie_config_and_raw_browser_logs(self):
  self.assertNotIn('browser-config.json',c.ALLOW);self.assertNotIn('browser-stdout.log',c.ALLOW);self.assertNotIn('browser-stderr.log',c.ALLOW)
  for name in ['history-browser-result.json','browser-hook-result.json','history-desktop.png','downloads/browser-version-1.pdf','downloads/browser-version-2.pdf']:self.assertIn(name,c.ALLOW)
 def test_hook_location_before_after_snapshot_no_additional_login(self):
  root=Path(__file__).parent;text=(root/'functional_smoke.py').read_text();ast.parse(text);self.assertLess(text.index("result['browser']=run_browser_hook"),text.index("result['after']=fixture('snapshot')"));self.assertIn('NODE,CONFIG,cancellation)',text)

class DrainTests(unittest.TestCase):
 def identity(self,pid):return {'pid':pid,'startTicks':str(pid),'pgid':pid}
 def test_only_new_browser_processes_signaled_not_baseline_app(self):
  # Unwrap real cleanup despite HookTests patch being local to each test.
  baseline={111:self.identity(111)};observed={**baseline,222:self.identity(222),333:self.identity(333)};child=mock.Mock(pid=222)
  with mock.patch.object(b,'group_snapshot',side_effect=[observed,baseline,baseline]),mock.patch.object(b,'process_identity',side_effect=lambda pid,group:self.identity(pid)),mock.patch.object(b.os,'kill')as kill:
   proof=b.cleanup_browser(child,GROUP,baseline,'222')
  self.assertTrue(proof['browserProcessesDrained']);self.assertEqual([x.args[0]for x in kill.call_args_list],[222,333])
 def test_reused_baseline_pid_blocks_all_signals(self):
  baseline={111:self.identity(111)};observed={111:{**self.identity(111),'startTicks':'changed'}}
  with mock.patch.object(b,'group_snapshot',return_value=observed),mock.patch.object(b.os,'kill')as kill,self.assertRaises(b.BrowserHookError):b.cleanup_browser(mock.Mock(pid=222),GROUP,baseline,'222')
  kill.assert_not_called()
if __name__=='__main__':unittest.main()
