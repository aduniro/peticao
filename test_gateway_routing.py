import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'runtime'))
import gateway
import replication_route
import topology
from test_topology import configuration


class EntryTests(unittest.TestCase):
    def test_gateway_entry_default_blocks_before_reading_or_spawning(self):
        with mock.patch.object(gateway.sys, 'stdin', None), mock.patch.object(gateway.subprocess, 'run') as spawn:
            with self.assertRaises(PermissionError):
                gateway.main()
            spawn.assert_not_called()

    def test_replication_default_blocks_before_private_key_metadata_or_network(self):
        with mock.patch.object(replication_route, 'known_hosts_bytes') as read:
            with self.assertRaises(PermissionError):
                replication_route.command({'role': 'primary'})
            read.assert_not_called()

    def test_unknown_peer_rejected_before_request_read(self):
        with mock.patch.object(gateway.authority_guard, 'require_gateway_qualified'), \
                mock.patch.object(topology, 'load', return_value=configuration()), \
                mock.patch.object(topology, 'local_node', return_value='civo'), \
                mock.patch.dict(gateway.os.environ, {'SSH_CONNECTION': '100.115.154.25 10100 100.122.224.82 22'}), \
                mock.patch.object(gateway.sys, 'stdin', None), \
                mock.patch.object(gateway.subprocess, 'run') as spawn:
            with self.assertRaises(PermissionError):
                gateway.main()
            spawn.assert_not_called()

    def test_fencing_and_ingest_never_inherit_weak_legacy_implementation(self):
        with mock.patch.object(gateway.subprocess, 'run') as spawn:
            for local, peer, action in [('civo', 'santiago', 'fence-info'),
                                        ('santiago', 'civo', 'replica-ingest')]:
                with self.assertRaisesRegex(PermissionError, 'native_recovery_provider_not_qualified'):
                    gateway.handle(configuration(), local, peer, {'action': action})
            spawn.assert_not_called()

    def test_client_fixed_rpc_drops_owner_secrets_and_dispatch_enable(self):
        result = types.SimpleNamespace(returncode=0, stdout='{"ok":true}')
        with mock.patch.dict(gateway.os.environ, {'HOME': '/owner', 'SECRET_KEY': 'fixture-only', 'ADMIN_CLUSTER_DISPATCH': '1'}), \
                mock.patch.object(gateway.subprocess, 'run', return_value=result) as spawn:
            self.assertEqual(gateway.handle(configuration(), 'civo', 'dell', {'action': 'health'}), {'ok': True})
        args, kwargs = spawn.call_args
        self.assertEqual(args[0], ['/usr/bin/python3', '-s', '-E', '-B', '/opt/admin-v2-cluster/coordinator.py', 'rpc'])
        self.assertEqual(kwargs['env']['ADMIN_CLUSTER_DISPATCH'], '0')
        self.assertNotIn('HOME', kwargs['env'])
        self.assertNotIn('SECRET_KEY', kwargs['env'])

    def test_unknown_internal_action_never_reaches_subprocess(self):
        with mock.patch.object(gateway.subprocess, 'run') as spawn:
            for action in ('dispatch', 'complete', 'retire', 'restore', 'promote'):
                with self.assertRaises(PermissionError):
                    gateway.handle(configuration(), 'civo', 'dell', {'action': action})
            spawn.assert_not_called()

    def test_command_failure_never_echoes_private_stderr(self):
        result = types.SimpleNamespace(returncode=7, stdout='', stderr='fixture-private-stderr')
        with mock.patch.object(gateway.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError) as error:
                gateway.handle(configuration(), 'civo', 'dell', {'action': 'health'})
        self.assertNotIn('fixture-private', str(error.exception))

    def test_replication_epoch_checked_before_private_hostkey_load(self):
        with mock.patch.object(replication_route.authority_guard, 'require_replication_qualified'), \
                mock.patch.object(replication_route.authority_guard, 'require_primary', side_effect=PermissionError('stale_epoch')), \
                mock.patch.object(replication_route, 'known_hosts_bytes') as read:
            with self.assertRaisesRegex(PermissionError, 'stale_epoch'):
                replication_route.command({'role': 'primary'})
            read.assert_not_called()

    def test_replication_hostkey_digest_mismatch_refuses_transport_argv(self):
        with mock.patch.object(replication_route.authority_guard, 'require_replication_qualified'), \
                mock.patch.object(replication_route.authority_guard, 'require_primary'), \
                mock.patch.object(topology, 'load', return_value=configuration()), \
                mock.patch.object(topology, 'local_node', return_value='civo'), \
                mock.patch.object(replication_route, 'known_hosts_bytes', return_value=b'fixture-mismatch'):
            with self.assertRaisesRegex(PermissionError, 'pinned_recovery_hostkey_digest_mismatch'):
                replication_route.command({'role': 'primary'})


if __name__ == '__main__':
    unittest.main()
