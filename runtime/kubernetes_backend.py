#!/usr/bin/python3
"""Optional Kubernetes backend for the installed durable queue, not a new queue.

Disabled until a root-owned catalog has reviewed immutable image/source pins.
Job creation is suspended until its actual UID is durably bound. An uncertain
create is observed by the same name, never automatically created again.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time

from execution_claims import Claims
import kubernetes_results
import runtime_upload

KIND = 'kubernetes-profile-v1'
BACKEND = 'kubernetes-v1'
PROFILES = {'typecheck', 'unit', 'postgres17', 'build', 'browser', 'pdf-png'}
NAMESPACE = 'peticao-dev'
ACTIVE = {'starting', 'running'}
FAILED = {'failed', 'interrupted', 'canceled'}
PROFILE_KEYS = {'enabled', 'source_commit', 'source_manifest_sha256', 'image', 'cpu_millis',
                'memory_mib', 'ephemeral_mib', 'heavy', 'timeout_seconds', 'priority', 'approval_reference'}
NODE_CEILINGS = {'local': (4000, 16384), 'santiago': (4000, 7168), 'sp': (2000, 3072)}


class Unavailable(RuntimeError):
    """Observation/transport failed; absence was NOT established."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def load_catalog(path, owner_uid=0):
    path = Path(path)
    info = path.lstat()
    if not path.is_file() or path.is_symlink() or info.st_uid != owner_uid or info.st_mode & 0o022:
        raise PermissionError('root_owned_unwritable_catalog_required')
    data = json.loads(path.read_text())
    if data.get('schema_version') != 1 or not isinstance(data.get('profiles'), dict):
        raise ValueError('invalid_profile_catalog')
    for name, entry in data['profiles'].items():
        if name not in PROFILES or set(entry) != PROFILE_KEYS or type(entry['enabled']) is not bool:
            raise ValueError('unsupported_profile_or_fields')
        if not entry['enabled']:
            continue
        if not re.fullmatch('[a-f0-9]{40}', entry['source_commit']) or not re.fullmatch('[a-f0-9]{64}', str(entry['source_manifest_sha256'])):
            raise ValueError('immutable_source_pins_required')
        if not re.fullmatch(r'100\.80\.18\.81:5443/peticao/[a-z0-9._/-]+@sha256:[a-f0-9]{64}', str(entry['image'])):
            raise ValueError('reviewed_registry_image_digest_required')
        for key, low, high in [('cpu_millis', 100, 4000), ('memory_mib', 128, 16384),
                               ('ephemeral_mib', 128, 12288), ('timeout_seconds', 30, 3600), ('priority', 0, 100)]:
            if type(entry[key]) is not int or not low <= entry[key] <= high:
                raise ValueError('invalid_profile_budget:' + key)
        if type(entry['heavy']) is not bool or not isinstance(entry['approval_reference'], str) or not entry['approval_reference'].strip():
            raise ValueError('reviewed_profile_required')
    return data['profiles']


