"""Only tiny fictitious archives; NEVER opens/normalizes the fixed real ingress.

No guard patching or fixture-owner arguments. Tests run as the explicit offline
UID1000 role and use fresh private project staging. Root runtime code is intact.
"""
import ast
import hashlib
import inspect
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest import mock

import offline_normalize as p

TMP = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115/producer-test-tmp')


def tar_fixture(path, *, bad_hardlink=False, symlinks=22):
    with tarfile.open(path, 'w:gz') as archive:
        for name in ('node_modules', 'node_modules/@esbuild', 'node_modules/@esbuild/linux-x64', 'node_modules/@esbuild/linux-x64/bin',
                     'node_modules/esbuild', 'node_modules/esbuild/bin', 'node_modules/.bin'):
            item = tarfile.TarInfo(name); item.type = tarfile.DIRTYPE; item.mode = 0o755
            archive.addfile(item)
        for name, raw in (('node', b'fictitious node bytes never executed'), ('package-lock.json', b'{}'),
                          ('package.tgz', b'fictitious public package'),
                          ('node_modules/@esbuild/linux-x64/bin/esbuild', b'fictitious esbuild preimage')):
            item = tarfile.TarInfo(name); item.mode = 0o755 if name.endswith('esbuild') or name == 'node' else 0o644
            item.size = len(raw); archive.addfile(item, io.BytesIO(raw))
        item = tarfile.TarInfo('node_modules/esbuild/bin/esbuild'); item.type = tarfile.LNKTYPE
        item.linkname = 'node_modules/@esbuild/linux-x64/bin/esbuild'; item.mode = 0o755
        archive.addfile(item)
        if bad_hardlink:
            item = tarfile.TarInfo('node_modules/extra'); item.type = tarfile.LNKTYPE
            item.linkname = 'node_modules/@esbuild/linux-x64/bin/esbuild'; archive.addfile(item)
        for index in range(symlinks):
            item = tarfile.TarInfo('node_modules/.bin/s' + str(index)); item.type = tarfile.SYMTYPE
            item.linkname = '../@esbuild/linux-x64/bin/esbuild'; item.mode = 0o755; archive.addfile(item)
    path.chmod(0o600)
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), len(raw)


