#!/usr/bin/env python3
"""Download one pinned official scanner; verify archive and executable hashes."""
import argparse
import hashlib
import io
import os
import tarfile
import urllib.request
from pathlib import Path

VERSION = '8.30.1'
URL = f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_linux_x64.tar.gz'
ARCHIVE_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
BINARY_SHA256 = '88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / 'gitleaks'
    if target.is_file() and not target.is_symlink():
        if hashlib.sha256(target.read_bytes()).hexdigest() == BINARY_SHA256:
            print(f'Gitleaks {VERSION}: verified cached executable')
            return
    if target.exists() or target.is_symlink():
        raise RuntimeError('refuse to overwrite an unverified tool')
    archive = urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError('scanner archive checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive)) as package:
        member = package.getmember('gitleaks')
        if not member.isfile():
            raise RuntimeError('unexpected executable member')
        binary = package.extractfile(member).read()
    if hashlib.sha256(binary).hexdigest() != BINARY_SHA256:
        raise RuntimeError('scanner executable checksum mismatch')
    with target.open('xb') as stream:
        stream.write(binary)
    os.chmod(target, 0o700)
    print(f'Gitleaks {VERSION}: official archive and executable verified')


if __name__ == '__main__':
    main()