class Kubectl:
    def __init__(self, binary='/usr/local/lib/peticao-k3s/kubectl', kubeconfig='/etc/admin-v2-kubernetes/kubeconfig'):
        # Standalone verified client: k3s kubectl extracts a runtime under HOME.
        self.argv = [binary, '--kubeconfig', kubeconfig, '-n', NAMESPACE, '--request-timeout=10s']

    def call(self, args, body=None):
        try:
            result = subprocess.run(self.argv + args, input=canonical(body) if body is not None else None,
                                    text=True, capture_output=True, timeout=15)
        except (OSError, subprocess.SubprocessError) as error:
            raise Unavailable('kubernetes_transport_unknown') from error
        if result.returncode:
            # Do not expose stderr, manifests or per-job tokens to public RPC errors.
            raise Unavailable('kubernetes_response_unknown')
        return result.stdout

    def get_job(self, job_id):
        text = self.call(['get', 'job', 'peticao-' + job_id, '--ignore-not-found', '-o', 'json'])
        return json.loads(text) if text.strip() else None

    def create(self, manifest):
        return json.loads(self.call(['create', '-f', '-', '-o', 'json'], manifest))

    def resume(self, job_id):
        self.call(['patch', 'job', 'peticao-' + job_id, '--type=merge', '-p', '{"spec":{"suspend":false}}'])

    def delete(self, job_id):
        self.call(['delete', 'job', 'peticao-' + job_id, '--ignore-not-found', '--wait=false'])

    def get_pod(self, name):
        if not re.fullmatch('[a-z0-9][a-z0-9.-]{0,252}', name):
            raise ValueError('invalid_pod_name')
        return json.loads(self.call(['get', 'pod', name, '-o', 'json']))

    def logs(self, job_id):
        return self.call(['logs', 'job/peticao-' + job_id, '-c', 'runner', '--limit-bytes=10485760'])


