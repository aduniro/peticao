import json
import importlib.util
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'coordinator'))
import claim_gateway
import test_kubernetes_backend as fixtures
RUNNER_SPEC = importlib.util.spec_from_file_location('tls_job_runner', ROOT / 'runner/job_runner.py')
runner = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(runner)


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

    def test_runner_queries_receipt_after_lost_https_finish_response(self):
        import socket
        original = claim_gateway.Handler.reply

        def lose_finish(handler, code, value):
            if handler.path == '/v1/finish' and code == 200:
                handler.close_connection = True
                handler.connection.shutdown(socket.SHUT_RDWR)
                handler.connection.close()
                return
            return original(handler, code, value)

        executions = []

        def execute(plan, run, output):
            executions.append('once')
            output.write_bytes(b'guarded synthetic execution\n')
            return 0

        work = Path(self.fixture.tmp.name) / 'runner-work'
        work.mkdir()
        plan = {'source_commit': self.fixture.catalog['unit']['source_commit'], 'manifest_sha256': 'c' * 64}
        gateway = runner.Gateway(self.token, self.cert, self.url)
        with patch.object(claim_gateway.Handler, 'reply', lose_finish):
            result = runner.run_once('unit', self.body, plan, gateway, work, execute)
        self.assertEqual(result, 0)
        self.assertEqual(executions, ['once'])
        self.assertTrue(self.fixture.backend.execution_receipt(self.job, 'pod-uid', self.token)['finished'])
        self.assertEqual(self.fixture.api.creates, 1)

    def test_large_runtime_crosses_real_tls_and_is_collected_before_job_cleanup(self):
        import hashlib
        build = self.fixture.submit(2, 'build')
        self.assertEqual(fixtures.core.dispatch_once(), build)
        token = self.fixture.start_pod(build)
        pod = self.fixture.api.pods.pop('test-pod')
        pod['metadata'].update(name='build-pod', uid='build-pod-uid')
        self.fixture.api.pods['build-pod'] = pod
        body = {'id': build, 'pod_name': 'build-pod', 'pod_uid': 'build-pod-uid'}
        work = Path(self.fixture.tmp.name) / 'large-runner-work'
        work.mkdir()
        data = b'0' * (17 * 1024 * 1024 + 1)
        executions = []

        def execute(plan, run, output):
            executions.append('once')
            output.write_bytes(b'synthetic portable-runtime transport fixture\n')
            (output.parent / 'runtime.tar').write_bytes(data)
            return 0

        plan = {'source_commit': self.fixture.catalog['build']['source_commit'], 'manifest_sha256': 'd' * 64}
        code = runner.run_once('build', body, plan, runner.Gateway(token, self.cert, self.url), work, execute)
        self.assertEqual(code, 0)
        self.assertEqual(executions, ['once'])
        folder = fixtures.core.WORKER / 'jobs' / build
        self.assertEqual(hashlib.sha256((folder / 'artifacts/runtime.tar').read_bytes()).digest(), hashlib.sha256(data).digest())
        self.fixture.api.jobs[build]['status'] = {'conditions': [{'type': 'Complete', 'status': 'True'}]}
        fixtures.core.reconcile()
        self.assertNotIn(build, self.fixture.api.jobs)
        self.assertEqual(self.fixture.row(build)['state'], 'completed')
        receipt = self.fixture.backend.execution_receipt(build, 'build-pod-uid', token)
        runtime = next(item for item in receipt['result']['artifacts'] if item['path'] == 'artifacts/runtime.tar')
        self.assertEqual(runtime['bytes'], len(data))

    def test_runtime_upload_is_denied_to_non_build_profile(self):
        import hashlib
        import base64
        self.assertEqual(self.request('/v1/start')[0], 200)
        data = b'fixture'
        chunk = {'path': 'artifacts/runtime.tar', 'total_sha256': hashlib.sha256(data).hexdigest(),
                 'total_bytes': len(data), 'index': 0, 'chunk_sha256': hashlib.sha256(data).hexdigest(),
                 'base64': base64.b64encode(data).decode()}
        self.assertEqual(self.request('/v1/runtime-chunk', {**self.body, 'chunk': chunk})[0], 403)
        self.assertFalse((fixtures.core.WORKER / 'jobs' / self.job / '.runtime-upload').exists())
