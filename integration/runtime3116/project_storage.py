"""Root-only, per-job project backing for systemd-managed StateDirectory.

Source preparation only. A mount intent is never replayed. The host qualification
must prove the exact systemd version, private tmp behavior and UID lifecycle.
"""
import json
import os
from pathlib import Path
import re
import stat
import subprocess

import remote_contract as contract

PROJECT_RUNTIME = Path('/mnt/apps/peticao-final/.runtime')


def state_name(manifest):
    contract.hex_value(manifest['job_id'], 32)
    contract.generation(manifest['generation'])
    return 'peticao-dev-job-' + manifest['job_id'] + '-g' + str(manifest['generation'])


def mountinfo(raw):
    """Bounded strict mount table, including duplicate/stacked mountpoints."""
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('mount_table_too_large')
    result = []
    def decode(value):
        value = re.sub(r'\\(040|011|012|134)', lambda m: chr(int(m[1], 8)), value)
        if '\\' in value:
            raise ValueError('unsupported_mount_escape')
        return value
    for line in raw.splitlines():
        fields = line.split()
        try:
            sep = fields.index('-')
            if sep < 6 or len(fields) != sep + 4:
                raise ValueError()
            ident = int(fields[0]); parent = int(fields[1])
            if ident < 1 or parent < 0 or not re.fullmatch(r'[0-9]+:[0-9]+', fields[2]):
                raise ValueError()
            root, target = decode(fields[3]), decode(fields[4])
            if not root.startswith('/') or not target.startswith('/'):
                raise ValueError()
            result.append({'mount_id': ident, 'parent_id': parent, 'device': fields[2],
                           'root': root, 'target': target, 'options': fields[5].split(',')})
        except (ValueError, IndexError) as exc:
            raise ValueError('invalid_mount_table') from exc
    if not result or len(result) > 20000 or len({x['mount_id'] for x in result}) != len(result):
        raise ValueError('complete_unique_mount_table_required')
    return result


def command(argv):
    subprocess.run(argv, check=True, capture_output=True, timeout=30,
                   env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})


