#!/usr/bin/env python3
"""Build a fresh Docker context from a hash-verified portable Next runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile


def prepare(archive, expected_sha, commit, destination):
    archive, destination = Path(archive), Path(destination)
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
        raise ValueError("sha256_required")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("full_source_commit_required")
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected_sha:
            raise ValueError("archive_hash_mismatch")
    # Nothing is overwritten. An incomplete new context remains available for diagnosis.
    if destination.exists():
        raise FileExistsError(destination)
    with tarfile.open(archive, "r:*") as bundle:
        members = bundle.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError("duplicate_archive_member")
        metadata = bundle.getmember("release-manifest.json")
        if not metadata.isfile() or metadata.size > 8 * 1024 * 1024:
            raise ValueError("invalid_runtime_manifest")
        manifest = json.load(bundle.extractfile(metadata))
        if manifest.get("source_commit") != commit:
            raise ValueError("runtime_source_commit_mismatch")
        expected = manifest.get("files")
        if not isinstance(expected, dict) or not expected:
            raise ValueError("runtime_file_manifest_required")
        files = {}
        for member in members:
            if member.name == "release-manifest.json":
                continue
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or str(path) != member.name:
                raise ValueError("unsafe_archive_path")
            if len(path.parts) < 2 or path.parts[0] != "runtime" or not member.isfile():
                raise ValueError("unexpected_archive_member")
            relative = str(PurePosixPath(*path.parts[1:]))
            if any(part.startswith(".env") for part in path.parts):
                raise ValueError("environment_file_forbidden")
            record = expected.get(relative)
            if not isinstance(record, dict) or record.get("bytes") != member.size:
                raise ValueError("file_size_or_manifest_mismatch")
            if not re.fullmatch(r"[a-f0-9]{64}", str(record.get("sha256", ""))):
                raise ValueError("file_hash_required")
            files[relative] = member
        if set(files) != set(expected):
            raise ValueError("runtime_file_set_mismatch")
        total = sum(member.size for member in files.values())
        if total > 2 * 1024**3:
            raise ValueError("runtime_size_limit")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(destination.parent).free < total + 1024**3:
            raise ValueError("insufficient_staging_disk_margin")
        destination.mkdir(mode=0o700)
        for relative, member in files.items():
            target = destination / "runtime" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with bundle.extractfile(member) as source, target.open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != expected[relative]["sha256"]:
                raise ValueError("runtime_file_hash_mismatch:" + relative)
            os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)
        dockerfile = Path(__file__).with_name("Dockerfile").read_text()
        (destination / "Dockerfile").write_text(dockerfile + f'\nLABEL org.opencontainers.image.revision="{commit}"\n')
        (destination / ".dockerignore").write_text("**\n!Dockerfile\n!runtime/\n!runtime/**\n")
        receipt = {"source_commit": commit, "runtime_sha256": expected_sha,
                   "verified_files": len(files), "runtime_bytes": total,
                   "context": str(destination.resolve()), "deployed": False}
        (destination / "context-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("archive", "sha256", "commit", "destination"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.sha256, args.commit, args.destination)))
