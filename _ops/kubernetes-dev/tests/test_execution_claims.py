import concurrent.futures
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('execution_claims', pathlib.Path(__file__).resolve().parents[1] / 'scripts/execution_claims.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
JOB = '1' * 32
TOKEN = '2' * 64
SHA = '3' * 64


def compete(path, pod):
    return module.Claims(path).start_once(JOB, 1, TOKEN, 'job-uid', pod)


class ClaimTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.tmp.name) / 'queue.sqlite'
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT,generation INTEGER,state TEXT)')
            db.execute('INSERT INTO jobs VALUES(?,?,?,?)', (JOB, json.dumps({'backend': 'kubernetes-v1'}), 1, 'starting'))
        self.claims = module.Claims(self.path)
        self.claims.reserve(JOB, 1, SHA, TOKEN)
        self.claims.bind_job(JOB, 1, SHA, 'job-uid')

    def tearDown(self):
        self.tmp.cleanup()

    def test_competing_processes_and_reopened_queue_start_only_once(self):
        with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
            starts = list(pool.map(compete, [self.path] * 8, ['pod-' + str(i) for i in range(8)]))
        self.assertEqual(sum(starts), 1)
        reopened = module.Claims(self.path)
        self.assertFalse(reopened.start_once(JOB, 1, TOKEN, 'job-uid', 'replacement-pod'))
        self.assertFalse(reopened.reserve(JOB, 1, SHA, TOKEN))

    def test_identity_changes_and_recreated_job_rejected(self):
        with self.assertRaises(ValueError): self.claims.reserve(JOB, 1, '4' * 64, TOKEN)
        with self.assertRaises(ValueError): self.claims.reserve(JOB, 1, SHA, '5' * 64)
        with self.assertRaises(ValueError): self.claims.bind_job(JOB, 1, SHA, 'new-job-uid')
        with self.assertRaises(PermissionError): self.claims.start_once(JOB, 2, TOKEN, 'job-uid', 'pod')
        with self.assertRaises(PermissionError): self.claims.start_once(JOB, 1, 'invalid', 'job-uid', 'pod')

    def test_cancel_before_start_and_lost_response_do_not_repeat(self):
        self.claims.cancel(JOB)
        self.assertFalse(self.claims.start_once(JOB, 1, TOKEN, 'job-uid', 'pod'))
        self.assertIsNotNone(self.claims.status(JOB)['cancel_requested_at'])

    def test_result_is_immutable_and_bound_to_actual_claimed_pod(self):
        self.assertTrue(self.claims.start_once(JOB, 1, TOKEN, 'job-uid', 'pod'))
        self.claims.finish(JOB, 'pod', SHA)
        self.claims.finish(JOB, 'pod', SHA)
        with self.assertRaises(ValueError): self.claims.finish(JOB, 'pod', '4' * 64)
        with self.assertRaises(PermissionError): self.claims.finish(JOB, 'replacement-pod', SHA)
        self.assertNotIn(TOKEN, json.dumps(self.claims.status(JOB)))

    def test_missing_queue_never_creates_an_alternative_database(self):
        missing = pathlib.Path(self.tmp.name) / 'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError): module.Claims(missing)
        self.assertFalse(missing.exists())
