"""Mocked terminal-failure gate/marker only. No app, unit, runtime tree, DB or browser."""
import unittest,json,tempfile,hashlib,os
from pathlib import Path
from unittest import mock
import local_controller as c
class IconV2GateTests(unittest.TestCase):
 def inputs(self):
  root=Path('/mnt/dev/.peticao-r0010-local-package-browser-qa-20261111');central=Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/r0010-package-browser-20261111/attempt-1');unit={'Result':'exit-code','ExecMainStatus':'1','MainPID':'0','ControlGroup':'','InvocationID':'9f31f0157c4745738f72818908631807'};sha='9592287a94bdcaa04e0bfab471e82f9b3686477e131d7657b1f4ce37e44920af'
  prior={'classification':'EXPLICIT_TERMINAL_FAILED_ATTEMPT_BEFORE_ICON_V2_ONLY','newMarker':'execution.browser-icon-v2.started','noGenericReplay':True,'receiptPath':str(central/'receipt.json'),'retainedUnitPath':str(central/'retained-unit.json'),'receiptSha256':sha,'retainedUnitSha256':'b'*64,'oldRun':str(root/'runs/2310073c187d'),'oldMarkerSha256':'c'*64,'oldOuterSha256':'d'*64}
  receipt={'exit':1,'classification':'LOCAL_BROWSER_ATTEMPT_FAILED_ASSET_ALLOWLIST','run':prior['oldRun'],'sourceCommit':'f55595cd348c23ffe559dba2de9150259db9f1e7','unitBeforeStop':unit,'independentPortsClosed':[55490,31390],'independentCgroupRemoved':'/mock/priorunit','independentDockerAbsent':True,'browserTmpRemoved':True,'browserProcessesDrained':True,'runtimeAndOriginStable':True,'artifacts':{'outer-result.json':'d'*64}}
  texts={str(root/'PREVIOUS-ATTEMPT-TERMINAL.json'):prior,str(central/'receipt.json'):receipt,str(central/'retained-unit.json'):unit};pins={str(central/'receipt.json'):sha,str(central/'retained-unit.json'):'b'*64,str(root/'execution.started'):'c'*64,str(root/'runs/2310073c187d/outer-result.json'):'d'*64};return texts,pins,prior,receipt
 def call(self,texts,pins):
  with mock.patch.object(Path,'read_text',lambda p,*a,**kw:json.dumps(texts[str(p)])),mock.patch.object(c,'digest',side_effect=lambda p:pins[str(p)]):return c.verify_icon_v2_previous_attempt()
 def test_exact_terminal_failed_receipt_and_cleanup_admitted(self):
  texts,pins,prior,receipt=self.inputs();self.assertEqual(self.call(texts,pins),prior)
 def test_success_or_missing_cleanup_never_admitted(self):
  for change in [{'exit':0},{'browserProcessesDrained':False},{'independentDockerAbsent':False}]:
   texts,pins,prior,receipt=self.inputs();receipt.update(change)
   with self.assertRaises(ValueError):self.call(texts,pins)
 def test_old_marker_or_root_receipt_hash_change_refused(self):
  for key in ['execution.started','receipt.json']:
   texts,pins,prior,receipt=self.inputs();name=next(n for n in pins if n.endswith('/'+key));pins[name]='e'*64
   with self.assertRaises(ValueError):self.call(texts,pins)
 def test_explicit_new_marker_exclusive_preserves_original_marker(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);(root/'execution.started').write_text('PRESERVE-FIRST-ATTEMPT');(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_icon_v2_previous_attempt',return_value={'receiptSha256':'a'*64,'oldMarkerSha256':'b'*64}),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    c.verify_local_manifest();self.assertTrue((root/'execution.browser-icon-v2.started').is_file())
    with self.assertRaises(FileExistsError):c.verify_local_manifest()
   self.assertEqual((root/'execution.started').read_text(),'PRESERVE-FIRST-ATTEMPT')
 def test_failed_gate_cannot_create_v2_marker(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_icon_v2_previous_attempt',side_effect=ValueError('missing terminal proof')),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    with self.assertRaises(ValueError):c.verify_local_manifest()
   self.assertFalse((root/'execution.browser-icon-v2.started').exists())
if __name__=='__main__':unittest.main()