class Backend:
    def __init__(self, core, api, catalog):
        self.core, self.api, self.catalog = core, api, catalog
        self.claims = Claims(core.ROOT / 'queue.sqlite')

    def payload(self, data):
        if set(data) - {'action', 'id', 'kind', 'profile', 'source_commit', 'dependencies'}:
            raise ValueError('unknown_kubernetes_submit_field')
        job_id = self.core.validate_id(data.get('id'))
        name = data.get('profile')
        profile = self.catalog.get(name)
        if data.get('kind') != KIND or name not in PROFILES or not profile or not profile['enabled']:
            raise ValueError('profile_not_qualified')
        if data.get('source_commit') != profile['source_commit']:
            raise ValueError('profile_source_commit_mismatch')
        deps = data.get('dependencies', [])
        if not isinstance(deps, list) or any(not isinstance(dep, str) for dep in deps) or len(deps) > 32 or len(set(deps)) != len(deps):
            raise ValueError('invalid_dependencies')
        current = self.core.primary()
        with self.core.connect() as db:
            for dep in deps:
                self.core.validate_id(dep)
                row = db.execute('SELECT generation FROM jobs WHERE id=?', (dep,)).fetchone()
                if dep == job_id or not row or row['generation'] != current['generation']:
                    raise ValueError('existing_same_generation_dependency_required')
        # Clients select an approved profile; commands, images and budgets are not RPC inputs.
        return {'kind': KIND, 'backend': BACKEND, 'profile': name, 'source_commit': profile['source_commit'],
                'source_manifest_sha256': profile['source_manifest_sha256'], 'image': profile['image'],
                'dependencies': sorted(deps), 'profile_sha256': sha(profile)}

    def profile(self, payload):
        profile = self.catalog.get(payload.get('profile'))
        if not profile or not profile['enabled'] or payload.get('profile_sha256') != sha(profile):
            raise ValueError('profile_changed_requires_reconciliation')
        if any(payload.get(key) != profile[key] for key in ('image', 'source_commit', 'source_manifest_sha256')):
            raise ValueError('profile_pin_mismatch')
        return profile

    def manifest(self, row, node, token):
        payload = json.loads(row['payload'])
        profile = self.profile(payload)
        identity = {'peticao.dev/managed': 'queue', 'peticao.dev/job-id': row['id']}
        annotations = {'peticao.dev/payload-sha256': row['digest'], 'peticao.dev/generation': str(row['generation']),
                       'peticao.dev/source-commit': payload['source_commit'], 'peticao.dev/profile': payload['profile']}
        resources = {'cpu': str(profile['cpu_millis']) + 'm', 'memory': str(profile['memory_mib']) + 'Mi',
                     'ephemeral-storage': str(profile['ephemeral_mib']) + 'Mi'}
        job = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': {'name': 'peticao-' + row['id'],
               'namespace': NAMESPACE, 'labels': identity, 'annotations': dict(annotations)},
               'spec': {'suspend': True, 'completions': 1, 'parallelism': 1, 'backoffLimit': 0,
                        'podReplacementPolicy': 'Failed', 'activeDeadlineSeconds': profile['timeout_seconds'],
                        'template': {'metadata': {'labels': identity, 'annotations': dict(annotations)},
                                     'spec': {'restartPolicy': 'Never', 'serviceAccountName': 'job-runner',
                                              'automountServiceAccountToken': False,
                                              'nodeSelector': {'peticao.dev/worker': node},
                                              'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001,
                                                                  'runAsGroup': 10001, 'fsGroup': 10001,
                                                                  'seccompProfile': {'type': 'RuntimeDefault'}},
                                              'containers': [{'name': 'runner', 'image': payload['image'],
                                                              'imagePullPolicy': 'IfNotPresent',
                                                              'command': ['/opt/peticao-runner/run-profile'],
                                                              'args': [payload['profile']],
                                                              'env': [{'name': 'PETICAO_JOB_ID', 'value': row['id']},
                                                                      {'name': 'PETICAO_CLAIM_TOKEN', 'value': token},
                                                                      {'name': 'PETICAO_CLAIM_URL', 'value': 'https://100.80.18.81:9444'},
                                                                      {'name': 'PETICAO_SOURCE_COMMIT', 'value': payload['source_commit']},
                                                                      {'name': 'PETICAO_SOURCE_MANIFEST_SHA256', 'value': payload['source_manifest_sha256']},
                                                                      {'name': 'POD_NAME', 'valueFrom': {'fieldRef': {'fieldPath': 'metadata.name'}}},
                                                                      {'name': 'POD_UID', 'valueFrom': {'fieldRef': {'fieldPath': 'metadata.uid'}}},
                                                                      {'name': 'NEXT_TELEMETRY_DISABLED', 'value': '1'}],
                                                              'resources': {'requests': resources, 'limits': dict(resources)},
                                                              'securityContext': {'allowPrivilegeEscalation': False,
                                                                                  'readOnlyRootFilesystem': True,
                                                                                  'capabilities': {'drop': ['ALL']}},
                                                              'volumeMounts': [{'name': 'work', 'mountPath': '/work'},
                                                                               {'name': 'tmp', 'mountPath': '/tmp'}]}],
                                              'volumes': [{'name': 'work', 'emptyDir': {'sizeLimit': str(profile['ephemeral_mib'] - 64) + 'Mi'}},
                                                          {'name': 'tmp', 'emptyDir': {'sizeLimit': '64Mi'}}]}}}}
        digest = sha(job)
        job['metadata']['annotations']['peticao.dev/manifest-sha256'] = digest
        job['spec']['template']['metadata']['annotations']['peticao.dev/manifest-sha256'] = digest
        return job, digest

    def placement(self, profile, observations, active):
        # observations are authenticated host/headroom samples, never caller-supplied RPC fields.
        if len(active) >= 4:
            return None
        heavy = sum(bool(self.profile(json.loads(r['payload']))['heavy']) for r in active)
        if profile['heavy'] and heavy >= 2:
            return None
        for name in ('local', 'santiago', 'sp'):
            sample = observations.get(name, {})
            if not sample.get('ready') or not sample.get('admission_open') or time.time() - sample.get('observed_at', 0) > 45 or sample.get('observed_at', 0) > time.time() + 5:
                continue
            running = [r for r in active if r['node'] == name]
            if name == 'sp' and (running or not sample.get('production_gate_eligible')):
                continue
            if profile['heavy'] and any(self.profile(json.loads(r['payload']))['heavy'] for r in running):
                continue
            used_cpu = sum(self.profile(json.loads(r['payload']))['cpu_millis'] for r in running)
            used_mem = sum(self.profile(json.loads(r['payload']))['memory_mib'] for r in running)
            cpu_cap = min(NODE_CEILINGS[name][0], sample.get('job_cpu_ceiling_millis', 0))
            memory_cap = min(NODE_CEILINGS[name][1], sample.get('job_memory_ceiling_mib', 0))
            if profile['cpu_millis'] + used_cpu > cpu_cap or profile['memory_mib'] + used_mem > memory_cap:
                continue
            if profile['cpu_millis'] > sample.get('free_cpu_millis', 0) or profile['memory_mib'] > sample.get('free_memory_mib', 0):
                continue
            return name
        return None

    def dispatch_once(self, observations):
        current = self.core.primary()
        # The existing single daemon's lock remains authoritative for both backends.
        with self.claims.db(True) as db:
            retained_objects = 0
            for claim in db.execute('SELECT job_id FROM kubernetes_execution_claims'):
                marker = self.core.WORKER / 'jobs' / claim['job_id'] / 'kubernetes-collected.json'
                if not marker.is_file() or not json.loads(marker.read_text()).get('cleanup_confirmed'):
                    retained_objects += 1
            if retained_objects >= 4:
                return None  # Uncollected/uncertain Jobs retain the namespace's object slots.
            active, queued = [], []
            for row in db.execute("SELECT * FROM jobs WHERE state IN ('queued','starting','running') ORDER BY created_at,id"):
                payload = json.loads(row['payload'])
                if payload.get('backend') != BACKEND:
                    if row['state'] in ACTIVE:
                        return None  # Legacy jobs conservatively retain exclusive worker use.
                    continue
                if row['state'] in ACTIVE:
                    folder = self.core.WORKER / 'jobs' / row['id'] / 'kubernetes.json'
                    if not folder.is_file():
                        return None  # Cannot infer placement from missing metadata.
                    active.append({**dict(row), 'node': json.loads(folder.read_text())['node']})
                else:
                    queued.append(row)
            valid_queued = []
            for row in queued:
                try:
                    profile = self.profile(json.loads(row['payload']))
                except ValueError:
                    self.terminal(db, row['id'], 'interrupted', 'profile_changed_requires_reconciliation')
                    continue
                valid_queued.append((profile['priority'], row))
            queued = [row for _, row in sorted(valid_queued, key=lambda pair: (-pair[0], pair[1]['created_at'], pair[1]['id']))]
            chosen = None
            for row in queued:
                payload = json.loads(row['payload'])
                if row['generation'] != current['generation']:
                    self.terminal(db, row['id'], 'interrupted', 'authority_generation_changed')
                    continue
                dep_states = [db.execute('SELECT state FROM jobs WHERE id=?', (dep,)).fetchone() for dep in payload['dependencies']]
                if any(not dep or dep['state'] in FAILED for dep in dep_states):
                    self.terminal(db, row['id'], 'failed', 'dependency_failed_or_missing')
                    continue
                if any(dep['state'] != 'completed' for dep in dep_states):
                    continue
                node = self.placement(self.profile(payload), observations, active)
                if node:
                    chosen = row
                    break
            if chosen is None:
                return None
            token = secrets.token_hex(32)
            manifest, digest = self.manifest(chosen, node, token)
            folder = self.core.WORKER / 'jobs' / chosen['id']
            # Files are staged before DB reservation; a crash leaves no executable job.
            # An unexplained existing folder is preserved and requires reconciliation.
            try:
                folder.mkdir(mode=0o2770)
            except FileExistsError:
                self.terminal(db, chosen['id'], 'interrupted', 'staged_files_require_reconciliation')
                return None
            folder.chmod(0o2770)
            self.core.atomic(folder / 'kubernetes.json', {'node': node, 'manifest_sha256': digest,
                                                        'manifest': manifest, 'generation': chosen['generation']})
            db.execute('INSERT INTO kubernetes_execution_claims(job_id,generation,manifest_sha256,token_sha256,reserved_at) VALUES(?,?,?,?,?)',
                       (chosen['id'], chosen['generation'], digest, hashlib.sha256(token.encode()).hexdigest(), self.core.stamp()))
            db.execute("UPDATE jobs SET state='starting',updated_at=? WHERE id=?", (self.core.stamp(), chosen['id']))
            self.core.event(db, chosen['id'], 'kubernetes_reserved', {'node': node, 'manifest_sha256': digest})
        try:
            observed = self.api.create(manifest)
            self.bind_and_resume(chosen, observed, digest)
        except Unavailable:
            with self.core.connect() as db:
                db.execute("UPDATE jobs SET error='kubernetes_create_or_resume_uncertain' WHERE id=?", (chosen['id'],))
                self.core.event(db, chosen['id'], 'kubernetes_observation_uncertain', {})
        return chosen['id']

    def terminal(self, db, job_id, state, error=None, exit_code=None):
        db.execute('UPDATE jobs SET state=?,error=?,exit_code=?,finished_at=?,updated_at=? WHERE id=?',
                   (state, error, exit_code, self.core.stamp(), self.core.stamp(), job_id))
        self.core.event(db, job_id, state, {'error': error, 'exit_code': exit_code, 'backend': BACKEND})

    def bind_and_resume(self, row, observed, digest):
        metadata = observed.get('metadata', {})
        annotations = metadata.get('annotations', {})
        if metadata.get('name') != 'peticao-' + row['id'] or metadata.get('namespace') != NAMESPACE or annotations.get('peticao.dev/manifest-sha256') != digest or annotations.get('peticao.dev/payload-sha256') != row['digest'] or annotations.get('peticao.dev/generation') != str(row['generation']):
            raise ValueError('observed_job_identity_mismatch')
        self.claims.bind_job(row['id'], row['generation'], digest, metadata['uid'])
        claim = self.claims.status(row['id'])
        if not claim['cancel_requested_at'] and not claim['finished_at'] and observed.get('spec', {}).get('suspend'):
            self.api.resume(row['id'])

    def reconcile(self):
        current = self.core.primary()
        with self.core.connect() as db:
            rows = db.execute("SELECT * FROM jobs WHERE state IN ('starting','running')").fetchall()
        for row in rows:
            if json.loads(row['payload']).get('backend') != BACKEND:
                continue
            if row['generation'] != current['generation']:
                continue  # An explicit operator reconciliation is required after authority change.
            try:
                observed = self.api.get_job(row['id'])
                claim = self.claims.status(row['id'])
                if observed is None:
                    # Even proved absence never creates a replacement automatically.
                    with self.core.connect() as db:
                        db.execute("UPDATE jobs SET error='kubernetes_absent_requires_reconciliation' WHERE id=?", (row['id'],))
                    continue
                self.bind_and_resume(row, observed, claim['manifest_sha256'])
                conditions = observed.get('status', {}).get('conditions', [])
                terminal = next((c['type'] for c in conditions if c.get('status') == 'True' and c.get('type') in ('Complete', 'Failed')), None)
                if terminal:
                    # Logs are retained before job removal; transport loss keeps the same ID uncertain.
                    output = self.api.logs(row['id'])
                    folder = self.core.WORKER / 'jobs' / row['id']
                    private = json.loads((folder / 'kubernetes.json').read_text())
                    token = next(e['value'] for e in private['manifest']['spec']['template']['spec']['containers'][0]['env'] if e['name'] == 'PETICAO_CLAIM_TOKEN')
                    output = self.core.sanitize(output.replace(token, '[redacted]'))
                    (folder / 'output.log').write_text(output)
                    with self.core.connect() as db:
                        if claim['cancel_requested_at']:
                            self.terminal(db, row['id'], 'canceled')
                        elif terminal == 'Complete' and claim['finished_at'] and claim['result_sha256']:
                            receipt = kubernetes_results.verify(folder, claim['result_sha256'])
                            if receipt['exit_code'] != 0:
                                raise ValueError('job_success_and_receipt_exit_conflict')
                            self.terminal(db, row['id'], 'completed', exit_code=0)
                        elif terminal == 'Failed':
                            exit_code = None
                            if claim['result_sha256']:
                                exit_code = kubernetes_results.verify(folder, claim['result_sha256'])['exit_code']
                            self.terminal(db, row['id'], 'failed', 'kubernetes_job_failed', exit_code=exit_code)
                        else:
                            self.terminal(db, row['id'], 'interrupted', 'missing_execution_receipt')
                    # cleanup_collected checks local receipts before releasing quota.
                elif claim['started_at']:
                    with self.core.connect() as db:
                        db.execute("UPDATE jobs SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?", (claim['started_at'], self.core.stamp(), row['id']))
            except Unavailable:
                # No local PID inference and no replacement on network/API observation loss.
                continue
        self.cleanup_collected()

    def cleanup_collected(self):
        """Release quota only after a terminal controller observation and local receipts."""
        self.core.primary()
        with self.core.connect() as db:
            rows = db.execute("SELECT * FROM jobs WHERE state IN ('completed','failed','canceled','interrupted') ORDER BY updated_at DESC LIMIT 200").fetchall()
        for row in rows:
            if json.loads(row['payload']).get('backend') != BACKEND:
                continue
            folder = self.core.WORKER / 'jobs' / row['id']
            claim = self.claims.status(row['id'])
            if not claim or not (folder / 'output.log').is_file():
                continue
            if not claim['result_sha256']:
                continue  # Preserve failed/uncertain pod storage until complete collection/reconciliation.
            marker = folder / 'kubernetes-collected.json'
            if marker.is_file() and json.loads(marker.read_text()).get('cleanup_confirmed'):
                continue
            receipt = {'id': row['id'], 'job_uid': claim['job_uid'], 'cleanup_confirmed': False,
                       'log_sha256': hashlib.sha256((folder / 'output.log').read_bytes()).hexdigest(),
                       'result_sha256': claim['result_sha256']}
            if claim['result_sha256']:
                kubernetes_results.verify(folder, claim['result_sha256'])
            try:
                observed = self.api.get_job(row['id'])
                if observed is None:
                    receipt['cleanup_confirmed'] = True
                else:
                    if observed.get('metadata', {}).get('uid') != claim['job_uid']:
                        raise ValueError('cleanup_job_uid_mismatch')
                    conditions = observed.get('status', {}).get('conditions', [])
                    if not any(c.get('type') in ('Complete', 'Failed') and c.get('status') == 'True' for c in conditions):
                        continue
                    # K8s 1.37 terminal Job conditions are emitted after pods terminate.
                    self.api.delete(row['id'])
                self.core.atomic(marker, receipt)
            except Unavailable:
                continue

    def cancel(self, row):
        self.core.primary()
        self.claims.cancel(row['id'])  # Commit denial of new execution BEFORE deleting K8s objects.
        with self.core.connect() as db:
            db.execute("UPDATE jobs SET error='cancel_requested' WHERE id=?", (row['id'],))
            self.core.event(db, row['id'], 'cancel_requested', {'backend': BACKEND})
        try:
            self.api.delete(row['id'])
        except Unavailable:
            return {'id': row['id'], 'state': 'cancel_requested', 'observation': 'unknown'}
        # A DELETE response alone does not prove that a disconnected pod has stopped.
        return {'id': row['id'], 'state': 'cancel_requested', 'observation': 'reconcile_required'}

    def attest_execution(self, job_id, pod_name, pod_uid, token):
        current = self.core.primary()
        with self.core.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (self.core.validate_id(job_id),)).fetchone()
        if not row or row['generation'] != current['generation']:
            raise PermissionError('current_authority_job_required')
        with self.claims.db() as db:
            claim = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
        if not claim or not isinstance(token, str) or not hmac.compare_digest(claim['token_sha256'], hashlib.sha256(token.encode()).hexdigest()):
            raise PermissionError('invalid_execution_token')
        pod = self.api.get_pod(pod_name)
        metadata, spec = pod.get('metadata', {}), pod.get('spec', {})
        owners = metadata.get('ownerReferences', [])
        payload = json.loads(row['payload'])
        if metadata.get('uid') != pod_uid or metadata.get('namespace') != NAMESPACE or metadata.get('labels', {}).get('peticao.dev/job-id') != job_id or not any(o.get('controller') is True and o.get('kind') == 'Job' and o.get('uid') == claim['job_uid'] for o in owners):
            raise PermissionError('actual_pod_owner_attestation_failed')
        containers = spec.get('containers', [])
        if len(containers) != 1 or containers[0].get('image') != payload['image'] or spec.get('serviceAccountName') != 'job-runner':
            raise PermissionError('actual_pod_profile_attestation_failed')
        return row, claim

    def authorize_start(self, job_id, pod_name, pod_uid, token):
        row, claim = self.attest_execution(job_id, pod_name, pod_uid, token)
        return self.claims.start_once(job_id, row['generation'], token, claim['job_uid'], pod_uid)

    def complete_execution(self, job_id, pod_name, pod_uid, token, exit_code, technical_result, artifacts):
        row, claim = self.attest_execution(job_id, pod_name, pod_uid, token)
        if not claim['started_at'] or claim['pod_uid'] != pod_uid:
            raise PermissionError('only_started_pod_can_complete')
        payload = json.loads(row['payload'])
        identity = {'id': job_id, 'backend': BACKEND, 'profile': payload['profile'],
                    'source_commit': payload['source_commit'], 'image': payload['image'],
                    'source_manifest_sha256': payload['source_manifest_sha256'],
                    'generation': row['generation'], 'pod_uid': pod_uid}
        folder = self.core.WORKER / 'jobs' / job_id

        def resolve_upload(upload_id, path, digest):
            if payload['profile'] != 'build':
                raise PermissionError('runtime_artifact_only_for_build_profile')
            return runtime_upload.resolve(folder, job_id, pod_uid, upload_id, path, digest)

        receipt, digest = kubernetes_results.store(folder, identity, exit_code, technical_result, artifacts,
                                                  staged_resolver=resolve_upload)
        self.claims.finish(job_id, pod_uid, digest)
        return {'id': job_id, 'result_sha256': digest, 'artifacts': receipt['artifacts']}

    def upload_runtime_chunk(self, job_id, pod_name, pod_uid, token, data):
        row, claim = self.attest_execution(job_id, pod_name, pod_uid, token)
        if json.loads(row['payload'])['profile'] != 'build' or not claim['started_at'] or claim['pod_uid'] != pod_uid:
            raise PermissionError('started_build_pod_required')
        return runtime_upload.chunk(self.core.WORKER / 'jobs' / job_id, job_id, pod_uid, data)

    def execution_receipt(self, job_id, pod_uid, token):
        # Read-only reconciliation remains possible after the Pod was collected.
        self.core.validate_id(job_id)
        with self.claims.db() as db:
            claim = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            row = db.execute('SELECT state FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not claim or not row or not isinstance(token, str) or not hmac.compare_digest(claim['token_sha256'], hashlib.sha256(token.encode()).hexdigest()) or (claim['pod_uid'] and claim['pod_uid'] != pod_uid):
            raise PermissionError('receipt_identity_denied')
        result = None
        if claim['result_sha256']:
            result = kubernetes_results.verify(self.core.WORKER / 'jobs' / job_id, claim['result_sha256'])
        return {'id': job_id, 'state': row['state'], 'started': bool(claim['started_at']),
                'finished': bool(claim['finished_at']), 'result_sha256': claim['result_sha256'],
                'result': result, 'execution_authorized': False}
