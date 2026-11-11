#!/usr/bin/env python3
"""Issue a short-lived install receipt from actual ledger ACKs and a fenced lease."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
COORD = ROOT.parent / 'coordenacao-dupla/tools/coord.py'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--node', required=True, choices=['santiago', 'local', 'sp'])
    p.add_argument('--manifest-event', required=True, type=int)
    p.add_argument('--lease-file', required=True, type=Path)
    args = p.parse_args()
    spec = importlib.util.spec_from_file_location('coord', COORD)
    coord = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(coord)
    ledger = coord.Ledger()
    actor = 'admin-recuperacao'
    target = 'coord:k3s/' + args.node
    lease = json.loads(args.lease_file.read_text())
    checked = ledger.check(actor, lease['lease'], lease['token'], lease['fence'])
    if checked['expires'] < time.time() + 300 or target not in lease['resources']:
        raise PermissionError('current_node_lease_with_five_minutes_required')
    with ledger.db() as db:
        ledger.actor(db, actor)
        if not db.execute('SELECT 1 FROM actor_handoffs WHERE prior=? AND replacement=?', ('admin', actor)).fetchone():
            raise PermissionError('coordinator_succession_not_acknowledged')
        event = db.execute('SELECT * FROM events WHERE seq=?', (args.manifest_event,)).fetchone()
        if not event or event['actor'] != actor or event['kind'] != 'notice' or not event['requires_ack'] or target not in json.loads(event['resources']):
            raise PermissionError('explicit_node_manifest_required')
        active = set(ledger.active_actors(db)) - {actor}
        acks = {row['actor'] for row in db.execute('SELECT actor FROM acks WHERE seq=?', (args.manifest_event,))}
        if not active or not active.issubset(acks):
            raise PermissionError('actual_peer_ack_missing')
        manifest = json.loads(event['data']).get('provision', {})
    cluster = json.loads((ROOT / 'cluster.json').read_text())
    destination = cluster['nodes'][args.node]['ip'] + ':/etc/rancher/peticao-k3s'
    if manifest.get('node') != args.node or manifest.get('destination') != destination or manifest.get('source_root') != str(ROOT) or not manifest.get('owner_reference'):
        raise ValueError('provision_manifest_destination_mismatch')
    head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain'], text=True).strip()
    if head != manifest.get('commit') or dirty:
        raise ValueError('reviewed_clean_source_commit_required')
    files = ['config.yaml', 'guard.nft', 'apply_guard.py', 'peticao-k3s.service', 'peticao-k3s-guard.service']
    hashes = {name: hashlib.sha256((ROOT / 'manifests' / args.node / name).read_bytes()).hexdigest() for name in files}
    if hashes != manifest.get('manifest_sha256'):
        raise ValueError('reviewed_files_changed')
    # SP qualification must bind to a separately recorded, inspected release receipt.
    if args.node == 'sp':
        raise PermissionError('sp_receipt_not_enabled_until_post_deploy_baseline_review')
    result = {'node': args.node, 'peer_ack_verified': True, 'peer_actors': sorted(active),
              'lease_valid': True, 'lease_expires_at': checked['expires'], 'lease_fence': lease['fence'],
              'manifest_event': args.manifest_event, 'manifest_sha256': hashes,
              'source_commit': head, 'issued_at': time.time()}
    out = ROOT / 'private' / (args.node + '-install-receipt.json')
    out.write_text(json.dumps(result, indent=2) + '\n')
    out.chmod(0o600)
    print(out)


if __name__ == '__main__':
    main()
