"""Actual private filesystem/SQLite with injected unit/bus/storage observations.

No SystemBus, host unit, mount, listener or external service is touched.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent/'runtime'))
import artifacts
import remote_contract as c
from broker_lifecycle import Lifecycle, RetirementUncertain


class Retirement(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='broker-fixture-', dir=Path(__file__).parent)
        self.root = Path(self.tmp.name)
        for name in ('journal', 'retirements', 'exports'):
            (self.root/name).mkdir(mode=0o700)
        self.manifest = {'backend': c.BACKEND, 'job_id': 'a'*32, 'generation': 1,
                         'worker_id': 'civo', 'profile': 'fixture-pass', 'profile_sha256': 'b'*64,
                         'source_sha256': 'c'*64, 'dependencies_sha256': 'd'*64,
                         'artifact_policy_sha256': 'e'*64, 'payload_sha256': 'f'*64,
                         'coordinator_host': 'civo', 'coordinator_boot_id': 'controller-boot',
                         'authority_operation_id': '1'*32, 'epoch_sha256': '2'*64}
        self.receipt = {'unit': 'admin-dev-'+'a'*32+'-g1.service', 'boot_id': 'worker-boot',
                        'job_id': 'a'*32, 'generation': 1, 'worker_id': 'civo',
                        'manifest_sha256': c.digest(self.manifest), 'prepared_at': '2026-11-15T04:00:00+00:00'}
        self.profiles = {'fixture-pass': 'b'*64}
        self.token = '3'*64
        self.bundle = b'synthetic sealed bundle'
        self.bundle_sha = hashlib.sha256(self.bundle).hexdigest()
        self.invocation = '4'*32
        self.stop = {'worker_boot_id': 'worker-boot', 'unit': self.receipt['unit'],
                     'invocation_id': self.invocation, 'receipt_sha256': c.digest(self.receipt),
                     'main_pid': 0, 'cgroup_empty': True, 'unit_stopped': True, 'exit_code':0, 'canceled':False}
        self.row = {'job_id': 'a'*32, 'manifest_json': c.canonical(self.manifest),
                    'receipt_json': c.canonical(self.receipt), 'receipt_sha256': c.digest(self.receipt),
                    'token_sha256': hashlib.sha256(self.token.encode()).hexdigest(),
                    'state': 'completed', 'invocation_id': self.invocation}
        final = {'protocol':1, 'identity':{'job_id':'a'*32,'generation':1,'manifest_sha256':c.digest(self.manifest),
                 'receipt_sha256':c.digest(self.receipt),'invocation_id':self.invocation,'worker_boot_id':'worker-boot'},
                 'profile':'fixture-pass','outcome':'completed','exit_code':0,'unit_stop':self.stop,'runner_report_valid':True}
        self.binding = {'job_id': 'a'*32, 'stop_proof': c.canonical(self.stop),
                        'finalized_result': c.canonical(final), 'bundle_sha256': self.bundle_sha,
                        'invocation_id': self.invocation, 'receipt_sha256':c.digest(self.receipt)}
        self.path = self.root/'journal/receipts.sqlite'
        self.path.touch(mode=0o600)
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE receipts(job_id TEXT,manifest_json TEXT,receipt_json TEXT,receipt_sha256 TEXT,token_sha256 TEXT,state TEXT,invocation_id TEXT)')
            db.execute('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)', tuple(self.row.values()))
            db.execute('CREATE TABLE unit_bindings(job_id TEXT,stop_proof TEXT,finalized_result TEXT,bundle_sha256 TEXT,invocation_id TEXT,receipt_sha256 TEXT)')
            db.execute('INSERT INTO unit_bindings VALUES(?,?,?,?,?,?)', tuple(self.binding.values()))
        self.refs = mock.Mock()
        self.refs.lost = False
        self.refs.records = {self.receipt['unit']: {'state': 'held'}}
        self.refs.snapshot.return_value = {'state': 'released', 'connection_uncertain': False,
                                           'invocation_id': self.invocation}
        self.service = mock.Mock()
        self.service.journal.path = self.path
        self.service.journal.profiles = self.profiles
        self.service.journal.boot_id.return_value = 'worker-boot'
        self.service.stored.side_effect = lambda job: (dict(self.row), dict(self.binding))
        self.service.exports = self.root/'exports'
        self.service.adapter.references = self.refs
        self.service.admission.mutation.side_effect = lambda m: contextlib.nullcontext()
        self.service.job_lock.side_effect = lambda job: contextlib.nullcontext()
        self.service.adapter.properties.return_value = {'MainPID': '0', 'ActiveState': 'inactive',
                                                       'LoadState': 'not-found', 'ControlGroup': '', 'InvocationID': ''}
        self.retained = {'state': 'retained', 'mount_absent': True,
                         'manifest_sha256': c.digest(self.manifest), 'receipt_sha256': c.digest(self.receipt),
                         'stopped_invocation_id': self.invocation}
        self.service.adapter.storage.status.return_value = dict(self.retained)
        (self.service.exports/('a'*32+'.tar')).write_bytes(self.bundle)
        (self.service.exports/('a'*32+'.tar')).chmod(0o600)
        self.life = Lifecycle(self.service, self.refs, self.root/'retirements')
        self.request = {'action': 'retire', 'manifest': self.manifest, 'token': self.token,
                        'receipt_sha256': c.digest(self.receipt), 'bundle_sha256': self.bundle_sha,
                        'custody_receipt_sha256': '5'*64}

    def tearDown(self):
        self.tmp.cleanup()

    def test_retirement_durable_intent_precedes_cleanup_and_receipt_follows(self):
        def cleanup(*args):
            directory = self.root/'retirements'/('a'*32)
            intent = json.loads((directory/'intent.json').read_text())
            self.assertEqual(intent['bundle_sha256'], self.bundle_sha)
            self.assertNotIn(self.token, (directory/'intent.json').read_text())
            self.assertFalse((directory/'receipt.json').exists())
        self.service.adapter.cleanup_storage.side_effect = cleanup
        result = self.life(self.request)
        self.assertEqual(result['state'], 'retained')
        path = self.root/'retirements'/('a'*32)/'receipt.json'
        self.assertEqual(json.loads(path.read_text()), result)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_duplicate_only_verifies_receipt_no_unmount_unref_replay(self):
        first = self.life(self.request)
        self.assertEqual(self.life(self.request), first)
        self.service.adapter.cleanup_storage.assert_called_once()
        self.assertEqual(self.refs.snapshot.call_count, 1)

    def test_wrong_token_or_changed_identity_never_enters_cleanup(self):
        for key, value in [('token', '6'*64), ('receipt_sha256', '6'*64), ('bundle_sha256', '6'*64)]:
            with self.subTest(key=key), self.assertRaises(PermissionError):
                self.life({**self.request, key: value})
        self.service.adapter.cleanup_storage.assert_not_called()
        self.assertEqual(list((self.root/'retirements').iterdir()), [])

    def test_changed_custody_attestation_after_retirement_refused(self):
        self.life(self.request)
        with self.assertRaises(PermissionError):
            self.life({**self.request, 'custody_receipt_sha256': '6'*64})
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_sealed_export_tampering_prevents_retirement(self):
        (self.service.exports/('a'*32+'.tar')).write_bytes(b'changed')
        with self.assertRaises(PermissionError): self.life(self.request)
        self.service.adapter.cleanup_storage.assert_not_called()

    def test_cleanup_failure_burns_intent_no_second_invocation(self):
        self.service.adapter.cleanup_storage.side_effect = OSError('private error')
        with self.assertRaises(OSError): self.life(self.request)
        with self.assertRaises(RetirementUncertain): self.life(self.request)
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_crashed_broker_intent_is_not_replayed_by_new_lifetime(self):
        self.service.adapter.cleanup_storage.side_effect = OSError('failure')
        with self.assertRaises(OSError): self.life(self.request)
        new = Lifecycle(self.service, self.refs, self.root/'retirements')
        with self.assertRaises(RetirementUncertain): new(self.request)
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_receipt_fsync_failure_is_uncertain_without_cleanup_replay(self):
        real = artifacts.durable_json
        def write(path, value):
            real(path, value)
            if path.name == 'receipt.json': raise OSError('fsync uncertainty')
        with mock.patch.object(artifacts, 'durable_json', side_effect=write):
            with self.assertRaises(OSError): self.life(self.request)
        self.assertTrue(self.life.uncertain)
        with self.assertRaises(RetirementUncertain): self.life(self.request)
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_recovery_sync_failure_does_not_adopt_visible_receipt(self):
        self.life(self.request)
        with mock.patch.object(os, 'fsync', side_effect=OSError('storage failure')):
            with self.assertRaises(OSError): self.life(self.request)
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_retained_wrong_invocation_is_not_success(self):
        self.service.adapter.storage.status.return_value = {**self.retained, 'stopped_invocation_id': '7'*32}
        with self.assertRaises(PermissionError): self.life(self.request)
        self.assertTrue(self.life.uncertain)

    def test_held_reference_after_cleanup_never_seals_success(self):
        self.refs.snapshot.return_value['state'] = 'held'
        with self.assertRaises(PermissionError): self.life(self.request)
        self.assertFalse((self.root/'retirements'/('a'*32)/'receipt.json').exists())

    def test_startup_adopts_completed_retained_receipt_without_rearming(self):
        self.life(self.request)
        new = Lifecycle(self.service, self.refs, self.root/'retirements')
        self.assertEqual(new.startup(), {'state': 'RECONCILED', 'receipt_count': 1})
        self.service.adapter.cleanup_storage.assert_called_once()
        self.refs.acquire.assert_not_called()

    def test_startup_finalized_without_retirement_blocks_listener(self):
        with self.assertRaises((OSError, RetirementUncertain)): self.life.startup()
        self.refs.acquire.assert_not_called()
        self.service.adapter.cleanup_storage.assert_not_called()

    def test_startup_running_or_uncertain_burned_launch_never_rearms(self):
        for state in ('running', 'uncertain', 'start_intent'):
            with sqlite3.connect(self.path) as db: db.execute('UPDATE receipts SET state=?', (state,))
            with self.subTest(state=state), self.assertRaises(RetirementUncertain): self.life.startup()
        self.refs.acquire.assert_not_called()

    def test_startup_prepared_never_started_can_continue(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE receipts SET state='prepared',invocation_id=NULL")
            db.execute('DELETE FROM unit_bindings')
        self.service.adapter.storage.status.side_effect = FileNotFoundError()
        self.assertEqual(self.life.startup()['state'], 'RECONCILED')
        self.refs.acquire.assert_not_called()

    def test_startup_reboot_or_recreated_unit_refused(self):
        self.life(self.request)
        self.service.journal.boot_id.return_value = 'new-boot'
        with self.assertRaises(RetirementUncertain): self.life.startup()
        self.service.journal.boot_id.return_value = 'worker-boot'
        self.service.adapter.properties.return_value.update(LoadState='loaded', InvocationID='7'*32)
        with self.assertRaises(RetirementUncertain): self.life.startup()

    def test_startup_live_old_process_refused(self):
        self.service.adapter.properties.return_value['MainPID'] = '1234'
        with self.assertRaises(RetirementUncertain): self.life.startup()

    def test_foreign_retirement_directory_refused(self):
        (self.root/'retirements'/('f'*32)).mkdir(mode=0o700)
        with self.assertRaises(RetirementUncertain): self.life.startup()

    def test_private_receipt_symlink_refused(self):
        self.life(self.request)
        path = self.root/'retirements'/('a'*32)/'receipt.json'
        data = path.read_bytes();path.unlink();other = self.root/'retirements'/('a'*32)/'other.json'
        other.write_bytes(data);other.chmod(0o600);path.symlink_to(other)
        with self.assertRaises(ValueError): self.life(self.request)

    def test_epoch_change_or_lost_ref_session_blocks_request(self):
        self.service.journal._epoch.side_effect = PermissionError('epoch changed')
        with self.assertRaises(PermissionError): self.life({'action': 'observe', 'id': 'a'*32})
        self.service.rpc.assert_not_called()
        self.service.journal._epoch.side_effect = None
        self.refs.check.side_effect = ConnectionError('session lost')
        with self.assertRaises(ConnectionError): self.life({'action': 'start'})
        self.service.rpc.assert_not_called()

    def test_other_rpc_actions_use_the_same_worker_instance(self):
        self.service.rpc.return_value = {'state': 'running'}
        for action in ('observe', 'logs', 'bundle'):
            self.assertEqual(self.life({'action': action}), {'state': 'running'})
        self.assertEqual(self.service.rpc.call_count, 3)

    def test_lost_reply_observed_without_replaying_retirement(self):
        saved = self.life(self.request)
        self.life.uncertain = True
        self.assertEqual(self.life({**self.request, 'action':'retirement'}), saved)
        self.service.adapter.cleanup_storage.assert_called_once()
        self.assertEqual(self.refs.snapshot.call_count, 1)

    def test_receipt_observation_never_creates_missing_retirement(self):
        self.assertEqual(self.life({**self.request, 'action':'retirement'}), {'state':'uncertain','no_replay':True})
        self.assertFalse((self.root/'retirements'/('a'*32)).exists())
        self.service.adapter.cleanup_storage.assert_not_called()

    def test_partial_retirement_observed_uncertain_without_second_cleanup(self):
        self.service.adapter.cleanup_storage.side_effect = OSError('failure')
        with self.assertRaises(OSError):self.life(self.request)
        self.assertEqual(self.life({**self.request, 'action':'retirement'}), {'state':'uncertain','no_replay':True})
        self.service.adapter.cleanup_storage.assert_called_once()

    def test_quarantine_keeps_readonly_available_but_blocks_mutations(self):
        self.life.uncertain = True
        self.service.rpc.return_value = {'state':'uncertain'}
        self.assertEqual(self.life({'action':'observe','id':'a'*32}), {'state':'uncertain'})
        with self.assertRaises(RetirementUncertain):self.life({'action':'start'})
        self.service.rpc.assert_called_once()

    def test_corrupt_finalized_state_or_stop_proof_is_not_retired(self):
        original = dict(self.binding)
        for field, value in [('finalized_result','{}'), ('stop_proof','{}')]:
            self.binding.update(original); self.binding[field] = value
            with self.subTest(field=field), self.assertRaises(PermissionError):self.life(self.request)
        self.service.adapter.cleanup_storage.assert_not_called()

    def test_startup_corrupt_finalized_result_cannot_adopt_old_receipt(self):
        self.life(self.request)
        with sqlite3.connect(self.path) as db:db.execute("UPDATE unit_bindings SET finalized_result='{}'")
        with self.assertRaises(PermissionError):self.life.startup()


if __name__ == '__main__': unittest.main()
