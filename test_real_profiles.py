"""Local contract/export tests; synthetic units are never native qualification."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

import artifacts
import entry_bootstrap
import profile_contract as p
import remote_contract as c
from systemd_adapter import SystemdAdapter
import test_runtime as fixture
import test_cgroups_and_entries as entries
import transport
import node_catalog

HERE = Path(__file__).resolve().parent


def descriptor(name='admin-build-v1', heavy=True):
    return {'version': 2, 'name': name, 'program': p.PROGRAM,
            'program_sha256': 'a' * 64, 'python_path': p.PYTHON,
            'python_sha256': 'b' * 64, 'source_sha256': 'c' * 64,
            'dependencies_sha256': 'd' * 64,
            'artifact_policy_sha256': c.digest(p.POLICY),
            'plan_sha256': 'e' * 64, 'resources': copy.deepcopy(p.PLANS[int(heavy)]),
            'artifact_policy': copy.deepcopy(p.POLICY)}


class ContractTests(unittest.TestCase):
    def test_fixed_three_names_full_descriptor_digest_binds_resources(self):
        for name in p.REAL:
            self.assertEqual(p.validate(descriptor(name))['name'], name)
        self.assertNotEqual(c.digest(descriptor()), c.digest(descriptor(heavy=False)))
        self.assertEqual(set(descriptor()), p.KEYS)

    def test_free_commands_paths_env_and_bool_versions_refused(self):
        for changes in ({'name': 'sh'}, {'program': '/bin/sh'}, {'python_path': '/usr/bin/python3'},
                        {'version': True}, {'env': {'HOME': '/root'}}, {'args': ['-c', 'anything']}):
            with self.subTest(changes=changes), self.assertRaises((ValueError, PermissionError)):
                p.validate({**descriptor(), **changes})

    def test_resource_tampering_extra_properties_and_boolean_cpu_refused(self):
        for key, value in [('cpu', True), ('cpu', 16), ('memory_bytes', 24 * p.GIB),
                           ('runtime_seconds', 999999), ('MemorySwapMax', 'infinity'),
                           ('disk_budget_is_hard_quota', True)]:
            item = descriptor()
            item['resources'][key] = value
            with self.subTest(key=key), self.assertRaises(PermissionError):
                p.validate(item)

    def test_artifact_policy_tampering_cannot_be_approved_by_its_new_digest(self):
        item = descriptor()
        item['artifact_policy']['allowlist'].append('credentials.json')
        item['artifact_policy_sha256'] = c.digest(item['artifact_policy'])
        with self.assertRaises(PermissionError):
            p.validate(item)

    def test_numeric_mapper_and_sandbox_preserve_fixed_program_and_private_state(self):
        item = descriptor()
        manifest = {'job_id': 'a' * 32, 'generation': 2}
        receipt = {'unit': 'admin-dev-' + 'a' * 32 + '-g2.service'}
        command = SystemdAdapter().unit_argv(manifest, receipt, item)
        for prop in ('CPUQuota=1400%', 'MemoryMax=21474836480', 'MemorySwapMax=0',
                     'TasksMax=512', 'RuntimeMaxSec=2700', 'TimeoutStopSec=30',
                     'DynamicUser=yes', 'PrivateTmp=yes', 'PrivateNetwork=yes', 'ProtectSystem=strict'):
            self.assertIn('--property=' + prop, command)
        self.assertEqual(command[-5:], ['-I', '-S', '-B', p.PROGRAM, item['name']])
        self.assertIn('/usr/bin/env', command)
        self.assertIn('-i', command)
        self.assertFalse(any('LD_PRELOAD' in part for part in command))


class CapacityTests(unittest.TestCase):
    def check(self, available=29, total=30, cpus=16, disk=50, pressure='0.00'):
        def read(path):
            if str(path) == '/proc/meminfo':
                return f'MemTotal: {total*1024**2} kB\nMemAvailable: {available*1024**2} kB\n'
            if str(path) == '/proc/pressure/memory':
                return f'some avg10={pressure} avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'
            raise AssertionError('unexpected numeric observation')
        with mock.patch.object(Path, 'read_text', read), \
                mock.patch.object(p.os, 'sched_getaffinity', return_value=set(range(cpus))), \
                mock.patch.object(p.os, 'statvfs', return_value=types.SimpleNamespace(f_bavail=disk, f_frsize=p.GIB)):
            return p.capacity(descriptor(), HERE)

    def test_fresh20gib_plus8gib_reserve_fits_actual30gib_host(self):
        self.check()

    def test_busy_memory_cpu_disk_pressure_refuse_before_launch(self):
        for kwargs in ({'available': 27}, {'total': 27, 'available': 27}, {'cpus': 14},
                       {'disk': 31}, {'pressure': '2.00'}, {'pressure': 'nan'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(PermissionError):
                self.check(**kwargs)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='real-export-', dir=HERE)
        self.root = Path(self.tmp.name)
        self.source, self.stage = self.root / 'source', self.root / 'stage'
        self.source.mkdir(mode=0o700)
        self.stage.mkdir(mode=0o700)
        self.art = self.source / 'artifacts'
        self.art.mkdir(mode=0o700)

    def tearDown(self):
        self.tmp.cleanup()

    def run_export(self):
        p.copy_artifacts(self.source, self.stage, descriptor())

    def test_only_flat_allowed_regular_sanitized_files_are_copied(self):
        (self.art / 'phase-results.json').write_text('{"ok":true}')
        (self.source / 'database-state').write_text('not exported')
        (self.stage / 'result.json').write_text('root result preserved')
        self.run_export()
        self.assertEqual((self.stage / 'artifacts/phase-results.json').read_text(), '{"ok":true}')
        self.assertEqual((self.stage / 'result.json').read_text(), 'root result preserved')
        self.assertFalse((self.stage / 'database-state').exists())

    def test_unexpected_private_or_nested_file_refused(self):
        for name in ('credentials.json', 'result.json', 'raw-browser-state', 'nested'):
            path = self.art / name
            path.mkdir() if name == 'nested' else path.write_text('fixture rejected')
            with self.assertRaises(PermissionError):
                self.run_export()
            path.rmdir() if path.is_dir() else path.unlink()

    def test_actual_symlink_and_hardlink_refused(self):
        original = self.root / 'original'
        original.write_text('fixture')
        target = self.art / 'phase-results.json'
        target.symlink_to(original)
        with self.assertRaises(PermissionError):
            self.run_export()
        target.unlink()
        os.link(original, target)
        with self.assertRaises(PermissionError):
            self.run_export()

    def test_actual_sparse_file_exceeds16mib_refused_before_read(self):
        path = self.art / 'sanitized-build.log'
        with path.open('wb') as out:
            out.truncate(16 * 1024**2 + 1)
        with self.assertRaises(PermissionError):
            self.run_export()

    def test_actual_total_above32mib_refused(self):
        for name in ('profile-result.json', 'integrity-proof.json', 'phase-results.json'):
            with (self.art / name).open('wb') as out:
                out.truncate(12 * 1024**2)
        with self.assertRaises((PermissionError, ValueError)):
            self.run_export()

    def test_symlink_artifacts_root_and_second_export_never_overwrite(self):
        (self.art / 'phase-results.json').write_text('{}')
        self.run_export()
        with self.assertRaises(FileExistsError):
            self.run_export()
        (self.art / 'phase-results.json').unlink()
        self.art.rmdir()
        self.art.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(PermissionError):
            self.run_export()


class PacketTests(unittest.TestCase):
    def setUp(self):
        self.ctx = entries.EntryTests()
        self.ctx.setUp()
        self.ctx.profile = {'admin-build-v1': descriptor()}
        self.ctx.config['profiles'] = self.ctx.profile
        self.ctx.evidence['profile_catalog_sha256'] = c.digest(self.ctx.profile)

    def proof(self):
        self.ctx.evidence['real_profile_qualifications'] = {
            'admin-build-v1': {'event': 99, 'descriptor_sha256': c.digest(descriptor()), 'native_execution_pass': True}}

    def test_presence_of_real_descriptor_is_not_native_qualification(self):
        with self.assertRaises(PermissionError):
            self.ctx.validate()
        self.proof()
        self.assertEqual(self.ctx.validate()[0]['worker_id'], 'civo')

    def test_wrong_descriptor_bool_event_and_unexecuted_profile_refused(self):
        for changes in ({'event': True}, {'event': 0}, {'native_execution_pass': False}, {'descriptor_sha256': '0' * 64}):
            self.proof()
            self.ctx.evidence['real_profile_qualifications']['admin-build-v1'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(PermissionError):
                self.ctx.validate()


class BrokerTransportTests(unittest.TestCase):
    def test_generated_real_profile_catalog_never_admits_without_native_qualification(self):
        with tempfile.TemporaryDirectory(prefix='real-catalog-', dir=HERE) as folder:
            path = Path(folder) / 'catalog.json'
            path.write_bytes((HERE / 'NODE-CATALOG.template.json').read_bytes())
            path.chmod(0o600)
            selector = node_catalog.NodeCatalog(path, c.private_file)
            for node in c.WORKERS:
                for name in p.REAL:
                    with self.assertRaises(PermissionError):
                        selector.select(name, node)

    def test_local_fixed_proxy_gets_secrets_only_on_stdin_never_one_shot_service(self):
        nodes = {'civo': {'qualified': True, 'host': transport.HOSTS['civo'][0], 'port': 22}}
        request = {'action': 'retirement', 'token': 'fixture-non-secret'}
        with mock.patch.object(transport, 'exchange', return_value={'state': 'retained'}) as exchange:
            value = transport.BrokerTransport(nodes).call('civo', request)
        self.assertEqual(value, {'state': 'retained'})
        argv, raw, _ = exchange.call_args.args
        self.assertEqual(argv, ['/usr/bin/python3', '-I', '-B', '/opt/peticao-dev-worker-broker/broker_proxy.py'])
        self.assertNotIn('fixture-non-secret', ' '.join(argv))
        self.assertEqual(json.loads(raw), request)

    def test_unqualified_local_endpoint_rejected_before_proxy(self):
        for node in ({}, {'qualified': False}, {'qualified': True, 'host': 'elsewhere', 'port': 22}):
            with mock.patch.object(transport, 'exchange') as exchange:
                with self.assertRaises(PermissionError):
                    transport.BrokerTransport({'civo': node}).call('civo', {'action': 'observe'})
                exchange.assert_not_called()

    def test_remote_target_is_persistent_broker_not_one_shot_rpc(self):
        self.assertEqual(transport.REMOTE_COMMAND, '/usr/bin/python3 -I -B /opt/peticao-dev-worker-broker/broker_proxy.py')


class RealDescriptorPipelineTests(unittest.TestCase):
    """Actual local child+SQLite+custody; adapter identities/cgroups synthetic."""
    def setUp(self):
        self.ctx = fixture.RuntimeTests()
        self.ctx.setUp()
        self.script = self.ctx.root / 'driver-test-fixture.py'
        self.script.write_text('''import json,sys
from pathlib import Path
name=sys.argv[1]
Path('artifacts').mkdir()
Path('artifacts/phase-results.json').write_text('{"fixture":true}')
Path('result.json').write_text(json.dumps({'protocol':1,'profile':name,'exit_code':0}))
''')
        item = descriptor()
        self.python = Path(sys.executable).resolve()
        item.update(program_sha256=hashlib.sha256(self.script.read_bytes()).hexdigest(),
                    python_sha256=hashlib.sha256(self.python.read_bytes()).hexdigest())
        name = item['name']
        self.ctx.profiles[name] = item
        self.ctx.worker.profiles[name] = item
        for mapping in (self.ctx.claims.profiles, self.ctx.journal.profiles):
            mapping[name] = c.digest(item)
        script, python = self.script, self.python
        class Adapter(fixture.LocalAdapter):
            def start(self, manifest, receipt, spec):
                return super().start(manifest, receipt, {**spec, 'program': str(script), 'python_path': str(python)})
        self.ctx.adapter = Adapter(self.ctx.root / 'worker-data', 'worker-boot-1')
        self.ctx.worker.adapter = self.ctx.adapter
        self.ctx.worker.program_validator = lambda _: script
        self.patch = mock.patch('worker.trusted_executable', return_value=self.python)
        self.patch.start()
        self.manifest = self.ctx.new_job('b' * 32, name)

    def tearDown(self):
        self.patch.stop()
        self.ctx.tearDown()

    def test_real_descriptor_flows_through_queue_child_stop_export_and_custody(self):
        self.ctx.backend.dispatch(self.manifest, self.ctx.token)
        result = self.ctx.backend.finish(self.manifest)
        self.assertEqual(result['state'], 'completed')
        self.assertEqual(self.ctx.adapter.starts, 1)
        self.assertEqual(self.ctx.adapter.stops, 1)
        receipt = json.loads((self.ctx.root / 'custody' / self.manifest['job_id'] / 'receipt.json').read_text())
        self.assertEqual({row['name'] for row in receipt['files']}, {'result.json', 'artifacts/phase-results.json'})

    def test_unexpected_output_never_gets_bundle_or_success_and_keeps_export_intent(self):
        self.ctx.backend.dispatch(self.manifest, self.ctx.token)
        (self.ctx.root / 'worker-data' / self.manifest['job_id'] / 'artifacts/raw-browser-state').write_text('fixture rejected')
        with self.assertRaises(PermissionError):
            self.ctx.backend.finish(self.manifest)
        row, binding = self.ctx.worker.stored(self.manifest['job_id'])
        self.assertIsNone(binding['bundle_sha256'])
        self.assertIsNotNone(binding['stop_proof'])
        self.assertTrue((self.ctx.root / 'exports' / (self.manifest['job_id'] + '.export-intent.json')).exists())
        self.assertNotEqual(self.ctx.state(self.manifest['job_id']), 'completed')

    def test_changed_resources_after_manifest_binding_refused_before_child(self):
        self.ctx.worker.profiles[self.manifest['profile']]['resources']['memory_bytes'] = 24 * p.GIB
        with self.assertRaises(PermissionError):
            self.ctx.backend.dispatch(self.manifest, self.ctx.token)
        self.assertEqual(self.ctx.adapter.starts, 0)


if __name__ == '__main__':
    unittest.main()
