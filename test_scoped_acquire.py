"""Only temporary ledgers and fictitious evidence; never production entrypoint."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import scoped_acquire as gate

spec = importlib.util.spec_from_file_location('test_canonical_coord', gate.COORD)
coord = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coord)
gate.ledger_overlaps = coord.overlaps


class ScopedAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r1-gate-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.base.chmod(0o700)
        self.ledger = coord.Ledger(self.base / 'ledger.sqlite')
        for actor, session in [(gate.ACTOR, gate.ROOT_THREAD), ('apoio', 'fictitious-apoio'),
                               ('executor61', 'fictitious-channel')]:
            self.ledger.register(actor, session, [])
        proof = self.base / 'proof.json'
        proof.write_text('{"FICTITIOUS":true}')
        self.proof = [{'path': str(proof), 'sha256': gate.sha(proof.read_bytes())}]
        self.receipt = {'operationId': gate.OPERATION, 'manifestSha256': 'a' * 64,
                        'globalChanges': [], 'canonicalGatePassed': False, 'notices': []}
        self.binding = {'operationId': gate.OPERATION, 'manifestSha256': 'a' * 64,
                        'receiptSha256': 'b' * 64}
        self.manifest = {'sourceCommit': gate.SOURCE, 'qaHarnessCommit': gate.HARNESS,
                         'newImage': gate.IMAGE,
                         'artifactSha256': '278345b65fd8a384d9b7639faf68e0a1a23d5f837f444fdd039aba4c798c9f78',
                         'releaseEnv': '/etc/peticao-admin-v2/release.env'}
        self.helper_sha = gate.sha(Path(gate.__file__).read_bytes())
        self.history = self.ledger.announce(gate.ACTOR, 'FICTITIOUS historical release',
                                           ['deploy:fictitious'], {'manifest': {}})['seq']
        self.ledger.ack('apoio', self.history)
        self.add_receipt(self.history, 'archived-completed', 'completed-verified')
        binding = {'operationId': gate.OPERATION, 'manifestSha256': 'a' * 64,
                   'receiptSha256': 'b' * 64, 'helperSha256': self.helper_sha}
        reviews = {}
        for actor in gate.REVIEWERS:
            review_path = self.base / (actor + '-review.json')
            review_path.write_text(json.dumps({'actor': actor, 'decision': 'pass',
                'purpose': 'r1-scoped-acquire', 'binding': binding}))
            reviews[actor] = {'path': str(review_path), 'sha256': gate.sha(review_path.read_bytes())}
        self.final = self.ledger.announce(gate.ACTOR, 'FICTITIOUS exact R1 final review', gate.RESOURCES,
            {'manifest': {'commit': gate.SOURCE, 'api_contracts': 'unchanged',
                          'database': 'unchanged', 'destination': 'admin-v2 Sao Paulo',
                          'files': ['fictitious'], 'tests': ['fictitious isolated PASS']},
             'operation_scoped': binding, 'technical_reviews': reviews})['seq']
        self.ledger.ack(gate.ACTOR, self.final)
        self.ledger.ack('apoio', self.final)

    def add_receipt(self, event, decision, state):
        fp = self.ledger.notice_fingerprint(event)
        self.receipt['notices'].append({'event': event, 'fingerprint': fp['sha256'],
             'missingAck': ['executor61'], 'author': gate.ACTOR, 'decision': decision,
             'state': state, 'relevance': 'outside-r1', 'appliedGlobally': False,
             'authorEvidence': self.proof, 'independentEvidence': self.proof,
             'stateEvidence': self.proof})

    def run_gate(self, dry=True, **kwargs):
        return gate.obtain(self.ledger, self.binding, self.receipt, self.manifest,
                           self.final, self.helper_sha, self.base, gate.ROOT_THREAD,
                           dry_run=dry, **kwargs)

    def test_check_has_no_writes_intent_or_capability(self):
        before = self.ledger.path.read_bytes()
        r = self.run_gate()
        self.assertFalse(r['leaseAcquired'])
        self.assertFalse((self.base / 'deploy-lease.private.json').exists())
        self.assertEqual(before, self.ledger.path.read_bytes())

    def test_real_acquisition_is_canonical_fenced_and_projection_unchanged(self):
        with self.ledger.db() as d:
            projection = gate.global_projection(d, self.ledger)
        # Normal CLI acquisition still refuses, including after the scoped lease.
        with self.assertRaisesRegex(RuntimeError, 'pending_ack'):
            self.ledger.acquire(gate.ACTOR, gate.RESOURCES, 'deploy', manifest_event=self.final)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            r = self.run_gate(dry=False)
        capability = json.loads((self.base / 'deploy-lease.private.json').read_text())
        self.assertNotIn(capability['token'], stdout.getvalue() + json.dumps(r))
        self.assertEqual(os.stat(self.base / 'deploy-lease.private.json').st_mode & 0o777, 0o600)
        self.assertTrue(self.ledger.check(gate.ACTOR, capability['lease'], capability['token'],
                                         capability['fence'])['valid'])
        with self.ledger.db() as d:
            self.assertEqual(gate.global_projection(d, self.ledger), projection)
            self.assertEqual(json.loads(d.execute('SELECT resources FROM leases').fetchone()[0]), gate.RESOURCES)
            self.assertFalse(d.execute("SELECT 1 FROM events WHERE kind='notice_disposition_confirmed'").fetchone())
        self.ledger.release(gate.ACTOR, capability['lease'], capability['token'], capability['fence'])
        with self.assertRaisesRegex(RuntimeError, 'pending_ack'):
            self.ledger.acquire(gate.ACTOR, gate.RESOURCES, 'deploy', manifest_event=self.final)
        with self.assertRaisesRegex(RuntimeError, 'already_attempted'):
            self.run_gate(dry=False)

    def test_root_identity_and_ttl(self):
        with self.assertRaisesRegex(RuntimeError, 'root_executor_only'):
            gate.obtain(self.ledger, self.binding, self.receipt, self.manifest, self.final,
                        self.helper_sha, self.base, 'infra-thread')
        for ttl in [0, 29, 3601, True]:
            with self.assertRaisesRegex(RuntimeError, 'invalid_ttl'):
                self.run_gate(ttl=ttl)

    def test_artifact_and_notice_pins(self):
        for field in ['sourceCommit', 'qaHarnessCommit', 'newImage', 'artifactSha256', 'releaseEnv']:
            old = self.manifest[field]
            self.manifest[field] = 'WRONG'
            with self.assertRaisesRegex(RuntimeError, 'artifact_pin'):
                self.run_gate()
            self.manifest[field] = old
        with self.assertRaisesRegex(RuntimeError, 'binding_mismatch'):
            gate.obtain(self.ledger, self.binding, self.receipt, self.manifest, self.final,
                        'f' * 64, self.base, gate.ROOT_THREAD)

    def test_new_pending_and_missing_current_reviews_abort(self):
        with self.ledger.db(True) as d:
            d.execute('DELETE FROM acks WHERE actor=? AND seq=?', ('apoio', self.final))
        with self.assertRaisesRegex(RuntimeError, 'reviews_required'):
            self.run_gate()
        self.ledger.ack('apoio', self.final)
        self.ledger.announce('apoio', 'FICTITIOUS new unexpected pending', ['deploy:new'])
        with self.assertRaisesRegex(RuntimeError, 'pending_notices'):
            self.run_gate()

    def test_conflicts_active_expired_uncertain(self):
        lease = self.ledger.acquire(gate.ACTOR, ['code:'], 'edit')
        for state, expires in [('active', time.time() + 600), ('active', time.time() - 1),
                               ('uncertain', time.time() - 1)]:
            with self.ledger.db(True) as d:
                d.execute('UPDATE leases SET state=?,expires=? WHERE id=?', (state, expires, lease['lease']))
            with self.assertRaisesRegex(RuntimeError, 'resource_busy'):
                self.run_gate()

    def test_historical_receipt_and_evidence_drift(self):
        item = self.receipt['notices'][0]
        for field, value in [('fingerprint', 'f' * 64), ('missingAck', []),
                             ('state', 'unknown'), ('decision', 'pass'), ('appliedGlobally', True)]:
            old = item[field]
            item[field] = value
            with self.assertRaises(RuntimeError):
                self.run_gate()
            item[field] = old
        Path(self.proof[0]['path']).write_text('ALTERED')
        with self.assertRaisesRegex(RuntimeError, 'digest_mismatch'):
            self.run_gate()

    def test_no_retry_after_post_commit_capability_failure(self):
        original = gate.durable_json
        def interrupted(path, value, exclusive=False):
            if Path(path).name == 'deploy-lease.private.json' and not exclusive:
                raise TimeoutError('FICTITIOUS write timeout')
            return original(path, value, exclusive)
        with patch.object(gate, 'durable_json', interrupted):
            with self.assertRaises(TimeoutError):
                self.run_gate(dry=False)
        self.assertTrue((self.base / 'r1-acquisition-intent.private.json').exists())
        with self.ledger.db() as d:
            self.assertEqual(d.execute('SELECT COUNT(*) FROM leases').fetchone()[0], 1)
        with self.assertRaises(RuntimeError):
            self.run_gate(dry=False)

    def test_intent_exclusive_prevents_replay_without_ledger_mutation(self):
        gate.durable_json(self.base / 'r1-acquisition-intent.private.json', {'status': 'uncertain'}, True)
        with self.assertRaises(FileExistsError):
            self.run_gate(dry=False)
        with self.ledger.db() as d:
            self.assertEqual(d.execute('SELECT COUNT(*) FROM leases').fetchone()[0], 0)

    def test_wrong_fence_and_expired_token_remain_canonical_failures(self):
        self.run_gate(dry=False)
        cap = json.loads((self.base / 'deploy-lease.private.json').read_text())
        with self.assertRaises(PermissionError):
            self.ledger.check(gate.ACTOR, cap['lease'], cap['token'], cap['fence'] + 1)
        with self.ledger.db(True) as d:
            d.execute('UPDATE leases SET expires=? WHERE id=?', (time.time() - 1, cap['lease']))
        with self.assertRaises(RuntimeError):
            self.ledger.check(gate.ACTOR, cap['lease'], cap['token'], cap['fence'])

    def test_withdrawal_requires_correction_and_reviewed_replacement(self):
        replacement = self.ledger.announce(gate.ACTOR, 'FICTITIOUS corrected Neon-only procedure',
                                            ['deploy:neon'], {'manifest': {}})['seq']
        for actor in gate.REVIEWERS:
            self.ledger.ack(actor, replacement)
        self.add_receipt(replacement, 'reviewed-only', 'reviewed-not-executed')
        item = self.receipt['notices'][0]
        item.update(decision='superseded', state='not-executed', nackPreserved=True,
                    nonExecutionEvidence=self.proof, correctionEvidence=self.proof,
                    replacement={'event': replacement,
                                 'fingerprint': self.ledger.notice_fingerprint(replacement)['sha256'],
                                 'scope': 'neon-only-no-workers-no-cutover', 'evidence': self.proof})
        self.assertFalse(self.run_gate()['leaseAcquired'])
        for field in ['nonExecutionEvidence', 'correctionEvidence']:
            old = item.pop(field)
            with self.assertRaises((KeyError, RuntimeError)):
                self.run_gate()
            item[field] = old
        item['nackPreserved'] = False
        with self.assertRaisesRegex(RuntimeError, 'nack_unproven'):
            self.run_gate()
        item['nackPreserved'] = True
        item['replacement']['fingerprint'] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'replacement_unproven'):
            self.run_gate()

    def test_unexpected_actor_is_not_silently_removed(self):
        self.ledger.register('fourth-fictitious', 'extra', [])
        with self.assertRaisesRegex(RuntimeError, 'unexpected_active_actors'):
            self.run_gate()

    def test_revalidation_blocks_notice_arriving_after_intent(self):
        original = gate.durable_json
        def arrival(path, value, exclusive=False):
            result = original(path, value, exclusive)
            if Path(path).name == 'r1-acquisition-intent.private.json' and exclusive:
                self.ledger.announce('apoio', 'FICTITIOUS concurrent new pending', ['deploy:other'])
            return result
        with patch.object(gate, 'durable_json', arrival):
            with self.assertRaisesRegex(RuntimeError, 'pending_notices'):
                self.run_gate(dry=False)
        with self.ledger.db() as d:
            self.assertEqual(d.execute('SELECT COUNT(*) FROM leases').fetchone()[0], 0)

    def test_concurrent_attempts_produce_only_one_capability(self):
        from concurrent.futures import ThreadPoolExecutor
        def attempt():
            try:
                return self.run_gate(dry=False)['leaseAcquired']
            except (RuntimeError, FileExistsError):
                return False
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(sum(executor.map(lambda _: attempt(), range(2))), 1)
        with self.ledger.db() as d:
            self.assertEqual(d.execute('SELECT COUNT(*) FROM leases').fetchone()[0], 1)

    def test_review_file_cannot_be_changed_after_final_notice(self):
        (self.base / 'apoio-review.json').write_text('{"decision":"nack"}')
        with self.assertRaisesRegex(RuntimeError, 'digest_mismatch'):
            self.run_gate()

    def test_duplicate_or_substituted_owner_sources_abort_before_file_read(self):
        refs = [{'sourceLineSha256': digest} for digest in gate.OWNER_SOURCE_HASHES]
        for sources in [refs[:2], [refs[0]] * 3, refs + [refs[0]]]:
            with self.assertRaisesRegex(RuntimeError, 'exact_original_owner_sources'):
                gate.verify_owner_sources({'directUserSources': sources})
        fake = self.base / 'fake-owner.jsonl'
        fake.write_text('{"type":"response_item","payload":{"role":"assistant"}}\n')
        for reference in refs:
            reference.update(sourcePath=str(fake), line=1)
        with self.assertRaisesRegex(RuntimeError, 'original_owner_source_changed'):
            gate.verify_owner_sources({'directUserSources': refs})


if __name__ == '__main__':
    unittest.main()
