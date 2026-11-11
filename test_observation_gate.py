"""Metadata-only mocks of the fixed prior-failure gate; no unit/app/Docker/browser."""
from pathlib import Path
from unittest import mock
import unittest,json,tempfile,hashlib,os
import local_controller as c
ROOT=Path(__file__).resolve().parent
class ObservationGateTests(unittest.TestCase):
 def inputs(self):
  prior=json.loads((ROOT/'PREVIOUS-OBSERVATION-FAILURE.json').read_text());old=Path(prior['oldRun']);texts={str(ROOT/'PREVIOUS-OBSERVATION-FAILURE.json'):prior}
  for n in ['root-failure-receipt.json','outer-result.json']:texts[str(old/n)]=json.loads((old/n).read_text())
  unit=dict(x.split('=',1)for x in(old/'root-retained-unit.txt').read_text().splitlines()if'='in x)
  pins={str(old/n):v for n,v in prior['files'].items()};pins[str(ROOT/'execution.started')]=prior['oldMarkerSha256'];return prior,old,texts,unit,pins
 def call(self,prior,old,texts,unit,pins):
  def read(p,*a,**kw):
   if str(p)==str(old/'root-retained-unit.txt'):return '\n'.join(k+'='+v for k,v in unit.items())
   return json.dumps(texts[str(p)])
  with mock.patch.object(Path,'read_text',read),mock.patch.object(c,'digest',side_effect=lambda p:pins[str(p)]):return c.verify_response_observation_v2_previous_attempt()
 def test_fixed_root_failure_proof_admitted(self):
  args=self.inputs();self.assertEqual(self.call(*args),args[0])
 def test_success_or_missing_cleanup_never_admits(self):
  for change in [{'exit':0},{'cleanupPassed':False},{'recoveryDownloadsHistoryReloadQualified':True},{'partialBrowserChecksPassed':13}]:
   prior,old,texts,unit,pins=self.inputs();texts[str(old/'root-failure-receipt.json')].update(change)
   with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_outer_not_drained_or_failed_unit_wrong_rejected(self):
  prior,old,texts,unit,pins=self.inputs();texts[str(old/'outer-result.json')]['postgresCleanup']['stopped']=False
  with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
  prior,old,texts,unit,pins=self.inputs();unit['ExecMainStatus']='0'
  with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_old_marker_or_outer_hash_drift_rejected(self):
  for name in ['execution.started','outer-result.json']:
   prior,old,texts,unit,pins=self.inputs();k=next(k for k in pins if k.endswith('/'+name));pins[k]='f'*64
   with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_marker_is_specific_exclusive_and_preserves_first_failure(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   root=Path(t);(root/'execution.started').write_text('PRESERVE-FIRST-FAILURE');(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_history_diagnostic_v3_previous_attempt',return_value={'failureReceiptSha256':'a'*64,'oldMarkerSha256':'b'*64}),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    c.verify_local_manifest();self.assertTrue((root/'execution.history-diagnostic-v3.started').exists())
    with self.assertRaises(FileExistsError):c.verify_local_manifest()
   self.assertEqual((root/'execution.started').read_text(),'PRESERVE-FIRST-FAILURE')
 def test_failed_gate_cannot_create_new_marker(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   root=Path(t);(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_history_diagnostic_v3_previous_attempt',side_effect=ValueError('no proof')),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    with self.assertRaises(ValueError):c.verify_local_manifest()
   self.assertFalse((root/'execution.history-diagnostic-v3.started').exists())
if __name__=='__main__':unittest.main()
