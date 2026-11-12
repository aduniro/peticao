import base64
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'coordinator'))
import runtime_upload as upload
import kubernetes_results as results


def packet(data, index):
    block = data[index * upload.CHUNK_BYTES:(index + 1) * upload.CHUNK_BYTES]
    return {'path': upload.ARTIFACT, 'total_sha256': hashlib.sha256(data).hexdigest(),
            'total_bytes': len(data), 'index': index, 'chunk_sha256': hashlib.sha256(block).hexdigest(),
            'base64': base64.b64encode(block).decode()}


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_multichunk_resume_and_collection_above_old_file_limit(self):
        data = b'0' * (17 * 1024 * 1024 + 11)
        first = upload.chunk(self.folder, 'job', 'pod', packet(data, 1))
        self.assertFalse(first['complete'])
        # A new module instance has no in-memory upload state to depend on.
        spec = importlib.util.spec_from_file_location('reopened_upload', Path(upload.__file__))
        reopened = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reopened)
        self.assertFalse(reopened.chunk(self.folder, 'job', 'pod', packet(data, 1))['complete'])
        self.assertFalse(reopened.chunk(self.folder, 'job', 'pod', packet(data, 0))['complete'])
        final = reopened.chunk(self.folder, 'job', 'pod', packet(data, 2))
        self.assertTrue(final['complete'])
        self.assertEqual(first['upload_id'], final['upload_id'])
        reference = {'path': upload.ARTIFACT, 'sha256': final['sha256'], 'upload_id': final['upload_id']}

        def resolver(upload_id, path, digest):
            return reopened.resolve(self.folder, 'job', 'pod', upload_id, path, digest)

        result, digest = results.store(self.folder, {'id': 'job'}, 0, {}, [reference], resolver)
        self.assertEqual(result['artifacts'][0]['bytes'], len(data))
        self.assertEqual(results.verify(self.folder, digest), result)
        self.assertEqual(hashlib.sha256((self.folder / upload.ARTIFACT).read_bytes()).hexdigest(), final['sha256'])

    def test_replay_cannot_change_identity_or_overwrite_prior_chunk(self):
        with patch.object(upload, 'CHUNK_BYTES', 8):
            data = b'12345678tail'
            original = packet(data, 0)
            receipt = upload.chunk(self.folder, 'job', 'pod', original)
            forged = {**original, 'base64': base64.b64encode(b'XXXXXXXX').decode(),
                      'chunk_sha256': hashlib.sha256(b'XXXXXXXX').hexdigest()}
            with self.assertRaises(ValueError): upload.chunk(self.folder, 'job', 'pod', forged)
            with self.assertRaises(ValueError): upload.chunk(self.folder, 'different-job', 'pod', original)
            self.assertEqual((self.folder / '.runtime-upload/chunk-0000').read_bytes(), b'12345678')
            self.assertEqual(upload.chunk(self.folder, 'job', 'pod', original)['upload_id'], receipt['upload_id'])

    def test_limits_bad_hash_and_arbitrary_paths_are_rejected(self):
        valid = packet(b'test', 0)
        for invalid in [{'path': 'artifacts/../../escape.tar'}, {'total_bytes': upload.MAX_BYTES + 1},
                        {'index': -1}, {'index': True}, {'chunk_sha256': '0' * 64}]:
            with self.assertRaises(ValueError): upload.chunk(self.folder, 'job', 'pod', {**valid, **invalid})
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_lock_and_cross_pod_reference_fail_closed(self):
        data = b'fixture'
        with upload.locked(self.folder):
            with self.assertRaises(BlockingIOError): upload.chunk(self.folder, 'job', 'pod', packet(data, 0))
        receipt = upload.chunk(self.folder, 'job', 'pod', packet(data, 0))
        with self.assertRaises(PermissionError):
            upload.resolve(self.folder, 'job', 'different-pod', receipt['upload_id'], upload.ARTIFACT, receipt['sha256'])
