import concurrent.futures
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

import authority_guard as guard
import coordinator as legacy
import remote_contract as contract
import rpc_facade as rpc


HERE = Path(__file__).resolve().parent


class FacadeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fixture-", dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.queue_root = self.root / "queue"
        self.queue_root.mkdir(mode=0o700)
        self.queue = self.queue_root / "queue.sqlite"
        self.worker = self.root / "worker"
        (self.worker / "jobs").mkdir(parents=True)
        self.floor = self.root / "epoch.json"
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.control = {"generation": 2, "primary_host": "civo", "coordinator_boot_id": self.boot, "operation_id": "a"*32}
        self.write(self.floor, self.control)
        self.current = {"role": "primary", "effective_role": "primary", "generation": 2, "coordinator_host": "civo",
                        "armed_boot_id": self.boot, "authority_operation_id": "a"*32, "epoch_sha256": contract.digest(self.control)}
        self.write(self.queue_root / "authority.json", self.current)
        for patch in (mock.patch.object(guard, "GUARD", contract.EpochGuard(self.floor, contract.private_file)),
                      mock.patch.object(guard, "local_node", return_value="civo"),
                      mock.patch.object(legacy, "ROOT", self.queue_root), mock.patch.object(legacy, "WORKER", self.worker)):
            patch.start()
            self.addCleanup(patch.stop)
        # Explicit fixture-only schema install; Facade never initializes schema.
        legacy.initialize()
        self.queue.chmod(0o600)
        with sqlite3.connect(self.queue) as db:
            db.execute("PRAGMA journal_mode=DELETE")
            db.execute("CREATE TABLE remote_execution_claims(job_id TEXT PRIMARY KEY)")
        self.catalog_path = self.root / "catalog.json"
        self.catalog_value = {"version": 1, "nodes": {n: {"qualified": True} for n in contract.WORKERS},
                              "profiles": {k: {"profile": k, "qualified": True, **{d: contract.digest([k,d]) for d in rpc.DIGESTS}} for k in rpc.KINDS}}
        self.save_catalog()
        self.facade = rpc.Facade(self.queue, rpc.Catalog(self.catalog_path, contract.private_file), lambda: copy.deepcopy(self.current))
        self.request = {"action": "submit", "id": "1"*32, "kind": "fixture-pass", "worker_id": "civo"}

    def write(self, path, value):
        path.write_text(contract.canonical(value))
        path.chmod(0o600)

    def save_catalog(self):
        self.write(self.catalog_path, self.catalog_value)

    def rows(self):
        with sqlite3.connect(self.queue) as db:
            return db.execute("SELECT * FROM jobs ORDER BY id").fetchall(), db.execute("SELECT * FROM events ORDER BY seq").fetchall(), db.execute("SELECT * FROM sqlite_sequence").fetchall()

    def local(self, job="0"*32, state="completed", kind="fixture-pass", backend=None):
        payload = {"kind": kind, "duration_seconds": 0}
        if backend: payload["backend"] = backend
        with sqlite3.connect(self.queue) as db:
            db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                       (job, contract.canonical(payload), contract.digest(payload), state, 2, "2000-01-01T00:00:00+00:00", "2000-01-01T00:00:00+00:00"))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)", (contract.now(), job, "fixture", '{"secret":"not-public"}'))
        return job

    def test_submit_manifest_has_exact_keys_no_recursive_payload_hash(self):
        self.assertFalse(self.facade.rpc(self.request)["existing"])
        manifest = self.facade.manifest_for(self.request["id"])
        self.assertEqual(set(manifest), contract.MANIFEST_KEYS)
        with sqlite3.connect(self.queue) as db:
            payload, sha = db.execute("SELECT payload,digest FROM jobs").fetchone()
        self.assertNotIn("payload_sha256", json.loads(payload))
        self.assertEqual(manifest["payload_sha256"], sha)
        self.assertEqual(contract.digest(json.loads(payload)), sha)

    def test_duplicate_same_id_keeps_one_job_event(self):
        self.facade.submit(self.request)
        before = self.rows()
        self.assertTrue(self.facade.submit(self.request)["existing"])
        self.assertEqual(before, self.rows())

    def test_concurrent_same_id_has_one_insert(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.facade.submit(self.request), range(8)))
        self.assertEqual(sum(not r["existing"] for r in results), 1)
        self.assertEqual([len(x) for x in self.rows()[:2]], [1,1])

    def test_concurrent_conflicting_worker_has_one_identity(self):
        requests = [self.request, {**self.request, "worker_id": "akamai"}]
        def attempt(req):
            try: return self.facade.submit(req)
            except ValueError: return "conflict"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(attempt, requests))
        self.assertEqual(result.count("conflict"), 1)
        self.assertEqual([len(x) for x in self.rows()[:2]], [1,1])

    def test_changed_profile_worker_or_catalog_not_same_job(self):
        self.facade.submit(self.request)
        for change in ({"kind":"fixture-fail"}, {"worker_id":"azure"}):
            with self.assertRaises(ValueError): self.facade.submit({**self.request, **change})
        self.catalog_value["profiles"]["fixture-pass"]["source_sha256"] = "f"*64
        self.save_catalog()
        with self.assertRaises(ValueError): self.facade.submit(self.request)
        with self.assertRaises(PermissionError): self.facade.manifest_for(self.request["id"])

    def test_unknown_fields_commands_and_bad_types_rejected_without_rows(self):
        for key in ("argv", "env", "manifest", "archive", "path", "token", "generation", "profile_sha256", "backend"):
            with self.assertRaises(ValueError): self.facade.submit({**self.request, key: "forged"})
        for change in ({"id": True}, {"id":"../bad"}, {"worker_id": []}, {"kind":"build"}, {"worker_id":"local"}):
            with self.assertRaises(ValueError): self.facade.submit({**self.request, **change})
        self.assertEqual(len(self.rows()[0]), 0)

    def test_missing_fields_rejected(self):
        for key in self.request:
            value = dict(self.request); value.pop(key)
            with self.assertRaises(ValueError): self.facade.submit(value)

    def test_default_catalog_validator_requires_root_control(self):
        with self.assertRaises(PermissionError): rpc.Catalog(self.catalog_path).load()

    def test_missing_malformed_large_or_unqualified_catalog_refused(self):
        cases = [None, "malformed", "x"*32769]
        for content in cases:
            if content is None: self.catalog_path.unlink(missing_ok=True)
            else: self.catalog_path.write_text(content); self.catalog_path.chmod(0o600)
            with self.assertRaises((OSError, ValueError)): self.facade.submit(self.request)
        self.save_catalog()
        for where in (self.catalog_value["nodes"]["civo"], self.catalog_value["profiles"]["fixture-pass"]):
            for state in (False, 1, "true"):
                where["qualified"] = state; self.save_catalog()
                with self.assertRaises((PermissionError, ValueError)): self.facade.submit(self.request)
            where["qualified"] = True
        self.assertEqual(len(self.rows()[0]), 0)

    def test_catalog_symlink_forbidden(self):
        link = self.root / "link.json"; link.symlink_to(self.catalog_path)
        facade = rpc.Facade(self.queue, rpc.Catalog(link, contract.private_file), lambda:self.current)
        with self.assertRaises(ValueError): facade.submit(self.request)

    def test_catalog_change_inside_queue_lock_refused(self):
        original = self.facade.catalog.select
        with mock.patch.object(self.facade.catalog, "select", side_effect=[original("fixture-pass","civo"), (original("fixture-pass","civo")[0], "0"*64)]):
            with self.assertRaises(PermissionError): self.facade.submit(self.request)
        self.assertEqual(len(self.rows()[0]), 0)

    def test_floor_revocation_refuses_admission_and_envelope(self):
        self.facade.submit(self.request)
        self.control["generation"] = 3; self.write(self.floor, self.control)
        with self.assertRaises(PermissionError): self.facade.submit({**self.request,"id":"2"*32})
        with self.assertRaises(PermissionError): self.facade.manifest_for(self.request["id"])
        self.assertEqual(len(self.rows()[0]), 1)

    def test_floor_change_after_initial_check_refuses_insert(self):
        with mock.patch.object(self.facade,"primary",side_effect=[copy.deepcopy(self.current), PermissionError("revoked")]):
            with self.assertRaises(PermissionError): self.facade.submit(self.request)
        self.assertEqual(len(self.rows()[0]), 0)

    def test_reuse_after_epoch_change_or_legacy_id_refused(self):
        self.facade.submit(self.request)
        self.control["generation"] = 3; self.write(self.floor,self.control)
        self.current.update(generation=3,epoch_sha256=contract.digest(self.control))
        with self.assertRaises(ValueError): self.facade.submit(self.request)
        self.local(job="2"*32)
        with self.assertRaises(ValueError): self.facade.submit({**self.request,"id":"2"*32})

    def test_no_implicit_queue_or_schema_creation(self):
        missing = self.root / "absent.sqlite"
        facade = rpc.Facade(missing,self.facade.catalog,lambda:self.current)
        for request in (self.request, {"action":"jobs"}, {"action":"health"}):
            with self.assertRaises(FileNotFoundError): facade.rpc(request)
        self.assertFalse(missing.exists())
        with sqlite3.connect(self.queue) as db: db.execute("DROP TABLE remote_execution_claims")
        with self.assertRaises(PermissionError): self.facade.submit(self.request)
        self.assertEqual(len(self.rows()[0]), 0)

    def test_readonly_rpcs_preserve_database_bytes_rows_sequence(self):
        job = self.local()
        before = self.rows(); sha = hashlib.sha256(self.queue.read_bytes()).hexdigest()
        with mock.patch.object(legacy,"reconcile",side_effect=AssertionError("no reconciliation")):
            for request in ({"action":"health"},{"action":"jobs"},{"action":"status","id":job},{"action":"logs","id":job}):
                self.facade.rpc(request)
        self.assertEqual(before,self.rows())
        self.assertEqual(sha,hashlib.sha256(self.queue.read_bytes()).hexdigest())

    def test_read_connection_rejects_write(self):
        with self.facade.connect() as db:
            with self.assertRaises(sqlite3.OperationalError): db.execute("DELETE FROM jobs")

    def test_public_reads_no_payload_token_log_or_result(self):
        job = self.local()
        folder = self.worker/"jobs"/job; folder.mkdir()
        (folder/"output.log").write_text("RAW_PRIVATE_MARKER")
        (folder/"result.json").write_text('{"secret":"RAW_PRIVATE_MARKER"}')
        output=json.dumps([self.facade.rpc({"action":"jobs"}),self.facade.rpc({"action":"status","id":job}),self.facade.rpc({"action":"logs","id":job})])
        for forbidden in ("RAW_PRIVATE_MARKER","not-public",'"payload"','"token"',str(self.worker)):
            self.assertNotIn(forbidden,output)

    def logfile(self, job, content):
        folder=self.worker/"jobs"/job;folder.mkdir(exist_ok=True)
        path=folder/"output.log";path.write_bytes(content);path.chmod(0o600)
        self.facade.worker_root=self.worker
        return path

    def test_legacy_logs_default_bounded_bytes_and_sanitized(self):
        job=self.local()
        self.logfile(job,b"API_KEY=private-fixture\n"+b"x"*40000)
        answer=self.facade.rpc({"action":"logs","id":job})
        self.assertEqual(answer["offset"],32768)
        self.assertNotIn("private-fixture",answer["output"])
        self.assertIn("[REDACTED]",answer["output"])
        rest=self.facade.rpc({"action":"logs","id":job,"offset":32768})
        self.assertEqual(rest["offset"],len(b"API_KEY=private-fixture\n"+b"x"*40000))
        self.assertLessEqual(len(rest["output"].encode()),32768)

    def test_sanitizer_long_identifier_linear_and_credential_families_preserved(self):
        start=time.monotonic()
        self.assertEqual(legacy.sanitize("x"*32768),"x"*32768)
        self.assertLess(time.monotonic()-start,2)
        for assignment in ("TOKEN=fake", "PREFIX_PASSWORD:fake", "secret=fake", "API_KEY=fake", "DATABASE_URL=fake", "Authorization: Bearer fake", "https://user:fake@example.invalid"):
            self.assertNotIn("fake",legacy.sanitize(assignment))

    def test_log_offset_uses_raw_utf8_bytes_not_character_count(self):
        job=self.local();self.logfile(job,"áéfim".encode())
        answer=self.facade.rpc({"action":"logs","id":job,"offset":2})
        self.assertEqual(answer["offset"],7)
        self.assertEqual(answer["output"],"éfim")

    def test_legacy_metadata_only_never_reads_file(self):
        job=self.local();self.logfile(job,b"private-fixture")
        with mock.patch.object(os,"open",side_effect=AssertionError("no log open")):
            answer=self.facade.rpc({"action":"logs","id":job,"metadata_only":True})
        self.assertEqual(answer["output"],"")
        with self.assertRaises(ValueError):self.facade.rpc({"action":"logs","id":job,"metadata_only":1})

    def test_log_links_and_world_readable_files_refused(self):
        job=self.local();path=self.logfile(job,b"private-fixture")
        path.chmod(0o644)
        with self.assertRaises(PermissionError):self.facade.rpc({"action":"logs","id":job})
        path.chmod(0o600)
        other=path.with_name("original.log");path.rename(other);path.symlink_to(other)
        with self.assertRaises(OSError):self.facade.rpc({"action":"logs","id":job})
        path.unlink();other.rename(path)
        os.link(path,path.with_name("hardlink.log"))
        with self.assertRaises(PermissionError):self.facade.rpc({"action":"logs","id":job})

    def test_missing_legacy_log_unavailable_without_creation(self):
        job=self.local();self.facade.worker_root=self.worker
        answer=self.facade.rpc({"action":"logs","id":job})
        self.assertFalse(answer["available"])
        self.assertFalse((self.worker/"jobs"/job).exists())

    def test_remote_logs_use_backend_same_manifest_never_local_file(self):
        self.facade.submit(self.request);job=self.request["id"]
        self.logfile(job,b"WRONG_LOCAL_FILE")
        backend=mock.Mock();backend.logs.return_value={"id":job,"offset":9,"output":"TOKEN=secret-fixture"}
        self.facade.backend=backend
        answer=self.facade.rpc({"action":"logs","id":job,"offset":4})
        self.assertNotIn("secret-fixture",answer["output"])
        self.assertNotIn("WRONG_LOCAL_FILE",answer["output"])
        backend.logs.assert_called_once_with(self.facade.manifest_for(job),offset=4)

    def test_remote_logs_missing_adapter_or_malformed_reply_fail_closed(self):
        self.facade.submit(self.request);job=self.request["id"]
        self.logfile(job,b"WRONG_LOCAL_FILE")
        self.assertEqual(self.facade.rpc({"action":"logs","id":job})["output"],"")
        backend=mock.Mock();self.facade.backend=backend
        for reply in ({"id":"2"*32,"offset":0,"output":""},{"id":job,"offset":40000,"output":""},{"id":job,"offset":0,"output":"x"*32769}):
            backend.logs.return_value=reply
            with self.assertRaises(ValueError):self.facade.rpc({"action":"logs","id":job})

    def test_legacy_rpc_logs_remote_id_refused_before_local_read(self):
        job=self.local(backend=contract.BACKEND)
        self.logfile(job,b"WRONG_LOCAL_FILE")
        with mock.patch.object(Path,"open",side_effect=AssertionError("no local log read")):
            with self.assertRaises(PermissionError):legacy.rpc({"action":"logs","id":job})

    def test_log_redaction_is_not_a_secret_boundary_for_arbitrary_offsets(self):
        # Negative evidence: preserve compatibility without claiming impossible
        # secrecy from a prefix regex applied to a separately requested suffix.
        job=self.local();self.logfile(job,b"TOKEN=secret-fixture")
        answer=self.facade.rpc({"action":"logs","id":job,"offset":6})
        self.assertEqual(answer["output"],"secret-fixture")
        # The value stays within this fictitious test; never printed/exported.

    def test_read_field_bounds_unknown_action_and_unknown_job(self):
        for request in ({"action":"finish"},{"action":"dispatch"},{"action":"cancel","id":"1"*32},{"action":"jobs","limit":True},{"action":"jobs","after_seq":-1},{"action":"jobs","payload":{}},{"action":"status","id":"1"*32},{"action":"logs","id":"1"*32}):
            with self.assertRaises((ValueError,PermissionError)): self.facade.rpc(request)

    def test_terminal_rows_events_sequence_preserved_after_admission(self):
        self.local(); before=self.rows()
        self.facade.submit(self.request); after=self.rows()
        self.assertEqual(before[0][0],after[0][0])
        self.assertEqual(before[1][0],after[1][0])
        self.assertEqual(after[2][0][1],before[2][0][1]+1)

    def test_reconcile_never_reads_remote_runtime_or_mutates_remote(self):
        for i,state in enumerate(("queued","starting","running"),1):self.local(job=str(i)*32,state=state,backend=contract.BACKEND)
        before=self.rows()
        with mock.patch.object(legacy,"read_runtime",side_effect=AssertionError("no local remote lookup")):
            legacy.reconcile()
        self.assertEqual(before,self.rows())

    def test_remote_queued_not_launched_and_local_queued_still_launches(self):
        remote=self.local(job="1"*32,state="queued",backend=contract.BACKEND)
        local=self.local(job="2"*32,state="queued")
        with mock.patch.dict(os.environ,{"ADMIN_CLUSTER_DISPATCH":"1","ADMIN_CLUSTER_TEST_INLINE":"0"}),mock.patch.object(legacy.subprocess,"run") as launch:
            self.assertEqual(legacy.dispatch_once(),local)
            self.assertEqual(launch.call_count,1)
        self.assertFalse((self.worker/"jobs"/remote).exists())
        with sqlite3.connect(self.queue) as db:self.assertEqual(db.execute("SELECT state FROM jobs WHERE id=?",(remote,)).fetchone()[0],"queued")

    def test_active_remote_retains_single_global_slot(self):
        self.local(job="1"*32,state="running",backend=contract.BACKEND)
        self.local(job="2"*32,state="queued")
        before=self.rows()
        with mock.patch.dict(os.environ,{"ADMIN_CLUSTER_DISPATCH":"1"}),mock.patch.object(legacy.subprocess,"run",side_effect=AssertionError("no launch")):
            self.assertIsNone(legacy.dispatch_once())
        self.assertEqual(before,self.rows())

    def test_direct_legacy_remote_cancel_and_run_refused(self):
        job=self.local(state="queued",backend=contract.BACKEND)
        with self.assertRaises(PermissionError):legacy.cancel(job)
        folder=self.worker/"jobs"/job;folder.mkdir()
        payload={"kind":"fixture-pass","backend":contract.BACKEND}
        (folder/"config.json").write_text(contract.canonical({"id":job,"payload":payload,"digest":contract.digest(payload),"generation":2}))
        with self.assertRaises(PermissionError):legacy.run_job(job)
        self.assertFalse((folder/"execution.started").exists())


if __name__ == "__main__":unittest.main()
