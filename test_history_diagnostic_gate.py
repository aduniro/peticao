from pathlib import Path
from unittest import mock
import unittest,json
import local_controller as c
ROOT=Path(__file__).parent
class DiagnosticGate(unittest.TestCase):
 def inputs(self):
  p=json.loads((ROOT/'PREVIOUS-HISTORY-DOM-FAILURE.json').read_text());old=Path(p['oldRun']);texts={str(ROOT/'PREVIOUS-HISTORY-DOM-FAILURE.json'):p}
  for n in ['root-failure-receipt.json','outer-result.json']:texts[str(old/n)]=json.loads((old/n).read_text())
  unit=dict(x.split('=',1)for x in(old/'root-retained-unit.txt').read_text().splitlines()if'='in x);pins={str(old/n):v for n,v in p['files'].items()};pins[str(ROOT/'execution.response-observation-v2.started')]=p['oldMarkerSha256'];return p,old,texts,unit,pins
 def call(self,args):
  p,old,texts,unit,pins=args
  def read(path,*a,**k):return '\n'.join(k+'='+v for k,v in unit.items())if str(path)==str(old/'root-retained-unit.txt')else json.dumps(texts[str(path)])
  with mock.patch.object(c,'verify_response_observation_v2_previous_attempt'),mock.patch.object(Path,'read_text',read),mock.patch.object(c,'digest',side_effect=lambda p:pins[str(p)]):return c.verify_history_diagnostic_v3_previous_attempt()
 def test_exact_second_failure(self):self.assertEqual(self.call(self.inputs())['newMarker'],'execution.history-diagnostic-v3.started')
 def test_wrong_failure_or_missing_cleanup(self):
  for change in [{'exit':0},{'partialBrowserChecksPassed':13},{'cleanupPassed':False},{'historyDomAndDownloadAndReloadQualified':True}]:
   args=self.inputs();args[2][str(args[1]/'root-failure-receipt.json')].update(change)
   with self.assertRaises(ValueError):self.call(args)
 def test_outer_not_drained_or_marker_changed(self):
  args=self.inputs();args[2][str(args[1]/'outer-result.json')]['postgresCleanup']['stopped']=False
  with self.assertRaises(ValueError):self.call(args)
  args=self.inputs();args[4][str(ROOT/'execution.response-observation-v2.started')]='f'*64
  with self.assertRaises(ValueError):self.call(args)
 def test_mutable_pointer_excluded(self):
  self.assertIn('latest-run.json',(ROOT/'.gitignore').read_text())
if __name__=='__main__':unittest.main()
