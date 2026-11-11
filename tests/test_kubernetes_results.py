import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'coordinator'))
import kubernetes_results as results


class ResultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def artifact(self, name='artifacts/result.txt', data=b'synthetic'):
        return {'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'base64': base64.b64encode(data).decode()}

    def test_bad_digest_and_size_limits_leave_no_partial_receipts(self):
        invalid = self.artifact()
        invalid['sha256'] = '0' * 64
        with self.assertRaises(ValueError): results.store(self.folder, {'id': 'fixture'}, 0, {}, [invalid])
        with patch.object(results, 'MAX_FILE', 3):
            with self.assertRaises(ValueError): results.store(self.folder, {'id': 'fixture'}, 0, {}, [self.artifact()])
        with patch.object(results, 'MAX_TOTAL', 4):
            with self.assertRaises(ValueError): results.store(self.folder, {'id': 'fixture'}, 0, {}, [self.artifact(data=b'12345')])
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_tampering_or_directory_symlink_invalidates_collected_evidence(self):
        _, digest = results.store(self.folder, {'id': 'fixture'}, 0, {}, [self.artifact('artifacts/nested/result.txt')])
        file = self.folder / 'artifacts/nested/result.txt'
        file.write_bytes(b'changed')
        with self.assertRaises(ValueError): results.verify(self.folder, digest)
        file.unlink()
        directory = file.parent
        directory.rmdir()
        outside = self.folder / 'outside'
        outside.mkdir()
        (outside / 'result.txt').write_bytes(b'synthetic')
        directory.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError): results.verify(self.folder, digest)

    def test_recovery_of_fsynced_artifacts_before_database_finish_is_idempotent(self):
        artifacts = [self.artifact()]
        receipt, digest = results.store(self.folder, {'id': 'fixture'}, 0, {'checks': 1}, artifacts)
        # Simulate a crash after artifact rename but before result/claim completion.
        (self.folder / 'result.json').unlink()
        repeated, repeated_digest = results.store(self.folder, {'id': 'fixture'}, 0, {'checks': 1}, artifacts)
        self.assertEqual((receipt, digest), (repeated, repeated_digest))
