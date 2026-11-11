#!/usr/bin/python3
"""Hash-pinned regular-files-only extraction; never starts the application."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import stat
import tarfile

REMOTE_ROOT = Path('/srv/admin-v2-worker/admin-r0002-history-native-qa-20261111')
ARCHIVE_SHA = '2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0'
MANIFEST_SHA = '7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3'
EXPECTED_COUNT = 12043
MAX_BYTES = 512 * 1024 * 1024

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''): h.update(block)
    return h.hexdigest()

def safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name or '\x00' in name:
        raise ValueError('invalid_archive_name')
    parts = name.split('/')
    if any(p in {'', '.', '..'} for p in parts) or PurePosixPath(name).is_absolute():
        raise ValueError('noncanonical_archive_name')
    if any(p.startswith('.env') or p.lower() in {'secrets', 'credentials'} for p in parts):
        raise ValueError('sensitive_archive_name')
    if Path(name).suffix.lower() in {'.pfx', '.p12', '.sqlite', '.dump', '.pem', '.key'}:
        raise ValueError('sensitive_archive_name')
    return name

def validate_manifest(manifest, count):
    if manifest.get('schema_version') != 1 or manifest.get('runtime_format') != 'next-start-v1':
        raise ValueError('wrong_runtime_manifest')
    if manifest.get('source_commit') != 'f55595cd348c23ffe559dba2de9150259db9f1e7':
        raise ValueError('wrong_source_commit')
    if manifest.get('release_id') != 'r0002-portable-f55595c-20261111':
        raise ValueError('wrong_release_id')
    files = manifest.get('files')
    if not isinstance(files, dict) or len(files) != count:
        raise ValueError('wrong_file_count')
    for name, entry in files.items():
        safe_name(name)
        if not isinstance(entry, dict) or type(entry.get('bytes')) is not int or entry['bytes'] < 0:
            raise ValueError('invalid_manifest_size')
        value = entry.get('sha256', '')
        if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
            raise ValueError('invalid_manifest_digest')
    if sum(e['bytes'] for e in files.values()) > MAX_BYTES:
        raise ValueError('runtime_too_large')
    return files

def private_canonical(path):
    if not path.is_absolute() or path.resolve() != path or not path.is_dir():
        raise ValueError('noncanonical_private_directory')
    mode = path.stat()
    if mode.st_uid != os.getuid() or mode.st_mode & 0o077:
        raise ValueError('directory_not_private_owned')

def verify_runtime(runtime, manifest, count=EXPECTED_COUNT):
    private_canonical(runtime)
    expected = validate_manifest(manifest, count)
    found = set()
    for path in runtime.rglob('*'):
        mode = path.lstat().st_mode
        name = str(path.relative_to(runtime))
        safe_name(name)
        if stat.S_ISDIR(mode): continue
        if not stat.S_ISREG(mode): raise ValueError('runtime_nonregular_file')
        if path.stat().st_nlink != 1: raise ValueError('runtime_hardlink_forbidden')
        if name not in expected: raise ValueError('runtime_extra_file')
        entry = expected[name]
        if path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError('runtime_hash_mismatch')
        found.add(name)
    if found != set(expected): raise ValueError('runtime_missing_file')
    return len(found)

def extract_verified(archive, manifest_path, run, archive_sha=ARCHIVE_SHA,
                     manifest_sha=MANIFEST_SHA, count=EXPECTED_COUNT):
    # Operates only in a newly-created private run. Never overlays an old run.
    if run.exists() or run.is_symlink(): raise ValueError('run_exists_never_overlay')
    private_canonical(run.parent)
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != manifest_sha:
        raise ValueError('manifest_digest_mismatch')
    manifest = json.loads(manifest_bytes)
    files = validate_manifest(manifest, count)
    expected = {'runtime/' + name: entry for name, entry in files.items()}
    expected['release-manifest.json'] = {'bytes':len(manifest_bytes), 'sha256':manifest_sha}
    # Keep one archive descriptor open throughout digest, metadata validation,
    # content validation, and extraction. No extract/extractall calls or links.
    with archive.open('rb') as source:
        h = hashlib.sha256()
        for block in iter(lambda: source.read(1048576), b''): h.update(block)
        if h.hexdigest() != archive_sha: raise ValueError('archive_digest_mismatch')
        source.seek(0)
        with tarfile.open(fileobj=source, mode='r:') as tar:
            members = tar.getmembers()
            if len(members) != count + 1: raise ValueError('archive_member_count')
            seen = set()
            for member in members:
                name = safe_name(member.name)
                if not member.isfile() or member.issym() or member.islnk() or member.sparse:
                    raise ValueError('archive_nonregular_member')
                if name in seen: raise ValueError('duplicate_archive_member')
                if name not in expected: raise ValueError('archive_extra_member')
                if member.size != expected[name]['bytes']: raise ValueError('archive_size_mismatch')
                seen.add(name)
            if seen != set(expected): raise ValueError('archive_missing_member')
            # Validate every archived byte before creating a runtime directory.
            for member in members:
                h = hashlib.sha256()
                with tar.extractfile(member) as data:
                    for block in iter(lambda: data.read(1048576), b''): h.update(block)
                if h.hexdigest() != expected[member.name]['sha256']:
                    raise ValueError('archive_content_mismatch')
            run.mkdir(mode=0o700)
            (run/'runtime').mkdir(mode=0o700)
            for member in members:
                target = run/member.name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with tar.extractfile(member) as data, target.open('xb') as output:
                    for block in iter(lambda: data.read(1048576), b''): output.write(block)
                    output.flush(); os.fsync(output.fileno())
                target.chmod(0o600)
    checked = verify_runtime(run/'runtime', manifest, count)
    proof = {'archiveSha256':archive_sha, 'manifestSha256':manifest_sha,
             'verifiedFiles':checked, 'linksAllowed':False, 'runtimeStarted':False}
    (run/'extraction-proof.json').write_text(json.dumps(proof, indent=2)+'\n')
    return proof

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--run', required=True, type=Path)
    args = parser.parse_args()
    if Path(__file__).resolve().parent != REMOTE_ROOT or args.run.parent != REMOTE_ROOT/'runs':
        raise ValueError('wrong_remote_run_root')
    private_canonical(REMOTE_ROOT)
    if args.archive != REMOTE_ROOT/'inputs/runtime.tar' or args.manifest != REMOTE_ROOT/'inputs/release-manifest.json':
        raise ValueError('wrong_frozen_input_paths')
    print(json.dumps(extract_verified(args.archive, args.manifest, args.run)))
