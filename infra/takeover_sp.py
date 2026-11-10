#!/usr/bin/python3
"""Restore and manually promote passive SP coordination; never starts execution."""
import argparse
import datetime
import fcntl
import grp
import json
import os
from pathlib import Path
import pwd
import shlex
import socket
import subprocess
import sys
import uuid

CURRENT = Path('/srv/admin-v2-coordinator-standby')
HISTORY = Path('/srv/admin-v2-standby-history')
RECOVERY = '/opt/admin-v2-cluster/recovery.py'
ENVIRONMENT_FILE = Path('/etc/admin-v2-cluster.env')


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


def recovery(*args):
    p = subprocess.run(['/usr/bin/python3', RECOVERY, *args], capture_output=True, text=True, timeout=600)
    if p.returncode:
        raise RuntimeError('recovery_failed: ' + p.stdout[-1000:])
    return json.loads(p.stdout)


def permissions(root):
    uid = pwd.getpwnam('vigia-coord').pw_uid
    gid = grp.getgrnam('admin-v2-exec').gr_gid
    for path in [root, *root.rglob('*')]:
        if path.is_symlink():
            raise ValueError('restored_symlink_refused')
        relative = path.relative_to(root)
        source = bool(relative.parts and relative.parts[0] == 'sources')
        os.chown(path, uid, gid)
        os.chmod(path, (0o2550 if source else 0o2770) if path.is_dir() else (0o440 if source else 0o660))


def suspend_if_present(path):
    authority_file = path / 'authority.json'
    if authority_file.exists():
        authority = json.loads(authority_file.read_text())
        authority.update(role='suspended', armed_boot_id=None)
        atomic(authority_file, authority)


def validate_service_environment():
    def property_value(name):
        return subprocess.run(['/usr/bin/systemctl', 'show', 'admin-v2-coordinator.service', '--property=' + name, '--value'], capture_output=True, text=True, check=True).stdout.strip()

    files = shlex.split(property_value('EnvironmentFiles'))
    if files not in ([str(ENVIRONMENT_FILE)], [str(ENVIRONMENT_FILE), '(ignore_errors=no)']):
        raise ValueError('sp_service_requires_only_fixed_environment_file')
    if ENVIRONMENT_FILE.is_symlink():
        raise ValueError('sp_environment_file_symlink_refused')
    needed = {'ADMIN_CLUSTER_DISPATCH', 'ADMIN_WORKER_ROOT'}
    settings = {}
    for item in shlex.split(property_value('Environment')):
        key, sep, value = item.partition('=')
        if sep and key in needed:
            settings[key] = value
    # systemd applies EnvironmentFile after Environment. Keep only the two guards;
    # never print or retain unrelated configuration values.
    for line in ENVIRONMENT_FILE.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith(('#', ';')):
            continue
        fields = shlex.split(line, comments=False, posix=True)
        if len(fields) != 1 or '=' not in fields[0]:
            raise ValueError('unsupported_sp_environment_file_syntax')
        key, value = fields[0].split('=', 1)
        if key in needed:
            settings[key] = value
    if settings.get('ADMIN_CLUSTER_DISPATCH') != '0' or settings.get('ADMIN_WORKER_ROOT') != str(CURRENT / 'recovered-worker'):
        raise ValueError('sp_service_must_have_dispatch_zero_and_recovered_worker_root')


def takeover():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--confirm-manual-takeover', action='store_true', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'peticao-sp':
        raise PermissionError('root_on_peticao_sp_required')
    archive = Path(args.snapshot)
    if not archive.is_absolute() or archive.is_symlink() or not archive.is_file():
        raise ValueError('absolute_regular_snapshot_required')
    if CURRENT.is_symlink() or HISTORY.is_symlink():
        raise ValueError('coordinator_root_symlink_refused')
    if CURRENT.exists() and json.loads((CURRENT / 'authority.json').read_text()).get('role') == 'primary':
        raise ValueError('current_sp_already_primary')
    validate_service_environment()
    meta = recovery('verify', '--snapshot', str(archive))
    if meta['source_host'].split('.')[0] != 'sonda-verifica3':
        raise ValueError('checkpoint_must_come_from_santiago')
    # Stop the passive reader before replacing its root. It is never started here.
    subprocess.run(['/usr/bin/systemctl', 'stop', 'admin-v2-coordinator.service'], check=True, timeout=120)
    state = subprocess.run(['/usr/bin/systemctl', 'show', 'admin-v2-coordinator.service', '--property=ActiveState', '--value'], capture_output=True, text=True, check=True).stdout.strip()
    if state not in ('inactive', 'failed'):
        raise RuntimeError('sp_coordinator_not_stopped')
    restored = Path('/srv/admin-v2-restore-' + uuid.uuid4().hex)
    proof = Path('/root/.admin-v2-takeover-' + uuid.uuid4().hex + '.json')
    promotion_attempted = False
    installed = False
    try:
        recovery('restore', '--snapshot', str(archive), '--target', str(restored))
        atomic(proof, {'previous_host': meta['source_host'], 'previous_generation': meta['generation'], 'new_generation': meta['generation'] + 1, 'method': 'coordinator-stopped', 'verified': True})
        promotion_attempted = True
        promotion = recovery('promote', '--target', str(restored), '--fence-proof', str(proof), '--verify-fence-command', '/usr/local/libexec/admin-v2-verify-fence')
        (restored / 'recovered-worker').mkdir(exist_ok=True)
        permissions(restored)
        HISTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
        previous = None
        if CURRENT.exists():
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex
            previous = HISTORY / stamp
            CURRENT.rename(previous)
        restored.rename(CURRENT)
        installed = True
        print(json.dumps({'state': 'promoted_service_stopped', 'root': str(CURRENT), 'previous_root': str(previous) if previous else None, 'generation': promotion['generation'], 'dispatch': False, 'worker_root': str(CURRENT / 'recovered-worker'), 'requires_operator_review': True}))
    except Exception:
        if promotion_attempted:
            # No rollback to an armed authority, even when promotion partially wrote.
            suspend_if_present(CURRENT if installed else restored)
        raise
    finally:
        proof.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'peticao-sp':
        raise PermissionError('root_on_peticao_sp_required')
    with Path('/run/admin-v2-manual-takeover.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        takeover()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'state': 'error', 'error': str(error)}), file=sys.stderr)
        sys.exit(1)