@unittest.skipUnless(os.getuid() == 1000 and os.geteuid() == 1000, 'explicit offline UID1000 role required; no guard monkeypatch')
class OfflineProducerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reads only the copied protected code/policy, never public archive data.
        TMP.mkdir(mode=0o700, exist_ok=True)
        cls.policy_temp = tempfile.TemporaryDirectory(prefix='committed-policy-', dir=TMP)
        # Ignore the real external live path entirely: committed-source tests
        # remain reproducible even after the parent publishes EXEC=true.
        cls.policy, raw, cls.policy_sha, live = p._read_policy(p.POLICY, Path(cls.policy_temp.name) / 'absent-live')
        if live:
            raise AssertionError('fictitious live unexpectedly exists')
        cls.normalizer = p.load_base(raw)

    @classmethod
    def tearDownClass(cls):
        cls.policy_temp.cleanup()

    def setUp(self):
        TMP.mkdir(mode=0o700, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='offline-producer-', dir=TMP)
        self.root = Path(self.temp.name)
        self.input = self.root / 'fictitious.public.tar.gz'
        self.sha, self.size = tar_fixture(self.input)

    def tearDown(self):
        self.temp.cleanup()

    def test_closed_policy_default_denies_execution_and_preserves_root_defaults(self):
        self.assertIs(self.policy['execute'], False)
        self.assertEqual(self.policy['uid'], 1000)
        self.assertEqual(self.policy['base_commit'], p.BASE_COMMIT)
        with self.assertRaisesRegex(PermissionError, 'not_released'):
            p._require_execution(self.policy, live=False)
        self.assertEqual(inspect.signature(self.normalizer.normalize_dependencies).parameters['_expected_uid'].default, 0)
        self.assertEqual(inspect.signature(self.normalizer.provider.verified_input).parameters['_expected_uid'].default, 0)
        for name, row in p.BASE.items():
            self.assertEqual(hashlib.sha256((p.SOURCE / name).read_bytes()).hexdigest(), row['sha256'])
        self.assertEqual(p.INGRESS.as_posix(), self.policy['ingress']['path'])

    def policy_files(self):
        template = self.root / 'template.json'
        execution = self.root / 'execution.json'
        template.write_text(p.canonical(self.policy))
        template.chmod(0o600)
        return template, execution

    def test_external_live_policy_selection_and_default_fallback_are_closed(self):
        self.assertEqual(p.EXEC_POLICY, p.SOURCE.parent / 'PRODUCER-EXECUTION-POLICY.json')
        self.assertNotEqual(p.EXEC_POLICY.parent, p.SOURCE)
        template, execution = self.policy_files()
        value, source, sha, live = p._read_policy(template, execution)
        self.assertFalse(live)
        self.assertIs(value['execute'], False)
        self.assertEqual(set(source), {'offline_normalize.py', *p.BASE})
        self.assertEqual(sha, hashlib.sha256(template.read_bytes()).hexdigest())
        # Only this fictitious private test file is true. The actual fixed live
        # policy is NEVER created or modified by these tests.
        toy_live = dict(self.policy)
        toy_live['execute'] = True
        execution.write_text(p.canonical(toy_live)); execution.chmod(0o600)
        value, _, sha, live = p._read_policy(template, execution)
        self.assertTrue(live)
        self.assertTrue(value['execute'])
        self.assertEqual(sha, hashlib.sha256(execution.read_bytes()).hexdigest())
        execution.unlink()
        self.assertFalse(p._read_policy(template, execution)[3])

    def test_invalid_present_live_policy_never_falls_back_or_bypasses_code_pins(self):
        template, execution = self.policy_files()
        cases = ('bad_json', 'wrong_uid', 'wrong_role', 'extra', 'wrong_self_hash', 'wrong_base_hash', 'group_write')
        for case in cases:
            with self.subTest(case=case):
                value = json.loads(p.canonical(self.policy)); value['execute'] = True
                if case == 'wrong_uid':
                    value['uid'] = 0
                elif case == 'wrong_role':
                    value['role'] = 'runtime-root-provider'
                elif case == 'extra':
                    value['arbitrary_input'] = '/fictitious'
                elif case == 'wrong_self_hash':
                    value['source_files']['offline_normalize.py']['sha256'] = '0' * 64
                elif case == 'wrong_base_hash':
                    value['source_files']['input_provider.py']['sha256'] = '0' * 64
                execution.write_text('{invalid' if case == 'bad_json' else p.canonical(value))
                execution.chmod(0o666 if case == 'group_write' else 0o600)
                with self.assertRaises((ValueError, PermissionError)):
                    p._read_policy(template, execution)
                execution.unlink()
        execution.symlink_to(self.root / 'nonexistent')
        with self.assertRaises(OSError):
            p._read_policy(template, execution)
        execution.unlink()
        execution.symlink_to(template)
        with self.assertRaises(OSError):
            p._read_policy(template, execution)
        execution.unlink()
        os.link(template, execution)
        with self.assertRaises(PermissionError):
            p._read_policy(template, execution)
        execution.unlink()
        self.assertFalse(p._read_policy(template, execution)[3])

    def test_template_cannot_enable_execution_and_invalid_live_false_still_wins(self):
        template, execution = self.policy_files()
        bypass = dict(self.policy); bypass['execute'] = True
        template.write_text(p.canonical(bypass))
        with self.assertRaisesRegex(PermissionError, 'template_must_never_enable'):
            p._read_policy(template, execution)
        # Present valid false live policy does not select the true template.
        execution.write_text(p.canonical(self.policy)); execution.chmod(0o600)
        value, _, _, live = p._read_policy(template, execution)
        self.assertTrue(live)
        self.assertIs(value['execute'], False)
        self.assertIs(self.policy['execute'], False)

    def test_tiny_archive_full_fd_pipeline_preserves_input_preimages_and_metadata(self):
        before = p.signature(self.input.stat())
        with p.new_staging(self.root / 'staging') as stage:
            with p.verified_public_input(self.input, self.sha, self.size) as original:
                original_fd = original.fileno()
                copied, copy_sig = p.copy_to_stage(original, stage, self.sha, self.size)
                self.assertEqual(original.fileno(), original_fd)
                try:
                    result = p.normalize_copy(copied, copy_sig, stage, self.normalizer)
                    inventory, strict, sha, size, output_sig, output = result
                    try:
                        self.assertEqual(len(inventory['symlinks']), 22)
                        self.assertFalse(strict['qualified'])
                        self.assertFalse(strict['cache_integrity_verified'])
                        self.assertEqual(p._hash(output, size), (sha, size))
                        p.assert_file(output, stage, 'dependencies.normalized.tar.gz', output_sig)
                        p.assert_file(copied, stage, 'parent.input.tar.gz', copy_sig)
                        output.seek(0)
                        with tarfile.open(fileobj=output, mode='r:gz') as archive:
                            materialized = archive.getmember(self.normalizer.HARDLINK_PATH)
                            self.assertTrue(materialized.isfile())
                            self.assertEqual(archive.extractfile(materialized).read(), b'fictitious esbuild preimage')
                            for member in archive:
                                self.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))
                                self.assertFalse(member.islnk())
                    finally:
                        output.close()
                finally:
                    copied.close()
            self.assertEqual(p.signature(self.input.stat()), before)
            self.assertEqual(self.input.stat().st_nlink, 1)
            self.assertEqual(stat.S_IMODE((stage.path / 'parent.input.tar.gz').stat().st_mode), 0o600)
            self.assertFalse((stage.path / 'NORMALIZATION-RECEIPT.json').exists())

    def test_writable_public_data_ancestor_is_never_a_code_or_output_exception(self):
        data = self.root / 'public-data'
        data.mkdir(mode=0o775); data.chmod(0o775)  # Only this new fictitious directory.
        path = data / 'fictitious.tar.gz'
        sha, size = tar_fixture(path)
        with p.verified_public_input(path, sha, size) as stream:
            self.assertEqual(p._hash(stream, size), (sha, size))
        with self.assertRaises(PermissionError):
            p.new_staging(data / 'staging')
        with self.assertRaises(PermissionError):
            p.code_bytes(path)

    def test_bad_pin_or_input_symlink_hardlink_and_changed_input_are_rejected(self):
        with self.assertRaises(p.ProducerRejected):
            with p.verified_public_input(self.input, '0' * 64, self.size):
                self.fail('bad hash yielded')
        link = self.root / 'link'; link.symlink_to(self.input)
        with self.assertRaises(OSError):
            with p.verified_public_input(link, self.sha, self.size):
                self.fail('symlink yielded')
        hard = self.root / 'hard'; os.link(self.input, hard)
        with self.assertRaises(PermissionError):
            with p.verified_public_input(self.input, self.sha, self.size):
                self.fail('hardlink yielded')
        hard.unlink()
        with self.assertRaises(p.ProducerRejected):
            with p.verified_public_input(self.input, self.sha, self.size):
                self.input.write_bytes(b'changed fictitious public input')

    def test_ancestor_link_and_parent_rename_are_not_followed(self):
        parent = self.root / 'data'; parent.mkdir(mode=0o700)
        file = parent / 'input'; sha, size = tar_fixture(file)
        alias = self.root / 'alias'; alias.symlink_to(parent, target_is_directory=True)
        with self.assertRaises(OSError):
            with p.verified_public_input(alias / 'input', sha, size):
                self.fail('ancestor symlink yielded')
        with self.assertRaises(p.ProducerRejected):
            with p.verified_public_input(file, sha, size):
                parent.rename(self.root / 'moved-data')
                parent.mkdir(mode=0o700)

    def test_output_alias_swap_rejected_before_any_normalized_or_receipt_write(self):
        stage_path = self.root / 'staging'
        with p.new_staging(stage_path) as stage:
            with p.verified_public_input(self.input, self.sha, self.size) as original:
                copied, copy_sig = p.copy_to_stage(original, stage, self.sha, self.size)
                try:
                    moved = self.root / 'preserved-original-staging'
                    stage_path.rename(moved); stage_path.mkdir(mode=0o700)
                    with self.assertRaisesRegex(PermissionError, 'alias_replaced'):
                        p.normalize_copy(copied, copy_sig, stage, self.normalizer)
                    with self.assertRaises(PermissionError):
                        p._write_json(stage, 'NORMALIZATION-RECEIPT.json', {'fictitious': True})
                    self.assertEqual(list(stage_path.iterdir()), [])
                    self.assertTrue((moved / 'parent.input.tar.gz').exists())
                    self.assertFalse((moved / 'dependencies.normalized.tar.gz').exists())
                    stage_path.rename(self.root / 'rejected-empty-replacement')
                    moved.rename(stage_path)  # Restore only the fictitious test alias before context exit.
                finally:
                    copied.close()

    def test_incomplete_staging_copy_output_and_receipt_are_never_overwritten(self):
        stage_path = self.root / 'staging'
        with p.new_staging(stage_path) as stage:
            with p.exclusive(stage, 'parent.input.tar.gz') as stream:
                stream.write(b'preserved partial')
            with self.assertRaises(FileExistsError):
                p.exclusive(stage, 'parent.input.tar.gz')
            p._write_json(stage, 'NORMALIZATION-RECEIPT.json', {'fictitious': True})
            with self.assertRaises(FileExistsError):
                p._write_json(stage, 'NORMALIZATION-RECEIPT.json', {'changed': True})
            self.assertEqual((stage_path / 'parent.input.tar.gz').read_bytes(), b'preserved partial')
        with self.assertRaises(FileExistsError):
            p.new_staging(stage_path)

    def test_wrong_hardlink_or_symlink_count_refuses_before_output(self):
        for extra, count in ((True, 22), (False, 21)):
            with self.subTest(extra=extra, count=count):
                path = self.root / ('bad-' + str(count) + '.tar.gz')
                sha, size = tar_fixture(path, bad_hardlink=extra, symlinks=count)
                with p.new_staging(self.root / ('stage-' + str(count))) as stage:
                    with p.verified_public_input(path, sha, size) as original:
                        copied, signature = p.copy_to_stage(original, stage, sha, size)
                        try:
                            with self.assertRaises(ValueError):
                                p.normalize_copy(copied, signature, stage, self.normalizer)
                            self.assertFalse((stage.path / 'dependencies.normalized.tar.gz').exists())
                            self.assertTrue((stage.path / 'parent.input.tar.gz').exists())
                        finally:
                            copied.close()

    def test_gzip_write_failure_preserves_exclusive_partial_and_has_no_receipt(self):
        class BrokenOutput:
            def __init__(self, file):
                self.file, self.calls = file, 0
            def write(self, value):
                self.calls += 1
                if self.calls > 1:
                    raise OSError('fictitious gzip output failure')
                return self.file.write(value)
            def flush(self):
                return self.file.flush()
            def fileno(self):
                return self.file.fileno()
        with p.new_staging(self.root / 'gzip-failure') as stage:
            with p.verified_public_input(self.input, self.sha, self.size) as original:
                inventory = self.normalizer._inventory(original)
                with p.exclusive(stage, 'dependencies.normalized.tar.gz') as output:
                    with self.assertRaises(OSError):
                        self.normalizer._produce(original, BrokenOutput(output), inventory)
            self.assertTrue((stage.path / 'dependencies.normalized.tar.gz').exists())
            self.assertFalse((stage.path / 'NORMALIZATION-RECEIPT.json').exists())
            with self.assertRaises(FileExistsError):
                p.exclusive(stage, 'dependencies.normalized.tar.gz')

    def test_receipt_fsync_failure_preserves_partial_and_refuses_replay(self):
        with p.new_staging(self.root / 'receipt-failure') as stage:
            with p.exclusive(stage, 'dependencies.normalized.tar.gz') as output:
                output.write(b'fictitious complete output')
            fsync = p.os.fsync
            calls = 0
            def fail_receipt(fd):
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise OSError('fictitious receipt fsync failure')
                return fsync(fd)
            # Fault injection changes I/O only, never owner/path/parser guards.
            with mock.patch.object(p.os, 'fsync', side_effect=fail_receipt):
                with self.assertRaises(OSError):
                    p._write_json(stage, 'NORMALIZATION-RECEIPT.json', {'fictitious': True})
            self.assertEqual((stage.path / 'dependencies.normalized.tar.gz').read_bytes(), b'fictitious complete output')
            self.assertTrue((stage.path / 'NORMALIZATION-RECEIPT.json').exists())
            with self.assertRaises(FileExistsError):
                p._write_json(stage, 'NORMALIZATION-RECEIPT.json', {'changed': True})

    def test_policy_json_cannot_hide_duplicate_keys_or_nonfinite_values(self):
        for raw in (b'{"execute":false,"execute":true}', b'{"uid":NaN}', b'{"uid":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(p.ProducerRejected):
                p._parse_json(raw)

    def test_operational_wrapper_calls_only_pure_v2_helpers_no_fixture_owner(self):
        source = (p.SOURCE / 'offline_normalize.py').read_text()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                self.assertFalse(any(key.arg == '_expected_uid' for key in node.keywords))
                if isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, {'normalize_dependencies', 'extract_input', 'verified_input', 'chown'})
        self.assertEqual(set(inspect.signature(p.produce).parameters), set())
        self.assertEqual(p.BASE_COMMIT, '32cce868127cb586cf5d314e429f0c3abbf0b6a5')


if __name__ == '__main__':
    unittest.main()
