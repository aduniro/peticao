#!/usr/bin/env python3
"""Reviewed, lease-bound installation of inert legacy coordinator code on Civo."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parent
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
SESSION = '01a1d130-2948-7140-bcfb-34696b20ab8d'
RESOURCE = 'deploy:civo-development-coordinator-standby'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def central(args):
    p = subprocess.run(['python3', COORD, *args], capture_output=True, text=True, timeout=30)
    result = json.loads(p.stdout)
    if p.returncode or not result.get('ok'):
        raise PermissionError('canonical ledger rejected operation')
    return result['result']


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def source_hashes():
    files = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    result = {}
    for name in filter(None, files):
        p = ROOT / name
        if p.is_symlink() or not p.is_file():
            raise ValueError('source must contain regular files only')
        result[name] = sha(p.read_bytes())
    return result


def packet():
    if git('status', '--porcelain'):
        raise ValueError('freeze source before preparing packet')
    files = {p.name: p.read_bytes() for p in (ROOT / 'runtime').glob('*.py')}
    unit = (ROOT / 'standby.service').read_bytes()
    return {'commit': git('rev-parse', 'HEAD'), 'operator_sha256': sha((ROOT / 'operator.py').read_bytes()),
            'runtime': {name: base64.b64encode(data).decode() for name, data in files.items()},
            'unit': base64.b64encode(unit).decode(),
            'hashes': {**{name: sha(data) for name, data in files.items()}, 'standby.service': sha(unit)}}


def validate_lease(path, manifest_event, operation='deploy'):
    info = path.lstat()
    if path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PermissionError('private own lease file required')
    record = json.loads(path.read_text())
    if record.get('operator_session') != SESSION:
        raise PermissionError('Infra session-owned capability required')
    cap = record['result']
    central(['check', '--actor', 'admin-recuperacao', '--lease', cap['lease'], '--token', cap['token'], '--fence', str(cap['fence'])])
    status = central(['status'])
    lease = next(x for x in status['leases'] if x['id'] == cap['lease'])
    if lease['actor'] != 'admin-recuperacao' or lease['operation'] != operation or RESOURCE not in lease['resources'] or lease['expires'] - time.time() < 180:
        raise PermissionError('exact own deploy reservation and time margin required')
    acquisition = central(['history', '--after-seq', str(cap['seq'] - 1), '--limit', '1'])[0]
    if acquisition['kind'] != 'lease_acquired' or acquisition['data'].get('manifest_event') != manifest_event or acquisition['data'].get('lease') != cap['lease']:
        raise PermissionError('lease acquisition is not bound to this manifest')
    return {'operator': 'infra', 'session': SESSION, 'actor': 'admin-recuperacao', 'lease': cap['lease'],
            'fence': cap['fence'], 'manifest_event': manifest_event}


def reviewed(manifest_event):
    if git('status', '--porcelain'):
        raise ValueError('reviewed source has changes')
    notice = central(['history', '--after-seq', str(manifest_event - 1), '--limit', '1'])[0]
    if notice['seq'] != manifest_event or notice['kind'] != 'notice':
        raise ValueError('immutable notice required')
    data = notice['data']
    if data['manifest']['commit'] != git('rev-parse', 'HEAD') or data['file_sha256'] != source_hashes():
        raise ValueError('reviewed manifest does not match source')
    cursor = manifest_event
    acknowledged = False
    while True:
        events = central(['history', '--after-seq', str(cursor), '--limit', '200'])
        if not events:
            break
        acknowledged |= any(e['kind'] == 'ack' and e['actor'] == 'apoio' and e['data'].get('event_seq') == manifest_event for e in events)
        cursor = events[-1]['seq']
        if len(events) < 200:
            break
    if not acknowledged:
        raise PermissionError('independent Apoio ACK required')
    return data


def execute(action, output, manifest_event, lease_file=None):
    reviewed(manifest_event)
    request = {'action': action, 'packet': packet()}
    if action == 'apply':
        if lease_file is None:
            raise PermissionError('own deployment lease required')
        request['execution'] = validate_lease(lease_file, manifest_event)
    if action not in {'preflight', 'apply', 'verify'}:
        raise ValueError('unsupported action')
    # Reserve the evidence path before any remote action; uncertain delivery is
    # inspected with verify, never retried as apply automatically.
    with output.open('x') as stream:
        try:
            code = (ROOT / 'operator.py').read_text()
            p = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ControlPath=none',
                                '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12',
                                'cluster-civo-root-ipv4', 'python3 -c ' + shlex.quote(code)],
                               input=json.dumps(request), capture_output=True, text=True, timeout=90)
            try:
                result = json.loads(p.stdout)
            except ValueError:
                result = {'ok': False, 'error': 'unstructured remote result', 'transport_uncertain': True}
            result['ssh_exit'] = p.returncode
        except (subprocess.TimeoutExpired, OSError):
            result = {'ok': False, 'error': 'transport failed', 'transport_uncertain': True, 'automatic_retry': False}
        result.update(action=action, manifest_event=manifest_event, commit=request['packet']['commit'])
        json.dump(result, stream, indent=2)
    output.chmod(0o600)
    return {'ok': result.get('ok'), 'action': action, 'receipt': str(output), 'transport_uncertain': result.get('transport_uncertain', False)}


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'apply', 'verify'])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--manifest-event', type=int, required=True)
    parser.add_argument('--lease-file', type=Path)
    args = parser.parse_args()
    print(json.dumps(execute(args.action, args.output, args.manifest_event, args.lease_file)))
