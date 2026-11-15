import concurrent.futures
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import remote_contract as r


PROFILE = {"fixture-pass": "1" * 64}


def launch_marker(marker):
    # A real child workload writes the marker; the InvocationID is synthetic.
    code = "import os,sys; fd=os.open(sys.argv[1],os.O_CREAT|os.O_WRONLY|os.O_APPEND,0o600); os.write(fd,b'actual-process-launch\\n'); os.fsync(fd); os.close(fd)"
    subprocess.run([sys.executable, "-c", code, str(marker)], check=True, timeout=10,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return "d" * 32


def concurrent_start(journal, manifest, token, receipt_sha, marker):
    guard = r.EpochGuard(Path(journal).parent.parent / "control-root" / "epoch.json", r.private_file)
    worker = r.WorkerJournal(journal, "civo", 1, lambda: "worker-boot-1", PROFILE, guard)
    worker.start_once(manifest, token, receipt_sha, lambda *_: launch_marker(marker))


def crash_after_commit(journal, manifest, token, receipt_sha):
    guard = r.EpochGuard(Path(journal).parent.parent / "control-root" / "epoch.json", r.private_file)
    worker = r.WorkerJournal(journal, "civo", 1, lambda: "worker-boot-1", PROFILE, guard)
    worker.start_once(manifest, token, receipt_sha, lambda *_: os._exit(91))


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="contract-", dir=Path(__file__).parent)
        self.root = Path(self.tmp.name)
        for directory in ("queue-root", "worker-root", "control-root"):
            (self.root / directory).mkdir(mode=0o700)
        self.queue = self.root / "queue-root" / "queue.sqlite"
        with sqlite3.connect(self.queue) as db:
            db.executescript("""
              CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL,
                state TEXT NOT NULL,generation INTEGER NOT NULL,created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,exit_code INTEGER,error TEXT);
              CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,
                job_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL);
            """)
        self.queue.chmod(0o600)
        self.authority_path = self.root / "queue-root" / "authority.json"
        self.authority_path.write_text(json.dumps({"role": "primary", "generation": 1, "armed_boot_id": "controller-boot-1"}))
        self.authority_path.chmod(0o600)
        self.epoch_path = self.root / "control-root" / "epoch.json"
        self.epoch = {"generation": 1, "primary_host": "civo", "coordinator_boot_id": "controller-boot-1", "operation_id": "e" * 32}
        self.epoch_path.write_text(json.dumps(self.epoch)); self.epoch_path.chmod(0o600)
        # Fixtures exercise state semantics as UID1000. Production uses the
        # default root-control validator; no runtime adapter is installed here.
        self.guard = r.EpochGuard(self.epoch_path, r.private_file)
        self.authority = r.Authority(self.authority_path, lambda: "controller-boot-1", self.guard, "civo", "e" * 32)
        self.claims = r.Claims(self.queue, self.authority, PROFILE)
        self.claims.install_schema(1)
        self.job = "a" * 32
        payload = {"backend": r.BACKEND, "kind": "fixture-pass"}
        self.manifest = {"backend": r.BACKEND, "job_id": self.job, "generation": 1, "worker_id": "civo",
                         "profile": "fixture-pass", "profile_sha256": "1" * 64,
                         "source_sha256": "2" * 64, "dependencies_sha256": "3" * 64,
                         "artifact_policy_sha256": "4" * 64, "payload_sha256": r.digest(payload)}
        self.manifest.update(coordinator_host="civo", coordinator_boot_id="controller-boot-1", authority_operation_id="e" * 32, epoch_sha256=r.digest(self.epoch))
        with sqlite3.connect(self.queue) as db:
            db.execute("INSERT INTO jobs VALUES(?,?,?,'queued',1,?,?,NULL,NULL,NULL,NULL)",
                       (self.job, r.canonical(payload), r.digest(payload), r.now(), r.now()))
            # Preserve a real legacy row/event through schema and claim operations.
            db.execute("INSERT INTO jobs VALUES(?,?,?,'completed',1,?,?,NULL,NULL,0,NULL)",
                       ("b" * 32, '{"kind":"fixture-pass"}', "old-digest", r.now(), r.now()))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)", (r.now(), "b" * 32, "legacy-event", "{}"))
        self.legacy = self.legacy_row()
        self.token = secrets.token_hex(32)
        self.token_sha = hashlib.sha256(self.token.encode()).hexdigest()
        self.journal = self.root / "worker-root" / "launch-receipts.sqlite"
        r.WorkerJournal.initialize(self.journal, "civo", 1)
        self.worker = r.WorkerJournal(self.journal, "civo", 1, lambda: "worker-boot-1", PROFILE, self.guard)
        self.marker = self.root / "launches"

    def tearDown(self):
        self.tmp.cleanup()

    def legacy_row(self):
        with sqlite3.connect(self.queue) as db:
            return db.execute("SELECT * FROM jobs WHERE id=?", ("b" * 32,)).fetchone(), db.execute("SELECT * FROM events WHERE kind='legacy-event'").fetchall()

    def bound(self):
        self.assertTrue(self.claims.reserve(self.manifest, self.token))
        receipt = self.worker.prepare(self.manifest, self.token_sha)
        self.assertTrue(self.claims.bind(self.manifest, receipt))
        return r.digest(receipt)

    def start(self, sha):
        return self.worker.start_once(self.manifest, self.token, sha, lambda *_: launch_marker(self.marker))

    def test_reserve_atomic_job_transition_preserves_legacy(self):
        self.assertTrue(self.claims.reserve(self.manifest, self.token))
        with sqlite3.connect(self.queue) as db:
            self.assertEqual(db.execute("SELECT state FROM jobs WHERE id=?", (self.job,)).fetchone()[0], "starting")
        self.assertEqual(self.legacy, self.legacy_row())

    def test_reserve_concurrent_one_winner(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.claims.reserve(self.manifest, self.token), range(8)))
        self.assertEqual(sum(results), 1)

    def test_duplicate_permit_controller_restart(self):
        sha = self.bound()
        self.assertTrue(self.claims.authorize_once(self.manifest, self.token, sha))
        other = r.Claims(self.queue, self.authority, PROFILE)
        self.assertFalse(other.authorize_once(self.manifest, self.token, sha))

    def test_worker_duplicate_multiprocess_one_actual_launch(self):
        sha = self.bound()
        self.assertTrue(self.claims.authorize_once(self.manifest, self.token, sha))
        ctx = multiprocessing.get_context("fork")
        ps = [ctx.Process(target=concurrent_start, args=(self.journal, self.manifest, self.token, sha, self.marker)) for _ in range(8)]
        for p in ps:
            p.start()
        for p in ps:
            p.join(15)
            self.assertFalse(p.is_alive())
            self.assertEqual(p.exitcode, 0)
        self.assertEqual(self.marker.read_text().splitlines(), ["actual-process-launch"])
        self.assertEqual(self.worker.observe(self.job)["state"], "running")

    def test_lost_response_after_launch_not_replayed(self):
        sha = self.bound()
        def lost(*_):
            launch_marker(self.marker)
            raise TimeoutError("simulated lost transport response")
        with self.assertRaises(TimeoutError):
            self.worker.start_once(self.manifest, self.token, sha, lost)
        self.assertEqual(self.worker.observe(self.job)["state"], "uncertain")
        self.assertFalse(self.start(sha))
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)

    def test_crash_after_commit_before_process_does_not_retry(self):
        sha = self.bound()
        p = multiprocessing.get_context("fork").Process(target=crash_after_commit, args=(self.journal, self.manifest, self.token, sha))
        p.start(); p.join(15)
        self.assertEqual(p.exitcode, 91)
        self.assertEqual(self.worker.observe(self.job)["state"], "start_intent")
        self.assertFalse(self.start(sha))
        self.assertFalse(self.marker.exists())

    def test_worker_restart_preserves_permit(self):
        sha = self.bound(); self.assertTrue(self.start(sha))
        other = r.WorkerJournal(self.journal, "civo", 1, lambda: "worker-boot-1", PROFILE, self.guard)
        self.assertFalse(other.start_once(self.manifest, self.token, sha, lambda *_: self.fail("duplicate launch")))

    def test_worker_reboot_blocks_prepare_and_start(self):
        sha = self.bound()
        other = r.WorkerJournal(self.journal, "civo", 1, lambda: "worker-boot-2", PROFILE, self.guard)
        self.assertFalse(other.observe(self.job)["boot_matches"])
        with self.assertRaises(PermissionError): other.prepare(self.manifest, self.token_sha)
        with self.assertRaises(PermissionError): other.start_once(self.manifest, self.token, sha, lambda *_: self.fail())

    def test_controller_reboot_unarmed_blocks(self):
        self.claims.authority = r.Authority(self.authority_path, lambda: "other-controller-boot", self.guard, "civo", "e" * 32)
        with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_standby_cannot_install_schema_or_reserve(self):
        value = json.loads(self.authority_path.read_text()); value["role"] = "standby"
        self.authority_path.write_text(json.dumps(value))
        with self.assertRaises(PermissionError): self.claims.install_schema(1)
        with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_current_generation_mismatch_blocks(self):
        value = json.loads(self.authority_path.read_text()); value["generation"] = 2
        self.authority_path.write_text(json.dumps(value))
        with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_authority_generation_bool_rejected(self):
        value = json.loads(self.authority_path.read_text()); value["generation"] = True
        self.authority_path.write_text(json.dumps(value))
        with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_wrong_token_blocks_controller_and_worker(self):
        sha = self.bound()
        with self.assertRaises(PermissionError): self.claims.authorize_once(self.manifest, "e" * 64, sha)
        with self.assertRaises(PermissionError): self.worker.start_once(self.manifest, "e" * 64, sha, lambda *_: self.fail())

    def test_changed_manifest_rejected_after_reservation(self):
        self.claims.reserve(self.manifest, self.token)
        changed = dict(self.manifest, source_sha256="9" * 64)
        with self.assertRaises(PermissionError): self.claims.reserve(changed, self.token)

    def test_changed_receipt_rejected(self):
        self.bound()
        receipt = self.worker.prepare(self.manifest, self.token_sha)
        receipt["boot_id"] = "forged-new-boot"
        with self.assertRaises(PermissionError): self.claims.bind(self.manifest, receipt)

    def test_unknown_and_shell_fields_rejected(self):
        for k in ("command", "argv", "env", "database_url", "extra"):
            with self.assertRaises(ValueError): self.worker.prepare(dict(self.manifest, **{k: "anything"}), self.token_sha)

    def test_profile_digest_and_worker_allowlist(self):
        with self.assertRaises(PermissionError): self.worker.prepare(dict(self.manifest, profile_sha256="f" * 64), self.token_sha)
        with self.assertRaises(ValueError): self.worker.prepare(dict(self.manifest, worker_id="production-sp"), self.token_sha)
        with self.assertRaises(ValueError): self.worker.prepare(dict(self.manifest, profile="../../bin/sh"), self.token_sha)

    def test_corrupt_payload_digest_refused(self):
        with sqlite3.connect(self.queue) as db: db.execute("UPDATE jobs SET payload=? WHERE id=?", ('{"backend":"ssh-systemd-v1","kind":"tampered"}', self.job))
        with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_legacy_backend_cannot_be_remote(self):
        payload = {"kind": "fixture-pass"}
        with sqlite3.connect(self.queue) as db: db.execute("UPDATE jobs SET payload=?,digest=? WHERE id=?", (r.canonical(payload), r.digest(payload), self.job))
        with self.assertRaises(PermissionError): self.claims.reserve(dict(self.manifest, payload_sha256=r.digest(payload)), self.token)

    def test_cancel_before_authorization_burns_controller_permit(self):
        sha = self.bound()
        self.assertTrue(self.claims.cancel_intent(self.manifest))
        self.assertFalse(self.claims.authorize_once(self.manifest, self.token, sha))
        self.assertFalse(self.claims.cancel_intent(self.manifest))

    def test_cancel_worker_prepared_prevents_start(self):
        sha = self.bound()
        self.assertEqual(self.worker.cancel_intent(self.manifest), "canceled_before_start")
        self.assertFalse(self.start(sha))

    def test_running_cancel_never_claims_process_stopped(self):
        sha = self.bound(); self.start(sha)
        self.assertEqual(self.worker.cancel_intent(self.manifest), "stop_observation_required")
        self.assertEqual(self.worker.observe(self.job)["state"], "running")

    def test_missing_queue_never_created(self):
        p = self.queue.parent / "other.sqlite"
        with self.assertRaises(FileNotFoundError): r.Claims(p, self.authority, PROFILE)
        self.assertFalse(p.exists())

    def test_constructor_is_read_only(self):
        before = self.queue.read_bytes()
        r.Claims(self.queue, self.authority, PROFILE)
        self.assertEqual(self.queue.read_bytes(), before)

    def test_public_observations_do_not_expose_token(self):
        self.bound()
        value = r.canonical([self.claims.observe(self.job), self.worker.observe(self.job)])
        self.assertNotIn(self.token, value)
        self.assertNotIn("token_sha256", value)

    def test_symlink_and_world_readable_database_rejected(self):
        p = self.root / "linked.sqlite"; p.symlink_to(self.queue)
        with self.assertRaises(ValueError): r.Claims(p, self.authority, PROFILE)
        self.queue.chmod(0o644)
        with self.assertRaises(PermissionError): r.Claims(self.queue, self.authority, PROFILE)

    def test_worker_initialization_never_overwrites(self):
        before = self.journal.read_bytes()
        with self.assertRaises(FileExistsError): r.WorkerJournal.initialize(self.journal, "civo", 1)
        self.assertEqual(before, self.journal.read_bytes())

    def test_worker_constructor_identity_mismatch(self):
        with self.assertRaises(PermissionError): r.WorkerJournal(self.journal, "akamai", 1, lambda: "worker-boot-1", PROFILE, self.guard)
        with self.assertRaises(PermissionError): r.WorkerJournal(self.journal, "civo", 2, lambda: "worker-boot-1", PROFILE, self.guard)

    def test_worker_epoch_revalidated_on_mutation(self):
        sha = self.bound()
        with sqlite3.connect(self.journal) as db: db.execute("UPDATE metadata SET value='2' WHERE key='generation'")
        with self.assertRaises(PermissionError): self.start(sha)

    def test_permit_not_bound_cannot_launch_controller(self):
        self.claims.reserve(self.manifest, self.token)
        with self.assertRaises(PermissionError): self.claims.authorize_once(self.manifest, self.token, "a" * 64)

    def test_floor_rejects_rearm_old_source(self):
        old = r.Authority(self.authority_path, lambda: "controller-boot-1", self.guard, "santiago", "e" * 32)
        with self.assertRaises(PermissionError): old.require(1)

    def test_floor_advance_blocks_existing_controller_and_worker(self):
        sha = self.bound()
        self.epoch_path.write_text(json.dumps(dict(self.epoch, generation=2)))
        with self.assertRaises(PermissionError): self.claims.authorize_once(self.manifest, self.token, sha)
        with self.assertRaises(PermissionError): self.start(sha)

    def test_floor_change_op_blocks_reused_manifest(self):
        sha = self.bound()
        self.epoch_path.write_text(json.dumps(dict(self.epoch, operation_id="f" * 32)))
        with self.assertRaises(PermissionError): self.start(sha)

    def test_floor_missing_fails_closed(self):
        self.epoch_path.unlink()
        with self.assertRaises(FileNotFoundError): self.claims.reserve(self.manifest, self.token)
        with self.assertRaises(FileNotFoundError): self.worker.prepare(self.manifest, self.token_sha)

    def test_floor_tampered_digest_refused(self):
        bad = dict(self.manifest, epoch_sha256="0" * 64)
        with self.assertRaises(PermissionError): self.claims.reserve(bad, self.token)
        with self.assertRaises(PermissionError): self.worker.prepare(bad, self.token_sha)

    def test_floor_manifest_wrong_host_boot_and_op(self):
        for field, value in [("coordinator_host", "santiago"), ("coordinator_boot_id", "new-boot"), ("authority_operation_id", "f" * 32)]:
            with self.assertRaises(PermissionError): self.worker.prepare(dict(self.manifest, **{field: value}), self.token_sha)

    def test_floor_schema_bool_and_extra_fields_refused(self):
        for epoch in [dict(self.epoch, generation=True), dict(self.epoch, extra=True)]:
            self.epoch_path.write_text(json.dumps(epoch))
            with self.assertRaises(PermissionError): self.claims.reserve(self.manifest, self.token)

    def test_initialization_symlink_ancestor_leaves_no_external_file(self):
        target = self.root / "private"; target.mkdir(mode=0o700)
        link = self.root / "alias"; link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(ValueError): r.WorkerJournal.initialize(link / "outside.sqlite", "civo", 1)
        self.assertFalse((target / "outside.sqlite").exists())

    def test_default_guard_rejects_nonroot_fixture_control(self):
        if os.geteuid() == 0:
            self.skipTest("requires the normal user fixture")
        guard = r.EpochGuard(self.epoch_path)
        with self.assertRaises(PermissionError): guard.require(1, "civo", "controller-boot-1", "e" * 32)

    def test_floor_inside_queue_restore_tree_rejected(self):
        bad = r.Authority(self.authority_path, lambda: "controller-boot-1", r.EpochGuard(self.authority_path, r.private_file), "civo", "e" * 32)
        with self.assertRaises(ValueError): r.Claims(self.queue, bad, PROFILE)


if __name__ == "__main__":
    unittest.main()
