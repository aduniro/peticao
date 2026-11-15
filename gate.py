"""Existing canonical ledger gates, no new coordinator or authorization channel."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

import reconcile as core

ROOT = Path(__file__).resolve().parent
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'


def central(args):
    p = subprocess.run(['/usr/bin/python3', COORD, *args], capture_output=True, text=True, timeout=30)
    value = json.loads(p.stdout)
    if p.returncode or value.get('ok') is not True:
        raise PermissionError('canonical_ledger_refused')
    return value['result']


def event(seq):
    if type(seq) is not int or seq < 1:
        raise ValueError('canonical_event_required')
    value = central(['history', '--after-seq', str(seq - 1), '--limit', '1'])[0]
    if value['seq'] != seq:
        raise PermissionError('event_not_found')
    return value


def ack(seq):
    cursor, found = seq, False
    while True:
        events = central(['history', '--after-seq', str(cursor), '--limit', '200'])
        if not events:
            break
        found |= any(e['kind'] == 'ack' and e['actor'] == 'apoio' and e['data'].get('event_seq') == seq for e in events)
        cursor = events[-1]['seq']
        if len(events) < 200:
            break
    if not found:
        raise PermissionError('independent_apoio_ack_required')


def source_hashes():
    names = subprocess.check_output(['/usr/bin/git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    result = {}
    for name in filter(None, names):
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise PermissionError('regular_frozen_source_required')
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def reviewed(seq):
    value = event(seq); data = value['data']
    if value['kind'] != 'notice' or value['actor'] != 'admin-recuperacao' or value['resources'] != [core.RESOURCE]:
        raise PermissionError('infra_exact_execution_notice_required')
    git = lambda *args: subprocess.check_output(['/usr/bin/git', '-C', str(ROOT), *args], text=True).strip()
    if git('status', '--porcelain') or data['manifest']['commit'] != git('rev-parse', 'HEAD') or data['file_sha256'] != source_hashes():
        raise PermissionError('frozen_source_changed')
    if data.get('operation') != 'test' or any(data.get(k) is not False for k in ('preparation_only', 'queue_cutover', 'production_access')) or data.get('operator_session') != core.SESSION:
        raise PermissionError('isolated_reconciliation_scope_required')
    op = data['reconciliation_operation']; pins = json.loads((ROOT / 'SOURCE-PINS.json').read_text())
    if type(op) is not dict or set(op) != {'operation_id', 'execute', 'original_execution_event', 'original_request_sha256'} or op['execute'] is not True or op['original_execution_event'] != 3151 or op['original_request_sha256'] != pins['original_request_sha256']:
        raise PermissionError('exact_original_execution_pin_required')
    original = event(3151)
    if original['kind'] != 'notice' or original['actor'] != 'admin-recuperacao' or core.digest(original['data']['qualification_operation']) != pins['original_request_sha256']:
        raise PermissionError('original_notice_pin_changed')
    ack(3151); ack(seq)
    return data


def lease(path, seq):
    path = Path(path); info = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16384 or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PermissionError('private_own_capability_required')
    record = json.loads(path.read_text())
    if record.get('operator_session') != core.SESSION:
        raise PermissionError('own_infra_session_required')
    cap = record['result']
    central(['check', '--actor', 'admin-recuperacao', '--lease', cap['lease'], '--token', cap['token'], '--fence', str(cap['fence'])])
    current = next(v for v in central(['status'])['leases'] if v['id'] == cap['lease'])
    if current['actor'] != 'admin-recuperacao' or current['operation'] != 'test' or set(current['resources']) != {core.RESOURCE} or current['expires'] - time.time() < 195:
        raise PermissionError('exact_own_test_lease_and_margin_required')
    acquisition = event(cap['seq'])
    if acquisition['kind'] != 'lease_acquired' or acquisition['actor'] != 'admin-recuperacao' or acquisition['data'].get('manifest_event') != seq or acquisition['data'].get('lease') != cap['lease']:
        raise PermissionError('own_lease_not_bound_to_notice')
    return cap['fence']


class Gate:
    def __init__(self, seq, capability):
        self.seq, self.capability = seq, capability

    def __call__(self, phase):
        if phase not in {'install', 'preflight', 'cleanup'}:
            raise ValueError('fixed_phase_required')
        data = reviewed(self.seq); fence = lease(self.capability, self.seq)
        auth = core.authorization({'operation_id': data['reconciliation_operation']['operation_id'], 'event': self.seq,
                                   'operation': 'test', 'resource': core.RESOURCE, 'session': core.SESSION, 'fence': fence, 'reviewed': True})
        return {'authorization': auth, 'execute': True,
                'code_sha256': {name: data['file_sha256'][name] for name in ('host.py', 'reconcile.py', 'SOURCE-PINS.json')}}
