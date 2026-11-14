import copy
import hashlib
import unittest
from context_draft import SOURCE, IMAGE, RUNTIME, assess, fingerprint


def fixture():
    evidence = {name: ("FICTITIOUS TEST ONLY " + name).encode() for name in
                ["owner", "tests", "native", "rollback", "author", "independent",
                 "correction", "replacement", "root-review", "apoio-review"]}
    def ref(key):
        return {"id": key, "sha256": hashlib.sha256(evidence[key]).hexdigest()}
    manifest = {"scope": "admin-query-r1-only", "executor": "admin-recuperacao",
                "source": SOURCE, "image": IMAGE, "runtime_sha256": RUNTIME,
                "harness": "a" * 40, "notice": 9001,
                "tests": ref("tests"), "native_qa": ref("native"),
                "rollback": ref("rollback"), "owner_authorization": ref("owner")}
    pending = [{"id": 8001, "fingerprint": "b" * 64, "author": "admin-recuperacao",
                "nack": True}]
    receipts = [{"operation_id": "FICTITIOUS-R1", "target_id": 8001,
                 "target_fingerprint": "b" * 64, "author": "admin-recuperacao",
                 "decision": "superseded", "execution_state": "not-executed",
                 "preserve_original": True, "applied_globally": False,
                 "author_evidence": ref("author"), "independent_evidence": ref("independent"),
                 "nack_preserved": True, "correction_evidence": ref("correction"),
                 "replacement": {"id": 8002, "fingerprint": "c" * 64,
                                 "technical_ack_actors": ["admin-recuperacao", "apoio"],
                                 "scope": "neon-only-no-workers-no-cutover",
                                 "evidence": ref("replacement")}}]
    snapshot = {"seq": 9002, "pending_notices": pending,
                "conflicting_leases": [], "inflight_operations": []}
    reviews = [{"actor": actor, "decision": "pass", "purpose": "r1-context-draft",
                "manifest_sha256": fingerprint(manifest),
                "receipts_sha256": fingerprint(receipts), "evidence": ref(key)}
               for actor, key in [("admin-recuperacao", "root-review"), ("apoio", "apoio-review")]]
    bundle = {"schema": "r1-context-draft-v1", "draft": True, "operation_id": "FICTITIOUS-R1",
              "manifest": manifest, "active_actors": ["admin-recuperacao", "apoio", "executor61"],
              "roles": {"executor61": "channel"}, "canonical_gate_passed": False,
              "global_changes": [], "snapshot": snapshot, "execution_history": [],
              "reviews": reviews, "receipts": receipts}
    pins = {"operation_id": "FICTITIOUS-R1", "manifest_sha256": fingerprint(manifest),
            "harness": "a" * 40, "notice": 9001, "snapshot_sha256": fingerprint(snapshot),
            "snapshot_seq": 9002}
    return bundle, pins, evidence


class DraftTests(unittest.TestCase):
    def test_complete_fictitious_context_never_authorizes(self):
        args = fixture()
        before = copy.deepcopy(args)
        result = assess(*args)
        self.assertEqual(result["status"], "context-consistent-draft")
        self.assertIs(result["execution_allowed"], False)
        self.assertIs(result["canonical_gate_passed"], False)
        self.assertEqual(args, before)

    def test_manifest_binding_and_independent_pins(self):
        for field, value in [("image", "sha256:5a582"), ("source", "d" * 40),
                             ("harness", "TODO"), ("runtime_sha256", "e" * 64),
                             ("notice", 0), ("scope", "all-clouds"),
                             ("executor", "infra")]:
            with self.subTest(field=field):
                b, p, e = fixture()
                b["manifest"][field] = value
                self.assertEqual(assess(b, p, e)["status"], "blocked")
                p["manifest_sha256"] = fingerprint(b["manifest"])
                self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_current_evidence_required(self):
        for key in fixture()[2]:
            with self.subTest(key=key):
                b, p, e = fixture()
                del e[key]
                self.assertEqual(assess(b, p, e)["status"], "blocked")
                b, p, e = fixture()
                e[key] += b" altered"
                self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_new_pending_and_conflicting_or_uncertain_state(self):
        for field, value in [("pending_notices", [{"id": 9999}]),
                             ("conflicting_leases", [{"state": "active", "fence": 1}]),
                             ("conflicting_leases", [{"state": "uncertain", "fence": 1}]),
                             ("conflicting_leases", [{"state": "expired", "fence": 0}]),
                             ("inflight_operations", [{"status": "timeout"}])]:
            with self.subTest(field=field, value=value):
                b, p, e = fixture()
                b["snapshot"][field] = value
                self.assertEqual(assess(b, p, e)["status"], "blocked")
                p["snapshot_sha256"] = fingerprint(b["snapshot"])
                self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_receipt_and_nack_cannot_be_relabelled(self):
        for field, value in [("author", "infra"), ("decision", "pass"),
                             ("target_fingerprint", "d" * 64), ("execution_state", "unknown"),
                             ("preserve_original", False), ("applied_globally", True),
                             ("nack_preserved", False), ("operation_id", "OTHER")]:
            with self.subTest(field=field):
                b, p, e = fixture()
                b["receipts"][0][field] = value
                # Even a fresh pair of review bindings cannot waive these invariants.
                for r in b["reviews"]:
                    r["receipts_sha256"] = fingerprint(b["receipts"])
                self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_reviews_are_distinct_and_for_this_operation(self):
        for mutation in [lambda b: b["reviews"].pop(),
                         lambda b: b["reviews"][1].update(actor="executor61"),
                         lambda b: b["reviews"][1].update(purpose="neon"),
                         lambda b: b["reviews"][1].update(decision="nack"),
                         lambda b: b["reviews"][1].update(manifest_sha256="f" * 64)]:
            b, p, e = fixture()
            mutation(b)
            self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_no_replay_or_global_authority(self):
        for field, value in [("draft", False), ("operation_id", "OTHER"),
                             ("execution_history", [{"status": "timeout"}]),
                             ("global_changes", ["confirm_notice_disposition"]),
                             ("canonical_gate_passed", True),
                             ("roles", {"executor61": "technical-reviewer"}),
                             ("active_actors", ["admin-recuperacao", "apoio"])]:
            b, p, e = fixture()
            b[field] = value
            self.assertEqual(assess(b, p, e)["status"], "blocked")

    def test_incomplete_input_fails_closed(self):
        for b in [{}, {"schema": "r1-context-draft-v1"}, None]:
            self.assertEqual(assess(b, {}, {})["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
