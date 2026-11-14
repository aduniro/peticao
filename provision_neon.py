"""Create only the reviewed, isolated Free Neon project. No app env changes.

Default is read-only inspection. Apply/rollback require an actual critical
lease and immutable manifest; the script cannot acquire or fabricate ACKs.
All CLI output is private. No database URL or API key enters command arguments.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

BASE = Path(__file__).resolve().parent
CLI = '/mnt/apps/peticao-final/.tools/neon/node_modules/.bin/neon'
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
ORG = 'org-fragrant-dawn-99551288'
NAME = 'peticao-infra'
REGION = 'aws-us-east-1'
RECEIPT = BASE / 'NEON-RECEIPT.private.json'
INTENT = BASE / 'NEON-INTENT.private.json'


def save(path, value):
    path = Path(path)
    raw = json.dumps(value, indent=2)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    tmp = Path(temporary)
    try:
        with os.fdopen(fd, 'w') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        tmp.replace(path)
        sync_directory(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def sync_directory(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_exclusive(path, value):
    # An interrupted/partial journal remains evidence and blocks another POST.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(json.dumps(value, indent=2))
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(Path(path).parent)


def run(args):
    result = subprocess.run([CLI, *args, '--profile', 'peticao-coordenacao',
                             '--output', 'json', '--no-color', '--no-analytics'],
                            capture_output=True, text=True, timeout=180)
    label = hashlib.sha256(json.dumps(args).encode()).hexdigest()[:16]
    save(BASE / ('neon-command-' + label + '.private.json'),
         {'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    if result.returncode:
        raise RuntimeError('Neon CLI failed; private command log ' + label)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def projects():
    result, seen, cursor = [], set(), None
    for _ in range(100):
        args = ['api', '/projects', '-Q', 'org_id=' + ORG, '-Q', 'limit=100']
        if cursor:
            args += ['-Q', 'cursor=' + cursor]
        page = run(args)
        if page.get('unavailable'):
            raise RuntimeError('Incomplete project listing; do not create')
        batch = page.get('projects')
        if not isinstance(batch, list):
            raise RuntimeError('Unexpected project listing')
        result.extend(batch)
        if not batch:
            return result
        cursor = page.get('pagination', {}).get('cursor')
        if not cursor:
            return result
        if cursor in seen:
            raise RuntimeError('Repeated pagination cursor; do not create')
        seen.add(cursor)
    raise RuntimeError('Project pagination limit; do not create')


def select(rows):
    matches = [p for p in rows if p.get('name') == NAME]
    if len(matches) > 1:
        raise RuntimeError('Duplicate project names; reconcile before any write')
    if not matches:
        return None
    p = matches[0]
    if p.get('region_id') != REGION or p.get('org_id', p.get('owner_id')) != ORG:
        raise RuntimeError('Project name belongs to another region/org')
    if p.get('pg_version') != 17:
        raise RuntimeError('Unexpected Postgres version; never change existing data')
    return p


def check_lease(path, manifest_event):
    private = json.loads(Path(path).read_text())
    lease = private.get('result', private)
    command = ['python3', COORD, 'check', '--actor', 'admin-recuperacao',
               '--lease', lease['lease'], '--token', lease['token'],
               '--fence', str(lease['fence'])]
    answer = json.loads(subprocess.check_output(command))
    if not answer.get('ok'):
        raise RuntimeError('Lease rejected')
    status = json.loads(subprocess.check_output(['python3', COORD, 'status']))['result']
    actual = next((x for x in status['leases'] if x['id'] == lease['lease']), None)
    if not actual or actual['operation'] != 'deploy' or actual['state'] != 'active':
        raise RuntimeError('A real critical deploy lease is required; edit is insufficient')
    if 'deploy:peticao-infra-cloud-us' not in actual['resources']:
        raise RuntimeError('Wrong critical resource')
    event = json.loads(subprocess.check_output(['python3', COORD, 'history',
                       '--after-seq', str(lease['seq'] - 1), '--limit', '1']))['result'][0]
    if event['data'].get('manifest_event') != manifest_event:
        raise RuntimeError('Critical lease references another manifest')
    notice = json.loads(subprocess.check_output(['python3', COORD, 'history',
                        '--after-seq', str(manifest_event - 1), '--limit', '1']))['result'][0]
    if notice.get('seq') != manifest_event or notice.get('kind') != 'notice':
        raise RuntimeError('Reviewed immutable manifest notice not found')
    head = subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True).strip()
    verify_source_pin(notice, head)


def verify_source_pin(notice, head):
    data = notice.get('data', {})
    manifest = data.get('manifest', {})
    hashes = data.get('file_sha256', {})
    files = manifest.get('files', [])
    required = {'provision_neon.py', 'test_provision_neon.py', 'NEON-PROCEDURE.md',
                'budget_policy.py', 'test_budget_policy.py', 'WORKER-PROFILES.json'}
    if manifest.get('commit') != head or not required.issubset(files):
        raise RuntimeError('Working source or procedure differs from reviewed manifest')
    for name in files:
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise RuntimeError('Unsafe manifest source path')
        target = BASE / path
        if target.is_symlink() or not target.is_file():
            raise RuntimeError('Reviewed source file is missing or a symlink')
        if hashlib.sha256(target.read_bytes()).hexdigest() != hashes.get(name):
            raise RuntimeError('Reviewed file hash drift: ' + name)


def verify_ownership(project):
    if RECEIPT.exists():
        receipt = json.loads(RECEIPT.read_text())
        if receipt.get('project_id') != project['id'] or receipt.get('creation_response_bound') is not True:
            raise RuntimeError('Project differs from owned receipt')
        return
    raise RuntimeError('Missing ID from create response; never adopt by name/timestamp; explicit reconciliation required')


def endpoints(pid):
    value = run(['api', '/projects/' + pid + '/endpoints'])
    rows = value.get('endpoints', [])
    if len(rows) != 1:
        raise RuntimeError('Expected one isolated initial compute')
    return rows


def ensure_free_plan():
    organization = run(['api', '/organizations/' + ORG])
    if organization.get('id') != ORG or organization.get('plan') != 'free':
        raise RuntimeError('Expected the verified Free organization; no paid creation')


def verify_compute_ownership(compute):
    receipt = json.loads(RECEIPT.read_text())
    if receipt.get('endpoint_id') != compute['id'] or receipt.get('branch_id') != compute['branch_id']:
        raise RuntimeError('Compute/branch changed or was never pinned; explicit reconciliation required')


def verify_auxiliary_services(pid, branch_id):
    # CLI9.5.0 config_format.js30/31 and53: absent toggles/functions in a
    # successfully inspected live config mean off. Empty/foreign envelopes do not.
    status = run(['status', '--project-id', pid, '--branch', branch_id])
    if (status.get('project', {}).get('id') != pid or
            status.get('branch', {}).get('id') != branch_id or
            not isinstance(status.get('config'), dict)):
        raise RuntimeError('Missing or wrong live status identity/config envelope')
    view = status['config']
    if view.get('auth') not in [None, False] or view.get('dataApi') not in [None, False]:
        raise RuntimeError('Auth/Data API unexpectedly enabled; preserve and stop')
    if view.get('preview', {}).get('functions'):
        raise RuntimeError('Unexpected function; preserve and stop')
    realtime = run(['api', '/projects/' + pid + '/branches/' + branch_id + '/realtime'])
    if realtime.get('enabled') is not False:
        raise RuntimeError('Realtime disabled state not proven; preserve and reconcile')
    gateway = run(['api', '/projects/' + pid + '/branches/' + branch_id + '/ai_gateway'])
    return {'auth': 'disabled_in_live_config', 'data_api': 'disabled_in_live_config',
            'functions': 'none_in_live_config', 'realtime': 'disabled_verified',
            'ai_gateway': {'availability_checked': True, 'invoke_calls': 0,
                           'credentials_created': 0,
                           'note': 'Availability URL is not paid activation; no model is invoked.'}}


def apply(project, gate):
    ensure_free_plan()
    created_now = project is None
    if project is None:
        if INTENT.exists():
            raise RuntimeError('Prior uncertain create; reconcile provider operations, never retry blindly')
        gate()
        save_exclusive(INTENT, {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                      'absent_before_create': True, 'name': NAME, 'org': ORG, 'region': REGION})
        # Capture privately even with --no-secrets. No context or app env is set.
        created = run(['projects', 'create', '--org-id', ORG, '--name', NAME, '--region-id', REGION,
             '--pg-version', '17', '--cu', '0.25', '--database', 'infra',
             '--role', 'infra_owner', '--no-secrets'])
        created_project = select([created.get('project', {})])
        if created_project is None or not created_project.get('id'):
            raise RuntimeError('Create response has no validated project ID; explicit reconciliation required')
        save(RECEIPT, {'project_id': created_project['id'], 'creation_response_bound': True,
                       'created_by_owned_intent': True})
        project = select(projects())
        if project is None:
            raise RuntimeError('Create not reconciled; preserve intent and stop')
    verify_ownership(project)
    pid = project['id']
    compute = endpoints(pid)[0]
    if not created_now:
        verify_compute_ownership(compute)
    for key in ['autoscaling_limit_min_cu', 'autoscaling_limit_max_cu']:
        if compute.get(key) != 0.25:
            raise RuntimeError('Unexpected CU sizing; preserve project and stop')
    # Free has fixed five-minute suspension; API value0 means plan default300.
    if compute.get('suspend_timeout_seconds') not in [0, 300]:
        raise RuntimeError('Suspension disabled or unexpected; preserve and stop')
    save(RECEIPT, {'project_id': pid, 'branch_id': compute['branch_id'],
                  'endpoint_id': compute['id'], 'created_by_owned_intent': True,
                  'creation_response_bound': True,
                  'region': REGION, 'compute_cu': 0.25,
                  'suspend_api_seconds': compute['suspend_timeout_seconds'],
                  'effective_free_suspend_seconds': 300,
                  'app_env_changed': False, 'production_database_changed': False})
    args = ['--project-id', pid, '--branch', compute['branch_id']]
    buckets = run(['bucket', 'list', *args])
    rows = buckets if isinstance(buckets, list) else buckets.get('buckets', [])
    matches = [x for x in rows if x.get('name') == 'infra-artefatos']
    if not matches:
        gate()
        run(['bucket', 'create', 'infra-artefatos', '--access-level', 'private', *args])
        buckets = run(['bucket', 'list', *args])
        rows = buckets if isinstance(buckets, list) else buckets.get('buckets', [])
        matches = [x for x in rows if x.get('name') == 'infra-artefatos']
    if len(matches) != 1 or matches[0].get('access_level') != 'private':
        raise RuntimeError('Bucket privacy not verified; stop without deleting data')
    ancillary = verify_auxiliary_services(pid, compute['branch_id'])
    return {'project_id': pid, 'bucket_private_verified': True,
            'auxiliary_services': ancillary,
            'compute_fixed_cu': 0.25, 'operational_ready': False,
            'pending': ['SQL smoke and storage roundtrip', 'autosuspend observation',
                        'explicit internal consumers after Admin-stage gate']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback-suspend', action='store_true')
    parser.add_argument('--critical-lease-file')
    parser.add_argument('--manifest-event', type=int)
    args = parser.parse_args()
    os.umask(0o077)
    with open(BASE / '.neon-operation.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.apply and args.rollback_suspend:
            raise RuntimeError('Choose one operation')
        if args.apply or args.rollback_suspend:
            if not args.critical_lease_file or not args.manifest_event:
                raise RuntimeError('Critical lease and reviewed manifest required')
            gate = lambda: check_lease(args.critical_lease_file, args.manifest_event)
            gate()
        project = select(projects())
        if args.rollback_suspend:
            if project is None or not RECEIPT.exists():
                raise RuntimeError('No owned project to suspend')
            verify_ownership(project)
            for endpoint in endpoints(project['id']):
                verify_compute_ownership(endpoint)
                gate()
                run(['postgres', 'computes', 'update', endpoint['id'], '--project-id',
                     project['id'], '--disabled', '--wait'])
            result = {'rolled_back_to_suspended': True, 'data_preserved': True,
                      'project_id': project['id'], 'deleted_anything': False}
        elif args.apply:
            result = apply(project, gate)
        else:
            ensure_free_plan()
            result = {'read_only': True, 'target_exists': project is not None,
                      'project_id': project['id'] if project else None,
                      'region': REGION, 'gpu': False, 'no_resources_created': True}
        save(BASE / 'NEON-RESULT.json', result)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
