import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publication_audit', Path(__file__).parents[1] / 'audit_publication.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class HistoricalAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '--initial-branch=main')
        self.git('config', 'user.name', 'Synthetic QA')
        self.git('config', 'user.email', 'qa@example.invalid')
        self.policy = {'reviewed_cpf_fixture_blobs': []}

    def git(self, *args):
        env = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null')
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null',
                                        '-c', 'core.excludesFile=/dev/null',
                                        '-C', str(self.repo), *args],
                                       stderr=subprocess.DEVNULL, env=env)

    def commit(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.git('add', '--', name)
        self.git('commit', '-m', 'Synthetic QA fixture')

    def test_clean_history_passes(self):
        self.commit('app.py', b'print("synthetic")\n')
        self.assertTrue(audit.audit(self.repo, self.policy)['pass'])

    def test_deleted_private_file_remains_rejected_in_history(self):
        self.commit('private-state.private.json', b'{}\n')
        self.git('rm', 'private-state.private.json')
        self.git('commit', '-m', 'Delete synthetic fixture')
        result = audit.audit(self.repo, self.policy)
        self.assertFalse(result['pass'])
        self.assertIn('prohibited_historical_path', {x['reason'] for x in result['errors']})

    def test_database_magic_without_database_extension_is_rejected(self):
        self.commit('innocent.dat', b'SQLite format 3\0' + bytes(100))
        self.assertIn('database_blob', {x['reason'] for x in audit.audit(self.repo, self.policy)['errors']})

    def test_unreviewed_synthetic_identifier_fails_without_printing_value(self):
        # Generate a validation-only number. Its literal is never committed in
        # this test source or printed in the audit output.
        digits = list(map(int, '800000009'))
        for length in (9, 10):
            value = 11 - sum(digits[i] * (length + 1 - i) for i in range(length)) % 11
            digits.append(0 if value >= 10 else value)
        value = ''.join(map(str, digits)).encode()
        self.commit('fixture.py', value + b'\n')
        result = audit.audit(self.repo, self.policy)
        self.assertFalse(result['pass'])
        self.assertNotIn(value.decode(), json.dumps(result))

    def test_exact_fixture_approval_does_not_approve_edited_blob(self):
        digits = list(map(int, '800000009'))
        for length in (9, 10):
            value = 11 - sum(digits[i] * (length + 1 - i) for i in range(length)) % 11
            digits.append(0 if value >= 10 else value)
        value = ''.join(map(str, digits)).encode()
        self.commit('fixture.py', value + b'\n')
        blob = self.git('rev-parse', 'HEAD:fixture.py').decode().strip()
        self.policy['reviewed_cpf_fixture_blobs'] = [
            {'blob': blob, 'cpf_sha256': [hashlib.sha256(value).hexdigest()]}]
        self.assertTrue(audit.audit(self.repo, self.policy)['pass'])
        self.commit('fixture.py', b'# modified\n' + value + b'\n')
        self.assertFalse(audit.audit(self.repo, self.policy)['pass'])

    def test_public_placeholder_environment_file_is_allowed(self):
        self.commit('.env.example', b'PROJECT_MODE=development\n')
        self.assertTrue(audit.audit(self.repo, self.policy)['pass'])

    def test_real_environment_filename_is_rejected(self):
        self.commit('.env.production', b'PROJECT_MODE=synthetic\n')
        self.assertFalse(audit.audit(self.repo, self.policy)['pass'])


if __name__ == '__main__':
    unittest.main()
