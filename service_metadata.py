"""Owner/mode preserving metadata CAS for explicitly reviewed service layouts.

Directory ownership is intentionally distinct on Santiago and Civo. This is
not a multi-file transaction, authorization mechanism or protection against an
administrator who can bypass the canonical operation/stop other writers.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

LIMIT = 1024 * 1024
FIELDS = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink',
          'st_size', 'st_mtime_ns', 'st_ctime_ns')


@dataclass(frozen=True)
class Layout:
    directory_uid: int
    directory_gid: int
    directory_mode: int
    file_uid: int
    file_gid: int
    file_mode: int


SANTIAGO = Layout(999, 989, 0o2770, 0, 989, 0o644)
CIVO = Layout(999, 987, 0o700, 999, 987, 0o600)
EPOCH = Layout(0, 0, 0o755, 0, 0, 0o644)


@dataclass(frozen=True)
class Snapshot:
    directory: tuple
    identity: tuple
    raw: bytes

    @property
    def sha256(self):
        return hashlib.sha256(self.raw).hexdigest()


class PublicationUncertain(RuntimeError):
    replaced = True


def root_ancestor(info):
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise PermissionError('root_metadata_ancestor_required')


class Metadata:
    def __init__(self, path, layout, ancestor_validator=root_ancestor):
        self.path, self.layout = Path(path).absolute(), layout
        self.ancestor_validator = ancestor_validator
        if '..' in self.path.parts or self.path.name not in {'authority.json', 'epoch.json'}:
            raise PermissionError('fixed_authority_or_epoch_filename_required')

    def directory(self):
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self.ancestor_validator(os.fstat(fd))
            parents = self.path.parts[1:-1]
            for index, part in enumerate(parents):
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
                if index != len(parents) - 1:
                    self.ancestor_validator(os.fstat(fd))
            info = os.fstat(fd)
            layout = self.layout
            if ((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
                    != (layout.directory_uid, layout.directory_gid, layout.directory_mode)):
                raise PermissionError('reviewed_metadata_directory_layout_required')
            return fd
        except BaseException:
            os.close(fd)
            raise

    def snapshot(self, directory):
        try:
            original = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            return None
        layout = self.layout
        if (not stat.S_ISREG(original.st_mode) or original.st_nlink != 1 or original.st_size > LIMIT
                or (original.st_uid, original.st_gid, stat.S_IMODE(original.st_mode))
                != (layout.file_uid, layout.file_gid, layout.file_mode)):
            raise PermissionError('reviewed_singlelink_metadata_file_required')
        opened = os.open(self.path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(opened)
            if (before.st_dev, before.st_ino) != (original.st_dev, original.st_ino):
                raise PermissionError('metadata_replaced_before_open')
            blocks, count = [], 0
            while count <= LIMIT:
                block = os.read(opened, min(65536, LIMIT + 1 - count))
                if not block:
                    break
                blocks.append(block)
                count += len(block)
            after = os.fstat(opened)
        finally:
            os.close(opened)
        current = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False)
        if count > LIMIT or count != original.st_size or any(getattr(original, k) != getattr(after, k)
                or getattr(original, k) != getattr(current, k) for k in FIELDS):
            raise PermissionError('metadata_changed_during_read')
        parent = os.fstat(directory)
        return Snapshot((parent.st_dev, parent.st_ino, parent.st_uid, parent.st_gid, parent.st_mode),
                        tuple(getattr(after, k) for k in FIELDS), b''.join(blocks))

    def read(self):
        directory = self.directory()
        try:
            return self.snapshot(directory)
        finally:
            os.close(directory)

    def publish(self, value, expected):
        raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        if len(raw) > LIMIT:
            raise ValueError('metadata_publication_budget')
        directory, opened, published = self.directory(), None, False
        name = '.authority-' + uuid.uuid4().hex
        try:
            if self.snapshot(directory) != expected:
                raise PermissionError('metadata_preimage_changed')
            opened = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            offset = 0
            while offset < len(raw):
                written = os.write(opened, raw[offset:])
                if written <= 0:
                    raise OSError('metadata_write_incomplete')
                offset += written
            os.fchown(opened, self.layout.file_uid, self.layout.file_gid)
            os.fchmod(opened, self.layout.file_mode)
            os.fsync(opened)
            if self.snapshot(directory) != expected:
                raise PermissionError('metadata_preimage_changed_before_publish')
            os.replace(name, self.path.name, src_dir_fd=directory, dst_dir_fd=directory)
            published = True
            os.fsync(directory)
            result = self.snapshot(directory)
            if result is None or result.raw != raw:
                raise PublicationUncertain('metadata_publication_readback_uncertain')
            return result
        except BaseException as error:
            # Preserve the publication temp/evidence on failure. Never perform
            # a silent retry, rollback or change somebody else's ownership.
            if published and not isinstance(error, PublicationUncertain):
                raise PublicationUncertain('visible_metadata_requires_observation') from None
            raise
        finally:
            if opened is not None:
                os.close(opened)
            os.close(directory)
