from pathlib import Path
import json,signal,tempfile,unittest
from unittest import mock
import run

class CleanupTermTests(unittest.TestCase):
 def test_signals_before_cleanup_cancel_but_during_cleanup_are_counted(self):
  state=run.CancellationState()
  with self.assertRaises(run.Cancelled):state.handle(signal.SIGTERM,None)
  state.cleaning=True;state.handle(signal.SIGTERM,None);state.handle(signal.SIGINT,None);self.assertEqual(state.signals,3)
 def test_unit_repeated_term_during_pg_stop_socket_and_export_preserves_receipts(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);h=root/'harness';h.mkdir();(h/'registry.json').write_text(json.dumps({'kind':'fixture','source_commit':'a'*40,'backend_source_commit':'b'*40}));folder=root/'job';(folder/'work').mkdir(parents=True)
   context=mock.Mock(folder=folder,cgroup='/fixture.service');context.verify.return_value={'fixture':True}
   pg=mock.Mock(prepared=True);state=run.CancellationState();export=run.export
   def request_cancel(*args):signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
   def stopped():request_cancel();return {'stopped':True}
   def socket_removed():signal.getsignal(signal.SIGINT)(signal.SIGINT,None);return {'removed':True}
   def publish(*args):request_cancel();return export(*args)
   pg.stop.side_effect=stopped;pg.release_socket.side_effect=socket_removed;pg.report.return_value={'fixture':True}
   old={sig:signal.getsignal(sig)for sig in [signal.SIGTERM,signal.SIGINT]}
   try:
    for sig in old:signal.signal(sig,state.handle)
    with mock.patch.object(run,'ROOT',h),mock.patch.object(run,'CANCELLATION',state),mock.patch.object(run,'WorkerContext',return_value=context),mock.patch.object(run,'verify_inputs'),mock.patch.object(run,'NativePG',return_value=pg),mock.patch.object(run,'stage',side_effect=request_cancel),mock.patch.object(run,'export',side_effect=publish):self.assertEqual(run.main('1'*32),1)
   finally:
    for sig,handler in old.items():signal.signal(sig,handler)
   pg.prepare.assert_not_called();pg.stop.assert_called_once();pg.release_socket.assert_called_once();self.assertEqual(state.signals,4)
   proof=json.loads((folder/'work/artifacts/govbr-route-gates/result.json').read_text());self.assertEqual(proof['exit'],1);self.assertNotIn('cleanupErrors',proof);self.assertTrue(proof['postgresCleanup']['stopped']);self.assertTrue(proof['socketCleanup']['removed']);self.assertEqual(proof['cancelSignals'],3)
if __name__=='__main__':unittest.main()
