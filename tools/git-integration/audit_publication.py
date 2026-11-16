#!/usr/bin/env python3
"""Audit all reachable candidate history without printing secret/PII values."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

CPF = re.compile(rb'(?<![A-Za-z0-9])(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?![A-Za-z0-9])')
DENIED = [
    re.compile(r'(^|/)([^/]*\.private\.[^/]*|config\.json|LOG-[^/]*|PENDENCIAS-MARKETING\.md|resposta-caso-ses-[^/]*)$'),
    re.compile(r'^material_base/[^/]*\.html$'),
    re.compile(r'(?i)\.(?:sqlite3?|db|pfx|p12)$'),
    re.compile(r'(^|/)\.env(?:\.(?!example$|sample$|template$)[^/]*)?$'),
]


def cpf_valid(value):
    value = re.sub(rb'\D', b'', value)
    if len(value) != 11 or len(set(value)) == 1:
        return False
    digits = list(map(int, value.decode()))
    for length in (9, 10):
        check = 11 - sum(digits[i] * (length + 1 - i) for i in range(length)) % 11
        if digits[length] != (0 if check >= 10 else check):
            return False
    return True


def cpf_hashes(data):
    return {hashlib.sha256(re.sub(rb'\D', b'', value)).hexdigest()
            for value in CPF.findall(data) if cpf_valid(value)}


def prohibited_path(path):
    return any(pattern.search(path) for pattern in DENIED)


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def audit(repo, policy):
    reviewed = {row['blob']: set(row['cpf_sha256']) for row in policy['reviewed_cpf_fixture_blobs']}
    names = {name.strip(b'\n').decode('utf-8', 'surrogateescape') for name in
             git(repo, 'log', '--all', '--root', '-m', '--no-renames', '--format=',
                 '--name-only', '-z', '--').split(b'\0') if name.strip(b'\n')}
    errors = [{'reason': 'prohibited_historical_path',
               'path_sha256': hashlib.sha256(name.encode('utf-8', 'surrogateescape')).hexdigest()}
              for name in sorted(names) if prohibited_path(name)]
    objects = {line.split(b' ', 1)[0] for line in git(repo, 'rev-list', '--objects', '--all').splitlines()}
    process = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    blobs = 0
    try:
        for oid in sorted(objects):
            process.stdin.write(oid + b'\n')
            process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3:
                raise RuntimeError('missing or malformed Git object')
            data = process.stdout.read(int(header[2]))
            if process.stdout.read(1) != b'\n' or len(data) != int(header[2]):
                raise RuntimeError('incomplete Git object read')
            if header[1] != b'blob':
                continue
            blobs += 1
            if data.startswith(b'SQLite format 3\0'):
                errors.append({'reason': 'database_blob'})
            # Binary assets are still inspected by the secret scanner and path
            # restrictions. CPF text validation applies to textual blobs.
            if b'\0' not in data[:8000]:
                unknown = cpf_hashes(data) - reviewed.get(oid.decode(), set())
                if unknown:
                    errors.append({'reason': 'unreviewed_cpf_literal', 'count': len(unknown)})
    finally:
        process.stdin.close()
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError('Git object enumeration failed')
    return {'pass': not errors, 'reachable_objects_checked': len(objects),
            'text_and_binary_blobs_checked': blobs, 'historical_paths_checked': len(names),
            'errors': errors, 'private_values_printed': False,
            'scope': 'all reachable refs and committed history; excludes untracked files and unreachable private archives'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--policy', type=Path, default=Path(__file__).with_name('publication-policy.json'))
    args = parser.parse_args()
    result = audit(args.repo.resolve(), json.loads(args.policy.read_text()))
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['pass'] else 1)


if __name__ == '__main__':
    main()
