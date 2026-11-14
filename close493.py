"""Proposed metadata-only closure of one expired R1 lease. Default is read-only.

No acquisition, renewal, reactivation, remote command, old ACK or global quorum
change. Root-only apply requires two NEW purpose-specific bound attestations.
"""
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time

LEASE = 'a57c97c38267485a9ad5f0355f277c83'
FENCE = 493
ACTOR = 'admin-recuperacao'
ROOT_THREAD = '01a1cad7-4a65-7d43-b8c2-f0b50a90a580'
OPERATION = 'ADMIN-QUERY-R1-20261114'
MANIFEST = 'a761d56f52193d1665aac190705deebb8443d6d7457f53e5c9a272e7495203ea'
IMAGE = 'sha256:5a582c5c71a860964d6a33c9f431a901fb85671d4b0afdf22481de610cb4aa21'
SOURCE = 'c472837fb5a4584d81f34c420f4de30989084f85'
SCHEMA = '8e3ac43319a3ae54a7b4928084b48c6f0ce03dad1baeddbb16f7236d93eec3c9'
EXPIRES = 1794662544.4754376
CREATED = 1794661944.4754376
ROOTDIR = Path('/mnt/apps/peticao-final/_ops/admin-query-r1-root-20261114')
DB = Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/coord.sqlite')
BASE = Path(__file__).resolve().parent
RESOURCES = sorted(['code:', 'deploy:admin-query-r1',
    'path:/mnt/apps/peticao-final/_ops/admin-query-r1-publication-20261114',
    'path:/mnt/apps/peticao-final/_ops/admin-query-r1-publish-gate-20261114',
    'path:' + str(ROOTDIR), 'path:/srv/peticao/admin-query-r1-20261114/publication'])


