"""Real local child/WorkerRPC/queue/artifact custody over real socketpairs.

Unit, cgroup, reference and storage-unmount adapters are synthetic. No SystemBus
or host deployment qualification is claimed by these integration tests.
"""
import hashlib
import json
from pathlib import Path
import socket
import sys
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent/'runtime'))
import artifacts
import fixture_support
import remote_contract as c
from broker_lifecycle import Lifecycle
from broker_wire import Broker, proxy_once


class WireTransport:
    def __init__(self, broker):
        self.broker = broker
        self.errors = []

    def call(self, node, request):
        if node != 'civo': raise ValueError('fixture_civo_only')
        server, client = socket.socketpair()
        def serve():
            with server:
                try: self.broker.serve_connection(server)
                except BaseException as e: self.errors.append(type(e).__name__)
        thread = threading.Thread(target=serve)
        thread.start()
        try:
            with client:
                reply = proxy_once(client, request, expected_uid=__import__('os').geteuid())
        finally:
            thread.join(3)
        if thread.is_alive() or self.errors: raise RuntimeError('fixture_server_failure')
        if not reply['ok']: raise RuntimeError(reply['error_type'])
        return reply['result']


class Integration(unittest.TestCase):
    def setUp(self):
        self.ctx = fixture_support.RuntimeTests('test_full_rpc_child_stop_artifact_and_queue_success')
        self.ctx.setUp()
        x = self.ctx
        self.refs = mock.Mock()
        x.adapter.references = self.refs
        self.retained = {}
        self.cleanups = []
        def status(m, r):
            if m['job_id'] not in self.retained: raise FileNotFoundError()
            return dict(self.retained[m['job_id']])
        x.adapter.storage = mock.Mock()
        x.adapter.storage.status.side_effect = status
        def cleanup(m, r, d, binding):
            self.cleanups.append(m['job_id'])
            self.retained[m['job_id']] = {'state': 'retained', 'mount_absent': True,
                'manifest_sha256': c.digest(m), 'receipt_sha256': c.digest(r),
                'stopped_invocation_id': binding['invocation_id']}
            self.refs.snapshot.return_value = {'state': 'released', 'connection_uncertain': False,
                                               'invocation_id': binding['invocation_id']}
        x.adapter.cleanup_storage = cleanup
        retirement = x.root/'retirements'; retirement.mkdir(mode=0o700)
        self.life = Lifecycle(x.worker, self.refs, retirement)
        self.transport = WireTransport(Broker(lambda:self.life, uid=__import__('os').geteuid()))
        x.backend.transport = self.transport

    def tearDown(self): self.ctx.tearDown()

    def finish_and_retire(self, manifest):
        x = self.ctx
        x.backend.dispatch(manifest, x.token)
        answer = x.backend.finish(manifest)
        self.assertNotIn(manifest['job_id'], self.retained)
        row, binding = x.worker.stored(manifest['job_id'])
        receipt = json.loads(row['receipt_json'])
        identity = {'job_id': manifest['job_id'], 'generation': manifest['generation'],
                    'manifest_sha256': c.digest(manifest), 'receipt_sha256': c.digest(receipt),
                    'invocation_id': binding['invocation_id'], 'worker_boot_id': receipt['boot_id']}
        custody = x.store.observe(identity)
        self.assertEqual(custody['state'], 'verified')
        # Real private durable attestation, after the canonical ArtifactStore
        # inspected/received/verified the actual child artifact in this fixture.
        attestation = {'identity': identity, 'bundle_sha256': binding['bundle_sha256'],
                       'coordinator_custody_verified': True}
        ack = x.root/'custody'/(manifest['job_id']+'.custody-attestation.json')
        artifacts.durable_json(ack, attestation)
        request = {'action': 'retire', 'manifest': manifest, 'token': x.token,
                   'receipt_sha256': c.digest(receipt), 'bundle_sha256': binding['bundle_sha256'],
                   'custody_receipt_sha256': hashlib.sha256(ack.read_bytes()).hexdigest()}
        retired = self.transport.call('civo', request)
        self.assertEqual(retired['state'], 'retained')
        self.assertTrue(retired['unit_reference_released'])
        self.assertNotIn(x.token, c.canonical(retired))
        self.assertEqual(self.transport.call('civo', request), retired)
        self.assertEqual(self.cleanups.count(manifest['job_id']), 1)
        return answer

    def test_real_child_queue_custody_then_retirement_same_worker_across_connections(self):
        self.assertEqual(self.finish_and_retire(self.ctx.manifest)['state'], 'completed')
        self.assertEqual(self.ctx.adapter.starts, 1)

    def test_real_nonzero_child_retired_only_after_canonical_failed_custody(self):
        manifest = self.ctx.new_job('b'*32, 'fixture-fail')
        self.assertEqual(self.finish_and_retire(manifest)['state'], 'failed')
        self.assertEqual(self.ctx.adapter.starts, 1)

    def test_forged_retirement_before_finalize_or_custody_never_cleans(self):
        x = self.ctx
        x.backend.dispatch(x.manifest, x.token)
        row, _ = x.worker.stored(x.manifest['job_id'])
        request = {'action':'retire', 'manifest':x.manifest, 'token':x.token,
                   'receipt_sha256':row['receipt_sha256'], 'bundle_sha256':'a'*64,
                   'custody_receipt_sha256':'b'*64}
        with self.assertRaises(RuntimeError): self.transport.call('civo', request)
        self.assertEqual(self.cleanups, [])
        # Finish normally so the actual fixture child/artifact has a terminal
        # receipt. This fixture has synthetic storage; no host cleanup exists.
        x.backend.finish(x.manifest)


if __name__ == '__main__': unittest.main()
