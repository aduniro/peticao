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
        plan = {'tests': ['site/src/lib/a.test.ts', 'site/src/i18n/b.test.ts']}
        command = module.command_for('tests', plan)
        self.assertIn('--test-concurrency=1', command)
        self.assertEqual(command[-2:], ['src/lib/a.test.ts', 'src/i18n/b.test.ts'])
        self.assertNotIn('sh', command); self.assertNotIn('rich-text', str(command))
        self.assertEqual(module.command_for('schema', plan)[-1], '../deploy/test/admin-schema-upgrade.mjs')

    def test_runtime_rejects_environment_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'site').mkdir(); (root / 'site/.env.local').write_text('NOT_A_SECRET')
            with self.assertRaisesRegex(AssertionError, 'environment files'): module.validate_runtime(root)

    def test_atomic_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'phase.json'; module.write_json(path, {'status': 'interrupted'})
            self.assertEqual(module.json.loads(path.read_text())['status'], 'interrupted')
            self.assertFalse(path.with_suffix('.json.tmp').exists())

if __name__ == '__main__': unittest.main()
