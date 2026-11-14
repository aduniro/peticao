"""Static local regression tests; no cloud, SSH, setup or QA execution."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('runner.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class SafetyTests(unittest.TestCase):
    def test_bounded_unit_and_explicit_writes(self):
        p = {'node_path': '/readonly/node20', 'deps_root': '/readonly/deps', 'export_root': '/readonly/export', 'chromium_path': '/readonly/chrome/chrome'}
        args = r.unit_args(p)
        for value in ('PrivateNetwork=yes', 'ProtectSystem=strict', 'ProtectHome=tmpfs', 'NoNewPrivileges=yes', 'MemoryMax=8G', 'CPUQuota=400%', 'TasksMax=256', 'TimeoutStartSec=2700', 'RuntimeMaxSec=2700', 'KillMode=control-group', 'CapabilityBoundingSet='):
            self.assertIn('--property=' + value, args)
        writes = next(x.split('=', 2)[2].split() for x in args if x.startswith('--property=ReadWritePaths='))
        self.assertNotIn(str(r.ROOT), writes)
        self.assertNotIn(str(r.ROOT / 'runtime'), writes)
        self.assertEqual(set(writes), {str(r.ROOT / x) for x in r.DIRS + r.FILES})
        self.assertIn('--property=BindReadOnlyPaths=/readonly/node20:/usr/local/bin/node', args)
        self.assertFalse(any('apt' == x or 'docker' == x for x in args))

    def test_safe_names(self):
        for name in ('../escape', '/absolute', 'a/../../b', 'a\\b', './a', 'a//b', 'space path'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                r.safe_name(name)
        self.assertEqual(r.safe_name('site/src/main.ts'), 'site/src/main.ts')

    def archive(self, root, entries):
        file = root / 'source.tar.gz'
        with tarfile.open(file, 'w:gz') as tf:
            for name, kind, data in entries:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.linkname = '/etc/passwd'
                item.size = len(data) if kind == tarfile.REGTYPE else 0
                tf.addfile(item, io.BytesIO(data) if item.size else None)
        return file

    def test_archive_rejects_links_traversal_duplicates_and_budget_before_writes(self):
        for entries, budget in [([('../escape', tarfile.REGTYPE, b'x')], 100), ([('site/link', tarfile.SYMTYPE, b'')], 100), ([('site/x', tarfile.REGTYPE, b'a'), ('site/x', tarfile.REGTYPE, b'b')], 100), ([('site/x', tarfile.REGTYPE, b'xx')], 1)]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = self.archive(root, entries)
                with self.assertRaises(ValueError):
                    r.extract_source(archive, root / 'dest', budget)
                self.assertFalse((root / 'dest').exists())

    def test_source_extraction_preserves_existing_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = self.archive(root, [('site/package.json', tarfile.REGTYPE, b'{}')])
            r.extract_source(archive, root / 'dest', 100)
            marker = root / 'dest/site/package.json'
            original = marker.read_bytes()
            with self.assertRaises(ValueError):
                r.extract_source(archive, root / 'dest', 100)
            self.assertEqual(marker.read_bytes(), original)

    def test_tree_hash_detects_changed_content_and_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'data'
            path.write_bytes(b'first')
            before = r.tree_hash(root)
            path.write_bytes(b'other')
            self.assertNotEqual(before, r.tree_hash(root))
            (root / 'link').symlink_to(path)
            with self.assertRaises(ValueError):
                r.tree_hash(root)

    def test_setup_refuses_replay_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'STATE.json').write_text('{"phase":"submitted"}')
            before = (root / 'STATE.json').read_bytes()
            with patch.object(r, 'ROOT', root), patch.object(r, 'policy', return_value={}), patch.object(r, 'host_guard'), patch.object(r, 'validate_inputs') as validate:
                with self.assertRaises(ValueError):
                    r.setup()
                validate.assert_not_called()
            self.assertEqual((root / 'STATE.json').read_bytes(), before)

    def test_export_manifest_and_materialized_files_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'runtime').mkdir()
            data = b'compiled'
            (root / 'runtime/app.js').write_bytes(data)
            manifest = {'files': {'app.js': {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}, 'source_commit': 'commit', 'runtime_format': 'next-start-v1', 'entrypoint': 'node_modules/next/dist/bin/next'}
            (root / 'release-manifest.json').write_text(json.dumps(manifest))
            (root / 'runtime.tar').write_bytes(b'artifact')
            report = {'manifestSha256': r.digest(root / 'release-manifest.json'), 'artifactSha256': r.digest(root / 'runtime.tar')}
            (root / 'export-report.json').write_text(json.dumps(report))
            p = {'export_root': str(root), 'artifact_sha256': report['artifactSha256'], 'manifest_sha256': report['manifestSha256'], 'source_commit': 'commit'}
            self.assertEqual(r.verify_export(p)['files'], 1)
            (root / 'runtime/extra').write_text('unexpected')
            with self.assertRaises(ValueError):
                r.verify_export(p)

    def test_stop_rejects_live_process_and_never_targets_other_unit(self):
        with patch.object(r, 'policy', return_value={}), patch.object(r, 'host_guard'), patch.object(r, 'run') as run, patch.object(r, 'state', return_value={'MainPID': '9', 'ActiveState': 'active'}):
            with self.assertRaises(ValueError):
                r.stop()
            run.assert_called_once_with(['/usr/bin/systemctl', 'stop', r.UNIT])

    def test_offline_install_uses_local_private_temporary_directory(self):
        text = Path(r.__file__).read_text()
        self.assertIn("'--no-index', '--no-deps', '--require-hashes'", text)
        self.assertIn("temporary = ROOT / 'install-tmp'", text)
        self.assertNotIn('shutil.rmtree', text)
        self.assertNotIn('reset-failed', text)


if __name__ == '__main__':
    unittest.main()
