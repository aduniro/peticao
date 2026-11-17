"""Verify generated browser dependencies against the tracked asset lock."""
import hashlib
import json
from pathlib import Path


def runtime_manifest(root: Path, required: bool = False):
    lock_path = root / "site/scripts/pdfjs-assets.lock.json"
    if not lock_path.exists():
        assert not required, "PDF.js asset lock is missing"
        return {}
    lock = json.loads(lock_path.read_text())
    target = root / "site/public/vendor/pdfjs" / lock["version"]
    if not target.exists():
        assert not required, "Prepare pinned PDF.js assets before browser QA"
        return {}
    result = {}
    for entry in lock["files"].values():
        path = target / entry["path"]
        assert path.resolve().is_relative_to(target.resolve()), "Asset path escaped its root"
        assert not path.is_symlink() and path.is_file(), "Missing or linked PDF.js asset"
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert len(data) == entry["size"] and digest == entry["sha256"], "PDF.js asset integrity mismatch"
        result[str(path.relative_to(root))] = digest
    version_path = target / "assets-version.json"
    version = json.loads(version_path.read_text())
    assert version == {"version": lock["version"], "archiveIntegrity": lock["archiveIntegrity"], "assets": len(lock["files"])}
    result[str(version_path.relative_to(root))] = hashlib.sha256(version_path.read_bytes()).hexdigest()
    return result
