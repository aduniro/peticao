#!/usr/bin/python3
"""Manual fencing of Santiago; never powers off or starts any service."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import uuid

ROOT = Path('/srv/admin-v2-coordinator')
UNIT = 'admin-v2-coordinator.service'


def atomic(path, value):
    old = path.stat() if path.exists() else None
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    with temp.open('x') as f:
        os.chmod(temp, 0o660 if old else 0o600)
        if old:
            os.chown(temp, old.st_uid, old.st_gid)
        json.dump(value, f, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    temp.replace(path)


def run(*args):
    return subprocess.run(['/usr/bin/systemctl', *args], capture_output=True, text=True, check=True, timeout=120).stdout


def workers():
    rows = run('list-units', '--all', '--plain', '--no-legend', '--no-pager', 'admin-v2-job-*.service')
    units = []
    for row in rows.splitlines():
        name = row.split()[0]
        if not re.fullmatch(r'admin-v2-job-[0-9a-fA-F-]{32,36}\.service', name):
            raise ValueError('unexpected_worker_unit: ' + name)
        units.append(name)
    return units


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-manual-fence', action='store_true', required=True)
    parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'sonda-verifica3':
        raise PermissionError('root_on_sonda_verifica3_required')
    if ROOT.is_symlink() or (ROOT / 'authority.json').is_symlink():
        raise ValueError('authority_symlink_refused')
    authority = json.loads((ROOT / 'authority.json').read_text())
    if not isinstance(authority.get('generation'), int):
        raise ValueError('invalid_authority_generation')
    # Revoke dispatch BEFORE stopping processes, including on subsequent failure.
    authority.update(role='suspended', armed_boot_id=None)
    atomic(ROOT / 'authority.json', authority)
    run('stop', UNIT)
    stopped = workers()
    if stopped:
        run('stop', *stopped)
    # A second inventory catches a unit created while authority was being revoked.
    checked = sorted(set(stopped + workers() + [UNIT]))
    for name in checked:
        state = run('show', name, '--property=ActiveState', '--value').strip()
        if state not in ('inactive', 'failed'):
            raise RuntimeError('unit_not_stopped: ' + name + ':' + state)
    if json.loads((ROOT / 'authority.json').read_text()) != authority:
        raise RuntimeError('authority_changed_during_fencing')
    result = {'state': 'fenced', 'host': socket.gethostname(), 'generation': authority['generation'], 'checked_units': checked, 'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    atomic(ROOT / 'manual-fence.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'state': 'error', 'error': str(error)}), file=sys.stderr)
        sys.exit(1)
