import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "runtime"))
import topology as t
import headroom as h


def configuration():
    return {'version': 1, 'coordinator': 'civo', 'recovery': 'santiago',
            'workers': ['civo', 'akamai'], 'queue_root': t.QUEUE, 'worker_root': t.WORKER,
            'checkpoint_root': t.CHECKPOINTS, 'code_root': t.CODE,
            'fence_scope': ['civo', 'akamai', 'santiago', 'sao-paulo'],
            'recovery_identity': t.SSH_IDENTITY, 'recovery_known_hosts': t.SSH_KNOWN_HOSTS,
            'recovery_known_hosts_sha256': '1' * 64}


class TopologyTests(unittest.TestCase):
    def test_plan_keeps_single_existing_queue_and_dispatch_disabled(self):
        value = t.migration_inventory(configuration())
        self.assertEqual(value['single_queue'], '/srv/admin-v2-coordinator/queue.sqlite')
        self.assertEqual(value['required_worker_nodes'], ['civo', 'akamai'])
        self.assertFalse(value['dispatch_enabled'])
        self.assertFalse(value['qualification'])

    def test_fixed_topology_rejects_old_primary_production_replica_and_added_workers(self):
        for field, value in [('coordinator', 'santiago'), ('recovery', 'sao-paulo'),
                             ('workers', ['civo', 'akamai', 'azure']), ('queue_root', '/tmp/new-queue'),
                             ('fence_scope', ['civo']), ('recovery_identity', '/tmp/key')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                t.validate({**configuration(), field: value})

    def test_version_bool_unknown_and_missing_field_rejected(self):
        for value in ({**configuration(), 'version': True}, {**configuration(), 'qualified': True},
                      {k: v for k, v in configuration().items() if k != 'fence_scope'}):
            with self.assertRaises(ValueError):
                t.validate(value)

    def test_actual_hostkey_file_digest_required(self):
        for value in ('0' * 64, 'PENDING', 'A' * 64, None):
            with self.assertRaises(ValueError):
                t.validate({**configuration(), 'recovery_known_hosts_sha256': value})

    def test_duplicate_key_rejected_not_last_key_wins(self):
        with self.assertRaises(ValueError):
            json.loads('{"coordinator":"civo","coordinator":"santiago"}', object_pairs_hook=t.no_duplicates)

    def test_source_recovery_only_observes_primary(self):
        for action in t.RECOVERY_ACTIONS:
            self.assertEqual(t.authorize_peer(configuration(), 'civo', 'santiago', action), 'recovery-observer')
        for action in ('submit', 'cancel', 'dispatch', 'complete', 'replica-ingest'):
            with self.assertRaises(PermissionError):
                t.authorize_peer(configuration(), 'civo', 'santiago', action)

    def test_production_and_whatsapp_peers_cannot_read_or_mutate_dev_gateway(self):
        for peer in ('sao-paulo', 'waha'):
            for action in t.READ_ACTIONS | {'submit', 'cancel', 'node-info'}:
                with self.assertRaises(PermissionError):
                    t.authorize_peer(configuration(), 'civo', peer, action)

    def test_clients_never_dispatch_or_finalize(self):
        for peer in ('dell', 'akamai'):
            self.assertEqual(t.authorize_peer(configuration(), 'civo', peer, 'submit'), 'client')
            for action in ('dispatch', 'complete', 'retire', 'replica-ingest'):
                with self.assertRaises(PermissionError):
                    t.authorize_peer(configuration(), 'civo', peer, action)

    def test_replication_goes_civo_to_santiago_only(self):
        command = t.replication_argv(configuration(), 'civo')
        self.assertEqual(command[-1], 'vigia-coord@100.80.18.81')
        self.assertEqual(command[command.index('-p') + 1], '2224')
        self.assertNotIn('100.109.6.122', ' '.join(command))
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertIn('ControlPath=none', command)
        for node in ('santiago', 'akamai', 'sao-paulo'):
            with self.assertRaises(PermissionError):
                t.replication_argv(configuration(), node)

    def test_only_civo_can_ingest_replica_on_recovery(self):
        self.assertEqual(t.authorize_peer(configuration(), 'santiago', 'civo', 'replica-ingest'), 'replication')
        for peer in ('dell', 'akamai', 'sao-paulo', 'waha', 'santiago'):
            with self.assertRaises(PermissionError):
                t.authorize_peer(configuration(), 'santiago', peer, 'replica-ingest')

    def test_ssh_context_binds_actual_destination_not_request_claim(self):
        self.assertEqual(t.connection_peer('100.105.193.63 45123 100.122.224.82 22', 'civo'), 'dell')
        for value in ('', '100.105.193.63 45123 100.122.224.82 2224',
                      '100.105.193.63 45123 100.80.18.81 22', '8.8.8.8 1 100.122.224.82 22',
                      '100.105.193.63 x 100.122.224.82 22', '100.105.193.63 0 100.122.224.82 22'):
            with self.assertRaises(PermissionError):
                t.connection_peer(value, 'civo')

    def test_hostname_does_not_default_to_primary_or_standby(self):
        self.assertEqual(t.local_node('peticao-civo'), 'civo')
        self.assertEqual(t.local_node('sonda-verifica3'), 'santiago')
        for value in ('unknown', 'peticao-civo.attacker', 'sonda-verifica3.extra'):
            with self.assertRaises(PermissionError):
                t.local_node(value)

    def test_load_validates_root_control_reader_and_schema(self):
        data = json.dumps(configuration()).encode()
        with mock.patch.object(t, 'control_bytes', return_value=data) as read:
            self.assertEqual(t.load(), configuration())
            read.assert_called_once_with(t.CONFIG)

    def test_real_local_control_reader_refuses_user_writable_or_linked_ancestry(self):
        # These are actual local files; no root/euid spoofing in this test.
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / 'topology.json'
            path.write_text(json.dumps(configuration()))
            path.chmod(0o644)
            linked = Path(folder) / 'linked.json'
            linked.symlink_to(path)
            for file in (path, linked):
                # Workspace ancestry is user-owned (or writable), and is not /etc.
                with self.assertRaises((PermissionError, OSError)):
                    t.control_bytes(file)


class CapacityTests(unittest.TestCase):
    def test_nominal32gib_is_not_actual32gib(self):
        result = h.candidate(int(29.9 * h.GIB), 28 * h.GIB, 16)
        self.assertEqual(result['memory_max_bytes'], 20 * h.GIB)
        self.assertEqual(result['cpu_quota_percent'], 1400)
        self.assertFalse(result['qualified'])

    def test_headroom_declines_busy_host(self):
        result = h.candidate(30 * h.GIB, 5 * h.GIB, 16)
        self.assertIsNone(result['memory_max_bytes'])
        self.assertFalse(result['eligible_capacity_candidate'])

    def test_actual_large_available_host_can_propose24_without_enabling(self):
        result = h.candidate(32 * h.GIB, 30 * h.GIB, 16)
        self.assertEqual(result['memory_max_bytes'], 24 * h.GIB)
        self.assertFalse(result['reservation_created'])
        self.assertTrue(result['requires_fresh_prelaunch_measurement'])

    def test_invalid_memory_measurement_rejected(self):
        for args in ((True, 1, 16), (1, 2, 16), (1, 1, 0), (0, 0, 16)):
            with self.assertRaises(ValueError):
                h.candidate(*args)


if __name__ == '__main__':
    unittest.main()