def need(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_ref(ref):
    raw = Path(ref['path']).read_bytes()
    need(sha(raw) == ref['sha256'], 'evidence_drift')
    return json.loads(raw)


def protected(d):
    tables = ['actors', 'actor_handoffs', 'acks', 'events', 'resolutions', 'resolution_acks', 'observations']
    # Includes all pre-existing events and every OTHER lease, including tokens in
    # memory only. Nothing from this protected snapshot is logged or returned.
    result = {name: [dict(r) for r in d.execute('SELECT * FROM ' + name + ' ORDER BY rowid')]
              for name in tables}
    result['other_leases'] = [dict(r) for r in d.execute('SELECT * FROM leases WHERE id<>? ORDER BY id', (LEASE,))]
    return result


def validate(d, binding, capability, attestations, now):
    expected = {'scope': 'CLOSE-LEASE493-METADATA-ONLY', 'operationId': OPERATION,
                'leaseId': LEASE, 'fence': FENCE, 'actor': ACTOR,
                'manifestSha256': MANIFEST, 'image': IMAGE}
    need(all(binding.get(k) == v for k, v in expected.items()), 'scope_or_pin_mismatch')
    need(binding['helperSha256'] == sha(Path(__file__).read_bytes()), 'helper_drift')
    active = {r['id'] for r in d.execute('SELECT id FROM actors WHERE id NOT IN (SELECT prior FROM actor_handoffs)')}
    need(active == {ACTOR, 'apoio', 'executor61'}, 'actor_projection_drift')
    need(d.execute('SELECT session FROM actors WHERE id=?', (ACTOR,)).fetchone()[0] == ROOT_THREAD,
         'root_actor_identity_drift')
    need(set(attestations) == {ACTOR, 'apoio'}, 'two_new_distinct_attestations_required')
    for actor, attestation in attestations.items():
        need(attestation['actor'] == actor and attestation['decision'] == 'pass' and
             attestation['purpose'] == 'r1-close-lease493' and attestation['binding'] == binding,
             'new_bound_attestation_required')
    row = d.execute('SELECT * FROM leases WHERE id=?', (LEASE,)).fetchone()
    need(row is not None, 'exact_lease_missing')
    need(row['actor'] == ACTOR and row['fence'] == FENCE and row['operation'] == 'deploy' and
         row['state'] == 'uncertain' and row['expires'] == EXPIRES and
         json.loads(row['resources']) == RESOURCES, 'lease_metadata_mismatch')
    need(now >= EXPIRES, 'lease_not_expired')
    need(capability['actor'] == ACTOR and capability['lease'] == LEASE and
         capability['fence'] == FENCE and capability['manifestSha256'] == MANIFEST and
         capability['manifestEvent'] == 2685 and capability['seq'] == 2689 and
         hmac.compare_digest(capability['token'], row['token']), 'original_owner_capability_mismatch')
    need(not d.execute('SELECT 1 FROM resolutions WHERE lease_id=?', (LEASE,)).fetchone(),
         'existing_normal_resolution_requires_review')
    for seq, kind in [(2689, 'lease_acquired'), (2690, 'r1_scoped_acquired'), (2691, 'lease_uncertain')]:
        event = d.execute('SELECT * FROM events WHERE seq=?', (seq,)).fetchone()
        need(event and event['actor'] == ACTOR and event['kind'] == kind, 'original_event_missing')
        body = json.loads(event['data'])
        need(body['lease'] == LEASE and body['fence'] == FENCE, 'original_event_mismatch')
        if seq != 2691:
            need(body['operationId'] == OPERATION and body['manifestSha256'] == MANIFEST and
                 body['expires'] == EXPIRES and body['manifest_event'] == 2685,
                 'original_operation_mismatch')
    need(not d.execute("SELECT 1 FROM events WHERE kind='r1_lease493_reconciled_scoped'").fetchone(),
         'closure_already_recorded_no_replay')
    post = read_ref(binding['postProof'])
    need(post['ok'] is True and post['fence'] == FENCE and post['manifestSha256'] == MANIFEST and
         post['image'] == IMAGE and post['sourceCommit'] == SOURCE and
         post['productionSchemaChanged'] is False and post['databaseRestored'] is False and
         post['rollbackNeeded'] is False and post['publicPidPreserved'] is True and
         post['configHashesPreserved'] is True and post['productionSchemaVerifiedByOperator'] == SCHEMA,
         'publication_outcome_unproven')
    times = []
    for step in ['preflight', 'switch', 'verify']:
        proof = post['steps'][step]
        need(proof['fence'] == FENCE and CREATED <= proof['at'] < EXPIRES,
             'publication_step_outside_original_ttl')
        times.append(proof['at'])
    post_at = datetime.datetime.fromisoformat(post['at']).timestamp()
    need(times == sorted(times) and len(set(times)) == 3 and times[-1] <= post_at < EXPIRES,
         'postproof_sequence_or_ttl_violation')
    live = read_ref(binding['liveProof'])
    need(0 <= now - live['observedAt'] <= 900 and live['remoteState']['manifestSha256'] == MANIFEST and
         live['image'] == IMAGE and live['sourceCommit'] == SOURCE,
         'fresh_runtime_proof_required')
    need(live['noActivePublication'] is True and live['noActiveDispatch'] is True and
         not live['remoteState'].get('intent') and live['schemaSha256'] == SCHEMA and
         live['schemaOK'] is True and live['remoteState']['completed'] == post['steps'],
         'runtime_or_inflight_state_unproven')
    health = read_ref(binding['httpConfigProof'])
    health_at = datetime.datetime.fromisoformat(health['at']).timestamp()
    need(0 <= now - health_at <= 900 and health['image'] == IMAGE and
         health['remoteState'] == live['remoteState'] and health['configPreserved'] is True and
         health['publicPIDPreserved'] is True and health['noNewProductionOperation'] is True and
         all(x['status'] == 200 for x in health['http']), 'fresh_http_config_proof_required')
    need({x['url'] for x in health['http']} == {
        'http://127.0.0.1:3001/api/internal/ready', 'http://127.0.0.1:3001/admin',
        'http://127.0.0.1:3000/', 'http://127.0.0.1:3000/admin'}, 'four_current_routes_required')
    need(set(binding['localJournals']) == {'preflight', 'switch', 'verify'}, 'three_exact_journals_required')
    for step in ['preflight', 'switch', 'verify']:
        journal = read_ref(binding['localJournals'][step])
        need(journal['state'] == 'complete' and journal['step'] == step and
             journal['fence'] == FENCE and journal['manifestSha256'] == MANIFEST and
             CREATED <= journal['at'] <= journal['completedAt'] < EXPIRES,
             'complete_in_ttl_journals_required')
        summary = live['localJournals'][step]
        need(summary == {key: journal[key] for key in ['state', 'at', 'completedAt']},
             'journal_snapshot_mismatch')
    return row


def exclusive_intent(path, binding):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(encode({'state': 'intent-no-retry', 'bindingSha256': sha(encode(binding).encode())}) + '\n')
        stream.flush(); os.fsync(stream.fileno())
    fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def close(d, binding, capability, attestations, *, now, apply=False, executor_session=None, intent=None, clock=None):
    need(executor_session == ROOT_THREAD, 'root_only')
    validate(d, binding, capability, attestations, now)
    result = {'operationId': OPERATION, 'leaseId': LEASE, 'fence': FENCE,
              'metadataOnly': True, 'globalQuorumChanged': False, 'allActorResolutionClaimed': False}
    if not apply:
        return dict(result, dryRun=True, applied=False)
    need(intent is not None, 'exclusive_durable_intent_required')
    exclusive_intent(intent, binding)
    d.execute('BEGIN IMMEDIATE')
    try:
        row = validate(d, binding, capability, attestations, now if clock is None else clock())
        before = dict(row)
        original = protected(d)
        changed = d.execute("UPDATE leases SET state='reconciled' WHERE id=? AND fence=493 AND state='uncertain'",
                            (LEASE,)).rowcount
        need(changed == 1, 'single_exact_row_required')
        after = dict(d.execute('SELECT * FROM leases WHERE id=?', (LEASE,)).fetchone())
        expected = dict(before, state='reconciled')
        need(after == expected and protected(d) == original, 'protected_state_changed')
        data = dict(result, manifestSha256=MANIFEST, image=IMAGE,
                    bindingSha256=sha(encode(binding).encode()), helperSha256=binding['helperSha256'],
                    attestations=sorted(attestations), proofState='completed-within-original-ttl',
                    previousState='uncertain', nextState='reconciled', normalResolutionConfirmed=False)
        cursor = d.execute('INSERT INTO events(at,actor,kind,summary,data,resources,requires_ack) VALUES(?,?,?,?,?,?,0)',
             (datetime.datetime.now(datetime.timezone.utc).isoformat(), ACTOR, 'r1_lease493_reconciled_scoped',
              'Only expired R1 lease493 metadata reconciled; global ACKs/quorum unchanged',
              encode(data), encode(RESOURCES)))
        audit = dict(d.execute('SELECT * FROM events WHERE seq=?', (cursor.lastrowid,)).fetchone())
        expected_protected = dict(original, events=original['events'] + [audit])
        need(protected(d) == expected_protected and
             dict(d.execute('SELECT * FROM leases WHERE id=?', (LEASE,)).fetchone()) == expected,
             'unexpected_audit_side_effect')
        d.commit()
        return dict(result, dryRun=False, applied=True, event=cursor.lastrowid, protectedStateVerified=True)
    except BaseException:
        d.rollback()
        raise


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Root-only metadata closure for exact lease493')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        config = json.loads((BASE / 'CLOSE-BINDING.json').read_text())
        binding = config['binding']
        attestations = {actor: read_ref(ref) for actor, ref in config['attestations'].items()}
        # Original Root capability stays at its private owner path; never copied,
        # exposed, used for renewal or sent to a remote service.
        cap_path = ROOTDIR / 'deploy-lease.private.json'
        need(not cap_path.is_symlink() and cap_path.stat().st_mode & 0o077 == 0,
             'private_original_capability_required')
        capability = json.loads(cap_path.read_text())
        mode = 'rw' if args.apply else 'ro'
        d = sqlite3.connect('file:' + str(DB) + '?mode=' + mode, uri=True, isolation_level=None, timeout=15)
        d.row_factory = sqlite3.Row
        try:
            result = close(d, binding, capability, attestations, now=time.time(), apply=args.apply,
                executor_session=os.getenv('CODEX_THREAD_ID'), intent=BASE / 'closure493.intent.private.json',
                clock=time.time)
        finally:
            d.close()
        print(encode(result))
        return 0
    except BaseException as error:
        reason = str(error) if type(error) is RuntimeError else ''
        safe_reason = reason if len(reason) <= 80 and reason.replace('_', '').isalpha() else None
        print(encode({'ok': False, 'errorType': type(error).__name__,
                      'reason': safe_reason,
                      'next': 'stop-and-reconcile-intent-if-present', 'tokenPrinted': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
