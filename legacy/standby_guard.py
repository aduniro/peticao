#!/usr/bin/env python3
"""Refuse to start a passive service with active authority or an absent queue."""
import argparse
import json
import os
from pathlib import Path
import sqlite3


def validate(root):
    root = Path(root)
    authority_path = root / 'authority.json'
    queue = root / 'queue.sqlite'
    if root.is_symlink() or not root.is_dir():
        raise ValueError('existing non-symlink standby root required')
    if any(p.is_symlink() or not p.is_file() for p in [authority_path, queue]):
        raise ValueError('existing regular authority and queue files required')
    authority = json.loads(authority_path.read_text())
    if authority.get('role') != 'standby' or authority.get('armed_boot_id') is not None:
        raise ValueError('standby authority must be unarmed')
    generation = authority.get('generation')
    if type(generation) is not int or generation < 1:
        raise ValueError('positive preserved generation required')
    if os.environ.get('ADMIN_CLUSTER_DISPATCH') != '0' or os.environ.get('ADMIN_CLUSTER_KUBERNETES') != '0':
        raise ValueError('dispatch and Kubernetes must both be disabled')
    with sqlite3.connect(queue.as_uri() + '?mode=ro', uri=True, timeout=3) as db:
        db.execute('PRAGMA query_only=ON')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'jobs', 'events'} <= tables:
            raise ValueError('existing queue schema required; no initialization')
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('queue integrity check failed')
    return {'passive': True, 'generation': generation, 'queue_present': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(validate(args.root.absolute())))


if __name__ == '__main__':
    main()
