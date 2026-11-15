"""Private local SQLite/TokenStore tests; no host, app, auth, daemon or network."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import types
import unittest

HERE = Path(__file__).resolve().parent
# Test harness explicitly selects the immutable V4 APIs; library does not alter
# import resolution. No production DB or control file is opened.
sys.path.insert(0, str(HERE / "upstream" / "runtime"))
import remote_contract as contract
import artifacts
from controller import Finalizer
spec = importlib.util.spec_from_file_location("launch_tokens", HERE / "upstream" / "launch_tokens.py")
launch_tokens = importlib.util.module_from_spec(spec)
sys.modules["launch_tokens"] = launch_tokens
spec.loader.exec_module(launch_tokens)
from consumer import Consumer, ConsumerPending, RetirementRequest


class Authority:
    host = "civo"
    operation_id = "b" * 32
    epoch_guard = types.SimpleNamespace(path=Path("/test-external-floor/epoch.json"))

    def __init__(self):
        self.allowed = True

    def boot_id(self):
        return "test-boot"

    def require(self, generation):
        if not self.allowed or generation != 1:
            raise PermissionError("test_floor_rejected")
        return "e" * 64


class Catalog:
    def __init__(self):
        self.allowed = True
        self.profile = {"profile": "fixture-pass", **{k: "c" * 64 for k in (
            "profile_sha256", "source_sha256", "dependencies_sha256", "artifact_policy_sha256")}}

    def select(self, kind, worker):
        if not self.allowed or kind != "fixture-pass" or worker not in contract.WORKERS:
            raise PermissionError("not_qualified")
        return dict(self.profile), "d" * 64


class Facade:
    def __init__(self, queue, catalog, authority):
        self.queue, self.catalog, self.authority = queue, catalog, authority

    def primary(self):
        self.authority.require(1)
        return {"generation": 1, "coordinator_host": "civo", "armed_boot_id": "test-boot",
                "authority_operation_id": "b" * 32, "epoch_sha256": "e" * 64}

    @staticmethod
    def manifest(job_id, payload):
        result = {k: payload[k] for k in contract.MANIFEST_KEYS - {"job_id", "payload_sha256"}}
        result.update(job_id=job_id, payload_sha256=contract.digest(payload))
        return result


class PairedGuard:
    """Explicit test seam; real paired installation is parent-owned."""
    def __init__(self):
        self.allowed = True
        self.calls = []

    def check(self, db, worker_id):
        if not self.allowed or worker_id not in contract.WORKERS or not db.in_transaction:
            raise ConsumerPending("paired_guard_not_qualified")
        db.execute("SELECT worker_id,backend FROM canonical_consumer_slots LIMIT 0")
        indexes = db.execute("PRAGMA index_list(canonical_consumer_slots)").fetchall()
        if not any(row["name"] == "canonical_consumer_one_slot" and row["unique"] == 1 for row in indexes):
            raise ConsumerPending("per_node_slot_index_required")
        self.calls.append((worker_id, db.in_transaction))


class Backend:
    def __init__(self, claims):
        self.claims = claims
        self.dispatches = self.finishes = self.observes = 0
        self.lose_dispatch = self.lose_finish = False
        self.before_dispatch = None
        self.prestart_cancel = False
        self.results = {}
        self.finalizer = types.SimpleNamespace(store=types.SimpleNamespace(observe=self.custody))

    @staticmethod
    def receipt(manifest):
        return {"job_id": manifest["job_id"], "generation": manifest["generation"],
                "worker_id": manifest["worker_id"], "manifest_sha256": contract.digest(manifest),
                "boot_id": "worker-boot", "unit": "admin-dev-" + manifest["job_id"] + "-g1.service",
                "prepared_at": "2026-11-15T00:00:00+00:00"}

    def dispatch(self, manifest, token):
        self.dispatches += 1
        if self.before_dispatch:
            self.before_dispatch()
        assert self.claims.reserve(manifest, token)
        receipt = self.receipt(manifest)
        with contract.transaction(self.claims.path, True) as db:
            db.execute("UPDATE remote_execution_claims SET receipt_json=?,receipt_sha256=?,invocation_id=?,phase='permit_committed' WHERE job_id=?",
                       (contract.canonical(receipt), contract.digest(receipt), None if self.prestart_cancel else "f" * 32, manifest["job_id"]))
        if self.lose_dispatch:
            raise RuntimeError(token)
        return {"token": token}  # must never escape consumer metadata

    def observe(self, manifest):
        self.observes += 1
        return {"untrusted": "not exposed"}

    @staticmethod
    def result(manifest, receipt, identity, cancel=False):
        code = None if cancel else 0
        return {"protocol": 1, "identity": identity, "profile": manifest["profile"],
                "outcome": "canceled" if cancel else "completed", "exit_code": code,
                "unit_stop": {"unit": receipt["unit"], "invocation_id": identity["invocation_id"],
                              "worker_boot_id": receipt["boot_id"], "main_pid": 0, "cgroup_empty": True,
                              "unit_stopped": True, "exit_code": code, "canceled": cancel,
                              "receipt_sha256": contract.digest(receipt)},
                "runner_report": {"protocol": 1, "profile": manifest["profile"], "exit_code": 0},
                "runner_report_valid": True, "runner_report_sha256": "3" * 64}

    def finish(self, manifest, cancel=False):
        self.finishes += 1
        terminal = "canceled" if cancel else "completed"
        with contract.transaction(self.claims.path) as db:
            claim = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (manifest["job_id"],)).fetchone()
            receipt = json.loads(claim["receipt_json"])
            identity = {"job_id": manifest["job_id"], "generation": manifest["generation"],
                        "manifest_sha256": contract.digest(manifest), "receipt_sha256": claim["receipt_sha256"],
                        "invocation_id": claim["invocation_id"], "worker_boot_id": receipt["boot_id"]}
        if self.prestart_cancel:
            assert cancel
            self.claims.cancel_intent(manifest)
            proof = {"state": "canceled_before_start", "no_unit_created": True,
                     "receipt_sha256": contract.digest(receipt), "worker_boot_id": receipt["boot_id"]}
            answer = Finalizer(self.claims, None).canceled_before_start(manifest, receipt, proof)
            if self.lose_finish:
                raise RuntimeError("lost prestart finish reply")
            return answer
        result = self.result(manifest, receipt, identity, cancel)
        self.results[manifest["job_id"]] = result
        custody = self.finalizer.store.observe(identity)
        with contract.transaction(self.claims.path, True) as db:
            db.execute("UPDATE jobs SET state=? WHERE id=?", (terminal, manifest["job_id"]))
            db.execute("UPDATE remote_execution_claims SET phase=?,result_json=? WHERE job_id=?",
                       (terminal, contract.canonical(result), manifest["job_id"]))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES('test',?,?,?)",
                       (manifest["job_id"], "remote_" + terminal, contract.canonical({
                           "result_sha256": contract.digest(result), "wire_sha256": custody["wire_sha256"],
                           "artifact_index_sha256": custody["index_sha256"], "late_cancel": False})))
        if self.lose_finish:
            raise RuntimeError("lost finish reply")
        return {"state": terminal}

    def custody(self, identity):
        return {"state": "verified", "identity": identity,
                "wire_sha256": "1" * 64, "index_sha256": "2" * 64,
                "result": self.results[identity["job_id"]]}


class ConsumerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canonical-consumer-test-", dir=HERE)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.queue = self.root / "queue.sqlite"
        db = sqlite3.connect(self.queue)
        db.executescript("""CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL,
            state TEXT NOT NULL,generation INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
            started_at TEXT,finished_at TEXT,exit_code INTEGER,error TEXT);
            CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,job_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL);
            INSERT INTO events(at,job_id,kind,data) VALUES('legacy',NULL,'legacy','{"preserved":true}');""")
        db.close()
        self.queue.chmod(0o600)
        self.authority, self.catalog = Authority(), Catalog()
        self.facade = Facade(self.queue, self.catalog, self.authority)
        self.claims = contract.Claims(self.queue, self.authority, {"fixture-pass": "c" * 64})
        self.claims.install_schema(1)
        self.backend = Backend(self.claims)
        custody = self.root / "tokens"
        custody.mkdir(mode=0o700)
        self.generations = 0

        def factory():
            self.generations += 1
            return "a" * 64

        # Ancestors in development tree may be writable; explicit TEST seam.
        self.tokens = launch_tokens.TokenStore(custody, allowed_root=self.root,
                                               validator=lambda p: p, factory=factory)
        self.paired_guard = PairedGuard()
        self.consumer = Consumer(self.queue, self.facade, self.tokens, self.backend, paired_guard=self.paired_guard)
        self.job = "1" * 32
        self.other = "2" * 32
        self.add_job(self.job)
        self.add_job(self.other)

    def tearDown(self):
        self.tokens.close()
        self.temp.cleanup()

    def add_job(self, job, worker_id="civo"):
        payload = {"backend": contract.BACKEND, "kind": "fixture-pass", "worker_id": worker_id,
                   **self.catalog.profile, "catalog_sha256": "d" * 64,
                   "generation": 1, "coordinator_host": "civo", "coordinator_boot_id": "test-boot",
                   "authority_operation_id": "b" * 32, "epoch_sha256": "e" * 64}
        with contract.transaction(self.queue, True) as db:
            db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,'queued',1,'test','test')",
                       (job, contract.canonical(payload), contract.digest(payload)))

    def install(self):
        self.consumer.install_schema(1)

    def manifest(self):
        with contract.transaction(self.queue) as db:
            payload = json.loads(db.execute("SELECT payload FROM jobs WHERE id=?", (self.job,)).fetchone()[0])
        return self.facade.manifest(self.job, payload)

    def slot(self):
        with contract.transaction(self.queue) as db:
            return dict(db.execute("SELECT * FROM canonical_consumer_slots WHERE job_id=?", (self.job,)).fetchone())

    def ack(self, request):
        self.assertIsInstance(request, RetirementRequest)
        self.assertIsInstance(request.token, launch_tokens.LaunchSecret)
        self.assertNotIn("a" * 64, repr(request))
        value = json.loads(self.slot()["custody_json"])
        return {"state": "retained", "identity": {**value["identity"], "bundle_sha256": request.bundle_sha256,
                "custody_receipt_sha256": request.custody_receipt_sha256}, "unit_reference_released": True}

    def test_explicit_migration_preserves_legacy(self):
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.job)
        with contract.transaction(self.queue) as db:
            before = [tuple(r) for r in db.execute("SELECT * FROM events")]
            schema = db.execute("SELECT sql FROM sqlite_master WHERE name='jobs'").fetchone()[0]
        self.install()
        self.install()
        with contract.transaction(self.queue) as db:
            self.assertEqual(before, [tuple(r) for r in db.execute("SELECT * FROM events")])
            self.assertEqual(schema, db.execute("SELECT sql FROM sqlite_master WHERE name='jobs'").fetchone()[0])

    def test_token_and_intent_durable_before_claim(self):
        self.install()
        def check():
            self.assertEqual(self.tokens.load(self.manifest()).sha256(), launch_tokens.LaunchSecret("a" * 64).sha256())
            self.assertEqual(self.slot()["state"], "starting_uncertain")
        self.backend.before_dispatch = check
        output = self.consumer.start(self.job)
        self.assertTrue(output["slot_retained"])
        self.assertNotIn("a" * 64, json.dumps(output))
        with contract.transaction(self.queue) as db:
            self.assertNotIn("a" * 64, str([tuple(r) for r in db.execute("SELECT * FROM events")]))
            self.assertNotIn("a" * 64, str([tuple(r) for r in db.execute("SELECT * FROM canonical_consumer_slots")]))

    def test_lost_dispatch_restart_never_replays(self):
        self.install()
        self.backend.lose_dispatch = True
        with self.assertRaisesRegex(ConsumerPending, "no_replay") as error:
            self.consumer.start(self.job)
        self.assertNotIn("a" * 64, str(error.exception))
        restarted = Consumer(self.queue, self.facade, self.tokens, self.backend, paired_guard=self.paired_guard)
        restarted.start(self.job)
        restarted.observe(self.job)
        self.assertEqual((self.backend.dispatches, self.generations), (1, 1))
        with self.assertRaises(ConsumerPending):
            restarted.start(self.other)

    def test_incomplete_token_and_crash_before_claim_retain_slot(self):
        self.install()
        (self.tokens.root / (self.job + ".json")).touch(mode=0o600)
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.job)
        self.consumer.start(self.job)
        self.assertEqual((self.backend.dispatches, self.generations), (0, 0))
        self.assertEqual(self.slot()["active"], 1)
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.other)

    def test_concurrent_start_one_slot_one_dispatch(self):
        self.install()
        barrier = threading.Barrier(2)
        def start(job):
            barrier.wait()
            try:
                return self.consumer.start(job)
            except ConsumerPending:
                return None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            outputs = list(pool.map(start, [self.job, self.other]))
        self.assertEqual(sum(v is not None for v in outputs), 1)
        self.assertEqual((self.backend.dispatches, self.generations), (1, 1))
        with contract.transaction(self.queue) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM canonical_consumer_slots WHERE active=1").fetchone()[0], 1)

    def test_terminal_pending_retirement_blocks_next_job(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        self.assertEqual(self.slot()["state"], "custody_verified")
        self.assertEqual(self.backend.finishes, 1)
        self.consumer.finish(self.job)
        self.assertEqual(self.backend.finishes, 1)
        with self.assertRaisesRegex(ConsumerPending, "pending_infra"):
            self.consumer.retire(self.job)
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.other)
        self.assertTrue(self.slot()["active"])

    def test_lost_finish_no_replay_but_verified_retirement_possible(self):
        self.install()
        self.consumer.start(self.job)
        self.backend.lose_finish = True
        with self.assertRaises(ConsumerPending):
            self.consumer.finish(self.job)
        self.consumer.finish(self.job)
        self.assertEqual(self.backend.finishes, 1)
        self.consumer.retire_provider = self.ack
        self.assertFalse(self.consumer.retire(self.job)["slot_retained"])
        self.assertTrue(self.consumer.start(self.other)["slot_retained"])

    def test_retirement_bad_binding_or_lost_ack_never_replays(self):
        for mode in ("bad_ack", "lost_ack"):
            with self.subTest(mode=mode):
                if mode == "lost_ack":
                    self.tearDown()
                    self.setUp()
                self.install()
                self.consumer.start(self.job)
                self.consumer.finish(self.job)
                calls = []
                def provider(request):
                    calls.append(request)
                    if mode == "lost_ack":
                        raise RuntimeError("lost ACK")
                    ack = self.ack(request)
                    ack["identity"]["bundle_sha256"] = "0" * 64
                    return ack
                self.consumer.retire_provider = provider
                with self.assertRaises(ConsumerPending):
                    self.consumer.retire(self.job)
                self.consumer.retire(self.job)
                self.assertEqual(len(calls), 1)
                self.assertEqual(self.slot()["active"], 1)
                with self.assertRaises(ConsumerPending):
                    self.consumer.start(self.other)

    def test_verified_ack_only_free_slot_duplicate_readonly(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job, cancel=True)
        calls = []
        def provider(request):
            calls.append(request)
            self.assertIsNotNone(self.slot()["retire_intent"])
            return self.ack(request)
        self.consumer.retire_provider = provider
        self.assertFalse(self.consumer.retire(self.job)["slot_retained"])
        self.consumer.retire(self.job)
        self.assertEqual(len(calls), 1)
        self.assertTrue(self.consumer.start(self.other)["slot_retained"])

    def test_custody_mismatch_retains_slot_no_retire(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        calls = []
        self.consumer.custody_provider = lambda identity: {"state": "verified", "identity": {**identity, "job_id": self.other}, "wire_sha256": "1" * 64, "index_sha256": "2" * 64}
        self.consumer.retire_provider = lambda request: calls.append(request)
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        self.assertEqual(calls, [])
        self.assertEqual(self.slot()["active"], 1)

    def test_actual_artifact_store_attestation_and_tamper_gate(self):
        self.install()
        self.consumer.start(self.job)
        manifest = self.manifest()
        with contract.transaction(self.queue) as db:
            claim = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (self.job,)).fetchone()
            identity = {"job_id": self.job, "generation": 1, "manifest_sha256": contract.digest(manifest),
                        "receipt_sha256": claim["receipt_sha256"], "invocation_id": claim["invocation_id"],
                        "worker_boot_id": "worker-boot"}
        source = self.root / "fixture-bundle"
        source.mkdir(mode=0o700)
        receipt = self.backend.receipt(manifest)
        result = self.backend.result(manifest, receipt, identity)
        (source / "result.json").write_text(contract.canonical(result))
        (source / "artifacts").mkdir(mode=0o700)
        (source / "artifacts" / "evidence.txt").write_text("local synthetic artifact")
        destination = self.root / "artifact-custody"
        destination.mkdir(mode=0o700)
        store = artifacts.ArtifactStore(destination)
        wire = artifacts.pack(source, identity)
        store.receive(wire, identity)
        self.backend.finalizer.store = store
        self.consumer.finish(self.job)
        attestation = json.loads(self.slot()["custody_json"])
        self.assertEqual(attestation["bundle_sha256"], artifacts.sha(wire))
        self.assertEqual(attestation["identity"], identity)
        self.assertTrue(attestation["artifact_custody_verified"])
        self.assertNotIn("storage_retained", attestation)
        self.assertEqual(self.slot()["custody_sha256"], contract.digest(attestation))
        self.assertEqual(attestation["index_sha256"], store.observe(identity)["index_sha256"])
        (destination / self.job / "artifacts" / "evidence.txt").write_text("tampered")
        called = []
        self.consumer.retire_provider = lambda request: called.append(request)
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        self.assertEqual(called, [])
        self.assertEqual(self.slot()["active"], 1)

    def test_concurrent_retirement_intent_excludes_cleanup_replay(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        entered, released = threading.Event(), threading.Event()
        calls = []
        def provider(request):
            calls.append(request)
            entered.set()
            self.assertTrue(released.wait(5))
            return self.ack(request)
        self.consumer.retire_provider = provider
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            future = pool.submit(self.consumer.retire, self.job)
            self.assertTrue(entered.wait(5))
            try:
                self.assertTrue(self.consumer.retire(self.job)["slot_retained"])
                self.assertEqual(len(calls), 1)
            finally:
                released.set()
            self.assertFalse(future.result()["slot_retained"])

    def test_process_crash_during_preparation_never_regenerates(self):
        self.install()
        def crash():
            raise SystemExit("simulated process death")
        self.tokens.factory = crash
        with self.assertRaises(SystemExit):
            self.consumer.start(self.job)
        self.assertEqual((self.tokens.root / (self.job + ".json")).stat().st_size, 0)
        self.tokens.factory = lambda: self.fail("token regeneration after crash")
        self.consumer.start(self.job)
        self.assertEqual(self.backend.dispatches, 0)
        self.assertEqual(self.slot()["active"], 1)

    def test_accepted_terminal_event_wire_index_must_match_actual_custody(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        with contract.transaction(self.queue, True) as db:
            db.execute("UPDATE events SET data=? WHERE job_id=? AND kind='remote_completed'",
                       (contract.canonical({"result_sha256": contract.digest(self.backend.results[self.job]),
                                            "wire_sha256": "9" * 64, "artifact_index_sha256": "2" * 64}), self.job))
        called = []
        self.consumer.retire_provider = lambda request: called.append(request)
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        self.assertEqual(called, [])
        self.assertEqual(self.slot()["active"], 1)

    def test_retirement_requires_complete_coherent_finalizer_proof(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        original = self.backend.results[self.job]
        proof = {"result_sha256": contract.digest(original), "wire_sha256": "1" * 64,
                 "artifact_index_sha256": "2" * 64}
        calls = []
        self.consumer.retire_provider = lambda request: calls.append(request)
        cases = ("null_result", "empty_result", "invalid_json", "empty_object", "wrong_identity",
                 "wrong_outcome", "mismatched_terminal_state", "missing_event", "wrong_event_hash",
                 "wrong_event_index", "prestart_canceled_without_invocation")
        for case in cases:
            with self.subTest(case=case):
                result = json.loads(contract.canonical(original))
                event = dict(proof)
                phase, state, invocation = "completed", "completed", "f" * 32
                if case == "wrong_identity":
                    result["identity"]["job_id"] = self.other
                elif case == "wrong_outcome":
                    result["outcome"] = "failed"
                elif case == "mismatched_terminal_state":
                    phase = "failed"
                elif case == "wrong_event_hash":
                    event["result_sha256"] = "0" * 64
                elif case == "wrong_event_index":
                    event["artifact_index_sha256"] = "0" * 64
                elif case == "prestart_canceled_without_invocation":
                    phase = state = "canceled"
                    invocation = None
                    result = {"state": "canceled_before_start", "no_unit_created": True}
                encoded = contract.canonical(result)
                if case == "null_result":
                    encoded = None
                elif case == "empty_result":
                    encoded = ""
                elif case == "invalid_json":
                    encoded = "{not-json"
                elif case == "empty_object":
                    encoded = "{}"
                with contract.transaction(self.queue, True) as db:
                    db.execute("UPDATE jobs SET state=? WHERE id=?", (state, self.job))
                    db.execute("UPDATE remote_execution_claims SET phase=?,invocation_id=?,result_json=? WHERE job_id=?",
                               (phase, invocation, encoded, self.job))
                    db.execute("DELETE FROM events WHERE job_id=? AND kind LIKE 'remote_completed'", (self.job,))
                    if case != "missing_event":
                        db.execute("INSERT INTO events(at,job_id,kind,data) VALUES('test',?,'remote_completed',?)",
                                   (self.job, contract.canonical(event)))
                with self.assertRaises(ConsumerPending):
                    self.consumer.retire(self.job)
                self.assertEqual(calls, [])
                self.assertEqual(self.slot()["active"], 1)
                self.assertIsNone(self.slot()["retire_intent"])

    def test_other_legacy_active_job_blocks_before_slot_or_token(self):
        self.install()
        for state in ("starting", "running"):
            with self.subTest(state=state):
                with contract.transaction(self.queue, True) as db:
                    db.execute("UPDATE jobs SET state=?,payload='{}' WHERE id=?", (state, self.other))
                with self.assertRaisesRegex(ConsumerPending, "active_job_blocks_start"):
                    self.consumer.start(self.job)
                self.assertEqual((self.generations, self.backend.dispatches), (0, 0))
                with contract.transaction(self.queue) as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM canonical_consumer_slots").fetchone()[0], 0)

    def test_other_active_job_appearing_during_token_prepare_blocks_dispatch(self):
        self.install()
        original = self.tokens.prepare
        def prepare(manifest):
            secret = original(manifest)
            with contract.transaction(self.queue, True) as db:
                db.execute("UPDATE jobs SET state='running',payload='{}' WHERE id=?", (self.other,))
            return secret
        self.tokens.prepare = prepare
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.job)
        self.assertEqual((self.generations, self.backend.dispatches), (1, 0))
        self.assertEqual(self.slot()["active"], 1)

    def test_paired_guard_default_blocks_effects_but_explicit_migration_allowed(self):
        consumer = Consumer(self.queue, self.facade, self.tokens, self.backend)
        consumer.install_schema(1)
        for operation in (consumer.start, consumer.observe, consumer.finish, consumer.retire, consumer.retirement, consumer.reconcile_prestart_cancel):
            with self.subTest(operation=operation.__name__):
                with self.assertRaises(ConsumerPending):
                    operation(self.job)
        self.assertEqual((self.backend.dispatches, self.backend.observes, self.backend.finishes, self.generations), (0, 0, 0, 0))
        self.assertEqual(self.paired_guard.calls, [])

    def test_paired_guard_rechecked_before_each_effect_in_same_transaction(self):
        self.install()
        original = self.tokens.prepare
        def revoke(manifest):
            secret = original(manifest)
            self.paired_guard.allowed = False
            return secret
        self.tokens.prepare = revoke
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.job)
        self.assertEqual((self.generations, self.backend.dispatches), (1, 0))
        self.assertTrue(self.paired_guard.calls)
        self.assertTrue(all(in_transaction for _, in_transaction in self.paired_guard.calls))
        self.assertEqual(self.slot()["active"], 1)

    def test_per_node_slot_allows_distinct_remote_workers(self):
        self.install()
        third = "3" * 32
        self.add_job(third, worker_id="akamai")
        self.consumer.start(self.job)
        self.consumer.start(third)
        self.assertEqual(self.backend.dispatches, 2)
        with contract.transaction(self.queue) as db:
            self.assertEqual({row["worker_id"] for row in db.execute("SELECT worker_id FROM canonical_consumer_slots WHERE active=1")}, {"civo", "akamai"})
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.other)

    def test_local_legacy_active_blocks_civo_but_not_akamai(self):
        self.install()
        third = "3" * 32
        self.add_job(third, worker_id="akamai")
        with contract.transaction(self.queue, True) as db:
            db.execute("UPDATE jobs SET state='running',payload='{}' WHERE id=?", (self.other,))
        self.assertTrue(self.consumer.start(third)["slot_retained"])
        with self.assertRaisesRegex(ConsumerPending, "active_job_blocks_start"):
            self.consumer.start(self.job)
        self.assertEqual(self.backend.dispatches, 1)

    def test_legacy_backend_slot_blocks_same_node_only(self):
        self.install()
        third = "3" * 32
        self.add_job(third, worker_id="akamai")
        with contract.transaction(self.queue, True) as db:
            db.execute("INSERT INTO canonical_consumer_slots(job_id,generation,manifest_sha256,worker_id,backend,state,active,created_at,updated_at) VALUES(?,1,?,'civo','legacy-local','legacy_uncertain',1,'test','test')",
                       (self.other, "0" * 64))
        self.assertTrue(self.consumer.start(third)["slot_retained"])
        with self.assertRaisesRegex(ConsumerPending, "node_slot_occupied"):
            self.consumer.start(self.job)
        with self.assertRaises(PermissionError):
            self.consumer.start(self.other)

    def test_lost_ack_retirement_observation_releases_without_second_cleanup(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        cleanup, observations, retained = [], [], []
        def retire(request):
            cleanup.append(request)
            retained.append(self.ack(request))
            raise RuntimeError("simulated lost mutation ACK")
        def observe(request):
            observations.append(request)
            self.assertEqual(request.manifest, cleanup[0].manifest)
            self.assertEqual(request.token.sha256(), cleanup[0].token.sha256())
            self.assertEqual(request.receipt_sha256, cleanup[0].receipt_sha256)
            self.assertEqual(request.bundle_sha256, cleanup[0].bundle_sha256)
            self.assertEqual(request.custody_receipt_sha256, cleanup[0].custody_receipt_sha256)
            return retained[0]
        self.consumer.retire_provider = retire
        self.consumer.retirement_observer = observe
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        self.assertTrue(self.consumer.retire(self.job)["slot_retained"])
        self.assertFalse(self.consumer.retirement(self.job)["slot_retained"])
        self.consumer.retirement(self.job)
        self.assertEqual((len(cleanup), len(observations)), (1, 1))
        self.assertTrue(self.consumer.start(self.other)["slot_retained"])

    def test_uncertain_or_wrong_retirement_observation_retains_slot(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        cleanup = []
        def retire(request):
            cleanup.append(request)
            raise RuntimeError("lost ACK")
        self.consumer.retire_provider = retire
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        for case in ("uncertain", "wrong_binding", "wrong_typed_proof"):
            with self.subTest(case=case):
                def observe(request):
                    if case == "uncertain":
                        return {"state": "uncertain", "no_replay": True}
                    ack = self.ack(request)
                    if case == "wrong_binding":
                        ack["identity"]["invocation_id"] = "0" * 32
                    else:
                        ack["unit_reference_released"] = 1
                    return ack
                self.consumer.retirement_observer = observe
                with self.assertRaises(ConsumerPending):
                    self.consumer.retirement(self.job)
                self.assertEqual(self.slot()["active"], 1)
        self.consumer.retire(self.job)
        self.assertEqual(len(cleanup), 1)

    def test_retirement_observer_requires_prior_durable_intent_and_peer_guard(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        observed = []
        self.consumer.retirement_observer = lambda request: observed.append(request)
        with self.assertRaisesRegex(ConsumerPending, "existing_retirement_intent"):
            self.consumer.retirement(self.job)
        self.assertEqual(observed, [])
        self.consumer.retire_provider = lambda request: {"state": "uncertain", "no_replay": True}
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        self.paired_guard.allowed = False
        with self.assertRaises(ConsumerPending):
            self.consumer.retirement(self.job)
        self.assertEqual(observed, [])
        self.paired_guard.allowed = True
        self.consumer.retirement_observer = None
        with self.assertRaisesRegex(ConsumerPending, "observer_pending_infra"):
            self.consumer.retirement(self.job)
        self.assertEqual(self.slot()["active"], 1)

    def test_retirement_rejects_flattened_or_incomplete_retained_wire(self):
        self.install()
        self.consumer.start(self.job)
        self.consumer.finish(self.job)
        self.consumer.retire_provider = lambda request: {"state": "uncertain", "no_replay": True}
        with self.assertRaises(ConsumerPending):
            self.consumer.retire(self.job)
        for wire in ({"state": "retained"}, {"state": "retained", "identity": {}, "unit_reference_released": True},
                     {"state": "retained", "storage_retained": True, "mount_absent": True, "reference_released": True}):
            with self.subTest(wire=wire):
                self.consumer.retirement_observer = lambda request: wire
                with self.assertRaises(ConsumerPending):
                    self.consumer.retirement(self.job)
                self.assertEqual(self.slot()["active"], 1)

    def test_exact_prestart_cancel_releases_without_bundle_or_retirement(self):
        self.install()
        self.backend.prestart_cancel = True
        self.consumer.start(self.job)
        forbidden = lambda *args: self.fail("prestart path called bundle/retirement/custody")
        self.consumer.retire_provider = self.consumer.retirement_observer = forbidden
        self.backend.finalizer.store.observe = forbidden
        with contract.transaction(self.queue) as db:
            legacy_before = [tuple(row) for row in db.execute("SELECT * FROM events WHERE kind='legacy'")]
        output = self.consumer.finish(self.job, cancel=True)
        self.assertFalse(output["slot_retained"])
        slot = self.slot()
        self.assertEqual(slot["state"], "prestart_canceled")
        self.assertIsNone(slot["custody_json"])
        self.assertIsNone(slot["custody_sha256"])
        self.assertIsNone(slot["retire_intent"])
        self.assertEqual(json.loads(slot["ack_json"])["state"], "canceled_before_start")
        self.consumer.reconcile_prestart_cancel(self.job)
        self.assertEqual(self.backend.finishes, 1)
        with contract.transaction(self.queue) as db:
            self.assertEqual(legacy_before, [tuple(row) for row in db.execute("SELECT * FROM events WHERE kind='legacy'")])
            self.assertEqual(db.execute("SELECT count(*) FROM events WHERE job_id=? AND kind='consumer_slot_prestart_canceled'", (self.job,)).fetchone()[0], 1)
        self.assertTrue(self.consumer.start(self.other)["slot_retained"])

    def prepare_lost_prestart_cancel(self):
        self.install()
        self.backend.prestart_cancel = True
        self.consumer.start(self.job)
        self.backend.lose_finish = True
        with self.assertRaises(ConsumerPending):
            self.consumer.finish(self.job, cancel=True)
        self.assertEqual(self.slot()["active"], 1)

    def test_lost_prestart_reply_reconciles_same_proof_without_finish_replay(self):
        self.prepare_lost_prestart_cancel()
        self.consumer.finish(self.job, cancel=True)
        self.assertEqual(self.backend.finishes, 1)
        self.assertFalse(self.consumer.reconcile_prestart_cancel(self.job)["slot_retained"])
        self.assertEqual(self.backend.finishes, 1)
        self.assertIsNone(self.slot()["retire_intent"])

    def test_prestart_incomplete_uncertain_running_or_wrong_bindings_retain_slot(self):
        cases = ("null", "empty", "invalid_json", "missing_field", "false_proof", "integer_proof", "wrong_boot",
                 "wrong_receipt", "missing_event", "wrong_event", "running_event", "invocation",
                 "starting_job", "running_job", "uncertain_claim", "wrong_token", "wrong_receipt_manifest")
        for index, case in enumerate(cases):
            with self.subTest(case=case):
                if index:
                    self.tearDown()
                    self.setUp()
                self.prepare_lost_prestart_cancel()
                with contract.transaction(self.queue, True) as db:
                    claim = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (self.job,)).fetchone()
                    proof = json.loads(claim["result_json"])
                    if case == "missing_field":
                        del proof["worker_boot_id"]
                    elif case == "false_proof":
                        proof["no_unit_created"] = False
                    elif case == "integer_proof":
                        proof["no_unit_created"] = 1
                    elif case == "wrong_boot":
                        proof["worker_boot_id"] = "different-boot"
                    elif case == "wrong_receipt":
                        proof["receipt_sha256"] = "0" * 64
                    encoded = contract.canonical(proof)
                    if case == "null":
                        encoded = None
                    elif case == "empty":
                        encoded = ""
                    elif case == "invalid_json":
                        encoded = "not-json"
                    db.execute("UPDATE remote_execution_claims SET result_json=? WHERE job_id=?", (encoded, self.job))
                    if case in {"missing_event", "wrong_event"}:
                        db.execute("DELETE FROM events WHERE job_id=? AND kind='remote_canceled_before_start'", (self.job,))
                        if case == "wrong_event":
                            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES('test',?,'remote_canceled_before_start',?)",
                                       (self.job, contract.canonical({"receipt_sha256": "0" * 64})))
                    elif case == "running_event":
                        db.execute("INSERT INTO events(at,job_id,kind,data) VALUES('test',?,'remote_running','{}')", (self.job,))
                    elif case == "invocation":
                        db.execute("UPDATE remote_execution_claims SET invocation_id=? WHERE job_id=?", ("f" * 32, self.job))
                    elif case in {"starting_job", "running_job"}:
                        db.execute("UPDATE jobs SET state=? WHERE id=?", (case.split('_')[0], self.job))
                    elif case == "uncertain_claim":
                        db.execute("UPDATE remote_execution_claims SET phase='permit_committed' WHERE job_id=?", (self.job,))
                    elif case == "wrong_token":
                        db.execute("UPDATE remote_execution_claims SET token_sha256=? WHERE job_id=?", ("0" * 64, self.job))
                    elif case == "wrong_receipt_manifest":
                        receipt = json.loads(claim["receipt_json"])
                        receipt["manifest_sha256"] = "0" * 64
                        db.execute("UPDATE remote_execution_claims SET receipt_json=? WHERE job_id=?", (contract.canonical(receipt), self.job))
                with self.assertRaises(ConsumerPending):
                    self.consumer.reconcile_prestart_cancel(self.job)
                self.assertEqual(self.slot()["active"], 1)
                self.assertIsNone(self.slot()["retire_intent"])
                self.assertIsNone(self.slot()["custody_json"])
                self.assertEqual(self.backend.finishes, 1)
                with self.assertRaises(ConsumerPending):
                    self.consumer.start(self.other)

    def test_current_profile_and_floor_checked_before_effect(self):
        self.install()
        self.catalog.allowed = False
        with self.assertRaises(PermissionError):
            self.consumer.start(self.job)
        self.assertEqual(self.generations, 0)
        self.catalog.allowed = True
        original = self.tokens.prepare
        def revoke(manifest):
            secret = original(manifest)
            self.authority.allowed = False
            return secret
        self.tokens.prepare = revoke
        with self.assertRaises(ConsumerPending):
            self.consumer.start(self.job)
        self.assertEqual(self.backend.dispatches, 0)
        self.authority.allowed = True
        self.assertEqual(self.slot()["active"], 1)

    def test_existing_legacy_claim_adopts_without_token_regeneration(self):
        self.install()
        manifest = self.manifest()
        token = self.tokens.prepare(manifest)
        self.claims.reserve(manifest, token.value_for_dispatch())
        with self.assertRaisesRegex(ConsumerPending, "legacy_claim"):
            self.consumer.start(self.other)
        self.consumer.start(self.job)
        self.assertEqual((self.backend.dispatches, self.generations, self.backend.observes), (0, 1, 1))
        self.assertEqual(self.slot()["active"], 1)


if __name__ == "__main__":
    unittest.main()
