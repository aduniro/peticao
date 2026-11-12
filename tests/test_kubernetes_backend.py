import concurrent.futures
import base64
import hashlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'coordinator'))
import kubernetes_backend as kube
import recovery
import sqlite3

SPEC = importlib.util.spec_from_file_location('queue_backend_test_core', ROOT / 'coordinator/coordinator.py')
core = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = core
SPEC.loader.exec_module(core)


class FakeAPI:
    def __init__(self):
        self.jobs, self.pods = {}, {}
        self.creates, self.resumes, self.deletes = 0, 0, 0
        self.unavailable = self.lose_create_response = False

    def create(self, manifest):
        self.creates += 1
        job_id = manifest['metadata']['labels']['peticao.dev/job-id']
        if job_id in self.jobs:
            raise kube.Unavailable('already_exists')
        observed = copy.deepcopy(manifest)
        observed['metadata']['uid'] = 'job-uid-' + job_id
        self.jobs[job_id] = observed
        if self.lose_create_response:
            raise kube.Unavailable('response_lost_after_create')
        return copy.deepcopy(observed)

    def get_job(self, job_id):
        if self.unavailable:
            raise kube.Unavailable('network_lost')
        return copy.deepcopy(self.jobs.get(job_id))

    def resume(self, job_id):
        self.resumes += 1
        self.jobs[job_id]['spec']['suspend'] = False

    def delete(self, job_id):
        self.deletes += 1
        self.jobs.pop(job_id, None)

    def get_pod(self, name):
        return self.pods[name]

    def logs(self, job_id):
        return 'synthetic technical result\n'


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        core.ROOT, core.WORKER = root / 'coordinator', root / 'worker'
        core.initialize()
        core.atomic(core.ROOT / 'authority.json', {'role': 'primary', 'generation': 1, 'armed_boot_id': core.boot_id()})
        self.catalog = json.loads((ROOT / 'profiles.json').read_text())['profiles']
        for name, entry in self.catalog.items():
            entry.update(enabled=True, image='100.80.18.81:5443/peticao/test@sha256:' + 'a' * 64,
                         source_manifest_sha256='b' * 64, approval_reference='synthetic test fixture only')
        self.api = FakeAPI()
        self.backend = kube.Backend(core, self.api, self.catalog)
        core.KUBERNETES_INSTANCE = self.backend
        self.env = patch.dict(os.environ, {'ADMIN_CLUSTER_KUBERNETES': '1'})
        self.env.start()
        self.samples = {'local': {'ready': True, 'admission_open': True, 'observed_at': time.time(),
                                  'job_cpu_ceiling_millis': 4000, 'job_memory_ceiling_mib': 16384,
                                  'free_cpu_millis': 4000, 'free_memory_mib': 8192}}
        self.observe = patch.object(core, 'kubernetes_observations', lambda: self.samples)
        self.observe.start()

    def tearDown(self):
        self.observe.stop()
        self.env.stop()
        core.KUBERNETES_INSTANCE = None
        self.tmp.cleanup()

    def submit(self, n=1, profile='unit', dependencies=None):
        job_id = f'{n:032x}'
        core.rpc({'action': 'submit', 'id': job_id, 'kind': kube.KIND, 'profile': profile,
                  'source_commit': self.catalog[profile]['source_commit'], 'dependencies': dependencies or []})
        return job_id

    def row(self, job):
        with core.connect() as db:
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone())

    def start_pod(self, job):
        spec = copy.deepcopy(self.api.jobs[job]['spec']['template']['spec'])
        self.api.pods['test-pod'] = {'metadata': {'name': 'test-pod', 'namespace': kube.NAMESPACE,
                                                'uid': 'pod-uid', 'labels': {'peticao.dev/job-id': job},
                                                'ownerReferences': [{'kind': 'Job', 'controller': True,
                                                                     'uid': self.api.jobs[job]['metadata']['uid']}]},
                                      'spec': spec}
        token = next(e['value'] for e in spec['containers'][0]['env'] if e['name'] == 'PETICAO_CLAIM_TOKEN')
        return token

    def test_lost_create_response_reconciles_same_job_without_second_create(self):
        job = self.submit()
        self.api.lose_create_response = True
        self.assertEqual(core.dispatch_once(), job)
        self.assertEqual(self.api.creates, 1)
        self.assertIsNone(self.backend.claims.status(job)['job_uid'])
        core.reconcile()
        self.assertIsNotNone(self.backend.claims.status(job)['job_uid'])
        self.assertFalse(self.api.jobs[job]['spec']['suspend'])
        self.assertIsNone(core.dispatch_once())
        self.assertEqual(self.api.creates, 1)

    def test_transport_loss_and_proved_absence_never_trigger_replacement(self):
        job = self.submit()
        core.dispatch_once()
        self.api.unavailable = True
        with core.connect() as db:
            db.execute("UPDATE jobs SET updated_at='2000-01-01T00:00:00+00:00' WHERE id=?", (job,))
        core.reconcile()
        self.assertEqual(self.row(job)['state'], 'starting')
        self.api.unavailable = False
        del self.api.jobs[job]
        for _ in range(3):
            core.dispatch_once()
        self.assertEqual(self.api.creates, 1)
        self.assertEqual(self.row(job)['error'], 'kubernetes_absent_requires_reconciliation')

    def test_actual_pod_owner_attestation_and_single_execution(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        self.api.pods['test-pod']['metadata']['ownerReferences'][0]['uid'] = 'wrong-owner'
        with self.assertRaises(PermissionError): self.backend.authorize_start(job, 'test-pod', 'pod-uid', token)
        self.api.pods['test-pod']['metadata']['ownerReferences'][0]['uid'] = self.api.jobs[job]['metadata']['uid']
        self.assertTrue(self.backend.authorize_start(job, 'test-pod', 'pod-uid', token))
        self.assertFalse(self.backend.authorize_start(job, 'test-pod', 'pod-uid', token))
        core.reconcile()
        self.assertEqual(self.row(job)['state'], 'running')

    def test_cancel_denies_execution_before_api_delete_and_preserves_uncertainty(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        result = core.rpc({'action': 'cancel', 'id': job})
        self.assertEqual(result['state'], 'cancel_requested')
        self.assertIsNotNone(self.backend.claims.status(job)['cancel_requested_at'])
        self.assertFalse(self.backend.authorize_start(job, 'test-pod', 'pod-uid', token))
        self.assertEqual(self.api.deletes, 1)
        self.assertNotEqual(self.row(job)['state'], 'canceled')

    def test_unfit_head_job_does_not_block_independent_smaller_work(self):
        large = self.submit(1, 'build')
        small = self.submit(2, 'unit')
        self.samples['local']['free_cpu_millis'] = 1000
        self.assertEqual(core.dispatch_once(), small)
        self.assertEqual(self.row(large)['state'], 'queued')

    def test_dependency_failure_prevents_effects_without_stalling_independent_work(self):
        dep = self.submit(1)
        child = self.submit(2, 'build', [dep])
        independent = self.submit(3)
        with core.connect() as db:
            db.execute("UPDATE jobs SET state='failed' WHERE id=?", (dep,))
        self.assertEqual(core.dispatch_once(), independent)
        self.assertEqual(self.row(child)['error'], 'dependency_failed_or_missing')

    def test_atomic_reservation_allows_only_one_create_under_competing_dispatchers(self):
        job = self.submit()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            result = list(pool.map(lambda _: self.backend.dispatch_once(self.samples), range(8)))
        self.assertEqual(result.count(job), 1)
        self.assertEqual(self.api.creates, 1)

    def test_public_rpc_contract_and_manifest_do_not_expose_execution_token(self):
        job = self.submit()
        core.dispatch_once()
        status = core.rpc({'action': 'status', 'id': job})
        self.assertEqual(status['backend'], kube.BACKEND)
        self.assertEqual(status['source_commit'], self.catalog['unit']['source_commit'])
        token = self.start_pod(job)
        self.assertNotIn(token, json.dumps(core.rpc({'action': 'jobs'})))
        manifest = self.api.jobs[job]
        pod = manifest['spec']['template']['spec']
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertFalse(pod['containers'][0]['securityContext']['allowPrivilegeEscalation'])
        self.assertEqual(pod['containers'][0]['command'], ['/opt/peticao-runner/run-profile'])
        self.assertTrue(manifest['spec']['backoffLimit'] == 0 and pod['restartPolicy'] == 'Never')

    def test_profiles_cannot_be_overridden_by_rpc(self):
        request = {'action': 'submit', 'id': 'f' * 32, 'kind': kube.KIND, 'profile': 'unit',
                   'source_commit': self.catalog['unit']['source_commit'], 'command': ['sh', '-c', 'anything']}
        with self.assertRaises(ValueError): core.rpc(request)
        del request['command']
        self.catalog['unit']['enabled'] = False
        with self.assertRaises(ValueError): core.rpc(request)

    def test_finished_receipt_and_artifacts_are_hashed_and_idempotent(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        self.assertTrue(self.backend.authorize_start(job, 'test-pod', 'pod-uid', token))
        data = b'synthetic technical result'
        artifacts = [{'path': 'artifacts/report.txt', 'sha256': hashlib.sha256(data).hexdigest(),
                      'base64': base64.b64encode(data).decode()}]
        first = self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {'checks': 3}, artifacts)
        second = self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {'checks': 3}, artifacts)
        self.assertEqual(first, second)
        self.api.jobs[job]['status'] = {'conditions': [{'type': 'Complete', 'status': 'True'}]}
        core.reconcile()
        self.assertEqual(self.row(job)['state'], 'completed')
        self.assertEqual(core.rpc({'action': 'status', 'id': job})['result']['technical_result']['checks'], 3)
        self.assertEqual((core.WORKER / 'jobs' / job / 'artifacts/report.txt').read_bytes(), data)

    def test_changed_or_traversing_result_never_overwrites_receipt(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        self.backend.authorize_start(job, 'test-pod', 'pod-uid', token)
        self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {'checks': 1}, [])
        with self.assertRaises(ValueError):
            self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {'checks': 2}, [])
        self.assertEqual(core.rpc({'action': 'status', 'id': job})['result']['technical_result']['checks'], 1)
        with self.assertRaises(ValueError):
            self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {},
                                            [{'path': 'artifacts/../../outside.txt', 'sha256': 'a' * 64, 'base64': ''}])

    def test_success_without_runner_receipt_is_not_reported_complete(self):
        job = self.submit()
        core.dispatch_once()
        self.api.jobs[job]['status'] = {'conditions': [{'type': 'Complete', 'status': 'True'}]}
        core.reconcile()
        self.assertEqual(self.row(job)['state'], 'interrupted')
        self.assertEqual(self.row(job)['error'], 'missing_execution_receipt')
        self.assertIn(job, self.api.jobs)

    def test_failed_runner_preserves_reported_exit_code_and_receipt(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        self.backend.authorize_start(job, 'test-pod', 'pod-uid', token)
        self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 7, {'synthetic_failure': True}, [])
        self.api.jobs[job]['status'] = {'conditions': [{'type': 'Failed', 'status': 'True'}]}
        core.reconcile()
        self.assertEqual(self.row(job)['state'], 'failed')
        self.assertEqual(self.row(job)['exit_code'], 7)
        self.assertEqual(core.rpc({'action': 'status', 'id': job})['result']['exit_code'], 7)

    def test_changed_queued_profile_does_not_block_valid_work(self):
        invalid = self.submit(1, 'build')
        valid = self.submit(2, 'unit')
        self.catalog['build']['enabled'] = False
        self.assertEqual(core.dispatch_once(), valid)
        self.assertEqual(self.row(invalid)['state'], 'interrupted')

    def test_sp_cannot_be_selected_without_fresh_production_admission(self):
        self.samples['sp'] = self.samples.pop('local')
        self.assertIsNone(self.backend.placement(self.catalog['unit'], self.samples, []))
        self.samples['sp']['production_gate_eligible'] = True
        self.assertEqual(self.backend.placement(self.catalog['unit'], self.samples, []), 'sp')
        self.samples['sp']['observed_at'] -= 50
        self.assertIsNone(self.backend.placement(self.catalog['unit'], self.samples, []))

    def test_owner_resource_ceilings_override_overstated_host_samples(self):
        self.samples['sp'] = self.samples.pop('local')
        self.samples['sp']['production_gate_eligible'] = True
        profile = copy.deepcopy(self.catalog['unit'])
        profile['cpu_millis'] = 2001
        self.assertIsNone(self.backend.placement(profile, self.samples, []))
        profile['cpu_millis'] = 1000
        profile['memory_mib'] = 3073
        self.assertIsNone(self.backend.placement(profile, self.samples, []))

    def test_parallel_heavy_limits_and_global_slot_budget(self):
        one = self.submit(1, 'build')
        two = self.submit(2, 'build')
        active = [{**self.row(one), 'node': 'local'}, {**self.row(two), 'node': 'santiago'}]
        self.assertIsNone(self.backend.placement(self.catalog['browser'], self.samples, active))
        active = [active[0]] * 4
        self.assertIsNone(self.backend.placement(self.catalog['unit'], self.samples, active))

    def test_terminal_job_cleanup_retains_hashed_local_receipts(self):
        job = self.submit()
        core.dispatch_once()
        token = self.start_pod(job)
        self.backend.authorize_start(job, 'test-pod', 'pod-uid', token)
        self.backend.complete_execution(job, 'test-pod', 'pod-uid', token, 0, {'synthetic': True}, [])
        self.api.jobs[job]['status'] = {'conditions': [{'type': 'Complete', 'status': 'True'}]}
        core.reconcile()
        self.assertNotIn(job, self.api.jobs)
        core.reconcile()
        folder = core.WORKER / 'jobs' / job
        self.assertTrue(json.loads((folder / 'kubernetes-collected.json').read_text())['cleanup_confirmed'])
        self.assertTrue((folder / 'result.json').is_file())
        self.assertEqual(self.row(job)['state'], 'completed')

    def test_snapshot_restore_preserves_claims_and_job_identity_without_restarting(self):
        job = self.submit(profile='build')
        core.dispatch_once()
        token = self.start_pod(job)
        self.assertTrue(self.backend.authorize_start(job, 'test-pod', 'pod-uid', token))
        import runtime_upload
        data = b'opaque-runtime-fixture'
        chunk = {'path': runtime_upload.ARTIFACT, 'total_sha256': hashlib.sha256(data).hexdigest(),
                 'total_bytes': len(data), 'index': 0, 'chunk_sha256': hashlib.sha256(data).hexdigest(),
                 'base64': base64.b64encode(data).decode()}
        self.backend.upload_runtime_chunk(job, 'test-pod', 'pod-uid', token, chunk)
        output = Path(self.tmp.name) / 'snapshots'
        archive = recovery.snapshot(core.ROOT, output, core.WORKER)['snapshot']
        target = Path(self.tmp.name) / 'restored'
        result = recovery.restore(archive, target)
        self.assertEqual(result['role'], 'standby')
        with sqlite3.connect(target / 'queue.sqlite') as db:
            restored = db.execute('SELECT started_at,pod_uid,job_uid FROM kubernetes_execution_claims WHERE job_id=?', (job,)).fetchone()
            self.assertIsNotNone(restored[0])
            self.assertEqual(restored[1], 'pod-uid')
            self.assertEqual(restored[2], self.api.jobs[job]['metadata']['uid'])
            self.assertEqual(db.execute('SELECT state FROM jobs WHERE id=?', (job,)).fetchone()[0], 'interrupted')
        self.assertTrue((target / 'recovered-worker/jobs' / job / 'kubernetes.json').is_file())
        self.assertEqual((target / 'recovered-worker/jobs' / job / '.runtime-upload/runtime.blob').read_bytes(), data)
        self.assertEqual(self.api.creates, 1)
