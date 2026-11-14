#!/usr/bin/env python3
"""Root staging operator, invoked only by the locally lease-validated client.

Installs code and an inert unit. Never starts/enables services, copies a database,
changes an existing account, modifies SSH/firewalls, or promotes a coordinator.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone

CODE = Path('/opt/admin-v2-cluster')
QUEUE = Path('/srv/admin-v2-coordinator')
UNIT = Path('/etc/systemd/system/admin-v2-coordinator-standby.service')
STATE = Path('/var/lib/peticao-infra/civo-development-standby')
ACCOUNT = 'vigia-coord'
ROOT_UID = 0
MODULES = {'coordinator.py', 'runtime_profile.py', 'recovery.py', 'replicate.py',
           'gateway.py', 'dashboard.py', 'fence_primary.py', 'standby_guard.py'}


def run(argv, **kwargs):
    return subprocess.run(argv, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          timeout=30, **kwargs)


def unit_state():
    p = run(['systemctl', 'show', 'admin-v2-coordinator-standby.service',
             '-p', 'LoadState', '-p', 'ActiveState', '-p', 'FragmentPath'])
    return dict(line.split('=', 1) for line in p.stdout.splitlines() if '=' in line)


def identity():
    try:
        p = pwd.getpwnam(ACCOUNT)
        return {'uid': p.pw_uid, 'gid': p.pw_gid, 'shell': p.pw_shell, 'home': p.pw_dir}
    except KeyError:
        return None


def inspect():
    fs = os.statvfs('/')
    return {'hostname': socket.gethostname(), 'root': os.geteuid() == 0,
            'available_bytes': fs.f_bavail * fs.f_frsize,
            'paths_present': {str(p): p.exists() or p.is_symlink() for p in [CODE, QUEUE, UNIT, STATE]},
            'identity': identity(), 'unit': unit_state(),
            'primary_unit': dict(line.split('=', 1) for line in run([
                'systemctl', 'show', 'admin-v2-coordinator.service',
                '-p', 'LoadState', '-p', 'ActiveState']).stdout.splitlines() if '=' in line)}


def decode(packet):
    if not re.fullmatch('[a-f0-9]{40}', packet.get('commit', '')):
        raise ValueError('frozen source commit required')
    if set(packet['runtime']) != MODULES:
        raise ValueError('unexpected runtime module set')
    data = {name: base64.b64decode(raw, validate=True) for name, raw in packet['runtime'].items()}
    data['standby.service'] = base64.b64decode(packet['unit'], validate=True)
    if any(len(v) > 512 * 1024 for v in data.values()):
        raise ValueError('oversize code member')
    actual = {name: hashlib.sha256(raw).hexdigest() for name, raw in data.items()}
    if actual != packet['hashes']:
        raise ValueError('packet hash mismatch')
    return data


def preflight(packet):
    decode(packet)
    d = inspect()
    if not d['root'] or d['hostname'] != 'peticao-civo':
        raise PermissionError('Civo root staging only')
    for target in [CODE, QUEUE, UNIT, STATE]:
        for parent in target.parents:
            if parent.is_symlink():
                raise ValueError('symlink ancestor refused')
            if parent.exists():
                info = parent.stat()
                if not parent.is_dir() or info.st_uid != ROOT_UID or info.st_mode & 0o022:
                    raise ValueError('untrusted staging parent directory')
    if d['available_bytes'] < 20 * 2**30:
        raise ValueError('shared disk floor20GiB not available')
    if any(d['paths_present'].values()):
        raise FileExistsError('existing staging resource; no overwrite or takeover')
    if d['identity'] is not None:
        raise FileExistsError('service identity already exists; requires explicit reconciliation')
    if d['unit'].get('LoadState') not in [None, 'not-found'] or d['unit'].get('ActiveState') not in [None, 'inactive']:
        raise FileExistsError('existing loaded unit; no shadowing')
    if d['primary_unit'].get('LoadState') != 'not-found' or d['primary_unit'].get('ActiveState') != 'inactive':
        raise FileExistsError('existing primary unit; no shadowing')
    return d


def receipt_write(data):
    tmp = STATE/'.receipt.tmp'
    with tmp.open('x') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    tmp.chmod(0o600)
    os.replace(tmp, STATE/'receipt.json')


def apply(packet, execution):
    # Execution metadata is audit evidence, not a replacement for central validation.
    if not isinstance(execution.get('fence'), int) or not execution.get('lease'):
        raise ValueError('validated lease audit metadata required')
    before = preflight(packet)
    data = decode(packet)
    STATE.mkdir(parents=True, mode=0o700, exist_ok=False)
    receipt = {'at': datetime.now(timezone.utc).isoformat(), 'phase': 'preparing',
               'commit': packet['commit'], 'hashes': packet['hashes'],
               'execution': execution, 'files': {}, 'account_created': False,
               'source_development_queue_untouched': True,
               'NCPF_and_application_databases_untouched': True, 'service_started': False}
    receipt_write(receipt)
    result = run(['useradd', '--system', '--user-group', '--no-create-home',
                  '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', ACCOUNT])
    if result.returncode:
        raise RuntimeError('service account creation failed; inspect protected receipt')
    who = identity()
    if not who or who['shell'] != '/usr/sbin/nologin':
        raise RuntimeError('new identity metadata inconsistent')
    receipt.update(account_created=True, identity=who)
    receipt_write(receipt)
    CODE.mkdir(mode=0o755, exist_ok=False)
    CODE.chmod(0o755)
    os.chown(CODE, 0, 0)
    for name in sorted(MODULES):
        p = CODE/name
        with p.open('xb') as f:
            f.write(data[name])
        p.chmod(0o644)
        os.chown(p, 0, 0)
        receipt['files'][str(p)] = hashlib.sha256(data[name]).hexdigest()
        receipt_write(receipt)
    with UNIT.open('xb') as f:
        f.write(data['standby.service'])
    UNIT.chmod(0o600)
    os.chown(UNIT, 0, 0)
    receipt['files'][str(UNIT)] = hashlib.sha256(data['standby.service']).hexdigest()
    receipt_write(receipt)
    code = ('import sys,pathlib;sys.path.insert(0,sys.argv[1]);'
            'root=pathlib.Path(sys.argv[1]);'
            'assert all((root/name).read_bytes() for name in sys.argv[2:]);'
            'import coordinator,runtime_profile,recovery,replicate,gateway,dashboard,fence_primary,standby_guard;'
            'print("imports_ok")')
    smoke = run(['runuser', '-u', ACCOUNT, '--', '/usr/bin/python3', '-I', '-B', '-c', code, str(CODE), *sorted(MODULES)])
    if smoke.returncode or smoke.stdout.strip() != 'imports_ok':
        raise RuntimeError('nonroot isolated import probe failed; no service started')
    receipt.update(phase='code_staged_inactive', nonroot_imports_verified=True,
                   database_created=False, daemon_reload_performed=False,
                   service_enabled=False, before=before)
    receipt_write(receipt)
    return verify()


def verify():
    receipt = json.loads((STATE/'receipt.json').read_text())
    for name, digest in receipt['files'].items():
        p = Path(name)
        if p.is_symlink() or not p.is_file() or p.stat().st_uid != ROOT_UID or p.stat().st_mode & 0o022 or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            raise ValueError('installed code ownership or hash mismatch')
    if {p.name for p in CODE.iterdir()} != MODULES:
        raise ValueError('unexpected installed code directory contents')
    if QUEUE.exists() or QUEUE.is_symlink():
        raise ValueError('unexpected queue: this phase must not initialize a database')
    if unit_state().get('ActiveState') not in [None, 'inactive']:
        raise ValueError('unexpected service activity; no stop inferred')
    if identity() != receipt.get('identity'):
        raise ValueError('service identity changed')
    return {'phase': receipt['phase'], 'commit': receipt['commit'],
            'files_verified': len(receipt['files']), 'new_queue': False,
            'service_started': False, 'rpc_listener_created': False,
            'nonroot_imports_verified': receipt.get('nonroot_imports_verified', False)}


def rollback():
    if os.geteuid() != 0 or socket.gethostname() != 'peticao-civo':
        raise PermissionError('Civo root rollback only')
    receipt = json.loads((STATE/'receipt.json').read_text())
    if unit_state().get('ActiveState') not in [None, 'inactive'] or QUEUE.exists():
        raise ValueError('staging has been activated; separate coordinated recovery required')
    allowed = {str(CODE/name) for name in MODULES} | {str(UNIT)}
    if not set(receipt['files']) <= allowed:
        raise ValueError('receipt contains foreign resources')
    if CODE.exists() and {str(p) for p in CODE.iterdir()} != {name for name in receipt['files'] if name.startswith(str(CODE)+'/')}:
        raise ValueError('unowned code directory content; no deletion')
    for name, digest in receipt['files'].items():
        p = Path(name)
        if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            raise ValueError('changed or foreign file; no deletion')
    for name in receipt['files']:
        Path(name).unlink()
    if CODE.exists():
        CODE.rmdir()
    receipt.update(phase='rolled_back_code_only', locked_identity_retained=True,
                   account_removal='not automatic: avoid identity reuse or deleting other work')
    receipt_write(receipt)
    return {'phase': receipt['phase'], 'identity_retained_nologin': bool(receipt.get('account_created'))}


def main():
    os.umask(0o077)
    request = json.load(sys.stdin)
    action = request['action']
    if action == 'preflight':
        result = preflight(request['packet'])
    elif action == 'apply':
        result = apply(request['packet'], request['execution'])
    elif action == 'verify':
        result = verify()
    elif action == 'rollback':
        result = rollback()
    else:
        raise ValueError('unknown staging action')
    print(json.dumps({'ok': True, 'result': result}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'ok': False, 'error': type(e).__name__, 'detail': str(e)}))
        sys.exit(1)
