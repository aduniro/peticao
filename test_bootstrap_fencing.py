"""Real local file CAS/journal; mocked services/refs, no native fencing claim."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest import mock

import legacy_fence as f
import legacy_cgroups as groups
from operator_journal import Journal
from service_metadata import Metadata, Layout, PublicationUncertain, SANTIAGO, CIVO

HERE = Path(__file__).resolve().parent
OP = 'c' * 32
JOB = 'admin-v2-job-' + 'b' * 32 + '.service'
BOOT = 'source-boot-fixture'


class FileContext:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='metadata-fixture-', dir=HERE)
        self.root = Path(self.tmp.name)
        self.directory = self.root / 'service'
        self.directory.mkdir(mode=0o700)
        self.path = self.directory / 'authority.json'
        self.value = {'role': 'primary', 'generation': 1, 'armed_boot_id': BOOT}
        self.path.write_text(json.dumps(self.value))
        self.path.chmod(0o644)
        self.layout = Layout(os.geteuid(), os.getegid(), 0o700, os.geteuid(), os.getegid(), 0o644)
        self.metadata = Metadata(self.path, self.layout, lambda _: None)

    def tearDown(self):
        self.tmp.cleanup()


class Files(FileContext, unittest.TestCase):
    def test_actual_file_cas_preserves_fixture_owner_mode_and_private_new_value(self):
        before = self.metadata.read()
        value = {**self.value, 'role': 'suspended', 'armed_boot_id': None}
        after = self.metadata.publish(value, before)
        info = self.path.stat()
        self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)),
                         (os.geteuid(), os.getegid(), 0o644))
        self.assertEqual(json.loads(after.raw), value)
        self.assertNotEqual(before.sha256, after.sha256)

    def test_actual_santiago_and_civo_layouts_are_distinct(self):
        self.assertEqual(SANTIAGO, Layout(999, 989, 0o2770, 0, 989, 0o644))
        self.assertEqual(CIVO, Layout(999, 987, 0o700, 999, 987, 0o600))
        with self.assertRaises(PermissionError):
            Metadata(self.path, CIVO, lambda _: None).read()

    def test_changed_preimage_rejected_before_any_publication_temp(self):
        before = self.metadata.read()
        self.path.write_text('{"role":"other-fixture"}')
        with self.assertRaises(PermissionError):
            self.metadata.publish(self.value, before)
        self.assertEqual(list(self.directory.glob('.authority-*')), [])

    def test_actual_symlink_hardlink_and_wrong_permissions_refused(self):
        self.path.chmod(0o660)
        with self.assertRaises(PermissionError):
            self.metadata.read()
        self.path.chmod(0o644)
        link = self.directory / 'other'
        os.link(self.path, link)
        with self.assertRaises(PermissionError):
            self.metadata.read()
        link.unlink()
        self.path.unlink()
        self.path.symlink_to(link)
        with self.assertRaises((PermissionError, OSError)):
            self.metadata.read()

    def test_actual_directory_link_refused_even_in_explicit_fixture_validator(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(OSError):
            Metadata(alias / 'authority.json', self.layout, lambda _: None).read()

    def test_default_ancestor_validator_is_not_fixture_validator(self):
        with self.assertRaises(PermissionError):
            Metadata(self.path, self.layout).read()

    def test_directory_fsync_failure_after_replace_is_visible_uncertain_no_rollback(self):
        before = self.metadata.read()
        sync = os.fsync
        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError('fixture directory sync lost')
            sync(fd)
        value = {**self.value, 'role': 'suspended', 'armed_boot_id': None}
        with mock.patch('service_metadata.os.fsync', side_effect=fail_directory):
            with self.assertRaises(PublicationUncertain):
                self.metadata.publish(value, before)
        self.assertEqual(json.loads(self.metadata.read().raw), value)

    def test_replace_failure_preserves_original_and_new_temp_evidence(self):
        before = self.metadata.read()
        with mock.patch('service_metadata.os.replace', side_effect=OSError('fixture rename lost')):
            with self.assertRaises(OSError):
                self.metadata.publish({**self.value, 'role': 'suspended'}, before)
        self.assertEqual(self.metadata.read(), before)
        self.assertEqual(len(list(self.directory.glob('.authority-*'))), 1)


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='journal-fixture-', dir=HERE)
        self.root = Path(self.tmp.name) / OP
        self.root.mkdir(mode=0o700)
        self.journal = Journal(self.root, OP, owner=os.geteuid())

    def tearDown(self):
        self.tmp.cleanup()

    def test_exclusive_durable_record_readback_and_duplicate_not_overwritten(self):
        value = {'operation_id': OP, 'stage': 'fixture'}
        digest = self.journal.record('fence-intent.json', value)
        self.assertEqual(self.journal.read('fence-intent.json'), (value, digest))
        with self.assertRaises(FileExistsError):
            self.journal.record('fence-intent.json', {**value, 'stage': 'other'})
        self.assertEqual(self.journal.read('fence-intent.json')[0], value)

    def test_wrong_operation_or_name_refused_and_missing_is_not_success(self):
        self.assertIsNone(self.journal.read('fenced-released.json'))
        for name, value in (('../outside', {'operation_id': OP}),
                            ('fence-intent.json', {'operation_id': 'd' * 32})):
            with self.assertRaises(PermissionError):
                self.journal.record(name, value)

    def test_public_receipt_permissions_and_symlinks_refused(self):
        self.journal.record('fence-intent.json', {'operation_id': OP})
        path = self.root / 'fence-intent.json'
        path.chmod(0o644)
        with self.assertRaises(PermissionError):
            self.journal.read(path.name)
        path.unlink()
        path.symlink_to(self.root / 'missing')
        with self.assertRaises(OSError):
            self.journal.read(path.name)


class FakeRefs:
    bus = types.SimpleNamespace(backend_kind='FAKE_LOCAL_NOT_HOST_PROOF')
    def __init__(self, events):
        self.events, self.held, self.fail_ref, self.lose_release = events, {}, False, False
    def acquire(self, unit, invocation):
        self.events.append(('ref', unit))
        if self.fail_ref:
            raise RuntimeError('fixture lost ref')
        self.held[unit] = invocation
    def assert_held(self, unit, invocation):
        if self.held.get(unit) != invocation:
            raise PermissionError('fixture unheld reference')
    def release(self, unit, invocation):
        self.assert_held(unit, invocation)
        self.events.append(('unref', unit))
        del self.held[unit]
        if self.lose_release:
            raise RuntimeError('fixture release response lost')
        return {'unit': unit, 'invocation_id': invocation, 'state': 'released'}


class FakeManager:
    def __init__(self, events, authority):
        self.events, self.authority = events, authority
        self.names = [JOB]
        self.running = {f.UNIT: True, JOB: True}
        self.invocations = {f.UNIT: 'a' * 32, JOB: 'b' * 32}
        self.orphan = False
        self.missing = set()
        self.fail_stop = False
    def inventory(self):
        return [name for name in self.names if name not in self.missing]
    def state(self, unit):
        return {'LoadState': 'not-found' if unit in self.missing else 'loaded',
                'ActiveState': 'active' if self.running.get(unit) else 'inactive',
                'SubState': 'running' if self.running.get(unit) else 'dead',
                'MainPID': 123 if self.running.get(unit) else 0,
                'ControlGroup': '/system.slice/' + unit if self.running.get(unit) else '',
                'InvocationID': self.invocations[unit], 'bound_cgroup': '/system.slice/' + unit}
    def stop(self, unit):
        value = json.loads(self.authority.read().raw)
        if value['role'] != 'suspended' or value['armed_boot_id'] is not None:
            raise AssertionError('stop occurred before authority revocation')
        self.events.append(('stop', unit))
        if self.fail_stop:
            raise TimeoutError('fixture stop response lost')
        self.running[unit] = False
    def cgroup(self, unit):
        live = self.running.get(unit, False) or self.orphan
        return {'empty': not live, 'absent': False, 'pids_count': int(live), 'populated': int(live)}


class FencingTests(FileContext, unittest.TestCase):
    # Real private file setup; service/native reference observations are fixtures.
    def setUp(self):
        super().setUp()
        state = self.root / OP
        state.mkdir(mode=0o700)
        self.journal = Journal(state, OP, owner=os.geteuid())
        self.events = []
        self.refs = FakeRefs(self.events)
        self.manager = FakeManager(self.events, self.metadata)
        self.operation = {'operation_id': OP, 'source_boot_id': BOOT, 'authority_sha256': self.metadata.read().sha256}
        self.fence = f.Fence(self.metadata, self.manager, self.refs, self.journal, self.operation, lambda: BOOT)

    def test_full_local_fence_revokes_before_stop_persists_before_unref_and_observes(self):
        result = self.fence.run()
        self.assertEqual(result['state'], 'fenced')
        self.assertFalse(result['epoch_written'])
        self.assertFalse(result['queue_promoted'])
        self.assertEqual([kind for kind, _ in self.events], ['ref', 'ref', 'stop', 'stop', 'unref', 'unref'])
        held = self.journal.read('fenced-held.json')[0]
        self.assertEqual(held['reference_backend'], 'FAKE_LOCAL_NOT_HOST_PROOF')
        self.assertEqual(self.fence.observe()['state'], 'fenced')

    def test_missing_after_stop_allowed_only_from_complete_receipts_and_original_empty_cgroup(self):
        self.fence.run()
        self.manager.missing.add(JOB)
        self.assertEqual(self.fence.observe()['state'], 'fenced')
        self.manager.orphan = True
        with self.assertRaises(PermissionError):
            self.fence.observe()

    def test_empty_manager_cgroup_does_not_hide_live_child(self):
        self.manager.orphan = True
        with self.assertRaises(PermissionError):
            self.fence.run()
        self.assertIsNone(self.journal.read('fenced-released.json'))
        self.assertEqual(self.fence.observe()['state'], 'uncertain')

    def test_lost_stop_reply_is_not_retried_or_reported_success(self):
        self.manager.fail_stop = True
        with self.assertRaises(TimeoutError):
            self.fence.run()
        self.assertEqual(sum(kind == 'stop' for kind, _ in self.events), 1)
        self.assertEqual(self.fence.observe()['state'], 'uncertain')

    def test_lost_unref_reply_keeps_held_receipt_but_no_terminal_success(self):
        self.refs.lose_release = True
        with self.assertRaises(RuntimeError):
            self.fence.run()
        self.assertIsNotNone(self.journal.read('fenced-held.json'))
        self.assertIsNone(self.journal.read('fenced-released.json'))
        self.assertEqual(self.fence.observe()['state'], 'uncertain')

    def test_reference_failure_does_not_revoke_authority_or_stop_anything(self):
        self.refs.fail_ref = True
        with self.assertRaises(RuntimeError):
            self.fence.run()
        self.assertEqual(json.loads(self.metadata.read().raw)['role'], 'primary')
        self.assertFalse(any(kind == 'stop' for kind, _ in self.events))

    def test_recreated_loaded_unit_refused_even_when_inactive(self):
        self.fence.run()
        self.manager.invocations[JOB] = 'e' * 32
        with self.assertRaises(PermissionError):
            self.fence.observe()

    def test_boot_change_or_authority_change_after_fence_refused(self):
        self.fence.run()
        self.fence.boot_reader = lambda: 'new-boot'
        with self.assertRaises(PermissionError):
            self.fence.observe()
        self.fence.boot_reader = lambda: BOOT
        self.path.write_text(json.dumps(self.value))
        with self.assertRaises(PermissionError):
            self.fence.observe()

    def test_second_mutating_run_refused_no_replay(self):
        self.fence.run()
        before = list(self.events)
        with self.assertRaises(PermissionError):
            self.fence.run()
        self.assertEqual(self.events, before)

    def test_new_legacy_unit_during_stop_leaves_uncertain_and_never_promotes(self):
        original = self.manager.inventory
        calls = 0
        def changed():
            nonlocal calls
            calls += 1
            return original() + (['admin-v2-job-' + 'd' * 32 + '.service'] if calls > 1 else [])
        self.manager.inventory = changed
        with self.assertRaises(PermissionError):
            self.fence.run()
        self.assertIsNone(self.journal.read('fenced-held.json'))
        self.assertIsNone(self.journal.read('fenced-released.json'))
        self.assertEqual(json.loads(self.metadata.read().raw)['role'], 'suspended')

    def test_armed_boot_preimage_must_match_source_boot(self):
        self.path.write_text(json.dumps({**self.value, 'armed_boot_id': 'old-boot'}))
        self.operation['authority_sha256'] = self.metadata.read().sha256
        with self.assertRaises(PermissionError):
            self.fence.run()
        self.assertEqual(self.events, [])

    def test_expired_budget_before_reference_prevents_authority_mutation(self):
        with mock.patch.object(f.time, 'monotonic', side_effect=[0, 301]):
            with self.assertRaises(TimeoutError):
                self.fence.run()
        self.assertEqual(json.loads(self.metadata.read().raw)['role'], 'primary')
        self.assertEqual(self.events, [])


class BoundaryTests(unittest.TestCase):
    def test_uninstalled_nonroot_entry_refuses_before_runtime_import(self):
        with mock.patch.object(f, 'read_root') as read:
            with self.assertRaises(PermissionError):
                f.gate({'action': 'fence', 'operation_id': OP, 'policy_sha256': 'a' * 64})
            read.assert_not_called()

    def test_production_units_arbitrary_commands_and_free_fields_are_not_allowed(self):
        manager = f.Manager()
        with mock.patch.object(f.subprocess, 'run') as spawn:
            for args in (['stop', 'postgresql.service'], ['restart', f.UNIT],
                         ['stop', f.UNIT, 'nginx.service'], ['show', f.UNIT, '--property=Environment'],
                         ['list-units', '*']):
                with self.assertRaises(PermissionError):
                    manager.command(args)
            spawn.assert_not_called()

    def test_legacy_cgroup_binding_cannot_be_empty_or_outside_own_unit(self):
        with mock.patch.object(groups, 'validate_mount', return_value=Path('/fixture')):
            for name in ('', '/system.slice/postgresql.service', '/system.slice/../something', '/user.slice/legacy.service'):
                with self.assertRaises(ValueError):
                    groups.snapshot(name)

    def test_actual_kernel_style_fixture_detects_nested_pid_and_missing_child_events(self):
        with tempfile.TemporaryDirectory(prefix='legacy-cgroup-', dir=HERE) as directory:
            base = Path(directory)
            (base / 'cgroup.controllers').write_text('cpu memory pids\n')
            root = base / 'system.slice' / f.UNIT
            root.mkdir(parents=True)
            (root / 'cgroup.procs').write_text('')
            (root / 'cgroup.events').write_text('populated 0\n')
            self.assertTrue(groups.snapshot('/system.slice/' + f.UNIT, base)['empty'])
            child = root / 'child'
            child.mkdir()
            (child / 'cgroup.procs').write_text('42\n')
            (child / 'cgroup.events').write_text('populated 1\n')
            self.assertFalse(groups.snapshot('/system.slice/' + f.UNIT, base)['empty'])
            (child / 'cgroup.events').unlink()
            with self.assertRaises(ValueError):
                groups.snapshot('/system.slice/' + f.UNIT, base)

    def test_empty_manager_controlgroup_is_not_an_empty_kernel_proof(self):
        manager = f.Manager()
        with mock.patch('legacy_cgroups.snapshot', return_value={'empty': False, 'pids_count': 1}) as read:
            self.assertFalse(manager.cgroup(f.UNIT)['empty'])
        read.assert_called_once_with('/system.slice/' + f.UNIT)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.codes = {name: (HERE / name).read_bytes() for name in f.FILES}
        self.policy = {'status': 'REVIEWED_SOURCE_FENCE', 'operation_id': OP, 'source_boot_id': BOOT,
                       'authority_sha256': 'a' * 64, 'manifest_event': 99, 'peer_ack_event': 100,
                       'code_sha256': {name: hashlib.sha256(raw).hexdigest() for name, raw in self.codes.items()}}

    def validate(self):
        raw = json.dumps(self.policy).encode()
        def read(path, mode, limit=1024**2):
            return raw if path == f.POLICY else self.codes[path.name]
        request = {'action': 'fence', 'operation_id': OP, 'policy_sha256': hashlib.sha256(raw).hexdigest()}
        with mock.patch.object(f, '__file__', str(f.LIB / 'legacy_fence.py')), \
                mock.patch.object(f.os, 'geteuid', return_value=0), \
                mock.patch.object(f.socket, 'gethostname', return_value='sonda-verifica3'), \
                mock.patch.object(f, 'boot', return_value=BOOT), \
                mock.patch.object(f, 'read_root', side_effect=read), \
                mock.patch.object(f, 'manager_namespace'):
            return f.gate(request)

    def test_mocked_packet_checks_all_code_before_runtime_import(self):
        self.assertEqual(self.validate()['operation_id'], OP)
        self.codes['service_metadata.py'] = b'raise AssertionError("unvalidated")'
        with self.assertRaises(PermissionError):
            self.validate()

    def test_bool_events_old_boot_and_unreviewed_packet_refused(self):
        original = copy.deepcopy(self.policy)
        for changes in ({'manifest_event': True}, {'peer_ack_event': 0}, {'source_boot_id': 'old'}, {'status': 'TEMPLATE'}):
            self.policy = {**original, **changes}
            with self.assertRaises(PermissionError):
                self.validate()

    def test_duplicate_json_key_refused(self):
        with self.assertRaises(ValueError):
            json.loads('{"action":"fence","action":"observe"}', object_pairs_hook=f.unique)


if __name__ == '__main__':
    unittest.main()
