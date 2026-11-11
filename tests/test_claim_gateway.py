import json
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'coordinator'))
import claim_gateway
import test_kubernetes_backend as fixtures


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pki = tempfile.TemporaryDirectory()
        cls.cert = Path(cls.pki.name) / 'server.crt'
        cls.key = Path(cls.pki.name) / 'server.key'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', str(cls.key), '-out', str(cls.cert)], capture_output=True, check=True)

    @classmethod
    def tearDownClass(cls):
        cls.pki.cleanup()

    def setUp(self):
        self.fixture = fixtures.BackendTests('test_actual_pod_owner_attestation_and_single_execution')
        self.fixture.setUp()
        self.server = claim_gateway.Server(('127.0.0.1', 0), self.fixture.backend, self.cert, self.key)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()
        self.url = 'https://127.0.0.1:' + str(self.server.server_port)
        self.context = ssl.create_default_context(cafile=str(self.cert))
        self.job = self.fixture.submit()
        fixtures.core.dispatch_once()
        self.token = self.fixture.start_pod(self.job)
        self.body = {'id': self.job, 'pod_name': 'test-pod', 'pod_uid': 'pod-uid'}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.fixture.tearDown()

    def request(self, endpoint, body=None, token=None):
        request = urllib.request.Request(self.url + endpoint, data=json.dumps(body or self.body).encode(),
                                         headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token or self.token)})
        try:
            with urllib.request.urlopen(request, context=self.context, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_real_tls_and_sqlite_claim_allow_exactly_one_start(self):
        status, body = self.request('/v1/start')
        self.assertEqual(status, 200)
        self.assertTrue(body['execution_authorized'])
        status, body = self.request('/v1/start')
        self.assertEqual(status, 409)
        self.assertFalse(body['execution_authorized'])
        status, body = self.request('/v1/receipt')
        self.assertTrue(body['started'])
        self.assertFalse(body['execution_authorized'])

    def test_untrusted_certificate_and_invalid_capability_are_rejected(self):
        with self.assertRaises(urllib.error.URLError):
            urllib.request.urlopen(self.url, context=ssl.create_default_context(), timeout=5)
        self.assertEqual(self.request('/v1/start', token='f' * 64)[0], 403)
        self.assertEqual(self.request('/v1/start', token='invalid')[0], 401)
        self.assertEqual(self.request('/arbitrary-command')[0], 404)
        self.assertFalse(self.fixture.backend.claims.status(self.job)['started_at'])

    def test_result_query_survives_pod_collection_without_reexecuting(self):
        self.assertEqual(self.request('/v1/start')[0], 200)
        finish = {**self.body, 'exit_code': 0, 'technical_result': {'synthetic': True}, 'artifacts': []}
        self.assertEqual(self.request('/v1/finish', finish)[0], 200)
        self.fixture.api.jobs[self.job]['status'] = {'conditions': [{'type': 'Complete', 'status': 'True'}]}
        fixtures.core.reconcile()
        self.fixture.api.pods.clear()
        status, receipt = self.request('/v1/receipt')
        self.assertEqual(status, 200)
        self.assertTrue(receipt['finished'])
        self.assertEqual(receipt['state'], 'completed')
        self.assertEqual(receipt['result']['technical_result'], {'synthetic': True})
        self.assertEqual(self.fixture.api.creates, 1)
        self.assertNotIn(self.token, json.dumps(receipt))

    def test_fixed_contract_rejects_injected_commands_and_oversized_body(self):
        status, _ = self.request('/v1/start', {**self.body, 'command': 'arbitrary'})
        self.assertEqual(status, 400)
        request = urllib.request.Request(self.url + '/v1/finish', data=b'{}', headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token,
            'Content-Length': str(claim_gateway.MAX_BODY + 1)})
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(request, context=self.context, timeout=5)
        self.assertEqual(result.exception.code, 413)
        self.assertFalse(self.fixture.backend.claims.status(self.job)['started_at'])
