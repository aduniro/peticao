"""Owner-preserving, dirfd-relative metadata publication, not three-file CAS.

Fencing/quiescence and cooperative operator serialization remain mandatory.
Only the three coordinator promotion files may be written for UID999:GID987.
Root/private snapshot metadata retains its original caller-owned behavior.
"""
import contextlib
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

SERVICE = (999, 987)
SERVICE_FILES = {"generation-floor.json", "authority.json", "promotion.json"}
UNSPECIFIED = object()


class PublicationUncertain(RuntimeError):
    replaced = True


@dataclass(frozen=True)
class Snapshot:
    identity: tuple
    raw: bytes


def directory(path, service=False):
    path = Path(path).absolute()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = following
        info = os.fstat(fd)
        owner = (info.st_uid, info.st_gid)
        allowed = {SERVICE} if service else {SERVICE, (0, 0)}
        if not service and os.geteuid() != 0:
            allowed.add((os.geteuid(), os.getegid()))
        if owner not in allowed or stat.S_IMODE(info.st_mode) != 0o700:
            raise PermissionError("private_expected_owner_directory_required")
        return fd, owner
    except BaseException:
        os.close(fd)
        raise


def snapshot(fd, name, owner):
    # Never open FIFOs, links or foreign files, even when the caller is root.
    try:
        before = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or (before.st_uid, before.st_gid) != owner or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > 1024*1024):
        raise PermissionError("private_regular_singlelink_expected_owner_file_required")
    file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        info = os.fstat(file)
        if (before.st_dev, before.st_ino) != (info.st_dev, info.st_ino):
            raise RuntimeError("metadata_replaced_during_open")
        raw = bytearray()
        while len(raw) <= 1024*1024:
            part = os.read(file, min(65536, 1024*1024+1-len(raw)))
            if not part:
                break
            raw.extend(part)
        after = os.fstat(file)
    finally:
        os.close(file)
    fields = ("st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
    if len(raw) > 1024*1024 or len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
        raise RuntimeError("metadata_changed_during_read")
    return Snapshot(tuple(getattr(after, k) for k in fields) + (hashlib.sha256(raw).hexdigest(),), bytes(raw))


def atomic_json(path, value, expected=UNSPECIFIED):
    path = Path(path).absolute()
    if path.name in {"", ".", ".."}:
        raise ValueError("metadata_name_required")
    raw = json.dumps(value, sort_keys=True, indent=2, allow_nan=False).encode()
    if len(raw) > 1024*1024:
        raise ValueError("bounded_metadata_required")
    fd, owner = directory(path.parent)
    temp, opened, created, published = ".metadata-" + uuid.uuid4().hex, None, None, False
    try:
        if owner == SERVICE and path.name not in SERVICE_FILES:
            raise PermissionError("fixed_service_metadata_names_required")
        original = snapshot(fd, path.name, owner)
        if expected is not UNSPECIFIED and original != expected:
            raise RuntimeError("metadata_preimage_changed")
        opened = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        created = os.fstat(opened)
        offset = 0
        while offset < len(raw):
            count = os.write(opened, raw[offset:])
            if count <= 0:
                raise OSError("metadata_write_not_completed")
            offset += count
        # Apply final owner/mode before publication and fsync both data+metadata.
        os.fchown(opened, *owner)
        os.fchmod(opened, 0o600)
        os.fsync(opened)
        if snapshot(fd, path.name, owner) != original:
            raise RuntimeError("metadata_preimage_changed_before_publication")
        current_temp = os.stat(temp, dir_fd=fd, follow_symlinks=False)
        final = os.fstat(opened)
        if ((current_temp.st_dev, current_temp.st_ino) != (created.st_dev, created.st_ino)
                or (final.st_uid, final.st_gid) != owner or stat.S_IMODE(final.st_mode) != 0o600 or final.st_nlink != 1):
            raise RuntimeError("own_temporary_metadata_changed")
        os.replace(temp, path.name, src_dir_fd=fd, dst_dir_fd=fd)
        published = True
        os.fsync(fd)
    except BaseException as exc:
        if not published and created is not None:
            # A transport/filesystem wrapper may lose the successful rename
            # reply. Observe the target inode before treating this as rollback.
            with contextlib.suppress(FileNotFoundError):
                destination = os.stat(path.name, dir_fd=fd, follow_symlinks=False)
                published = (destination.st_dev, destination.st_ino) == (created.st_dev, created.st_ino)
        if published:
            raise PublicationUncertain("metadata_visible_durability_uncertain_observe_no_rollback") from exc
        if created is not None:
            with contextlib.suppress(FileNotFoundError):
                current = os.stat(temp, dir_fd=fd, follow_symlinks=False)
                if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                    os.unlink(temp, dir_fd=fd)
        raise
    finally:
        if opened is not None:
            os.close(opened)
        os.close(fd)


def service_preimages(target):
    fd, owner = directory(target, service=True)
    try:
        values = {name: snapshot(fd, name, owner) for name in SERVICE_FILES | {"recovery-origin.json"}}
        if any(values[name] is None for name in ("authority.json", "generation-floor.json", "recovery-origin.json")):
            raise ValueError("existing_service_recovery_metadata_required")
        return values
    finally:
        os.close(fd)


@contextlib.contextmanager
def service_lock(target):
    fd, owner = directory(target, service=True)
    lock = None
    try:
        try:
            lock = os.open(".recovery.lock", os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            os.fchown(lock, *owner); os.fchmod(lock, 0o600); os.fsync(lock); os.fsync(fd)
        except FileExistsError:
            snapshot(fd, ".recovery.lock", owner)
            lock = os.open(".recovery.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        value = os.fstat(lock)
        if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or (value.st_uid, value.st_gid) != owner or stat.S_IMODE(value.st_mode) != 0o600:
            raise PermissionError("private_service_operator_lock_required")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("cooperative_operator_busy") from None
        yield
    finally:
        if lock is not None:
            os.close(lock)
        os.close(fd)
