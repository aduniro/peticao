"""Guard-only tests. Do not start Node, PostgreSQL, browser or remote operations."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cumulative', Path(__file__).with_name('cumulative-snapshot.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Guards(unittest.TestCase):
    def test_only_full_hash_and_dedicated_checkout(self):
        parent = module.CHECKOUT_PARENT
        module.validate_name(parent / 'candidate-cumulative-accepted-20261109', 'a' * 40)
        for name, commit in [('candidate-stage02-domains', 'a' * 40), ('candidate-cumulative-safe', 'abc123'), ('candidate-cumulative-safe', 'a' * 39 + ';')]:
            with self.assertRaises(AssertionError): module.validate_name(parent / name, commit)
        with self.assertRaises(AssertionError): module.validate_name(Path('/tmp/candidate-cumulative-safe'), 'a' * 40)

    def test_environment_is_fictitious_and_not_inherited(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(module.os.environ, {'DATABASE_URL': 'UNEXPECTED_QA_VALUE', 'MAIL_PROVIDER': 'REAL', 'CPF_BRASIL_TOKEN': 'UNEXPECTED_QA_VALUE', 'PREVIEW_MODE': '1', 'MAIL_PROVIDERS': 'REAL'}):
                env = module.clean_env(Path(tmp), 'tests')
            self.assertEqual(env['MAIL_PROVIDER'], 'dev'); self.assertEqual(env['DEV_DB_PORT'], '54364')
            self.assertNotIn('CPF_BRASIL_TOKEN', env); self.assertNotIn('PREVIEW_MODE', env); self.assertNotIn('MAIL_PROVIDERS', env)
            self.assertNotIn('UNEXPECTED_QA_VALUE', str(env)); self.assertEqual(env['NODE_ENV'], 'test')

    def test_fixed_test_selection_and_no_shell(self):
        plan = {'tests': ['site/src/lib/a.test.ts', 'site/src/i18n/b.test.ts'], 'runtime': {'node': str(module.NODE20)}}
        command = module.command_for('tests', plan)
        self.assertIn('--test-concurrency=1', command)
        self.assertEqual(command[-2:], ['src/lib/a.test.ts', 'src/i18n/b.test.ts'])
        self.assertNotIn('sh', command); self.assertNotIn('rich-text', str(command))
        self.assertEqual(module.command_for('schema', plan)[-1], '../deploy/test/admin-schema-upgrade.mjs')

    def test_runtime_rejects_environment_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'site').mkdir(); (root / 'site/.env.local').write_text('NOT_A_SECRET')
            with self.assertRaisesRegex(AssertionError, 'environment files'): module.validate_runtime(root)

    def test_untracked_or_ignored_source_is_rejected(self):
        for path in [b'site/src/lib/untracked.ts\0', b'site/src/lib/ignored-wip.ts\0']:
            with patch.object(module.subprocess, 'check_output', return_value=path) as command:
                with self.assertRaisesRegex(AssertionError, 'Untracked source'): module.validate_source_tracking(Path('/tmp/fake'))
                self.assertNotIn('--exclude-standard', command.call_args.args[0])
        with patch.object(module.subprocess, 'check_output', return_value=b''): module.validate_source_tracking(Path('/tmp/fake'))

    def test_only_tracked_environment_example_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'site').mkdir(); example = root / 'site/.env.example'; example.write_text('QA_SAMPLE')
            with patch.object(module.subprocess, 'run', return_value=module.subprocess.CompletedProcess([], 0)): module.validate_environment(root)
            with patch.object(module.subprocess, 'run', return_value=module.subprocess.CompletedProcess([], 1)):
                with self.assertRaisesRegex(AssertionError, 'tracked example'): module.validate_environment(root)
            (root / 'site/.env.local').write_text('QA_SAMPLE')
            with patch.object(module.subprocess, 'run', return_value=module.subprocess.CompletedProcess([], 0)):
                with self.assertRaisesRegex(AssertionError, 'environment files'): module.validate_environment(root)

    def test_runtime_is_pinned_and_arbitrary_binaries_are_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'approved isolated'): module.node_runtime_manifest(Path('/usr/bin/node'))
        with patch.object(module, 'digest', return_value='0' * 64):
            with self.assertRaisesRegex(AssertionError, 'binary hash'): module.node_runtime_manifest()
        with patch.object(module, 'digest', return_value=module.NODE20_SHA256), patch.object(module.subprocess, 'check_output', return_value='v20.19.2\n'):
            self.assertEqual(module.node_runtime_manifest()['version'], 'v20.19.2')

    def test_node20_namespace_and_child_runtime_are_separate(self):
        self.assertEqual(module.OUTPUT_NAMESPACE, 'accepted-cumulative-node20')
        plan = {'tests': ['site/src/lib/a.test.ts'], 'runtime': {'node': str(module.NODE20)}}
        command = module.command_for('tests', plan)
        self.assertEqual(command[0], str(module.NODE20)); self.assertEqual(command[2], str(module.NODE20))
        with tempfile.TemporaryDirectory() as tmp:
            env = module.clean_env(Path(tmp), 'tests')
            self.assertEqual(env['PATH'].split(module.os.pathsep)[0], str(module.NODE20.parent))

    def test_atomic_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'phase.json'; module.write_json(path, {'status': 'interrupted'})
            self.assertEqual(module.json.loads(path.read_text())['status'], 'interrupted')
            self.assertFalse(path.with_suffix('.json.tmp').exists())

if __name__ == '__main__': unittest.main()