class ProjectStorage:
    def __init__(self, root, private_base=Path('/var/lib/private'), public_base=Path('/var/lib'),
                 *, runner=command, table_reader=lambda: Path('/proc/self/mountinfo').read_text(),
                 uid=0, allowed_root=PROJECT_RUNTIME,
                 boot_id=lambda: Path('/proc/sys/kernel/random/boot_id').read_text().strip()):
        self.root = Path(root).absolute()
        self.private_base, self.public_base = Path(private_base), Path(public_base)
        self.runner, self.table_reader, self.uid = runner, table_reader, uid
        self.boot_id = boot_id
        allowed = Path(allowed_root).absolute()
        self.allowed_root = allowed
        if any(not p.is_absolute() or '..' in p.parts for p in (self.root, allowed, self.private_base, self.public_base)):
            raise PermissionError('absolute_storage_paths_without_traversal_required')
        if self.root == allowed or allowed not in self.root.parents:
            raise PermissionError('dedicated_project_runtime_child_required')
        self._directory(self.root, private=True)
        self._directory(self.private_base, private=True)
        self._directory(self.public_base)

    def _directory(self, path, private=False, leaf_owner=True):
        path = Path(path)
        for parent in [*reversed(path.parents), path]:
            info = parent.lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise PermissionError('storage_directory_no_links_required')
            # Default root operator requires an entirely root-controlled chain.
            # uid!=0 is an explicit local-fixture seam, never a runtime config.
            if parent != path and self.uid == 0 and (info.st_uid != 0 or info.st_mode & 0o022):
                raise PermissionError('root_controlled_storage_ancestors_required')
        info = path.lstat()
        if (leaf_owner and info.st_uid != self.uid) or info.st_mode & 0o022:
            raise PermissionError('root_controlled_storage_required')
        if private and stat.S_IMODE(info.st_mode) != 0o700:
            raise PermissionError('private_storage_mode_required')
        return info

    def _paths(self, manifest):
        name = state_name(manifest)
        job = self.root / name
        return job, job / 'work', self.private_base / name, self.public_base / name

    def _identity(self, manifest, receipt):
        name = state_name(manifest)
        expected_unit = 'admin-dev-' + manifest['job_id'] + '-g' + str(manifest['generation']) + '.service'
        if receipt.get('unit') != expected_unit or receipt.get('boot_id') != self.boot_id():
            raise PermissionError('current_boot_own_unit_storage_required')
        return name

    def _write(self, job, value, initial=False):
        path = job / ('binding.json' if initial else 'binding.next')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, sort_keys=True); f.flush(); os.fsync(f.fileno())
        if not initial:
            os.replace(path, job / 'binding.json')
        fd = os.open(job, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)

    def _record(self, manifest, receipt):
        self._identity(manifest, receipt)
        if os.geteuid() != self.uid:
            raise PermissionError('root_storage_operator_required')
        self._directory(self.root, private=True)
        job, source, target, public = self._paths(manifest)
        self._directory(job, private=True)
        fd = os.open(job / 'binding.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as f:
            info = os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 8192:
                raise PermissionError('private_binding_receipt_required')
            record = json.loads(f.read(8193))
        expected = {'manifest_sha256': contract.digest(manifest), 'receipt_sha256': contract.digest(receipt),
                    'worker_boot_id': receipt['boot_id'], 'unit': receipt['unit'],
                    'source': str(source), 'target': str(target)}
        if any(record.get(k) != v for k, v in expected.items()):
            raise PermissionError('foreign_storage_binding')
        return record

    def _mounts(self, source, target):
        entries = mountinfo(self.table_reader())
        # No nested mount is permitted in either the work tree or host target.
        if any(Path(x['target']) != target and (target in Path(x['target']).parents or source == Path(x['target']) or source in Path(x['target']).parents) for x in entries):
            raise PermissionError('nested_storage_mount_refused')
        return [x for x in entries if x['target'] == str(target)]

    def prepare(self, manifest, receipt):
        self._identity(manifest, receipt)
        if os.geteuid() != self.uid:
            raise PermissionError('root_storage_operator_required')
        self._directory(self.root, private=True)
        self._directory(self.private_base, private=True)
        job, source, target, public = self._paths(manifest)
        if os.path.lexists(job) or os.path.lexists(target) or os.path.lexists(public):
            raise PermissionError('occupied_storage_refused_no_replay')
        if self._mounts(source, target):
            raise PermissionError('preexisting_storage_mount')
        job.mkdir(mode=0o700); source.mkdir(mode=0o700)
        target.mkdir(mode=0o700)
        before = target.stat()
        record = {'version': 1, 'state': 'mount_intent', 'manifest_sha256': contract.digest(manifest),
                  'receipt_sha256': contract.digest(receipt), 'worker_boot_id': receipt['boot_id'],
                  'unit': receipt['unit'], 'source': str(source), 'target': str(target),
                  'underlay_device': before.st_dev, 'underlay_inode': before.st_ino}
        self._write(job, record, initial=True)
        # Any failure after intent requires explicit reconciliation, never replay.
        self.runner(['/usr/bin/mount', '--bind', '--', str(source), str(target)])
        entries = self._mounts(source, target)
        a, b = source.stat(), target.stat()
        if len(entries) != 1 or 'rw' not in entries[0]['options'] or (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
            raise PermissionError('project_bind_mount_not_proven')
        record.update(state='mounted', mount_id=entries[0]['mount_id'], device=a.st_dev, inode=a.st_ino)
        self._write(job, record)
        return self.verify(manifest, receipt)

    def verify(self, manifest, receipt):
        record = self._record(manifest, receipt)
        if record.get('state') != 'mounted':
            raise PermissionError('mounted_storage_receipt_required')
        job, source, target, public = self._paths(manifest)
        self._directory(self.private_base, private=True)
        self._directory(source, private=True, leaf_owner=False)
        self._directory(target, private=True, leaf_owner=False)
        entries = self._mounts(source, target)
        if len(entries) != 1 or entries[0]['mount_id'] != record['mount_id'] or 'rw' not in entries[0]['options']:
            raise PermissionError('storage_mount_replaced_or_missing')
        a, b = source.stat(), target.stat()
        if (a.st_dev, a.st_ino) != (record['device'], record['inode']) or (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
            raise PermissionError('physical_project_backing_mismatch')
        if os.path.lexists(public) and (not public.is_symlink() or os.readlink(public) not in {str(target), 'private/' + target.name}):
            raise PermissionError('unexpected_public_state_path')
        return {k: record[k] for k in ('source','target','mount_id','device','inode','manifest_sha256','receipt_sha256','worker_boot_id')}

    def output_root(self, manifest, receipt):
        return Path(self.verify(manifest, receipt)['source'])

    def status(self, manifest, receipt):
        record = self._record(manifest, receipt)
        if record.get('state') == 'mounted':
            return {'state': 'mounted', **self.verify(manifest, receipt)}
        if record.get('state') != 'retained':
            # mount_intent/unmount_intent are uncertain even if a mount is absent.
            return {'state': 'uncertain', 'intent': record.get('state')}
        job, source, target, public = self._paths(manifest)
        self._directory(source, private=True)
        info = source.stat()
        contract.hex_value(record.get('stopped_invocation_id'), 32)
        if (self._mounts(source, target) or os.path.lexists(target) or os.path.lexists(public)
                or (info.st_dev, info.st_ino) != (record['device'], record['inode'])):
            raise PermissionError('retained_storage_state_not_proven')
        return {'state': 'retained', 'source': str(source), 'mount_absent': True,
                'stopped_invocation_id': record['stopped_invocation_id'],
                'manifest_sha256': record['manifest_sha256'], 'receipt_sha256': record['receipt_sha256']}

    def cleanup(self, manifest, receipt, stopped):
        # Caller must freshly check own unit identity/cgroup, not trust API input.
        if (stopped.get('unit') != receipt['unit'] or stopped.get('worker_boot_id') != receipt['boot_id']
                or stopped.get('main_pid') != 0 or stopped.get('cgroup_empty') is not True
                or stopped.get('unit_stopped') is not True):
            raise PermissionError('fresh_own_stopped_storage_proof_required')
        contract.hex_value(stopped.get('invocation_id'), 32)
        self.verify(manifest, receipt)
        record = self._record(manifest, receipt)
        job, source, target, public = self._paths(manifest)
        record['state'] = 'unmount_intent'; self._write(job, record)
        self.runner(['/usr/bin/umount', '--', str(target)])
        if self._mounts(source, target):
            raise PermissionError('storage_unmount_not_proven')
        underlay = target.lstat()
        if not stat.S_ISDIR(underlay.st_mode) or (underlay.st_dev, underlay.st_ino) != (record['underlay_device'], record['underlay_inode']):
            raise PermissionError('foreign_storage_underlay')
        self._directory(job, private=True)
        # Parent700 remains root-owned throughout; retained dynamic UID cannot
        # reach stale contents through either mountpoint or project ancestry.
        os.chown(source, self.uid, -1); os.chmod(source, 0o700)
        if os.path.lexists(public):
            if not public.is_symlink() or os.readlink(public) not in {str(target), 'private/' + target.name}:
                raise PermissionError('foreign_public_state_path')
            public.unlink()
        target.rmdir()
        record['state'] = 'retained'; record['stopped_invocation_id'] = stopped['invocation_id']
        self._write(job, record)
        return {'state': 'retained', 'source': str(source), 'mount_absent': True}
