"""Exclusive durable operator receipts in a pre-created private project root."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

NAMES = frozenset({'fence-intent.json', 'fenced-held.json', 'fenced-released.json'})


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Journal:
    def __init__(self, root, operation_id, owner=0):
        if not re.fullmatch('[a-f0-9]{32}', operation_id):
            raise ValueError('operator_operation_id_required')
        self.root, self.operation_id, self.owner = Path(root).absolute(), operation_id, owner
        # The installer prepares exactly the operation directory. Runtime calls
        # never create/chown a new authority hierarchy or storage pool.
        if self.root.name != operation_id:
            raise PermissionError('operation_private_directory_required')
        for path in [*reversed(self.root.parents), self.root]:
            if path.is_symlink():
                raise PermissionError('operator_journal_ancestry_link')
        info = self.root.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o700:
            raise PermissionError('prepared_private_operator_directory_required')

    def record(self, name, value):
        if name not in NAMES or type(value) is not dict or value.get('operation_id') != self.operation_id:
            raise PermissionError('fixed_operation_receipt_required')
        raw = canonical(value).encode()
        if len(raw) > 1024 ** 2:
            raise ValueError('operator_receipt_budget')
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fd = None
        try:
            info = os.fstat(directory)
            if info.st_uid != self.owner or stat.S_IMODE(info.st_mode) != 0o700:
                raise PermissionError('operator_journal_changed')
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:])
                if count <= 0:
                    raise OSError('operator_receipt_write_incomplete')
                offset += count
            os.fsync(fd)
            os.fsync(directory)
            return hashlib.sha256(raw).hexdigest()
        finally:
            if fd is not None:
                os.close(fd)
            os.close(directory)

    def read(self, name):
        if name not in NAMES:
            raise PermissionError('fixed_receipt_name_required')
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened = None
        try:
            parent = os.fstat(directory)
            if parent.st_uid != self.owner or stat.S_IMODE(parent.st_mode) != 0o700:
                raise PermissionError('operator_journal_changed')
            try:
                opened = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            except FileNotFoundError:
                return None
            before = os.fstat(opened)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != self.owner
                    or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or before.st_size > 1024**2):
                raise PermissionError('private_bounded_singlelink_receipt_required')
            raw = bytearray()
            while len(raw) <= 1024**2:
                block = os.read(opened, min(65536, 1024**2 + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
            after = os.fstat(opened)
            fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_mode', 'st_uid', 'st_gid', 'st_nlink')
            current = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) or getattr(before, k) != getattr(current, k) for k in fields):
                raise PermissionError('operator_receipt_changed_during_read')
            value = json.loads(raw)
            if type(value) is not dict or value.get('operation_id') != self.operation_id:
                raise PermissionError('operator_receipt_operation_mismatch')
            return value, hashlib.sha256(raw).hexdigest()
        finally:
            if opened is not None:
                os.close(opened)
            os.close(directory)
