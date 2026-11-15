"""Read-only evidence for project backing and own-unit host-temp absence.

No mounts, chmod/chown, file creation or cleanup. inotify roots are fixed in the
root helper; injectable roots below are an explicit local-test seam, never RPC.
Only systemd255's reviewed boot32/unit name format is accepted initially. A
different actual version requires another reviewed format, not an inference.
"""
import ctypes
import errno
import hashlib
import os
from pathlib import Path
import re
import stat
import struct

PROJECT = Path("/mnt/apps/peticao-final/.runtime")
TMP_ROOTS = (Path("/tmp"), Path("/var/tmp"))
UNITS = re.compile(r"admin-dev-[a-f0-9]{32}-g1\.service\Z")
EVENT = struct.Struct("iIII")
CREATE, DELETE, MOVED_FROM, MOVED_TO = 0x100, 0x200, 0x40, 0x80
DELETE_SELF, MOVE_SELF, UNMOUNT, OVERFLOW, IGNORED = 0x400, 0x800, 0x2000, 0x4000, 0x8000
ONLYDIR, DONT_FOLLOW = 0x01000000, 0x02000000
MASK = CREATE | DELETE | MOVED_FROM | MOVED_TO | DELETE_SELF | MOVE_SELF | UNMOUNT | ONLYDIR | DONT_FOLLOW


def version_evidence(raw, expected_sha256, expected_major):
    if type(raw) is not bytes or len(raw) > 32768 or type(expected_major) is not int:
        raise ValueError("bounded_exact_systemd_version_required")
    found = re.match(rb"systemd ([0-9]+)(?:[ (\n]|$)", raw)
    if not found or int(found.group(1)) != expected_major or expected_major != 255:
        raise PermissionError("unreviewed_systemd_temp_name_format")
    if not re.fullmatch("[a-f0-9]{64}", expected_sha256) or hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise PermissionError("actual_systemd_version_differs_from_reviewed_manifest")
    return {"verified": True, "major": expected_major, "sha256": expected_sha256,
            "format": "systemd-private-boot32-unit-random-v255"}


def prefixes(boot, units, evidence):
    if (type(evidence) is not dict or evidence.get("verified") is not True or evidence.get("major") != 255
            or evidence.get("format") != "systemd-private-boot32-unit-random-v255"):
        raise PermissionError("reviewed_actual_version_evidence_required")
    if type(boot) is not str or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", boot):
        raise ValueError("actual_canonical_kernel_boot_required")
    if type(units) not in {tuple, list} or len(units) != 3 or len(set(units)) != 3 or any(type(u) is not str or not UNITS.fullmatch(u) for u in units):
        raise ValueError("exact_three_own_units_required")
    return tuple(("systemd-private-" + boot.replace("-", "") + "-" + u + "-").encode() for u in units)


