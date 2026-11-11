"""Bounded, hashed technical artifacts; no archives, symlinks or arbitrary writes."""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile

MAX_TOTAL = 32 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def regular_digest(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
            raise ValueError('regular_bounded_receipt_required')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def store(folder, identity, exit_code, technical_result, artifacts):
    if type(exit_code) is not int or not 0 <= exit_code <= 255:
        raise ValueError('invalid_exit_code')
    if not isinstance(technical_result, dict) or len(canonical(technical_result).encode()) > 128 * 1024:
        raise ValueError('bounded_technical_result_required')
    if not isinstance(artifacts, list) or len(artifacts) > 64:
        raise ValueError('artifact_count_limit')
    folder = Path(folder)
    staging = Path(tempfile.mkdtemp(prefix='.kubernetes-result-', dir=folder))
    budget, manifest, names = 0, [], set()
    try:
        (staging / 'artifacts').mkdir()
        for entry in artifacts:
            if not isinstance(entry, dict) or set(entry) != {'path', 'sha256', 'base64'}:
                raise ValueError('fixed_artifact_contract_required')
            name = entry['path']
            if not isinstance(name, str) or not re.fullmatch(r'artifacts/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}', name):
                raise ValueError('invalid_artifact_path')
            parts = PurePosixPath(name).parts
            if '..' in parts or '.' in parts or '//' in name or PurePosixPath(name).suffix.lower() not in {'.json', '.png', '.pdf', '.txt', '.log', '.xml'} or name in names:
                raise ValueError('invalid_or_duplicate_artifact_path')
            names.add(name)
            if not isinstance(entry['base64'], str) or len(entry['base64']) > (MAX_FILE + 2) // 3 * 4:
                raise ValueError('artifact_size_limit')
            data = base64.b64decode(entry['base64'], validate=True)
            budget += len(data)
            if len(data) > MAX_FILE or budget > MAX_TOTAL:
                raise ValueError('artifact_size_limit')
            digest = hashlib.sha256(data).hexdigest()
            if entry['sha256'] != digest:
                raise ValueError('artifact_digest_mismatch')
            path = staging / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            manifest.append({'path': name, 'sha256': digest, 'bytes': len(data)})
        result = {**identity, 'exit_code': exit_code, 'technical_result': technical_result,
                  'artifacts': sorted(manifest, key=lambda item: item['path'])}
        encoded = (canonical(result) + '\n').encode()
        digest = hashlib.sha256(encoded).hexdigest()
        destination = folder / 'result.json'
        if destination.exists() or destination.is_symlink():
            if regular_digest(destination) != digest:
                raise ValueError('conflicting_result_requires_reconciliation')
            verify(folder, digest)
            return result, digest
        artifacts_dir = folder / 'artifacts'
        if artifacts_dir.exists() or artifacts_dir.is_symlink():
            if artifacts_dir.is_symlink():
                raise ValueError('artifact_directory_link_rejected')
            if any(p.is_symlink() for p in artifacts_dir.rglob('*')):
                raise ValueError('artifact_directory_link_rejected')
            existing = sorted(p.relative_to(folder).as_posix() for p in artifacts_dir.rglob('*') if not p.is_dir())
            if existing != sorted(names):
                raise ValueError('existing_artifacts_require_reconciliation')
            for item in manifest:
                if regular_digest(folder / item['path']) != item['sha256']:
                    raise ValueError('existing_artifact_digest_mismatch')
        else:
            # Persist directories before the rename and result receipt before DB finish.
            for directory in sorted((p for p in (staging / 'artifacts').rglob('*') if p.is_dir()), reverse=True):
                sync_directory(directory)
            sync_directory(staging / 'artifacts')
            os.rename(staging / 'artifacts', artifacts_dir)
            sync_directory(folder)
        temp_result = staging / 'result.json'
        with temp_result.open('xb') as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        # link() fails rather than overwriting a concurrent or prior receipt.
        os.link(temp_result, destination)
        temp_result.unlink()
        sync_directory(folder)
        return result, digest
    finally:
        shutil.rmtree(staging)


def verify(folder, expected_digest):
    folder = Path(folder)
    if regular_digest(folder / 'result.json') != expected_digest:
        raise ValueError('result_receipt_digest_mismatch')
    result = json.loads((folder / 'result.json').read_text())
    root = folder / 'artifacts'
    if root.is_symlink():
        raise ValueError('artifact_directory_link_rejected')
    for entry in result['artifacts']:
        relative = PurePosixPath(entry['path'])
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'artifacts':
            raise ValueError('result_artifact_path_invalid')
        # Reject directory symlinks as well as file links.
        current = folder
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('artifact_directory_link_rejected')
        if regular_digest(current) != entry['sha256'] or current.stat().st_size != entry['bytes']:
            raise ValueError('result_artifact_digest_mismatch')
    return result
