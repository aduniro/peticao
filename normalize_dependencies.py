"""Offline, pinned producer for ONE historical dependency-archive hardlink.

No extraction, filesystem hardlinks, program execution, download or cache
qualification. The original archive is read through one verified fd. A failed
run preserves its exclusive partial output/receipt; it never retries in place.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile

import input_provider as provider

PARENT_SHA256 = "3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698"
PARENT_BYTES = 207013889
HARDLINK_PATH = "node_modules/esbuild/bin/esbuild"
HARDLINK_TARGET = "node_modules/@esbuild/linux-x64/bin/esbuild"
EXPECTED_SYMLINKS = 22
COPY_BUFFER = 1024**2


class NormalizationRejected(ValueError):
    pass


def _hash_stream(fp, size):
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = fp.read(min(COPY_BUFFER, remaining))
        if not chunk:
            raise NormalizationRejected("truncated_regular_input_member")
        digest.update(chunk); remaining -= len(chunk)
    if fp.read(1):
        raise NormalizationRejected("oversized_regular_input_member")
    return digest.hexdigest()


def _inventory(fp):
    """The sole hardlink exception is inventoried, never passed to extractor."""
    entries, names, total = [], {}, 0
    hardlinks = []
    symlinks = []
    fp.seek(0)
    try:
        with tarfile.open(fileobj=fp, mode="r:*", tarinfo=provider._BoundedTarInfo) as archive:
            for member in archive:
                if len(entries) >= provider.LIMITS["deps"]["members"]:
                    raise NormalizationRejected("bounded_member_count_required")
                provider._allowed(member.name, "deps")
                if member.name in names:
                    raise NormalizationRejected("unique_archive_member_names_required")
                if member.issparse() or member.size < 0 or member.size > provider.MAX_FILE or member.mode & 0o7000:
                    raise NormalizationRejected("regular_bounded_member_metadata_required")
                if member.islnk():
                    if (member.name != HARDLINK_PATH or member.linkname != HARDLINK_TARGET or member.size != 0):
                        raise NormalizationRejected("only_exact_esbuild_hardlink_allowed")
                    category = "hardlink"; hardlinks.append(member.name)
                elif member.isfile():
                    category = "file"
                elif member.isdir():
                    category = "directory"
                elif member.issym():
                    category = "symlink"; symlinks.append(member.name)
                else:
                    raise NormalizationRejected("unsupported_input_member_type")
                if category != "file" and member.size:
                    raise NormalizationRejected("nonfile_payload_forbidden")
                total += member.size
                if total > provider.LIMITS["deps"]["bytes"]:
                    raise NormalizationRejected("bounded_unpacked_input_required")
                entry = {"name": member.name, "parent_type": category, "parent_size": member.size,
                         "normalized_mode": 0o755 if category == "directory" or member.mode & 0o111 else 0o644,
                         "parent_content_sha256": None}
                if category == "file":
                    with archive.extractfile(member) as stream:
                        entry["parent_content_sha256"] = _hash_stream(stream, member.size)
                elif category in {"symlink", "hardlink"}:
                    entry["parent_linkname"] = member.linkname
                    if category == "symlink":
                        entry["resolved_target"] = provider._link_target(member.name, member.linkname)
                        entry["link_target_utf8_sha256"] = hashlib.sha256(member.linkname.encode("utf-8")).hexdigest()
                entries.append(entry); names[member.name] = entry
    except (tarfile.TarError, EOFError) as error:
        raise NormalizationRejected("invalid_or_truncated_parent_archive") from error
    finally:
        fp.seek(0)
    if hardlinks != [HARDLINK_PATH]:
        raise NormalizationRejected("exactly_one_allowlisted_hardlink_required")
    if len(symlinks) != EXPECTED_SYMLINKS:
        raise NormalizationRejected("exact_historical_symlink_count_required")
    target = names.get(HARDLINK_TARGET)
    if not target or target["parent_type"] != "file":
        raise NormalizationRejected("unique_regular_esbuild_target_required")
    # Materialization adds bytes, but never exceeds the strict provider budget.
    if total + target["parent_size"] > provider.LIMITS["deps"]["bytes"]:
        raise NormalizationRejected("materialized_output_budget_exceeded")
    for name, entry in names.items():
        parent = PurePosixPath(name).parent
        while str(parent) != ".":
            found = names.get(str(parent))
            if found and found["parent_type"] != "directory":
                raise NormalizationRejected("member_beneath_nondirectory_forbidden")
            parent = parent.parent
        if entry["parent_type"] == "symlink":
            current, visited = entry["resolved_target"], {name}
            for _ in range(provider.MAX_LINK_DEPTH):
                if current in visited:
                    raise NormalizationRejected("symlink_loop_forbidden")
                visited.add(current)
                found = names.get(current)
                if not found:
                    raise NormalizationRejected("dangling_symlink_forbidden")
                if found["parent_type"] != "symlink":
                    break
                current = found["resolved_target"]
            else:
                raise NormalizationRejected("symlink_depth_exceeded")
            entry["final_target"] = current
        if entry["parent_type"] == "hardlink":
            entry["output_type"] = "file"
            entry["output_size"] = target["parent_size"]
            entry["output_content_sha256"] = target["parent_content_sha256"]
            entry["parent_logical_content_sha256"] = target["parent_content_sha256"]
            # A hardlink aliases the target's data/mode in the historical tar;
            # normalize to that regular target's reviewed executable mode.
            entry["normalized_mode"] = target["normalized_mode"]
        else:
            entry["output_type"] = entry["parent_type"]
            entry["output_size"] = entry["parent_size"]
            entry["output_content_sha256"] = entry["parent_content_sha256"]
    for required in ("node", "package-lock.json", "package.tgz"):
        if names.get(required, {}).get("parent_type") != "file":
            raise NormalizationRejected("actual_dependency_roots_required")
    return {"entries": entries, "parent_unpacked_bytes": total,
            "output_unpacked_bytes": total + target["parent_size"], "symlinks": symlinks}


def _exclusive_output(path, expected_uid):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise NormalizationRejected("absolute_new_output_path_required")
    parent = provider._trusted_input_parent(path, expected_uid)
    fd = None
    try:
        fd = os.open(path.name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        os.fchmod(fd, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != expected_uid or info.st_nlink != 1:
            raise PermissionError("exclusive_owned_regular_output_required")
        os.fsync(parent)
        return parent, os.fdopen(fd, "w+b")
    except BaseException:
        if fd is not None:
            os.close(fd)
        os.close(parent)
        raise


class _CheckedReader:
    def __init__(self, fp):
        self.fp = fp
        self.count = 0
        self.digest = hashlib.sha256()

    def read(self, size=-1):
        value = self.fp.read(size)
        self.count += len(value); self.digest.update(value)
        return value


def _produce(source, output, inventory):
    entries = inventory["entries"]
    source.seek(0)
    with tarfile.open(fileobj=source, mode="r:*", tarinfo=provider._BoundedTarInfo) as parent:
        members = parent.getmembers()
        by_name = {member.name: member for member in members}
        if len(by_name) != len(members) or set(by_name) != {entry["name"] for entry in entries}:
            raise NormalizationRejected("parent_inventory_changed")
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=6, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as child:
                for entry in entries:
                    info = tarfile.TarInfo(entry["name"])
                    info.uid = info.gid = 0; info.uname = info.gname = ""; info.mtime = 0
                    info.mode = entry["normalized_mode"]; info.size = entry["output_size"]
                    if entry["output_type"] == "directory":
                        info.type = tarfile.DIRTYPE; child.addfile(info)
                    elif entry["output_type"] == "symlink":
                        info.type = tarfile.SYMTYPE; info.linkname = entry["parent_linkname"]; child.addfile(info)
                    else:
                        info.type = tarfile.REGTYPE
                        target_name = HARDLINK_TARGET if entry["parent_type"] == "hardlink" else entry["name"]
                        member = by_name[target_name]
                        if not member.isfile() or member.size != info.size:
                            raise NormalizationRejected("unique_regular_source_changed")
                        with parent.extractfile(member) as fp:
                            reader = _CheckedReader(fp)
                            child.addfile(info, reader)
                            if reader.count != info.size or reader.digest.hexdigest() != entry["output_content_sha256"]:
                                raise NormalizationRejected("materialized_content_hash_or_size_changed")
    output.flush(); os.fsync(output.fileno())


def _validate_output(fp, inventory):
    manifest = provider.archive_manifest(fp, "deps")
    expected = inventory["entries"]
    if (manifest["members"] != len(expected) or manifest["unpacked_bytes"] != inventory["output_unpacked_bytes"]
            or [item["name"] for item in manifest["entries"]] != [item["name"] for item in expected]):
        raise NormalizationRejected("strict_output_inventory_mismatch")
    for observed, entry in zip(manifest["entries"], expected):
        if (observed["type"] != entry["output_type"] or observed["size"] != entry["output_size"]
                or observed["mode"] != (0o755 if entry["normalized_mode"] & 0o111 else 0o644)
                or observed["type"] == "symlink" and observed["linkname"] != entry["parent_linkname"]):
            raise NormalizationRejected("strict_output_member_type_size_mode_or_link_mismatch")
    fp.seek(0)
    with tarfile.open(fileobj=fp, mode="r:*", tarinfo=provider._BoundedTarInfo) as archive:
        for member, entry in zip(archive, expected):
            if (member.uid != 0 or member.gid != 0 or member.uname != "" or member.gname != "" or member.mtime != 0
                    or member.mode != entry["normalized_mode"]):
                raise NormalizationRejected("deterministic_header_mismatch")
            if entry["output_type"] == "file":
                with archive.extractfile(member) as stream:
                    if _hash_stream(stream, member.size) != entry["output_content_sha256"]:
                        raise NormalizationRejected("normalized_output_content_mismatch")
            elif entry["output_type"] == "symlink" and member.linkname != entry["parent_linkname"]:
                raise NormalizationRejected("normalized_symlink_changed")
    fp.seek(0)
    return manifest


def normalize_dependencies(path, output, receipt, *, _expected_uid=0):
    """Produce a NEW tar+receipt for the exact pinned parent, without extraction.

    Pin constants and owner seam may be monkeypatched by fictitious tests only;
    the CLI has no pin, owner, hardlink-target or symlink-policy override.
    """
    output, receipt = Path(output), Path(receipt)
    if output == receipt or not str(output).endswith(".tar.gz") or not str(receipt).endswith(".json"):
        raise NormalizationRejected("distinct_new_tar_gzip_and_json_paths_required")
    output_fp = None; output_parent = None
    try:
        with provider.verified_input(path, PARENT_SHA256, PARENT_BYTES, _expected_uid) as original:
            inventory = _inventory(original)  # All validation before new output.
            output_parent, output_fp = _exclusive_output(output, _expected_uid)
            _produce(original, output_fp, inventory)
            strict = _validate_output(output_fp, inventory)
            info = os.fstat(output_fp.fileno())
            normalized_sha = _hash_stream(output_fp, info.st_size)
            output_signature = provider._signature(info)
            record = {"version": 1, "state": "OFFLINE_NORMALIZED_ARCHIVE_VERIFIED",
                      "parent_sha256": PARENT_SHA256, "parent_bytes": PARENT_BYTES,
                      "output_sha256": normalized_sha, "output_bytes": info.st_size,
                      "parent_preserved": True, "qualified": False, "cache_integrity_verified": False,
                      "normalization": {"only_hardlink_materialized": HARDLINK_PATH, "regular_target": HARDLINK_TARGET,
                                        "target_sha256": next(entry["output_content_sha256"] for entry in inventory["entries"] if entry["name"] == HARDLINK_PATH),
                                        "target_bytes": next(entry["output_size"] for entry in inventory["entries"] if entry["name"] == HARDLINK_PATH),
                                        "symlink_count": len(inventory["symlinks"]), "symlinks_preserved": inventory["symlinks"],
                                        "uid": 0, "gid": 0, "mtime": 0, "gzip_mtime": 0, "gzip_filename": ""},
                      "entrymap": inventory["entries"],
                      "strict_manifest": {key: strict[key] for key in ("version", "kind", "members", "unpacked_bytes", "qualified", "cache_integrity_verified")}}
        # The original's verified_input exit stat check must succeed BEFORE any
        # receipt attests completion. Both output and original remain unchanged.
        if (provider._signature(os.fstat(output_fp.fileno())) != output_signature
                or provider._signature(os.stat(output.name, dir_fd=output_parent, follow_symlinks=False)) != output_signature):
            raise NormalizationRejected("normalized_output_identity_changed")
        receipt_parent, receipt_fp = _exclusive_output(receipt, _expected_uid)
        try:
            with receipt_fp:
                raw = (json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
                if len(raw) > 32 * 1024**2:
                    raise NormalizationRejected("bounded_normalization_receipt_required")
                receipt_fp.write(raw); receipt_fp.flush(); os.fsync(receipt_fp.fileno())
            os.fsync(receipt_parent)
        finally:
            os.close(receipt_parent)
        return record
    finally:
        if output_fp is not None:
            output_fp.close()
        if output_parent is not None:
            os.close(output_parent)


def main():
    parser = argparse.ArgumentParser(description="Normalize the single fixed offline public deps archive", allow_abbrev=False)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    result = normalize_dependencies(args.input, args.output, args.receipt)
    print(json.dumps({"state": result["state"], "output_sha256": result["output_sha256"],
                      "output_bytes": result["output_bytes"], "qualified": False}, sort_keys=True))


if __name__ == "__main__":
    main()
