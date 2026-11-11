"""Pure prior-failure admission mocks; no application, network, unit or database execution."""
import unittest,json,hashlib,tempfile,os
from pathlib import Path
from unittest import mock
import local_controller as c
ROOT=Path(__file__).parent
class Gate(unittest.TestCase):
 def inputs(self):
  prior=json.loads((ROOT/'PREVIOUS-EMPTY-JOB-FAILURE.json').read_text());old=Path(prior['oldRun']);texts={str(ROOT/'PREVIOUS-EMPTY-JOB-FAILURE.json'):prior}
  for n in ['root-failure-receipt.json','outer-result.json']:texts[str(old/n)]=json.loads((old/n).read_text())
  unit=dict(x.split('=',1)for x in(old/'root-retained-unit.txt').read_text().splitlines()if'='in x);pins={str(old/n):h for n,h in prior['files'].items()};pins[str(ROOT/'execution.started')]=prior['oldMarkerSha256'];return prior,old,texts,unit,pins
 def call(self,prior,old,texts,unit,pins):
  def read(p,*a,**kw):return '\n'.join(k+'='+v for k,v in unit.items())if str(p)==str(old/'root-retained-unit.txt')else json.dumps(texts[str(p)])
  with mock.patch.object(Path,'read_text',read),mock.patch.object(c,'digest',side_effect=lambda p:pins[str(p)]):return c.verify_empty_latest_job_v3_previous_attempt()
 def test_exact_failed_attempt_admits(self):
  args=self.inputs();self.assertEqual(self.call(*args),args[0])
 def test_wrong_success_posts_or_cleanup_cannot_admit(self):
  for change in [{'exit':0},{'browserA1Posts':1},{'cleanupPassed':False},{'queuedOrCryptographicOperationQualified':True}]:
   prior,old,texts,unit,pins=self.inputs();texts[str(old/'root-failure-receipt.json')].update(change)
   with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_failed_unit_or_outer_drain_required(self):
  prior,old,texts,unit,pins=self.inputs();unit['ExecMainStatus']='0'
  with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
  prior,old,texts,unit,pins=self.inputs();texts[str(old/'outer-result.json')]['postgresCleanup']['stopped']=False
  with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_old_marker_hash_must_match(self):
  prior,old,texts,unit,pins=self.inputs();pins[str(ROOT/'execution.started')]='f'*64
  with self.assertRaises(ValueError):self.call(prior,old,texts,unit,pins)
 def test_marker_is_specific_exclusive_and_preserves_old(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as tmp:
   root=Path(tmp);(root/'execution.started').write_text('PRESERVED');(root/'local-manifest.json').write_text('{"files":{}}');(root/'config.json').write_text('{"expected_cgroup":"/mock"}');h=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_empty_latest_job_v3_previous_attempt',return_value={'failureReceiptSha256':'a'*64,'oldMarkerSha256':'b'*64}),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':h}):
    c.verify_local_manifest();self.assertTrue((root/'execution.empty-latest-job-v3.started').is_file())
    with self.assertRaises(FileExistsError):c.verify_local_manifest()
   self.assertEqual((root/'execution.started').read_text(),'PRESERVED')
if __name__=='__main__':unittest.main()
