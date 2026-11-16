#!/usr/bin/env python3
"""Report admission gates from saved evidence; never deploy or grant authority."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TERMINAL = {'completed', 'failed', 'canceled', 'cancelled'}


def load(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    now = datetime.now(timezone.utc)
    hosts = {name: load(args.inventory / (name + '.json')) for name in ['akamai', 'santiago', 'sp', 'local', 'waha']}
    checks = []

    def check(name, passed, detail):
        checks.append({'check': name, 'passed': bool(passed), 'detail': detail})

    for name, data in hosts.items():
        age = (now - datetime.fromisoformat(data['at'])).total_seconds() if data.get('at') else None
        check('fresh_inventory_' + name, age is not None and 0 <= age <= 300,
              {'age_seconds': round(age, 1) if age is not None else None})
    free = hosts['akamai'].get('root_disk', {}).get('available', 0)
    check('akamai_shared_disk_floor', free >= 20 * 2**30, {'available_bytes': free, 'floor_bytes': 20 * 2**30})
    states = hosts['santiago'].get('queue', {}).get('states')
    check('queue_has_no_nonterminal_jobs', states is not None and not any(count for name, count in states.items() if name not in TERMINAL), states)

    notices = []
    for line in (BASE / 'inbox/root-updates.jsonl').read_text().splitlines():
        if line.strip():
            notices.append(json.loads(line))
    network = next((d for d in reversed(notices) if d.get('status') == 'private_network_and_transport_verified'), None)
    check('root_private_qa_receipt', network is not None and network.get('dnsPass') is True and network.get('httpsStatus') == 200 and network.get('privateBackendHttpStatus') == 200,
          {'at': network.get('at'), 'network': network.get('network')} if network else None)
    migration = next((d for d in reversed(notices) if d.get('actor') == 'e-digger-migracao' and 'santiagoFreed' in d), None)
    check('migration_origin_release_received', migration is not None and migration.get('santiagoFreed') is True,
          {'at': migration.get('at'), 'status': migration.get('status'), 'santiagoFreed': migration.get('santiagoFreed')} if migration else None)

    nodes = hosts['santiago'].get('kubernetes', {}).get('nodes', [])
    santiago = next((n for n in nodes if n.get('name') == 'peticao-santiago'), None)
    pressure = next((c.get('status') for c in (santiago or {}).get('conditions', []) if c.get('type') == 'DiskPressure'), None)
    check('santiago_diskpressure_cleared', pressure == 'False', {'DiskPressure': pressure})

    snapshot = BASE / 'distributed/backend-snapshot-20261113'
    manifest = load(snapshot / 'SNAPSHOT.json')
    bad = [name for name, digest in manifest['files'].items() if not (snapshot / name).is_file() or hashlib.sha256((snapshot / name).read_bytes()).hexdigest() != digest]
    check('backend_snapshot_hashes', not bad, {'source_head': manifest.get('sourceHead'), 'files': len(manifest['files']), 'mismatches': bad})
    runs = load(BASE / 'evidence/implementation-20261113/backend-tests.json')
    last = {d['suite']: d for d in runs}
    check('queue_claim_restore_runner_tests', len(last) == 4 and all(r['exit'] == 0 for r in last.values()),
          {'suites': len(last), 'all_runs_preserved': len(runs)})
    profiles = load(snapshot / 'profiles.json')['profiles']
    check('current_profiles_qualified', bool(profiles) and all(
        p.get('enabled') is True and p.get('image') and '@sha256:' in p['image'] and p.get('source_manifest_sha256') and p.get('approval_reference')
        for p in profiles.values()), {'profiles': len(profiles), 'enabled': sum(p.get('enabled') is True for p in profiles.values())})
    # Technical readiness never establishes another actor's execution authority.
    report = {'at': now.isoformat(), 'read_only': True, 'grants_authority': False,
              'remote_mutations_performed': False, 'checks': checks,
              'technical_preconditions_ready': all(c['passed'] for c in checks),
              'execution_authorized': False,
              'coordination_required': 'Live central ledger validation and explicit root/migration coordination at execution time; no environment flag or local report grants authority.',
              'optional_local_worker': {'required_for_central_operation': False, 'admission_requires_separate_qualification': True},
              'production': {'builds_not_admitted': True, 'requires_fresh_stability_gate': True}}
    with args.output.open('x') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    for c in checks:
        print(('PASS ' if c['passed'] else 'HOLD ') + c['check'])
    print('Report: ' + str(args.output))


if __name__ == '__main__':
    main()
