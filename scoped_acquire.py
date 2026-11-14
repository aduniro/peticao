"""Single-operation R1 acquisition, pending independent review. No remote deploy.

This is an explicit proposed exception route, NOT a claim that Ledger.acquire
passed. Normal global pending ACKs remain unchanged. Only Root may invoke the
production entrypoint after exact new notice reviews. Tests use temporary DBs.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import time
import uuid

OPERATION = "ADMIN-QUERY-R1-20261114"
ROOT_THREAD = "01a1cad7-4a65-7d43-b8c2-f0b50a90a580"
ACTOR = "admin-recuperacao"
REVIEWERS = {ACTOR, "apoio"}
ACTORS = REVIEWERS | {"executor61"}
PACKAGE = Path('/mnt/apps/peticao-final/_ops/admin-query-r1-publication-20261114')
HELPER_DIR = Path(__file__).resolve().parent
COORD = Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py')
CALLER_DIR = Path('/mnt/apps/peticao-final/_ops/admin-query-r1-root-20261114')
CALLER_PATH = CALLER_DIR / 'run-publication-step.py'
COORD_SHA = 'd4ba306556cd25ae291f8aab2c184632372e09a0ada387542e40f73cbd7e4ac7'
RESOURCES = sorted(['code:', 'deploy:admin-query-r1', 'path:' + str(PACKAGE),
                    'path:' + str(HELPER_DIR),
                    'path:' + str(CALLER_DIR),
                    'path:/srv/peticao/admin-query-r1-20261114/publication'])
IMAGE = 'sha256:5a582c5c71a860964d6a33c9f431a901fb85671d4b0afdf22481de610cb4aa21'
SOURCE = 'c472837fb5a4584d81f34c420f4de30989084f85'
HARNESS = '09d1d66d0e821e92d96bd83de70afdb832a31bc6'
OWNER_SOURCE_HASHES = {
    '1fe606af174d85c949d944649d503851399c79d552d360ced4f52eceb97318bd',
    'edff7e71920daa9ce814d5ffc84f48ffbeb41fd08a26b1af4c5124b616f28ff1',
    '4847cc289aedda573e590c35bb70d3ff6c695b7d5343af7d3d970b367a38d1e6',
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def need(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def read_exact(path, digest):
    need(isinstance(digest, str) and len(digest) == 64 and
         all(x in '0123456789abcdef' for x in digest), 'unfrozen_digest')
    raw = Path(path).read_bytes()
    need(sha(raw) == digest, 'evidence_digest_mismatch')
    return raw


def evidence(items):
    need(isinstance(items, list) and bool(items), 'missing_evidence')
    for item in items:
        read_exact(item['path'], item['sha256'])


def verify_owner_sources(authorization):
    references = authorization['directUserSources']
    need(len(references) == 3 and
         {r['sourceLineSha256'] for r in references} == OWNER_SOURCE_HASHES,
         'three_exact_original_owner_sources_required')
    for reference in references:
        with Path(reference['sourcePath']).open('rb') as stream:
            line = next(raw for number, raw in enumerate(stream, 1) if number == reference['line'])
        need(sha(line) == reference['sourceLineSha256'], 'original_owner_source_changed')
        original = json.loads(line)
        need(original['type'] == 'response_item' and original['payload']['role'] == 'user',
             'original_owner_user_message_required')


def global_projection(d, ledger):
    """Token-free integrity assertion over actors, ACKs and disposition state."""
    return sha(encode({'actors': [dict(x) for x in d.execute('SELECT * FROM actors ORDER BY id')],
                       'handoffs': [dict(x) for x in d.execute('SELECT * FROM actor_handoffs ORDER BY prior')],
                       'acks': [dict(x) for x in d.execute('SELECT * FROM acks ORDER BY actor,seq')],
                       'notices': [dict(x) for x in d.execute('SELECT * FROM events WHERE requires_ack=1 ORDER BY seq')],
                       'dispositions': ledger._notice_dispositions(d)}).encode())


def validate(d, ledger, binding, receipt, manifest, notice_event, helper_sha):
    need(binding['operationId'] == receipt['operationId'] == OPERATION, 'wrong_operation')
    need(receipt['manifestSha256'] == binding['manifestSha256'], 'receipt_manifest_mismatch')
    need(receipt['globalChanges'] == [] and receipt['canonicalGatePassed'] is False,
         'global_gate_misrepresented')
    need(manifest['sourceCommit'] == SOURCE and manifest['qaHarnessCommit'] == HARNESS and
         manifest['newImage'] == IMAGE and
         manifest['artifactSha256'] == '278345b65fd8a384d9b7639faf68e0a1a23d5f837f444fdd039aba4c798c9f78' and
         manifest['releaseEnv'] == '/etc/peticao-admin-v2/release.env', 'artifact_pin_mismatch')
    need(set(ledger.active_actors(d)) == ACTORS, 'unexpected_active_actors')
    need(d.execute('SELECT session FROM actors WHERE id=?', (ACTOR,)).fetchone()[0] == ROOT_THREAD,
         'root_session_mismatch')
    ledger.actor(d, ACTOR)
    disposed = ledger._notice_dispositions(d)
    row = d.execute('SELECT * FROM events WHERE seq=?', (notice_event,)).fetchone()
    need(row and row['kind'] == 'notice' and row['requires_ack'] and
         row['actor'] == ACTOR and notice_event not in disposed, 'final_notice_required')
    payload = json.loads(row['data'])
    expected = {'operationId': OPERATION, 'manifestSha256': binding['manifestSha256'],
                'receiptSha256': binding['receiptSha256'], 'helperSha256': helper_sha}
    need(payload.get('operation_scoped') == expected, 'final_notice_binding_mismatch')
    need(sha(Path(__file__).read_bytes()) == helper_sha, 'helper_bytes_changed')
    need(payload['caller']['path'] == str(CALLER_PATH), 'caller_path_mismatch')
    read_exact(CALLER_PATH, payload['caller']['sha256'])
    reviews = payload['technical_reviews']
    need(set(reviews) == REVIEWERS, 'distinct_bound_technical_reviews_required')
    for reviewer, reference in reviews.items():
        review = json.loads(read_exact(reference['path'], reference['sha256']))
        need(review['actor'] == reviewer and review['decision'] == 'pass' and
             review['purpose'] == 'r1-scoped-acquire' and
             review['binding'] == expected, 'current_technical_review_mismatch')
    normalized = payload.get('manifest', {})
    need(normalized.get('commit') == SOURCE, 'normalized_commit_mismatch')
    for key in ('api_contracts', 'database', 'destination'):
        need(isinstance(normalized.get(key), str) and normalized[key].strip(), 'normalized_manifest_missing')
    for key in ('files', 'tests'):
        need(isinstance(normalized.get(key), list) and bool(normalized[key]) and
             all(isinstance(x, str) and x.strip() for x in normalized[key]), 'normalized_manifest_missing')
    final_acks = {r['actor'] for r in d.execute('SELECT actor FROM acks WHERE seq=?', (notice_event,))}
    need(REVIEWERS <= final_acks, 'new_root_apoio_reviews_required')
    need(json.loads(row['resources']) == RESOURCES, 'final_resources_mismatch')
    entries = receipt['notices']
    indexed = {r['event']: r for r in entries}
    need(len(indexed) == len(entries), 'duplicate_receipt')
    pending = {}
    for old in d.execute('SELECT * FROM events WHERE requires_ack=1'):
        if old['seq'] in disposed or old['seq'] == notice_event:
            continue
        ack = {a['actor'] for a in d.execute('SELECT actor FROM acks WHERE seq=?', (old['seq'],))}
        missing = sorted(ACTORS - {old['actor']} - ack)
        if missing:
            pending[old['seq']] = (old, ack, missing)
    need(set(pending) == set(indexed), 'new_or_changed_pending_notices')
    for seq, (old, ack, missing) in pending.items():
        item = indexed[seq]
        need(item['fingerprint'] == sha(ledger_encode(dict(old)).encode()) and
             item['missingAck'] == missing and item['author'] == old['actor'], 'historical_notice_drift')
        need(item['relevance'] == 'outside-r1' and item['appliedGlobally'] is False,
             'receipt_scope_mismatch')
        evidence(item['authorEvidence'])
        evidence(item['independentEvidence'])
        decision, state = item['decision'], item['state']
        if decision in ('archived-completed', 'standby-inert', 'reviewed-only'):
            wanted = {'archived-completed': 'completed-verified', 'standby-inert': 'inert-verified',
                      'reviewed-only': 'reviewed-not-executed'}[decision]
            need(state == wanted and missing == ['executor61'] and
                 (REVIEWERS - {old['actor']}) <= ack, 'historical_completion_or_review_unproven')
            evidence(item['stateEvidence'])
        elif decision in ('withdrawn', 'superseded'):
            need(state == 'not-executed' and item['author'] == ACTOR and
                 item['nackPreserved'] is True, 'withdrawal_or_nack_unproven')
            evidence(item['nonExecutionEvidence'])
            evidence(item['correctionEvidence'])
            replacement = item['replacement']
            replacement_row, fingerprint = ledger._notice_fingerprint(d, replacement['event'])
            replacement_acks = {r['actor'] for r in d.execute('SELECT actor FROM acks WHERE seq=?',
                                                            (replacement['event'],))}
            need(fingerprint == replacement['fingerprint'] and REVIEWERS <= replacement_acks and
                 replacement['scope'] == 'neon-only-no-workers-no-cutover', 'replacement_unproven')
            evidence(replacement['evidence'])
        else:
            raise RuntimeError('unrecognized_historical_state')
        # Completed/rejected operations cannot hide an active/uncertain old lease.
        ledger._notice_without_live_lease(d, seq)
    for lease in d.execute("SELECT * FROM leases WHERE state IN ('active','uncertain')"):
        if any(ledger_overlaps(a, b) for a in RESOURCES for b in json.loads(lease['resources'])):
            raise RuntimeError('resource_busy_active_or_uncertain')
    # Explicit operation identity also prevents replay after a released lease.
    for old in d.execute("SELECT data FROM events WHERE kind='r1_scoped_acquired'"):
        need(json.loads(old['data']).get('operationId') != OPERATION, 'operation_already_attempted')
    return {'operationId': OPERATION, 'localReceiptApplied': True, 'globalGatePassed': False,
            'globalChanges': [], 'resources': RESOURCES, 'noticeEvent': notice_event}


# Assigned only to the exact pinned canonical implementation, never monkeypatched.
ledger_encode = encode
ledger_overlaps = None


def durable_json(path, value, exclusive=False):
    path = Path(path)
    target = path if exclusive else path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(encode(value) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        if not exclusive:
            os.replace(target, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    except BaseException:
        # Do not remove an intent: an interrupted operation is uncertain.
        raise


def obtain(ledger, binding, receipt, manifest, notice_event, helper_sha, output_dir,
           executor_session, dry_run=True, ttl=600):
    need(executor_session == ROOT_THREAD, 'root_executor_only')
    need(type(ttl) is int and 30 <= ttl <= 3600, 'invalid_ttl')
    with ledger.db() as d:
        result = validate(d, ledger, binding, receipt, manifest, notice_event, helper_sha)
    if dry_run:
        return dict(result, dryRun=True, leaseAcquired=False)
    output_dir = Path(output_dir)
    need(output_dir.is_dir() and not output_dir.is_symlink() and
         (output_dir.stat().st_mode & 0o077) == 0, 'private_output_directory_required')
    intent = output_dir / 'r1-acquisition-intent.private.json'
    capability = output_dir / 'deploy-lease.private.json'
    durable_json(intent, dict(result, status='intent-recorded-no-retry',
                             manifestSha256=binding['manifestSha256']), exclusive=True)
    durable_json(capability, {'status': 'not-acquired-do-not-use'}, exclusive=True)
    # Canonical expiry is persisted even if the subsequent transaction refuses.
    with ledger.db(True) as d:
        ledger.expire(d)
    with ledger.db(True) as d:
        result = validate(d, ledger, binding, receipt, manifest, notice_event, helper_sha)
        original_projection = global_projection(d, ledger)
        ident, token = uuid.uuid4().hex, secrets.token_hex(24)
        fence = d.execute('SELECT COALESCE(MAX(fence),0)+1 FROM leases').fetchone()[0]
        expires = time.time() + ttl
        created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        d.execute('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?)',
                  (ident, ACTOR, token, fence, 'active', expires, 'deploy', encode(RESOURCES), created_at))
        data = dict(result, lease=ident, fence=fence, expires=expires,
                    manifest_event=notice_event, manifestSha256=binding['manifestSha256'],
                    receiptSha256=binding['receiptSha256'], helperSha256=helper_sha,
                    originalProjectionSha256=original_projection)
        seq = ledger.event(d, ACTOR, 'lease_acquired', 'R1 scoped lease; global pending ACKs unchanged',
                           dict(data, operation='deploy'), RESOURCES)
        ledger.event(d, ACTOR, 'r1_scoped_acquired', 'One R1 operation; explicit local receipt projection',
                     data, RESOURCES)
        verified = ledger.verify(d, ACTOR, ident, token, fence)
        need(json.loads(verified['resources']) == RESOURCES, 'acquired_resources_mismatch')
        need(global_projection(d, ledger) == original_projection, 'global_projection_changed')
    # If this fails after commit, preserve intent and reconcile the actual lease.
    durable_json(capability, {'actor': ACTOR, 'operationId': OPERATION, 'manifestSha256': binding['manifestSha256'],
                             'manifestEvent': notice_event, 'lease': ident, 'token': token,
                             'fence': fence, 'seq': seq, 'expires': expires})
    durable_json(intent, dict(result, status='lease-acquired-no-retry', lease=ident, fence=fence))
    return dict(result, dryRun=False, leaseAcquired=True, fence=fence, seq=seq,
                capabilityFile=str(capability), tokenPrinted=False)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Reviewed single R1 acquisition; no SSH or deploy')
    parser.add_argument('--manifest-event', type=int, required=True)
    parser.add_argument('--acquire', action='store_true')
    args = parser.parse_args()
    try:
        binding = json.loads((HELPER_DIR / 'BINDING.json').read_text())
        helper_sha = sha(Path(__file__).read_bytes())
        manifest = json.loads(read_exact(PACKAGE / 'MANIFEST.json', binding['manifestSha256']))
        receipt = json.loads(read_exact(HELPER_DIR / 'OPERATION-RECEIPT.json', binding['receiptSha256']))
        package_evidence = {}
        for name, digest in manifest['evidenceSha256'].items():
            need(Path(name).name == name, 'invalid_package_path')
            package_evidence[name] = read_exact(PACKAGE / name, digest)
        read_exact(PACKAGE / 'publish.py', manifest['operatorSha256'])
        authorization = json.loads(package_evidence['OWNER-AUTHORIZATION.json'])
        verify_owner_sources(authorization)
        need(binding['coordSha256'] == COORD_SHA, 'canonical_implementation_changed')
        read_exact(COORD, COORD_SHA)
        spec = importlib.util.spec_from_file_location('canonical_r1_coord', COORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        global ledger_overlaps
        ledger_overlaps = module.overlaps
        # No constructor/schema mutation in check mode.
        ledger = object.__new__(module.Ledger)
        ledger.path = module.DEFAULT_DB
        result = obtain(ledger, binding, receipt, manifest, args.manifest_event, helper_sha,
                        CALLER_DIR, os.getenv('CODEX_THREAD_ID'), dry_run=not args.acquire)
        print(encode(result))
    except BaseException as error:
        # Never format arbitrary exception contents or capability/token objects.
        print(encode({'ok': False, 'errorType': type(error).__name__,
                      'action': 'stop-and-reconcile-if-intent-exists', 'tokenPrinted': False}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
