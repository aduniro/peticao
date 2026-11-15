import os
from pathlib import Path
import unittest
from unittest import mock

import unit_refs as refs
from systemd_adapter import SystemdAdapter

UNIT='admin-dev-'+'a'*32+'-g1.service'
INV='b'*32


class FakeBus:
    backend_kind='FAKE_LOCAL_NOT_HOST_PROOF'
    def __init__(self):self.calls=[];self.bad=False;self.fail_ref=False;self.fail_unref=False;self.closed=False;self.references=set()
    def check(self):
        if self.bad or self.closed:raise OSError('fixture connection lost')
    def ref(self,unit):
        self.calls.append(('ref',unit));self.references.add(unit)
        if self.fail_ref:raise TimeoutError('fixture lost ref reply')
    def unref(self,unit):
        self.calls.append(('unref',unit));self.references.remove(unit)
        if self.fail_unref:raise TimeoutError('fixture lost unref reply')
    def close(self):self.closed=True;self.references.clear()


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.bus=FakeBus();self.pid=123;self.boot='boot-1'
        self.refs=refs.UnitReferences(factory=lambda:self.bus,pid=lambda:self.pid,boot=lambda:self.boot)

    def test_ref_remains_until_explicit_release_after_cleanup(self):
        self.assertEqual(self.refs.acquire(UNIT,INV)['state'],'held')
        self.refs.assert_held(UNIT,INV)
        self.assertIn(UNIT,self.bus.references)
        self.assertEqual(self.refs.release(UNIT,INV)['state'],'released')
        self.assertNotIn(UNIT,self.bus.references)
        self.refs.close();self.assertTrue(self.bus.closed)

    def test_no_duplicate_ref_or_reacquisition_of_same_unit(self):
        self.refs.acquire(UNIT,INV)
        with self.assertRaises(PermissionError):self.refs.acquire(UNIT,INV)
        self.refs.release(UNIT,INV)
        with self.assertRaises(PermissionError):self.refs.acquire(UNIT,INV)
        self.assertEqual(self.bus.calls,[('ref',UNIT),('unref',UNIT)])

    def test_changed_invocation_is_not_same_held_reference(self):
        self.refs.acquire(UNIT,INV)
        with self.assertRaises(PermissionError):self.refs.assert_held(UNIT,'c'*32)
        with self.assertRaises(PermissionError):self.refs.release(UNIT,'c'*32)
        self.assertEqual(self.bus.calls,[('ref',UNIT)])

    def test_ref_reply_loss_is_latched_and_never_retried(self):
        self.bus.fail_ref=True
        with self.assertRaises(refs.ReferenceUncertain):self.refs.acquire(UNIT,INV)
        self.bus.fail_ref=False
        with self.assertRaises(refs.ReferenceUncertain):self.refs.acquire(UNIT,INV)
        self.assertEqual(self.bus.calls,[('ref',UNIT)])
        self.assertEqual(self.refs.snapshot(UNIT)['state'],'uncertain')

    def test_unref_reply_loss_is_latched_and_never_retried(self):
        self.refs.acquire(UNIT,INV);self.bus.fail_unref=True
        with self.assertRaises(refs.ReferenceUncertain):self.refs.release(UNIT,INV)
        self.bus.fail_unref=False
        with self.assertRaises(refs.ReferenceUncertain):self.refs.release(UNIT,INV)
        self.assertEqual(self.bus.calls,[('ref',UNIT),('unref',UNIT)])

    def test_connection_loss_does_not_rearm_when_transport_returns(self):
        self.refs.acquire(UNIT,INV);self.bus.bad=True
        with self.assertRaises(refs.ReferenceUncertain):self.refs.assert_held(UNIT,INV)
        self.bus.bad=False
        with self.assertRaises(refs.ReferenceUncertain):self.refs.assert_held(UNIT,INV)

    def test_fork_or_boot_change_invalidates_reference(self):
        self.refs.acquire(UNIT,INV);self.pid=124
        with self.assertRaises(refs.ReferenceUncertain):self.refs.assert_held(UNIT,INV)
        self.pid=123
        with self.assertRaises(refs.ReferenceUncertain):self.refs.assert_held(UNIT,INV)
        other=refs.UnitReferences(factory=FakeBus,pid=lambda:123,boot=lambda:self.boot)
        other.acquire(UNIT,INV);self.boot='boot-2'
        with self.assertRaises(refs.ReferenceUncertain):other.assert_held(UNIT,INV)

    def test_cannot_close_with_live_or_uncertain_reference(self):
        self.refs.acquire(UNIT,INV)
        with self.assertRaises(PermissionError):self.refs.close()
        self.assertFalse(self.bus.closed)

    def test_foreign_names_or_noncanonical_invocation_never_call_bus(self):
        for name,inv in [('ssh.service',INV),(UNIT,'not-an-id'),('../../escape',INV)]:
            with self.assertRaises(PermissionError):self.refs.acquire(name,inv)
        self.assertFalse(self.bus.calls)

    def test_unacquired_reference_and_closed_provider_rejected(self):
        with self.assertRaises(PermissionError):self.refs.assert_held(UNIT,INV)
        self.refs.close()
        with self.assertRaises(refs.ReferenceUncertain):self.refs.acquire(UNIT,INV)

    def test_native_backend_refuses_nonroot_before_loading_library(self):
        with mock.patch.object(refs.os,'geteuid',return_value=1000),mock.patch.object(refs.C,'CDLL') as load:
            with self.assertRaises(PermissionError):refs.LibSystemdBus()
            load.assert_not_called()

    def test_constructor_failure_closes_unreferenced_connection(self):
        bus=FakeBus();bus.bad=True
        with self.assertRaises(refs.ReferenceUncertain):refs.UnitReferences(factory=lambda:bus)
        self.assertTrue(bus.closed)


class AdapterLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.bus=FakeBus();self.refs=refs.UnitReferences(factory=lambda:self.bus,boot=lambda:'boot-1')
        self.storage=mock.Mock();self.storage.cleanup.return_value={'state':'retained','mount_absent':True}
        self.adapter=SystemdAdapter(boot_id=lambda:'boot-1',storage=self.storage,references=self.refs)
        self.manifest={'job_id':'a'*32,'generation':1};self.receipt={'unit':UNIT,'boot_id':'boot-1'}
        self.binding={'invocation_id':INV,'main_pid':0,'cgroup_empty':True,'cgroup_path':'/system.slice/'+UNIT,'exit_code':0,'exited':True}
        self.adapter.observe=mock.Mock(return_value=self.binding)
        self.adapter.properties=mock.Mock(return_value={'ActiveState':'inactive','SubState':'dead'})
        self.adapter.cgroup_empty=mock.Mock(return_value=True)
        self.refs.acquire(UNIT,INV)

    def test_retention_regression_reference_spans_unmount_then_unref(self):
        def clean(*args):
            self.assertIn(UNIT,self.bus.references)
            return {'state':'retained','mount_absent':True}
        self.storage.cleanup.side_effect=clean
        self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.assertNotIn(UNIT,self.bus.references)
        self.assertEqual(self.refs.snapshot(UNIT)['state'],'released')

    def test_failed_storage_cleanup_never_drops_reference(self):
        self.storage.cleanup.side_effect=TimeoutError('fixture uncertain unmount')
        with self.assertRaises(TimeoutError):self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.assertIn(UNIT,self.bus.references)
        self.assertEqual(self.refs.snapshot(UNIT)['state'],'held')

    def test_connection_loss_prevents_cleanup_not_just_metadata_check(self):
        self.bus.bad=True
        with self.assertRaises(refs.ReferenceUncertain):self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.storage.cleanup.assert_not_called()

    def test_missing_collected_unit_still_refuses_cleanup(self):
        self.adapter.observe.return_value=None
        with self.assertRaises(PermissionError):self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.storage.cleanup.assert_not_called();self.assertIn(UNIT,self.bus.references)

    def test_unref_failure_after_retained_storage_is_uncertain_no_repeat(self):
        self.bus.fail_unref=True
        with self.assertRaises(refs.ReferenceUncertain):self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.assertEqual(self.storage.cleanup.call_count,1)
        with self.assertRaises(refs.ReferenceUncertain):self.adapter.cleanup_storage(self.manifest,self.receipt,{},self.binding)
        self.assertEqual(self.storage.cleanup.call_count,1)

    def test_stop_rejects_missing_referenced_unit(self):
        self.adapter.observe.return_value=None
        self.adapter.command=mock.Mock()
        with self.assertRaises(PermissionError):self.adapter.stop(self.manifest,self.receipt,{},self.binding)
        self.adapter.command.assert_not_called()


if __name__=='__main__':unittest.main()
