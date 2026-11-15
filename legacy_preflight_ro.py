"""Read-only Santiago development metadata; never imports application code."""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import time

ROOT = Path('/srv/admin-v2-coordinator')
CODE = Path('/opt/admin-v2-cluster')
UNIT = 'admin-v2-coordinator.service'
JOB = re.compile(r'admin-v2-job-[a-fA-F0-9-]{32,36}\.service\Z')


def meta(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return {'present': False}
    return {'present': True, 'uid': info.st_uid, 'gid': info.st_gid,
            'mode': oct(stat.S_IMODE(info.st_mode)), 'bytes': info.st_size,
            'link': stat.S_ISLNK(info.st_mode), 'regular': stat.S_ISREG(info.st_mode),
            'directory': stat.S_ISDIR(info.st_mode), 'nlink': info.st_nlink}


def regular(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise PermissionError('bounded_regular_metadata_required')
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    if len(raw) > limit or len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
        raise PermissionError('metadata_changed_during_read')
    return raw


def command(args):
    if not args or args[0] not in {'show', 'list-units'}:
        raise PermissionError('readonly_systemd_commands_only')
    process = subprocess.run(['/usr/bin/systemctl', *args], capture_output=True,
                             text=True, timeout=10, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    if process.returncode or len(process.stdout) > 131072:
        raise RuntimeError('bounded_systemd_read_failed')
    return process.stdout


def main():
    if os.geteuid() != 0 or socket.gethostname() != 'sonda-verifica3':
        raise PermissionError('root_on_exact_legacy_source_required')
    before_boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    authority_raw = regular(ROOT / 'authority.json', 65536)
    authority = json.loads(authority_raw)
    rows = command(['list-units', '--all', '--plain', '--no-legend', '--no-pager', 'admin-v2-job-*.service'])
    jobs = []
    for line in rows.splitlines():
        name = line.split()[0]
        if not JOB.fullmatch(name) or name in jobs:
            raise PermissionError('exact_development_job_inventory_required')
        jobs.append(name)
    if len(jobs) > 128:
        raise PermissionError('development_job_inventory_budget')
    units = []
    fields = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlGroup',
              'InvocationID', 'User', 'Group', 'Restart', 'FragmentPath']
    for name in [UNIT, *sorted(jobs)]:
        raw = command(['show', name, '--no-pager', '--property=' + ','.join(fields)])
        values = dict(line.split('=', 1) for line in raw.splitlines())
        if set(values) != set(fields):
            raise PermissionError('complete_unit_observation_required')
        units.append({'unit': name, **values})
    files = {}
    for name in ('coordinator.py', 'recovery.py', 'fence_primary.py', 'gateway.py',
                 'replicate.py', 'runtime_profile.py', 'standby_guard.py', 'authority_guard.py',
                 'remote_contract.py', 'atomic_metadata.py'):
        path = CODE / name
        item = meta(path)
        if item['present'] and item['regular']:
            item['sha256'] = hashlib.sha256(regular(path, 1024**2)).hexdigest()
        files[name] = item
    state = {name: meta(ROOT / name) for name in ('queue.sqlite', 'queue.sqlite-wal',
             'queue.sqlite-shm', 'authority.json', 'generation-floor.json', 'manual-fence.json')}
    # No SQLite open: WAL reader marks may update SHM even with mode=ro. Queue
    # contents/freshness must be established by a later coordinated snapshot.
    if authority_raw != regular(ROOT / 'authority.json', 65536):
        raise PermissionError('authority_changed_during_observation')
    if before_boot != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        raise PermissionError('source_boot_changed')
    return {'version': 1, 'observed_unix': time.time(), 'host': 'sonda-verifica3',
            'boot_id': before_boot, 'root': meta(ROOT),
            'authority': {k: authority.get(k) for k in ('role', 'generation', 'armed_boot_id')},
            'authority_sha256': hashlib.sha256(authority_raw).hexdigest(),
            'units': units, 'code_files': files, 'state_metadata': state,
            'epoch_metadata': meta(Path('/etc/peticao-dev-authority/epoch.json')),
            'queue_contents_read': False, 'app_code_imported': False,
            'services_stopped': False, 'host_files_written': False,
            'fencing_qualified': False, 'cutover_done': False}


if __name__ == '__main__':
    print(json.dumps(main(), sort_keys=True, allow_nan=False))
