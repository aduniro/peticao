"""One bounded portable-runtime upload per started job; immutable, restartable chunks."""
import base64
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat

CHUNK_BYTES = 8 * 1024 * 1024
MAX_BYTES = 512 * 1024 * 1024
ARTIFACT = 'artifacts/runtime.tar'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest_file(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > maximum:
            raise ValueError('bounded_regular_upload_file_required')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest(), info.st_size
    finally:
        os.close(fd)


@contextlib.contextmanager
def locked(folder):
    root = Path(folder) / '.runtime-upload'
    if root.is_symlink():
        raise ValueError('upload_directory_link_rejected')
    root.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(root / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('invalid_upload_lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield root
    finally:
        os.close(fd)


def chunk(folder, job_id, pod_uid, data):
    if not isinstance(data, dict) or set(data) != {'path', 'total_sha256', 'total_bytes', 'index', 'chunk_sha256', 'base64'}:
        raise ValueError('fixed_upload_contract_required')
    if data['path'] != ARTIFACT or not re.fullmatch('[a-f0-9]{64}', str(data['total_sha256'])):
        raise ValueError('fixed_runtime_artifact_required')
    total, index = data['total_bytes'], data['index']
    if type(total) is not int or not 1 <= total <= MAX_BYTES or type(index) is not int or not 0 <= index < math.ceil(total / CHUNK_BYTES):
        raise ValueError('runtime_upload_budget_exceeded')
    size = min(CHUNK_BYTES, total - index * CHUNK_BYTES)
    if not isinstance(data['base64'], str) or len(data['base64']) > (size + 2) // 3 * 4:
        raise ValueError('chunk_size_limit')
    decoded = base64.b64decode(data['base64'], validate=True)
    if len(decoded) != size or hashlib.sha256(decoded).hexdigest() != data['chunk_sha256']:
        raise ValueError('chunk_digest_or_size_mismatch')
    metadata = {'id': job_id, 'pod_uid': pod_uid, 'path': ARTIFACT, 'sha256': data['total_sha256'],
                'bytes': total, 'chunk_bytes': CHUNK_BYTES}
    upload_id = hashlib.sha256(canonical(metadata).encode()).hexdigest()
    with locked(folder) as root:
        meta = root / 'upload.json'
        if meta.exists() or meta.is_symlink():
            digest_file(meta, 4096)
            if json.loads(meta.read_text()) != metadata:
                raise ValueError('existing_runtime_upload_identity_mismatch')
        else:
            if shutil.disk_usage(root).free < total * 3 + 64 * 1024 * 1024:
                raise ValueError('runtime_upload_disk_headroom_insufficient')
            with meta.open('xb') as stream:
                stream.write((canonical(metadata) + '\n').encode())
                stream.flush()
                os.fsync(stream.fileno())
            sync(root)
        destination = root / f'chunk-{index:04d}'
        if destination.exists() or destination.is_symlink():
            if digest_file(destination, CHUNK_BYTES) != (data['chunk_sha256'], size):
                raise ValueError('existing_chunk_identity_mismatch')
        else:
            part = root / f'.part-{index:04d}'
            if part.exists() or part.is_symlink():
                digest_file(part, CHUNK_BYTES)
                part.unlink()  # Only this upload's incomplete scratch, while exclusively locked.
            with part.open('xb') as stream:
                stream.write(decoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.rename(part, destination)
            sync(root)
        count = math.ceil(total / CHUNK_BYTES)
        missing = [i for i in range(count) if not (root / f'chunk-{i:04d}').exists()]
        blob = root / 'runtime.blob'
        if not missing and not blob.exists():
            part = root / '.assembly.part'
            if part.exists() or part.is_symlink():
                digest_file(part, MAX_BYTES)
                part.unlink()
            digest, length = hashlib.sha256(), 0
            with part.open('xb') as output:
                for i in range(count):
                    path = root / f'chunk-{i:04d}'
                    _, chunk_size = digest_file(path, CHUNK_BYTES)
                    if chunk_size != min(CHUNK_BYTES, total - i * CHUNK_BYTES):
                        raise ValueError('persisted_chunk_size_mismatch')
                    with path.open('rb') as source:
                        for block in iter(lambda: source.read(1024 * 1024), b''):
                            digest.update(block)
                            length += len(block)
                            output.write(block)
                output.flush()
                os.fsync(output.fileno())
            if length != total or digest.hexdigest() != metadata['sha256']:
                part.unlink()
                raise ValueError('assembled_runtime_digest_mismatch')
            os.rename(part, blob)
            sync(root)
        complete = not missing
        if complete and digest_file(blob, MAX_BYTES) != (metadata['sha256'], total):
            raise ValueError('completed_runtime_digest_mismatch')
        return {'id': job_id, 'upload_id': upload_id, 'path': ARTIFACT, 'sha256': metadata['sha256'],
                'bytes': total, 'received_index': index, 'missing_indices': missing, 'complete': complete}


def resolve(folder, job_id, pod_uid, upload_id, path, digest):
    if path != ARTIFACT or not re.fullmatch('[a-f0-9]{64}', str(upload_id)):
        raise ValueError('fixed_runtime_reference_required')
    with locked(folder) as root:
        digest_file(root / 'upload.json', 4096)
        metadata = json.loads((root / 'upload.json').read_text())
        expected_id = hashlib.sha256(canonical(metadata).encode()).hexdigest()
        if expected_id != upload_id or metadata['id'] != job_id or metadata['pod_uid'] != pod_uid or metadata['sha256'] != digest:
            raise PermissionError('runtime_upload_reference_identity_denied')
        blob = root / 'runtime.blob'
        if digest_file(blob, MAX_BYTES) != (digest, metadata['bytes']):
            raise ValueError('runtime_upload_not_complete_or_changed')
        return blob