class TmpAudit:
    def __init__(self, boot, units, evidence, *, roots=None):
        self.prefixes = prefixes(boot, units, evidence)
        self.units = tuple(u.encode() for u in units)
        self.roots = tuple(Path(p).absolute() for p in (TMP_ROOTS if roots is None else roots))
        if len(self.roots) != 2 or len(set(self.roots)) != 2:
            raise ValueError("exact_two_audit_roots_required")
        if roots is None and os.geteuid() != 0:
            raise PermissionError("host_tmp_audit_requires_root_operator")
        self.fd, self.parents, self.watches = None, [], {}
        self.matching_events = self.matching_existing = 0
        self.overflow = self.watch_lost = False
        self.host_scope = roots is None
        self.manager_namespace = None
        self.manager_roots = None
        if self.host_scope:
            own, manager = os.stat("/proc/self/ns/mnt"), os.stat("/proc/1/ns/mnt")
            if (own.st_dev, own.st_ino) != (manager.st_dev, manager.st_ino):
                raise PermissionError("helper_not_in_service_manager_mount_namespace")
            self.manager_namespace = (manager.st_dev, manager.st_ino)
            self.manager_roots = self._manager_view()
        libc = ctypes.CDLL(None, use_errno=True)
        self.add = libc.inotify_add_watch
        self.add.argtypes, self.add.restype = (ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32), ctypes.c_int
        init = libc.inotify_init1
        init.argtypes, init.restype = (ctypes.c_int,), ctypes.c_int
        self.fd = init(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), "inotify_init_failed")
        try:
            for root in self.roots:
                before = root.lstat()
                if not stat.S_ISDIR(before.st_mode):
                    raise PermissionError("audit_root_directory_no_links_required")
                if roots is None and before.st_uid != 0:
                    raise PermissionError("host_tmp_root_owner_required")
                name_max = os.pathconf(root, "PC_NAME_MAX")
                if any(len(p) + 6 > name_max for p in self.prefixes):
                    raise PermissionError("temp_name_would_require_unreviewed_truncation")
                parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                identity = (before.st_dev, before.st_ino)
                if identity != (os.fstat(parent).st_dev, os.fstat(parent).st_ino):
                    os.close(parent)
                    raise PermissionError("audit_root_changed_during_open")
                self.parents.append((root, parent, identity))
                wd = self.add(self.fd, os.fsencode(root), MASK)
                if wd < 0:
                    raise OSError(ctypes.get_errno(), "inotify_watch_failed")
                self.watches.setdefault(wd, []).append(root)
                self.matching_existing += self._existing(root)
            self.drain()
        except BaseException:
            self.close()
            raise

    def _matches(self, name):
        # Exact format is version-qualified. Also fail on own literal unit in an
        # unexpected name instead of silently missing a changed naming scheme.
        return any(name.startswith(p) for p in self.prefixes) or any(u in name for u in self.units)

    def _manager_view(self):
        identities = {}
        for path in ("/", "/tmp", "/var/tmp"):
            own = os.stat(path)
            manager = os.stat("/proc/1/root" + ("" if path == "/" else path))
            if (own.st_dev, own.st_ino) != (manager.st_dev, manager.st_ino):
                raise PermissionError("helper_chroot_or_tmp_view_differs_from_service_manager")
            identities[path] = (own.st_dev, own.st_ino)
        return identities

    def _existing(self, root):
        count = 0
        with os.scandir(root) as entries:
            for index, entry in enumerate(entries):
                if index >= 100000:
                    raise RuntimeError("audit_directory_budget_exceeded")
                if self._matches(os.fsencode(entry.name)):
                    count += 1
        return count

    def consume(self, raw):
        offset = 0
        while offset < len(raw):
            if len(raw) - offset < EVENT.size:
                self.watch_lost = True
                raise RuntimeError("truncated_inotify_evidence")
            wd, mask, _, length = EVENT.unpack_from(raw, offset)
            end = offset + EVENT.size + length
            if end > len(raw):
                self.watch_lost = True
                raise RuntimeError("truncated_inotify_name")
            name = raw[offset + EVENT.size:end].split(b"\0", 1)[0]
            if mask & OVERFLOW:
                self.overflow = True
            if mask & (IGNORED | UNMOUNT | DELETE_SELF | MOVE_SELF) or (wd not in self.watches and not mask & OVERFLOW):
                self.watch_lost = True
            if self._matches(name):
                self.matching_events += 1
            offset = end

    def drain(self):
        if self.fd is None:
            raise RuntimeError("audit_not_active")
        for _ in range(256):
            try:
                raw = os.read(self.fd, 65536)
            except BlockingIOError:
                return
            except InterruptedError:
                continue
            if not raw:
                self.watch_lost = True
                raise RuntimeError("audit_stream_closed")
            self.consume(raw)
        self.overflow = True
        raise RuntimeError("audit_drain_budget_exceeded")

    def proof(self):
        self.drain()
        unchanged = True
        existing = 0
        for root, fd, identity in self.parents:
            current = root.lstat()
            unchanged &= identity == (current.st_dev, current.st_ino) == (os.fstat(fd).st_dev, os.fstat(fd).st_ino)
            existing += self._existing(root)
        # Events created AND removed during the scandir cannot be discarded by
        # the final proof followed by close(). Overflow remains inconclusive.
        self.drain()
        if self.host_scope:
            own, manager = os.stat("/proc/self/ns/mnt"), os.stat("/proc/1/ns/mnt")
            unchanged &= self.manager_namespace == (own.st_dev, own.st_ino) == (manager.st_dev, manager.st_ino)
            unchanged &= self.manager_roots == self._manager_view()
        result = {"roots": 2, "matching_events": self.matching_events, "matching_existing": max(existing, self.matching_existing),
                  "overflow": self.overflow, "watch_lost": self.watch_lost, "parents_unchanged": unchanged,
                  "scope": "manager_host_tmp_roots" if self.host_scope else "local_test_roots",
                  "manager_namespace_verified": self.host_scope and unchanged}
        if self.overflow or self.watch_lost or not unchanged or result["matching_existing"] or self.matching_events:
            raise RuntimeError("host_tmp_absence_not_proven")
        return result

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        for _, fd, _ in self.parents:
            os.close(fd)
        self.parents.clear()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def backing_evidence(proof, manifest_sha, receipt_sha, boot, child, source_parent):
    expected = {"source", "target", "mount_id", "device", "inode", "manifest_sha256", "receipt_sha256", "worker_boot_id"}
    if type(proof) is not dict or set(proof) != expected:
        raise ValueError("exact_storage_binding_proof_required")
    if proof["manifest_sha256"] != manifest_sha or proof["receipt_sha256"] != receipt_sha or proof["worker_boot_id"] != boot:
        raise PermissionError("storage_binding_identity_mismatch")
    source, target = Path(proof["source"]), Path(proof["target"])
    if (not source.is_absolute() or not source.is_relative_to(PROJECT) or ".." in source.parts
            or source.parent != Path(source_parent) or not re.fullmatch(r"peticao-dev-job-[a-f0-9]{32}-g1", source.parent.name)
            or source.name != "work" or target != Path("/var/lib/private") / source.parent.name):
        raise PermissionError("fixed_project_backing_paths_required")
    if type(proof["mount_id"]) is not int or proof["mount_id"] < 1 or any(type(proof[k]) is not int or proof[k] < 1 for k in ("device", "inode")):
        raise ValueError("actual_mount_device_inode_required")
    for path in (source, target):
        for ancestor in [*reversed(path.parents), path]:
            if stat.S_ISLNK(ancestor.lstat().st_mode):
                raise PermissionError("storage_proof_link_refused")
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or (info.st_dev, info.st_ino) != (proof["device"], proof["inode"]):
            raise PermissionError("physical_backing_identity_mismatch")
    parent = source.parent.stat()
    if parent.st_uid != 0 or parent.st_gid != 0 or stat.S_IMODE(parent.st_mode) != 0o700:
        raise PermissionError("root_private_parent_lifecycle_required")
    if (type(child) is not dict or child.get("cwd_device") != proof["device"] or child.get("cwd_inode") != proof["inode"]
            or child.get("direct_runtime_access_denied") is not True):
        raise PermissionError("actual_namespace_backing_or_direct_access_not_proven")
    return {"same_device_inode": True, "project_backing": True, "root_private_parent": True, "direct_access_denied": True}
