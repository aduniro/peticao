#!/usr/bin/python3
"""One-shot, locked checkpoint replication over pinned tailnet SSH."""
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid

ROOT = Path('/srv/admin-v2-coordinator')
WORKER = Path('/srv/admin-v2-worker')
OUTPUT = Path('/srv/admin-v2-checkpoints')
RECOVERY = '/opt/admin-v2-cluster/recovery.py'
MAX_ARCHIVE = 250 * 1024 * 1024


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic_json(path, data):
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    with temp.open('x') as f:
        os.chmod(temp, 0o600)
        json.dump(data, f, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    temp.replace(path)


def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def fingerprint():
    # Exclude replication status/lock: writing our own status must not trigger work.
    # WAL content matters; hashing only database mtime misses committed WAL writes.
    paths = [ROOT / n for n in ('queue.sqlite', 'queue.sqlite-wal', 'authority.json', 'config.json', 'version.json')]
    for directory in (ROOT / 'sources', ROOT / 'bundles'):
        if directory.exists():
            paths.extend(p for p in directory.rglob('*') if p.is_file() and not p.is_symlink())
    jobs = WORKER / 'jobs'
    if jobs.exists():
        for job in jobs.iterdir():
            if job.is_dir() and not job.is_symlink():
                paths.extend(job / name for name in ('config.json', 'state.json', 'result.json', 'output.log'))
                artifacts = job / 'artifacts'
                if artifacts.exists():
                    paths.extend(p for p in artifacts.rglob('*') if p.is_file() and not p.is_symlink())
    h = hashlib.sha256()
    for path in sorted(set(paths)):
        if path.is_symlink():
            raise ValueError('checkpoint_input_symlink')
        if path.is_file():
            h.update(str(path).encode() + b'\0' + digest_file(path).encode() + b'\0')
    return h.hexdigest()


def recovery(*args):
    p = subprocess.run(['/usr/bin/python3', RECOVERY, *args], capture_output=True, text=True, timeout=600)
    if p.returncode:
        raise RuntimeError('recovery_command_failed: ' + p.stdout[-1000:])
    return json.loads(p.stdout)


def retain(last_good):
    # Delete only older verified checkpoints, always retaining the last delivered one.
    verified = []
    for path in OUTPUT.glob('*.tar.gz'):
        if path.is_symlink():
            continue
        try:
            meta = recovery('verify', '--snapshot', str(path))
            verified.append((meta['created_at'], path))
        except Exception:
            continue
    verified.sort(reverse=True)
    keep = {p for _, p in verified[:10]}
    if last_good:
        good = OUTPUT / Path(last_good).name
        if good not in keep and good.exists():
            # Stay within ten good captures even if the last delivered one is old.
            keep = {p for _, p in verified[:9]} | {good}
    for _, path in verified:
        if path not in keep:
            path.unlink()


def tick():
    import authority_guard
    authority_guard.require_replication_qualified()
    state_path = ROOT / 'replication-out.json'
    previous = json.loads(state_path.read_text()) if state_path.exists() else {}
    state = {**previous, 'source': socket.gethostname(), 'destination': '100.109.6.122', 'checked_at': now()}
    try:
        authority = json.loads((ROOT / 'authority.json').read_text())
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        if authority.get('role') != 'primary' or authority.get('armed_boot_id') != boot:
            state.update(state='inactive', error='coordinator_not_armed_primary')
            atomic_json(state_path, state)
            return state
        current = fingerprint()
        if current == previous.get('last_success_fingerprint'):
            state.update(state='unchanged', error=None)
            retain(previous.get('last_success_snapshot'))
            atomic_json(state_path, state)
            return state
        capture = recovery('snapshot', '--source', str(ROOT), '--worker-root', str(WORKER), '--output', str(OUTPUT))
        archive = Path(capture['snapshot'])
        if archive.is_symlink() or archive.parent.resolve() != OUTPUT.resolve() or archive.stat().st_size > MAX_ARCHIVE:
            raise ValueError('checkpoint_path_or_size_invalid')
        if digest_file(archive) != capture['sha256']:
            raise ValueError('checkpoint_changed_after_verification')
        payload = {'action': 'replica-ingest', 'archive_base64': base64.b64encode(archive.read_bytes()).decode('ascii'), 'sha256': capture['sha256']}
        cmd = ['/usr/bin/ssh', '-T', '-p', '2222', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'UserKnownHostsFile=/home/vigia-coord/.ssh/known_hosts', '-i', '/home/vigia-coord/.ssh/id_standby', 'vigia-coord@100.109.6.122']
        sent = subprocess.run(cmd, input=json.dumps(payload), capture_output=True, text=True, timeout=600)
        if sent.returncode:
            raise RuntimeError('replica_transport_failed')
        reply = json.loads(sent.stdout)
        if reply.get('state') != 'replicated' or reply.get('sha256') != capture['sha256'] or not reply.get('received_at'):
            raise ValueError('replica_acknowledgement_invalid')
        state.update(state='replicated', error=None, last_success_at=now(), destination_received_at=reply['received_at'], last_success_fingerprint=current, last_success_snapshot=archive.name, sha256=capture['sha256'], generation=capture['generation'])
        atomic_json(state_path, state)
        retain(archive.name)
        return state
    except Exception as e:
        state.update(state='error', error=str(e)[:1000], failed_at=now())
        atomic_json(state_path, state)
        # Failed transmissions cannot consume disk indefinitely; preserve last ack.
        try:
            retain(previous.get('last_success_snapshot'))
        except Exception:
            pass
        return state


def main():
    import authority_guard
    authority_guard.require_replication_qualified()
    os.umask(0o077)
    with (ROOT / '.replication.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'state': 'already_running'}))
            return 0
        result = tick()
        print(json.dumps(result))
        return 1 if result['state'] == 'error' else 0


if __name__ == '__main__':
    sys.exit(main())
