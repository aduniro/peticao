"""Compose into SourceA only after full source/dependency review. No host I/O."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

import qualification_contract as q

ROOT = Path(__file__).resolve().parent
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
SESSION = '01a1d130-2948-7140-bcfb-34696b20ab8d'
RESOURCE = 'deploy:civo-worker-broker-qualification'
RUNTIME_NOTICE = 3178
RUNTIME_COMMIT = '4e15b7e5d069272a82aaf15bdb192e400e891f95'
BROKER_NOTICE = 3237
BROKER_COMMIT = '0676c096561a51266fd2ece7ff538afadddc6d7e'
INSTALL_INTENT = '/opt/.peticao-dev-worker-broker-qual-20261115-attempt1.install-intent.json'


def central(args):
    r = subprocess.run(['/usr/bin/python3', COORD, *args], capture_output=True, text=True, timeout=30)
    if r.returncode:
        raise PermissionError('canonical_ledger_rejected_operation')
    value = json.loads(r.stdout)
    if value.get('ok') is not True:
        raise PermissionError('canonical_ledger_rejected_operation')
    return value['result']


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(ROOT), *args], text=True).strip()


def source_hashes():
    result = {}
    for name in git('ls-files', '-z').split('\0'):
        if not name:
            continue
        p = ROOT/name
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('tracked_source_path_required')
        for item in (p, *p.parents):
            if item.is_symlink():
                raise PermissionError('source_symlink_forbidden')
        i = p.lstat()
        if not stat.S_ISREG(i.st_mode) or i.st_nlink != 1 or i.st_size > 2*1024*1024:
            raise PermissionError('regular_bounded_source_required')
        result[name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return result


def notice(event, actor):
    if type(event) is not int or event < 1:
        raise ValueError('canonical_notice_id_required')
    rows = central(['history', '--after-seq', str(event-1), '--limit', '1'])
    if not rows or rows[0]['seq'] != event or rows[0]['kind'] != 'notice' or rows[0]['actor'] != actor:
        raise PermissionError('expected_canonical_notice_author_required')
    return rows[0]


def ack(event, actor):
    cursor, found = event, False
    while True:
        rows = central(['history', '--after-seq', str(cursor), '--limit', '200'])
        if not rows:
            break
        found |= any(r['kind'] == 'ack' and r['actor'] == actor and r['data'].get('event_seq') == event for r in rows)
        if rows[-1]['seq'] <= cursor:
            raise PermissionError('monotonic_ledger_history_required')
        cursor = rows[-1]['seq']
        if len(rows) < 200:
            break
    if not found:
        raise PermissionError('independent_canonical_ack_required')


def active_notices(events):
    status = central(['status'])
    for item in status['notice_dispositions']:
        if item['target_event'] in events:
            raise PermissionError('disposed_source_or_execution_notice_forbidden')


def reviewed(event):
    if git('status', '--porcelain'):
        raise PermissionError('reviewed_source_has_changes')
    n = notice(event, 'admin-recuperacao')
    d = n['data']
    if (n['resources'] != [RESOURCE] or d.get('operation') != 'test'
            or d.get('preparation_only') is not False or d.get('production_access') is not False
            or d.get('queue_cutover') is not False or d.get('operator_session') != SESSION
            or d.get('install_intent_path') != INSTALL_INTENT):
        raise PermissionError('isolated_session_bound_test_notice_required')
    hashes = source_hashes()
    if d['manifest']['commit'] != git('rev-parse', 'HEAD') or d['file_sha256'] != hashes:
        raise PermissionError('execution_source_closure_mismatch')
    source = notice(d['source_notice'], 'apoio')
    if (source['data'].get('preparation_only') is not True
            or source['data']['manifest']['commit'] != d['manifest']['commit']
            or source['data']['file_sha256'] != hashes):
        raise PermissionError('reviewed_sourceA_preparation_required')
    ack(d['source_notice'], 'admin-recuperacao')
    if d['runtime_notice'] != RUNTIME_NOTICE or d['broker_notice'] != BROKER_NOTICE:
        raise PermissionError('required_runtime_and_broker_version_required')
    runtime, broker = notice(RUNTIME_NOTICE, 'admin-recuperacao'), notice(BROKER_NOTICE, 'admin-recuperacao')
    request = q.operation(d['qualification_operation'], execution=True)
    raw_template = (ROOT/'OPERATION.template.json').read_bytes()
    if hashes.get('OPERATION.template.json') != hashlib.sha256(raw_template).hexdigest():
        raise PermissionError('tracked_reviewed_operation_template_required')
    template = q.operation(json.loads(raw_template), execution=False)
    if (template['execute'] is not False or request['systemd_major'] != template['systemd_major']
            or request['systemd_version_sha256'] != template['systemd_version_sha256']):
        raise PermissionError('frozen_host_version_template_pin_required')
    if (request['runtime_commit'] != RUNTIME_COMMIT or request['broker_commit'] != BROKER_COMMIT
            or runtime['data']['manifest']['commit'] != RUNTIME_COMMIT
            or broker['data']['manifest']['commit'] != BROKER_COMMIT):
        raise PermissionError('required_runtime_and_broker_commit_required')
    for field, prefix, upstream, upstream_prefix in (
        ('runtime_sha256', 'runtime/', runtime, ''),
        ('broker_sha256', 'broker/', broker, ''),
        ('harness_sha256', '', source, ''),
    ):
        for name, sha in request[field].items():
            if hashes.get(prefix+name) != sha or upstream['data']['file_sha256'].get(upstream_prefix+name) != sha:
                raise PermissionError('public_package_reviewed_hash_mismatch')
    ack(RUNTIME_NOTICE, 'apoio'); ack(BROKER_NOTICE, 'apoio'); ack(event, 'apoio')
    active_notices({event, d['source_notice'], RUNTIME_NOTICE, BROKER_NOTICE})
    return d


def validate_lease(path, event, budget):
    path = Path(path)
    if not path.is_absolute():
        raise PermissionError('absolute_own_capability_path_required')
    for item in (path, *path.parents):
        if item.is_symlink():
            raise PermissionError('own_capability_symlink_forbidden')
    i = path.lstat()
    if not stat.S_ISREG(i.st_mode) or i.st_uid != os.getuid() or i.st_nlink != 1 or i.st_mode & 0o077 or i.st_size > 16384:
        raise PermissionError('private_regular_own_capability_required')
    record = json.loads(path.read_text())
    if record.get('operator_session') != SESSION:
        raise PermissionError('infra_session_owned_capability_required')
    cap = record['result']
    checked = central(['check', '--actor', 'admin-recuperacao', '--lease', cap['lease'], '--token', cap['token'], '--fence', str(cap['fence'])])
    if checked.get('valid') is not True:
        raise PermissionError('canonical_capability_check_rejected')
    status = central(['status'])
    matches = [l for l in status['leases'] if l['id'] == cap['lease']]
    if len(matches) != 1:
        raise PermissionError('canonical_own_active_reservation_required')
    lease = matches[0]
    if (lease['actor'] != 'admin-recuperacao' or lease['operation'] != 'test' or lease['state'] != 'active'
            or set(lease['resources']) != {RESOURCE} or lease['fence'] != cap['fence']
            or lease['expires'] - time.time() < budget + 120):
        raise PermissionError('exact_active_test_resource_and_margin_required')
    rows = central(['history', '--after-seq', str(cap['seq']-1), '--limit', '1'])
    if (not rows or rows[0]['seq'] != cap['seq'] or rows[0]['kind'] != 'lease_acquired'
            or rows[0]['actor'] != 'admin-recuperacao'
            or rows[0]['data'].get('manifest_event') != event
            or rows[0]['data'].get('lease') != cap['lease']):
        raise PermissionError('capability_not_bound_to_execution_notice')
    return {'session': SESSION, 'manifest_event': event, 'fence': cap['fence']}


class Gate:
    def __init__(self, event, capability_file):
        self.event, self.capability_file = event, Path(capability_file)

    def __call__(self, phase):
        if phase not in {'install', 'preflight', 'bootstrap', 'start', 'observe', 'cleanup'}:
            raise PermissionError('fixed_qualification_phase_required')
        d = reviewed(self.event)
        lease = validate_lease(self.capability_file, self.event, 600 if phase == 'start' else 75)
        return {'qualification_operation': d['qualification_operation'], 'capability': lease}
