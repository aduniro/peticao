#!/usr/bin/env python3
"""Create a deterministic, credential-free passive-coordinator package; never install."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile

BASE = Path(__file__).resolve().parent
SNAPSHOT = BASE / 'backend-snapshot-20261113'


def payload():
    source = json.loads((SNAPSHOT / 'SNAPSHOT.json').read_text())
    result = {}
    modules = sorted((SNAPSHOT / 'coordinator').glob('*.py'))
    modules += [SNAPSHOT / 'scripts/execution_claims.py', SNAPSHOT / 'scripts/production_gate.py']
    for p in modules:
        name = str(p.relative_to(SNAPSHOT))
        data = p.read_bytes()
        if hashlib.sha256(data).hexdigest() != source['files'][name]:
            raise ValueError('snapshot changed: ' + name)
        result['opt/admin-v2-cluster/' + p.name] = data
    result['opt/admin-v2-cluster/standby_guard.py'] = (BASE / 'standby_guard.py').read_bytes()
    result['review-only/admin-v2-coordinator-standby.service'] = (BASE / 'admin-v2-coordinator-standby.service').read_bytes()
    result['review-only/profiles-disabled.json'] = (SNAPSHOT / 'profiles.json').read_bytes()
    manifest = {
        'schema_version': 1,
        'purpose': 'passive development coordinator staging; not installed or enabled',
        'source_commit': source['sourceHead'],
        'active_queue_created': False,
        'database_included': False,
        'credentials_included': False,
        'service_installation_automatic': False,
        'dispatch': False,
        'kubernetes': False,
        'requires_before_remote_install': [
            'root coordination and valid own delegated ledger authority',
            'migration destination storage receipt and preserved shared floor',
            'dedicated vigia-coord identity and least-privilege private RPC path',
            'consistent verified existing queue restore; never initialize a second queue',
        ],
        'requires_before_promotion': [
            'explicit source-owner fencing and generation transition',
            'final snapshot after source admission is suspended',
            'root and required peer reviews for the concrete operation',
        ],
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(result.items())},
    }
    result['MANIFEST.json'] = json.dumps(manifest, sort_keys=True, indent=2).encode() + b'\n'
    return result


def build(output):
    files = payload()
    # Exclusive creation prevents replacing a previous reviewed artifact.
    with output.open('xb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w') as archive:
                for directory, mode in [('opt', 0o755), ('opt/admin-v2-cluster', 0o755), ('review-only', 0o700)]:
                    info = tarfile.TarInfo(directory)
                    info.type = tarfile.DIRTYPE
                    info.mode = mode
                    info.uid = info.gid = 0
                    info.mtime = 0
                    archive.addfile(info)
                for name, data in sorted(files.items()):
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o644 if name.startswith('opt/') else 0o600
                    info.uid = info.gid = 0
                    info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))
    with tarfile.open(output, 'r:gz') as archive:
        manifest = json.load(archive.extractfile('MANIFEST.json'))
        members = {m.name for m in archive.getmembers() if m.isfile()}
        if members != set(manifest['files']) | {'MANIFEST.json'}:
            raise ValueError('unexpected bundle member')
        for member in archive.getmembers():
            if not (member.isfile() or member.isdir()):
                raise ValueError('non-regular bundle member')
            if member.name.startswith('opt/') and member.isfile() and member.mode != 0o644:
                raise ValueError('runtime must be readable by the service account')
        for name, digest in manifest['files'].items():
            if hashlib.sha256(archive.extractfile(name).read()).hexdigest() != digest:
                raise ValueError('bundle integrity failure: ' + name)
    return {'archive': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'bytes': output.stat().st_size, 'files': len(files), 'verified': True, 'installed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(build(args.output)))


if __name__ == '__main__':
    main()
