"""Pinned current-topology transport provider, no snapshot/SSH execution.

The recovered legacy replication scheduler is intentionally not copied: its
hardcoded SP destination and deletion-based retention must not be activated.
Native checkpoint/custody/ingest qualification remains required.
"""
import hashlib
import os
from pathlib import Path
import stat

import authority_guard
import topology


def known_hosts_bytes(path):
    # Identity/knownhosts are owned by the dedicated service, not root0644.
    from remote_contract import private_file
    path = private_file(Path(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > 16384:
            raise PermissionError('bounded_private_known_hosts_required')
        raw = os.read(fd, 16385)
        after = os.fstat(fd)
        fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        current = path.stat(follow_symlinks=False)
        if (len(raw) != before.st_size or len(raw) > 16384 or before.st_nlink != 1
                or any(getattr(before, k) != getattr(after, k) or getattr(before, k) != getattr(current, k) for k in fields)):
            raise PermissionError('recovery_hostkey_file_changed')
        return raw
    finally:
        os.close(fd)


def command(authority):
    # Both checks happen before loading private hostkey metadata. This source
    # cannot turn a legacy armed bit into permission for a network transfer.
    authority_guard.require_replication_qualified()
    authority_guard.require_primary(authority)
    policy, local = topology.load(), topology.local_node()
    argv = topology.replication_argv(policy, local)
    actual = hashlib.sha256(known_hosts_bytes(policy['recovery_known_hosts'])).hexdigest()
    if actual != policy['recovery_known_hosts_sha256']:
        raise PermissionError('pinned_recovery_hostkey_digest_mismatch')
    return argv
