"""Pure fake HTTP/clock and marker gates; no app, sockets, PG, Docker or PDF parser."""
from pathlib import Path
from unittest import mock
import unittest,json,textwrap,tempfile,os,hashlib,copy
import functional_smoke as f,local_controller as c
ROOT=Path(__file__).resolve().parent
class FakeClock:
 def __init__(self,step=0):self.now=0;self.step=step
 def monotonic(self):v=self.now;self.now+=self.step;return v
 def sleep(self,n):self.now+=n
class ReadinessTests(unittest.TestCase):
 def test_exact_baseline_waits_for200_and_times_out_on_disabled404(self):
  code=textwrap.dedent((ROOT/'mock-proof/baseline-903b-readiness.txt').read_text());request=mock.Mock(return_value=(404,b'',{}));clock=FakeClock(46)
  with self.assertRaises(TimeoutError):exec(code,{'time':clock,'proc':mock.Mock(poll=lambda:None),'request':request})
  self.assertEqual(request.call_args_list,[mock.call('GET','/presidente')])
 def test_new_protected401_ready_then_disabled404_verified_without_cookie(self):
  request=mock.Mock(side_effect=[(401,b'',{}),(404,b'',{})]);v=f.observe_readiness(mock.Mock(poll=lambda:None),request,FakeClock())
  self.assertEqual(request.call_args_list,[mock.call('GET','/api/admin/lotes/1/versoes'),mock.call('GET','/presidente')]);self.assertEqual(v['status'],401);self.assertEqual(v['disabledPortalStatus'],404);self.assertTrue(v['notPdfQualification'])
 def test_disabled_portal200_does_not_qualify(self):
  with self.assertRaisesRegex(RuntimeError,'must remain404'):f.observe_readiness(mock.Mock(poll=lambda:None),mock.Mock(side_effect=[(401,b'',{}),(200,b'',{})]),FakeClock())
 def test_protected404_or200_is_not_readiness(self):
  for status in [404,200]:
   with self.assertRaises(TimeoutError):f.observe_readiness(mock.Mock(poll=lambda:None),mock.Mock(return_value=(status,b'',{})),FakeClock(46))
 def test_terminated_next_never_ready(self):
  request=mock.Mock()
  with self.assertRaises(RuntimeError):f.observe_readiness(mock.Mock(poll=lambda:1),request,FakeClock())
  request.assert_not_called()
 def test_network_wait_is_readonly_and_bounded(self):
  request=mock.Mock(side_effect=[OSError('not yet listening'),(401,b'',{}),(404,b'',{})]);self.assertEqual(f.observe_readiness(mock.Mock(poll=lambda:None),request,FakeClock())['status'],401)
class MarkerTests(unittest.TestCase):
 def inputs(self):
  prior=json.loads((ROOT/'PREVIOUS-ATTEMPT-TERMINAL.json').read_text());receipt=json.loads(Path(prior['receiptPath']).read_text());unit=json.loads(Path(prior['retainedUnitPath']).read_text());texts={str(ROOT/'PREVIOUS-ATTEMPT-TERMINAL.json'):prior,prior['receiptPath']:receipt,prior['retainedUnitPath']:unit};pins={prior['receiptPath']:prior['receiptSha256'],prior['retainedUnitPath']:prior['retainedUnitSha256'],str(ROOT/'execution.started'):prior['oldMarkerSha256'],str(Path(prior['oldRun'])/'outer-result.json'):prior['oldOuterSha256']};return texts,pins,prior,receipt,unit
 def call(self,texts,pins):
  with mock.patch.object(Path,'read_text',lambda p,*a,**kw:json.dumps(texts[str(p)])),mock.patch.object(c,'digest',side_effect=lambda p:pins[str(p)]):return c.verify_readiness_v2_previous_attempt()
 def test_exact_failed_receipt_and_cleanup_admitted(self):
  texts,pins,prior,receipt,unit=self.inputs();self.assertEqual(self.call(texts,pins),prior)
 def test_success_or_missing_cleanup_or_prior_pdf_rejected(self):
  for change in [{'exit':0},{'independentDockerAbsent':False},{'guardDenials':1},{'pdfGenerated':True},{'httpChecksExecuted':1}]:
   texts,pins,prior,receipt,unit=self.inputs();receipt.update(change)
   with self.assertRaises(ValueError):self.call(texts,pins)
 def test_original_marker_outer_or_receipt_changed_rejected(self):
  for suffix in ['execution.started','outer-result.json','receipt.json']:
   texts,pins,prior,receipt,unit=self.inputs();name=next(n for n in pins if n.endswith('/'+suffix));pins[name]='f'*64
   with self.assertRaises(ValueError):self.call(texts,pins)
 def test_wrong_retained_invocation_or_status_rejected(self):
  for change in [{'InvocationID':'foreign'},{'ExecMainStatus':'0'},{'ExecMainCode':'0'}]:
   texts,pins,prior,receipt,unit=self.inputs();unit.update(change)
   with self.assertRaises(ValueError):self.call(texts,pins)
 def test_explicit_marker_is_exclusive_and_old_marker_preserved(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as tmp:
   root=Path(tmp);(root/'execution.started').write_text('PRESERVE-FIRST');(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_readiness_v2_previous_attempt',return_value={'receiptSha256':'a'*64,'oldMarkerSha256':'b'*64}),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    c.verify_local_manifest();self.assertTrue((root/'execution.readiness-v2.started').exists())
    with self.assertRaises(FileExistsError):c.verify_local_manifest()
   self.assertEqual((root/'execution.started').read_text(),'PRESERVE-FIRST')
 def test_failed_prior_gate_cannot_create_marker(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as tmp:
   root=Path(tmp);(root/'config.json').write_text('{"expected_cgroup":"/mock"}');(root/'local-manifest.json').write_text('{"files":{}}');sha=hashlib.sha256((root/'local-manifest.json').read_bytes()).hexdigest()
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c,'CONFIG',root/'config.json'),mock.patch.object(c,'live_context'),mock.patch.object(c,'verify_readiness_v2_previous_attempt',side_effect=ValueError('missingproof')),mock.patch.dict(os.environ,{'LOCAL_HISTORY_REVIEWED_MANIFEST_SHA256':sha}):
    with self.assertRaises(ValueError):c.verify_local_manifest()
   self.assertFalse((root/'execution.readiness-v2.started').exists())
if __name__=='__main__':unittest.main()
