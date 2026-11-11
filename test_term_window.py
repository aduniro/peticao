"""Pure private temporary-directory regression, no app, network, Docker or PG."""
import unittest,tempfile,os,stat,signal,importlib.util
from pathlib import Path
from unittest import mock
import package_http as current,local_controller as c
ROOT=Path(__file__).resolve().parent
h=current
if os.environ.get('R11_TEST_BASELINE_C997')=='1':
 spec=importlib.util.spec_from_file_location('r11_baseline',ROOT/'mock-proof/baseline-c997-package_http.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class TermWindowTests(unittest.TestCase):
 def test_term_after_permission_syscall_before_python_assignment_restores_and_fails(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);state=c.CancellationState();proof={};original=os.fchmod
   def chmod(fd,mode):
    original(fd,mode)
    if mode==0o500:state.handle(signal.SIGTERM,None)
   try:
    with mock.patch.object(os,'fchmod',side_effect=chmod):
     error=None
     try:
      with h.readonly_spool(r,state,proof):self.fail('cancelled scope cannot run')
     except BaseException as caught:error=caught
    self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700,'TERM syscall window must restore permission')
    self.assertIsInstance(error,c.Cancelled)
    self.assertTrue(proof['restored']);self.assertEqual(state.signals,1)
    self.assertFalse(state.cleaning)
   finally:p.chmod(0o700) # Own mock cleanup even when preserved baseline fails.
 def test_preexisting_nonadmitted_mode_is_never_changed(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o500)
   try:
    with mock.patch.object(os,'fchmod')as chmod:
     with self.assertRaises(RuntimeError):
      with h.readonly_spool(r,c.CancellationState(),{}):self.fail('unadmitted scope')
     chmod.assert_not_called()
    self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o500)
   finally:p.chmod(0o700)
 def test_term_before_permission_syscall_also_restores(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);state=c.CancellationState();proof={};original=os.fchmod
   def chmod(fd,mode):
    if mode==0o500:state.handle(signal.SIGTERM,None)
    original(fd,mode)
   with mock.patch.object(os,'fchmod',side_effect=chmod):
    with self.assertRaises(c.Cancelled):
     with h.readonly_spool(r,state,proof):self.fail('cancelled scope')
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700);self.assertTrue(proof['restored']);self.assertEqual(state.signals,1)
if __name__=='__main__':unittest.main()
