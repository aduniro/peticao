"""Bounded offline input custody and manual extraction; no workload execution.

Archive hashes bind bytes only. Nothing in this module qualifies a dependency
cache, toolchain, runtime or worker. Hardlinks are deliberately unsupported,
including the esbuild hardlink present in the historical public deps archive.
"""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

LIMITS = {
    "source": {"members": 10000, "bytes": 128 * 1024**2},
    "deps": {"members": 30000, "bytes": 2 * 1024**3},
}
MAX_COMPRESSED = 512 * 1024**2
MAX_FILE = 256 * 1024**2
MAX_PATH = 1024
MAX_LINK_DEPTH = 40
FORBIDDEN_PARTS = frozenset({".ssh", ".aws", ".gnupg", ".config", ".codex", ".git", "secrets", "credentials"})


class InputRejected(ValueError):
    pass


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _regular(info, expected_uid):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != expected_uid
            or info.st_nlink != 1 or info.st_mode & 0o022):
        raise PermissionError("owned_unlinked_regular_readonly_to_others_input_required")


def _trusted_input_parent(path, expected_uid):
    """Walk every ancestor through held directory fds, without following links."""
    parts = Path(path).absolute().parts
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[1:-1]:
            info = os.fstat(fd)
            if info.st_uid not in {0, expected_uid} or info.st_mode & 0o022:
                raise PermissionError("root_controlled_input_ancestors_required")
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        info = os.fstat(fd)
        if info.st_uid not in {0, expected_uid} or info.st_mode & 0o022:
            raise PermissionError("root_controlled_input_ancestors_required")
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def verified_input(path, sha256, size, _expected_uid=0):
    """Hash and consume the SAME held fd; verify identity/stat on both sides.

    _expected_uid is a local fixture owner seam, not a production policy knob.
    Ancestors must still be root/expected-owner controlled and non-writable by
    group/other. Caller must not replace fp or reopen the input pathname.
    """
    if type(sha256) is not str or not re.fullmatch("[a-f0-9]{64}", sha256):
        raise InputRejected("canonical_input_sha256_required")
    if type(size) is not int or not 0 < size <= MAX_COMPRESSED:
        raise InputRejected("bounded_exact_input_size_required")
    if type(_expected_uid) is not int or _expected_uid < 0:
        raise InputRejected("expected_owner_uid_required")
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise InputRejected("absolute_canonical_input_path_required")
    parent = _trusted_input_parent(path, _expected_uid)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, "rb") as fp:
            before = os.fstat(fp.fileno())
            _regular(before, _expected_uid)
            if before.st_size != size:
                raise InputRejected("input_size_mismatch")
            if _signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != _signature(before):
                raise InputRejected("input_path_identity_changed")
            digest = hashlib.sha256()
            for chunk in iter(lambda: fp.read(1024**2), b""):
                digest.update(chunk)
            if digest.hexdigest() != sha256 or _signature(os.fstat(fp.fileno())) != _signature(before):
                raise InputRejected("input_hash_or_stat_changed")
            fp.seek(0)
            try:
                yield fp
            finally:
                after = os.fstat(fp.fileno())
                named = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
                if _signature(after) != _signature(before) or _signature(named) != _signature(before):
                    raise InputRejected("verified_input_changed_during_consumption")
    finally:
        os.close(parent)


