"""Fictitious file tests only, under the explicit project-private TMPDIR."""
import concurrent.futures
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest import mock

import artifact_policy as a

TMPROOT = Path('/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def fixtures():
    return {
        'profile-result.json': {'version': 1, 'profile': 'admin-typecheck-v1', 'plan_sha256': 'a' * 64,
                                'source_sha256': 'b' * 64, 'dependencies_sha256': 'c' * 64,
                                'artifact_policy_sha256': a.digest_policy(), 'status': 'passed',
                                'exit_code': 0, 'phase_count': 1, 'failed_phase': None},
        'integrity-proof.json': {'version': 1, 'source_sha256': 'a' * 64, 'dependencies_sha256': 'b' * 64,
                                 'toolchain_sha256': 'c' * 64, 'verified_files': 3, 'verified_bytes': 42,
                                 'archive_only_provenance': True},
        'phase-results.json': {'version': 1, 'profile': 'admin-qa-v1', 'phases': [
            {'name': 'backend', 'exit_code': 0, 'signal': None, 'duration_ms': 10,
             'expected_checks': 43, 'observed_checks': 43, 'success': True}]},
        'sanitized-build.log': b'fictitious build completed\n',
        'sanitized-qa-summary.json': {'version': 1, 'counts': dict(a.COUNTS), 'passed': True,
                                      'page_errors': 0, 'blocked_writes': 0, 'fixture_only': True},
        'process-drain-proof.json': {'version': 1, 'scope': 'driver_owned_children', 'tracked_processes': 2,
                                     'remaining_owned_processes': 0, 'stop_requested': True, 'all_exited': True},
        'network-denial-summary.json': {'version': 1, 'mode': 'offline-loopback-fixtures', 'external_allowed': False,
                                         'attempts_denied': 1, 'unexpected_attempts': 0,
                                         'fixture_pg_loopback': True, 'fixture_http_loopback': True},
    }


class ArtifactPolicyTests(unittest.TestCase):
    def setUp(self):
        # Never chmod/chown any existing ancestor. All mutable test data stays
        # under this explicit absolute project directory, not system /tmp.
        TMPROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.temp = tempfile.TemporaryDirectory(prefix='artifact-policy-', dir=TMPROOT)
        self.parent = Path(self.temp.name)
        self.root = self.parent / 'artifacts'
        a.prepare_artifacts(self.root)
        self.values = fixtures()

    def tearDown(self):
        self.temp.cleanup()

    def raw(self, name):
        value = self.values[name]
        return value if type(value) is bytes else encoded(value)

    def manual(self, name, raw):
        path = self.root / name
        path.write_bytes(raw)
        path.chmod(0o600)
        return path

    def test_policy_exact_proposal_deepcopy_and_canonical_digest(self):
        proposal = json.loads((Path(__file__).parent / 'INTERFACE-PROPOSAL.json').read_text())['worker_descriptor_v2']['artifact_policy']
        self.assertEqual(a.policy(), proposal)
        self.assertEqual(a.digest_policy(), hashlib.sha256(encoded(proposal)).hexdigest())
        mutated = a.policy()
        mutated['allowlist'].append('forbidden')
        mutated['forbidden'][0] = 'changed'
        self.assertEqual(a.policy(), proposal)

    def test_exact_seven_receipts_roundtrip_and_content_hashes(self):
        total = 0
        for name in self.values:
            raw = self.raw(name)
            result = a.write_artifact(self.root, name, raw)
            self.assertEqual(result, {'name': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
            self.assertEqual(stat.S_IMODE((self.root / name).stat().st_mode), 0o600)
            total += len(raw)
        result = a.inspect_artifacts(self.root)
        self.assertEqual(result['state'], 'verified')
        self.assertEqual(result['policy_sha256'], a.digest_policy())
        self.assertEqual(result['total_bytes'], total)
        self.assertEqual(len(result['files']), 7)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)

    def test_empty_subset_is_valid_but_prepare_and_write_are_exclusive(self):
        self.assertEqual(a.inspect_artifacts(self.root)['files'], [])
        with self.assertRaises(FileExistsError):
            a.prepare_artifacts(self.root)
        raw = self.raw('integrity-proof.json')
        a.write_artifact(self.root, 'integrity-proof.json', raw)
        with self.assertRaises(FileExistsError):
            a.write_artifact(self.root, 'integrity-proof.json', raw)
        self.assertEqual((self.root / 'integrity-proof.json').read_bytes(), raw)

    def test_prepare_preserves_existing_permissions_and_rejects_ancestor_links(self):
        existing = self.parent / 'existing'
        existing.mkdir(mode=0o755)
        before = existing.stat().st_mode
        with self.assertRaises(FileExistsError):
            a.prepare_artifacts(existing)
        self.assertEqual(existing.stat().st_mode, before)
        link = self.parent / 'linked'
        link.symlink_to(existing, target_is_directory=True)
        with self.assertRaises(PermissionError):
            a.prepare_artifacts(link / 'artifacts')
        with self.assertRaises(PermissionError):
            a.inspect_artifacts(link)
        with self.assertRaises(ValueError):
            a.prepare_artifacts(self.parent / '..' / 'escape')

    def test_ownership_mode_and_expected_uid_are_strict(self):
        self.root.chmod(0o750)
        with self.assertRaises(PermissionError):
            a.inspect_artifacts(self.root)
        self.root.chmod(0o700)
        with self.assertRaises(PermissionError):
            a.inspect_artifacts(self.root, expected_uid=os.geteuid() + 1)
        for uid in (True, -1, '0'):
            with self.subTest(uid=uid), self.assertRaises(ValueError):
                a.inspect_artifacts(self.root, expected_uid=uid)
        path = self.manual('sanitized-build.log', b'fictitious\n')
        path.chmod(0o644)
        with self.assertRaises(PermissionError):
            a.inspect_artifacts(self.root)
        path.chmod(0o600)
        self.assertEqual(a.inspect_artifacts(self.root)['total_bytes'], path.stat().st_size)

    def test_symlinks_hardlinks_fifo_and_directories_never_read(self):
        name = 'sanitized-build.log'
        target = self.parent / 'private'
        target.write_bytes(b'fictitious')
        target.chmod(0o600)
        path = self.root / name
        for kind in ('symlink', 'hardlink', 'fifo', 'directory'):
            with self.subTest(kind=kind):
                if kind == 'symlink':
                    path.symlink_to(target)
                elif kind == 'hardlink':
                    os.link(target, path)
                elif kind == 'fifo':
                    os.mkfifo(path, 0o600)
                else:
                    path.mkdir(mode=0o700)
                with self.assertRaises(PermissionError):
                    a.inspect_artifacts(self.root)
                path.rmdir() if kind == 'directory' else path.unlink()

    def test_no_unexpected_source_database_browser_env_exports(self):
        for name in ('database.sqlite', 'source.tar', '.env', 'cookies.json', 'browser-profile', '../outside', '/absolute'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                a.write_artifact(self.root, name, b'not-exportable')
        extra = self.root / '.env'
        extra.write_bytes(b'FICTITIOUS=1')
        extra.chmod(0o600)
        with self.assertRaises(ValueError):
            a.inspect_artifacts(self.root)

    def test_json_exact_schemas_refuse_disguised_dumps_and_secret_strings(self):
        for name, value in self.values.items():
            if name.endswith('.json'):
                invalid = copy.deepcopy(value)
                invalid['environment'] = {'FICTITIOUS_PASSWORD': 'never-export'}
                with self.subTest(name=name), self.assertRaises(ValueError):
                    a.write_artifact(self.root, name, encoded(invalid))
        for raw in (b'{"source_code":"fictitious"}', b'{"cookies":["fictitious"]}', b'{"database_state":"fictitious"}', b'[]', b'null', b'NaN', b'{invalid', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                a.write_artifact(self.root, 'integrity-proof.json', raw)
        duplicate = self.raw('integrity-proof.json').replace(b'"version":1', b'"version":1,"version":1')
        with self.assertRaises(ValueError):
            a.write_artifact(self.root, 'integrity-proof.json', duplicate)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_json_types_enums_limits_and_coherence_are_strict(self):
        cases = [
            ('profile-result.json', 'version', True), ('profile-result.json', 'profile', 'arbitrary'),
            ('profile-result.json', 'source_sha256', 'invalid'), ('profile-result.json', 'exit_code', True),
            ('profile-result.json', 'phase_count', 33), ('profile-result.json', 'failed_phase', 'contains spaces'),
            ('profile-result.json', 'artifact_policy_sha256', '0' * 64),
            ('integrity-proof.json', 'verified_files', -1), ('integrity-proof.json', 'verified_bytes', 1024 ** 4 + 1),
            ('integrity-proof.json', 'archive_only_provenance', 1),
            ('sanitized-qa-summary.json', 'fixture_only', False), ('sanitized-qa-summary.json', 'page_errors', 1),
            ('process-drain-proof.json', 'scope', 'root_cgroup_stopped'), ('process-drain-proof.json', 'all_exited', 1),
            ('process-drain-proof.json', 'remaining_owned_processes', 1),
            ('network-denial-summary.json', 'mode', 'arbitrary'), ('network-denial-summary.json', 'external_allowed', True),
            ('network-denial-summary.json', 'fixture_http_loopback', 1),
        ]
        for name, field, invalid in cases:
            value = copy.deepcopy(self.values[name])
            value[field] = invalid
            with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                a.write_artifact(self.root, name, encoded(value))
        for mutate in ('extra', 'many', 'duplicate', 'signal', 'count', 'success', 'duration'):
            value = copy.deepcopy(self.values['phase-results.json'])
            if mutate == 'extra':
                value['phases'][0]['stdout'] = 'forbidden'
            elif mutate == 'many':
                value['phases'] *= 33
            elif mutate == 'duplicate':
                value['phases'] *= 2
            elif mutate == 'signal':
                value['phases'][0]['signal'] = 'arbitrary'
            elif mutate == 'count':
                value['phases'][0]['observed_checks'] = True
            elif mutate == 'success':
                value['phases'][0]['observed_checks'] = 42
            else:
                value['phases'][0]['duration_ms'] = 86400001
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                a.write_artifact(self.root, 'phase-results.json', encoded(value))

    def test_failed_receipts_can_report_bounded_diagnostics_without_free_text(self):
        result = self.values['profile-result.json']
        result.update(status='failed', exit_code=None, failed_phase='backend')
        a.write_artifact(self.root, 'profile-result.json', encoded(result))
        phases = self.values['phase-results.json']
        phases['phases'][0].update(exit_code=None, signal='SIGTERM', observed_checks=9, success=False)
        a.write_artifact(self.root, 'phase-results.json', encoded(phases))
        summary = self.values['sanitized-qa-summary.json']
        summary.update(passed=False, page_errors=3)
        summary['counts']['backend'] = 44
        a.write_artifact(self.root, 'sanitized-qa-summary.json', encoded(summary))
        self.assertEqual(len(a.inspect_artifacts(self.root)['files']), 3)

    def test_log_sanitizer_known_patterns_bound_and_idempotence(self):
        raw = (b'Authorization: Bearer synthetic-bearer\nCookie: adm=synthetic-cookie\n'
               b'ADMIN_PASSWORD=synthetic-password\nAPI_KEY="synthetic-key"\n'
               b'{"token":"synthetic-token"}\nDATABASE_URL=postgres://user:synthetic-dbpass@localhost/db\n'
               b'url=https://fictitious:synthetic-urlpass@example.invalid/path\n'
               b'contact=fictitious@example.invalid\n')
        result = a.sanitize_log(raw)
        for secret in (b'synthetic-bearer', b'synthetic-cookie', b'synthetic-password', b'synthetic-key', b'synthetic-token',
                       b'synthetic-dbpass', b'synthetic-urlpass', b'fictitious@example.invalid'):
            self.assertNotIn(secret, result)
        self.assertEqual(a.sanitize_log(result), result)
        self.assertIn(b'[REDACTED]', result)
        self.assertEqual(a.sanitize_log(b'ordinary arbitrary-string\n'), b'ordinary arbitrary-string\n')
        with self.assertRaises(ValueError):
            a.sanitize_log(b'x' * (a.MAX_LOG_BYTES + 1))
        with self.assertRaises(ValueError):
            a.sanitize_log('not-bytes')
        with self.assertRaises(ValueError):
            a.write_artifact(self.root, 'sanitized-build.log', raw)
        a.write_artifact(self.root, 'sanitized-build.log', result)
        self.assertEqual(a.inspect_artifacts(self.root)['total_bytes'], len(result))

    def test_logs_strip_control_sequences_and_refuse_database_dump_signatures(self):
        raw = b'\x1b[31mADMIN_PASSWORD=synthetic-colored\x1b[0m\nnormal\x00message\n'
        result = a.sanitize_log(raw)
        self.assertNotIn(b'synthetic-colored', result)
        self.assertNotIn(b'\x1b', result)
        self.assertNotIn(b'\x00', result)
        self.assertEqual(a.sanitize_log(result), result)
        with self.assertRaises(ValueError):
            a.write_artifact(self.root, 'sanitized-build.log', b'ordinary\x00binary')
        for dump in (b'SQLite format 3\x00', b'PGDMP123', b'-- PostgreSQL database dump\n',
                     b'CREATE TABLE fictitious(id int);', b'INSERT INTO fictitious VALUES(1);', b'COPY fictitious FROM stdin;'):
            with self.subTest(dump=dump), self.assertRaises(ValueError):
                a.sanitize_log(dump)

    def test_file_mutation_during_read_and_after_prior_file_are_refused(self):
        first = self.manual('integrity-proof.json', self.raw('integrity-proof.json'))
        self.manual('network-denial-summary.json', self.raw('network-denial-summary.json'))
        original = a.os.read
        count = 0
        def read(fd, size):
            nonlocal count
            value = original(fd, size)
            count += 1
            if count == 1:
                first.write_bytes(b'changed-after-read')
            return value
        with mock.patch.object(a.os, 'read', side_effect=read), self.assertRaises(PermissionError):
            a.inspect_artifacts(self.root)
        first.write_bytes(self.raw('integrity-proof.json'))
        original_content = a._content
        def content(name, raw):
            original_content(name, raw)
            if name == 'network-denial-summary.json':
                first.write_bytes(b'changed-after-prior-file-inspection')
        with mock.patch.object(a, '_content', side_effect=content), self.assertRaises(PermissionError):
            a.inspect_artifacts(self.root)

    def test_inspector_revalidates_manual_files_and_sparse_byte_limit(self):
        path = self.manual('integrity-proof.json', b'{"source_code":"not allowed"}')
        with self.assertRaises(ValueError):
            a.inspect_artifacts(self.root)
        path.unlink()
        path = self.manual('sanitized-build.log', b'')
        with path.open('r+b') as stream:
            stream.truncate(a.policy()['max_file_bytes'] + 1)
        with self.assertRaises(ValueError):
            a.inspect_artifacts(self.root)

    def test_aggregate_budget_and_concurrent_writes(self):
        names = ('integrity-proof.json', 'network-denial-summary.json')
        raws = {name: self.raw(name) for name in names}
        budget = sum(map(len, raws.values())) - 1
        barrier = threading.Barrier(2)
        def write(name):
            barrier.wait()
            try:
                a.write_artifact(self.root, name, raws[name])
                return True
            except ValueError:
                return False
        with mock.patch.dict(a._POLICY, {'max_total_bytes': budget}):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                results = list(pool.map(write, names))
            self.assertEqual(sum(results), 1)
            self.assertLessEqual(a.inspect_artifacts(self.root)['total_bytes'], budget)
        # Inspector independently rejects the aggregate, including manual writes.
        for name in names:
            if not (self.root / name).exists():
                self.manual(name, raws[name])
        with mock.patch.dict(a._POLICY, {'max_total_bytes': budget}), self.assertRaises(ValueError):
            a.inspect_artifacts(self.root)

    def test_fsync_failure_retains_evidence_and_never_overwrites(self):
        raw = self.raw('integrity-proof.json')
        with mock.patch.object(a.os, 'fsync', side_effect=OSError('synthetic fsync failure')):
            with self.assertRaises(OSError):
                a.write_artifact(self.root, 'integrity-proof.json', raw)
        self.assertTrue((self.root / 'integrity-proof.json').exists())
        with self.assertRaises(FileExistsError):
            a.write_artifact(self.root, 'integrity-proof.json', raw)
        self.assertEqual((self.root / 'integrity-proof.json').read_bytes(), raw)

    def test_umask_never_requires_chmod_of_ancestors(self):
        previous = os.umask(0o777)
        try:
            root = self.parent / 'restrictive'
            a.prepare_artifacts(root)
            a.write_artifact(root, 'sanitized-build.log', b'fictitious\n')
        finally:
            os.umask(previous)
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((root / 'sanitized-build.log').stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