def _name(name):
    if (type(name) is not str or not name or len(name.encode("utf-8")) > MAX_PATH
            or "\\" in name or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise InputRejected("bounded_canonical_archive_path_required")
    path = PurePosixPath(name)
    if path.is_absolute() or str(path) != name or any(part in {"", ".", ".."} for part in name.split("/")) or len(path.parts) > 128:
        raise InputRejected("archive_path_traversal_or_alias")
    return path.parts


def _allowed(name, kind):
    parts = _name(name)
    if any(part.lower() in FORBIDDEN_PARTS for part in parts):
        raise InputRejected("credential_or_configuration_directory_forbidden")
    if any(part.startswith(".env") and not (name == "site/.env.example" and kind == "source") for part in parts):
        raise InputRejected("environment_input_forbidden")
    if any(part in {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"} for part in parts):
        raise InputRejected("private_key_input_forbidden")
    if kind == "source":
        allowed = (name == "AGENTS.md" or parts[0] == "site"
                   or name == "tools" or name.startswith("tools/preview/") or name == "tools/preview"
                   or name.startswith("tools/admin-qa/") or name == "tools/admin-qa")
        if parts[0] == "site" and "node_modules" in parts:
            raise InputRejected("source_dependency_tree_forbidden")
    else:
        allowed = parts[0] == "node_modules" or name in {"node", "package-lock.json", "package.tgz"}
    if not allowed:
        raise InputRejected("fixed_archive_prefix_required")
    return parts


def _link_target(name, target):
    if (type(target) is not str or not target or target.startswith("/") or "\\" in target
            or len(target.encode("utf-8")) > MAX_PATH or any(ord(c) < 32 or ord(c) == 127 for c in target)):
        raise InputRejected("bounded_relative_symlink_target_required")
    parts = name.split("/")[:-1]
    for component in target.split("/"):
        if component in {"", "."}:
            raise InputRejected("canonical_symlink_target_required")
        if component == "..":
            if not parts:
                raise InputRejected("symlink_escapes_archive")
            parts.pop()
        else:
            parts.append(component)
    result = "/".join(parts)
    if not parts or parts[0] != "node_modules":
        raise InputRejected("symlink_escapes_dependency_prefix")
    _allowed(result, "deps")
    return result


class _BoundedTarInfo(tarfile.TarInfo):
    # tarfile consumes PAX/GNU extension records before yielding members. Bound
    # those hidden headers BEFORE stdlib allocates their payload, too.
    def _proc_member(self, archive):
        archive._input_header_count = getattr(archive, "_input_header_count", 0) + 1
        if archive._input_header_count > 3 * max(value["members"] for value in LIMITS.values()):
            raise InputRejected("archive_hidden_header_count_exceeded")
        extension_types = {tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE,
                           tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK}
        if self.type in extension_types:
            archive._input_metadata_bytes = getattr(archive, "_input_metadata_bytes", 0) + self.size
            if archive._input_metadata_bytes > 8 * 1024**2:
                raise InputRejected("archive_hidden_metadata_budget_exceeded")
        if self.type in {tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE} and self.size > 65536:
            raise InputRejected("archive_pax_header_too_large")
        if self.type in {tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK} and self.size > MAX_PATH + 1:
            raise InputRejected("archive_long_header_too_large")
        if self.type == tarfile.GNUTYPE_SPARSE or self.size < 0 or self.size > MAX_FILE:
            raise InputRejected("special_or_oversized_archive_header")
        return super()._proc_member(archive)

    def _proc_pax(self, archive):
        position = archive.fileobj.tell()
        payload = archive.fileobj.read(self._block(self.size))
        archive.fileobj.seek(position)
        if b"GNU.sparse" in payload or b"SCHILY.realsize" in payload or b"SCHILY.filetype=sparse" in payload:
            raise InputRejected("sparse_pax_extensions_forbidden")
        return super()._proc_pax(archive)


def archive_manifest(fp, kind):
    """Validate complete bounded inventory before destination creation/writes.

    Source roots are the actual frozen AGENTS.md/site/tools/{preview,admin-qa}.
    Deps roots are node_modules/node/package-lock.json/package.tgz, not invented
    pdfjs directories. Safe NPM/PG symlinks may target existing in-archive nodes;
    hardlinks always reject with an explicit pending/repack requirement.
    """
    if type(kind) is not str or kind not in LIMITS:
        raise InputRejected("fixed_archive_kind_required")
    fp.seek(0, os.SEEK_END)
    if fp.tell() > MAX_COMPRESSED:
        raise InputRejected("compressed_archive_too_large")
    fp.seek(0)
    entries = []
    by_name = {}
    total = 0
    try:
        with tarfile.open(fileobj=fp, mode="r:*", tarinfo=_BoundedTarInfo) as archive:
            for member in archive:
                if len(entries) >= LIMITS[kind]["members"]:
                    raise InputRejected("archive_member_count_exceeded")
                _allowed(member.name, kind)
                if member.name in by_name:
                    raise InputRejected("duplicate_archive_member")
                if member.islnk():
                    raise InputRejected("hardlinks_forbidden_pending_reviewed_repack")
                if member.issparse() or member.size < 0 or member.size > MAX_FILE or member.mode & 0o7000:
                    raise InputRejected("special_or_oversized_archive_member")
                if member.isfile():
                    category = "file"
                elif member.isdir():
                    category = "directory"
                elif member.issym() and kind == "deps":
                    category = "symlink"
                else:
                    raise InputRejected("unsupported_archive_member_type")
                if category != "file" and member.size != 0:
                    raise InputRejected("nonfile_archive_payload_forbidden")
                total += member.size
                if total > LIMITS[kind]["bytes"]:
                    raise InputRejected("archive_unpacked_bytes_exceeded")
                entry = {"name": member.name, "type": category, "size": member.size,
                         "mode": 0o755 if member.mode & 0o111 else 0o644}
                if category == "symlink":
                    entry["linkname"] = member.linkname
                    entry["resolved_target"] = _link_target(member.name, member.linkname)
                entries.append(entry); by_name[member.name] = entry
    except (tarfile.TarError, EOFError) as error:
        raise InputRejected("invalid_or_truncated_archive") from error
    finally:
        fp.seek(0)
    for name, entry in by_name.items():
        parent = PurePosixPath(name).parent
        while str(parent) != ".":
            other = by_name.get(str(parent))
            if other and other["type"] != "directory":
                raise InputRejected("archive_member_beneath_file_or_symlink")
            parent = parent.parent
        if entry["type"] == "symlink":
            current = entry["resolved_target"]
            visited = {name}
            for _ in range(MAX_LINK_DEPTH):
                if current in visited:
                    raise InputRejected("symlink_loop")
                visited.add(current)
                target = by_name.get(current)
                if target is None:
                    raise InputRejected("dangling_or_implicit_symlink_target")
                if target["type"] != "symlink":
                    break
                current = target["resolved_target"]
            else:
                raise InputRejected("symlink_depth_exceeded")
            entry["final_target"] = current
    if kind == "source":
        if not any(name.startswith("site/") and entry["type"] == "file" for name, entry in by_name.items()) or not any(name.startswith("tools/preview/") and entry["type"] == "file" for name, entry in by_name.items()):
            raise InputRejected("source_site_and_preview_required")
    elif not all(by_name.get(name, {}).get("type") == "file" for name in ("node", "package-lock.json", "package.tgz")) or not any(name.startswith("node_modules/") for name in by_name):
        raise InputRejected("actual_dependency_roots_required")
    return {"version": 1, "kind": kind, "members": len(entries), "unpacked_bytes": total, "entries": entries,
            "qualified": False, "cache_integrity_verified": False}


def _open_directory(parent_fd, component, create=False):
    if create:
        try:
            os.mkdir(component, 0o700, dir_fd=parent_fd)
            os.fsync(parent_fd)
        except FileExistsError:
            pass
    return os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)


def _destination(dest):
    value = os.fspath(dest)
    if type(value) is not str:
        raise InputRejected("relative_new_destination_required")
    _name(value)
    root = os.open(".", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = root
    try:
        info = os.fstat(root)
        if info.st_uid != os.geteuid() or info.st_mode & 0o022:
            raise PermissionError("trusted_private_current_job_directory_required")
        components = value.split("/")
        for component in components[:-1]:
            child = _open_directory(fd, component)
            if fd != root:
                os.close(fd)
            fd = child
            info = os.fstat(fd)
            if info.st_uid != os.geteuid() or info.st_mode & 0o022:
                raise PermissionError("owned_destination_parents_required")
        os.mkdir(components[-1], 0o700, dir_fd=fd)  # Never resume/reinitialize.
        result = _open_directory(fd, components[-1])
        os.fsync(fd)
        return result
    finally:
        if fd != root:
            os.close(fd)
        os.close(root)


def _member_parent(root_fd, name):
    parts = name.split("/")
    fd = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            child = _open_directory(fd, part, create=True)
            os.close(fd); fd = child
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def extract_input(path, sha256, size, dest, kind, _expected_uid=0):
    """Extract once below trusted CWD; failures keep partial destination intact."""
    with verified_input(path, sha256, size, _expected_uid) as fp:
        manifest = archive_manifest(fp, kind)
        root = _destination(dest)
        try:
            expected = {entry["name"]: entry for entry in manifest["entries"]}
            seen = set()
            with tarfile.open(fileobj=fp, mode="r:*", tarinfo=_BoundedTarInfo) as archive:
                for member in archive:
                    entry = expected.get(member.name)
                    category = "file" if member.isfile() else "directory" if member.isdir() else "symlink" if member.issym() else "unsupported"
                    if (entry is None or member.name in seen or member.size != entry["size"]
                            or category != entry["type"] or (0o755 if member.mode & 0o111 else 0o644) != entry["mode"]
                            or category == "symlink" and member.linkname != entry["linkname"]):
                        raise InputRejected("archive_changed_after_inventory")
                    seen.add(member.name)
                    if entry["type"] == "symlink":
                        continue  # All files/dirs first; never traverse links.
                    parent, leaf = _member_parent(root, member.name)
                    try:
                        if entry["type"] == "directory":
                            directory = _open_directory(parent, leaf, create=True)
                            os.close(directory)
                        else:
                            target = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, entry["mode"], dir_fd=parent)
                            with os.fdopen(target, "wb") as output, archive.extractfile(member) as source:
                                remaining = entry["size"]
                                while remaining:
                                    chunk = source.read(min(1024**2, remaining))
                                    if not chunk:
                                        raise InputRejected("truncated_member_payload")
                                    output.write(chunk); remaining -= len(chunk)
                                if source.read(1):
                                    raise InputRejected("oversized_member_payload")
                                output.flush(); os.fsync(output.fileno())
                        os.fsync(parent)
                    finally:
                        os.close(parent)
            if seen != set(expected):
                raise InputRejected("archive_inventory_changed")
            for entry in manifest["entries"]:
                if entry["type"] == "symlink":
                    parent, leaf = _member_parent(root, entry["name"])
                    try:
                        os.symlink(entry["linkname"], leaf, dir_fd=parent)
                        os.fsync(parent)
                    finally:
                        os.close(parent)
            os.fsync(root)
        finally:
            os.close(root)
    return manifest
