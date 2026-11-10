import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / "recovery" / "recovery.py"
spec = importlib.util.spec_from_file_location("recovery", MODULE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.primary = self.root / "primary"
        self.primary.mkdir()
        self.worker = self.root / "worker"
        self.worker.mkdir()
        self.authority = {"role": "primary", "generation": 7, "armed_boot_id": "old-boot"}
        r.atomic_json(self.primary / "authority.json", self.authority)
        with sqlite3.connect(self.primary / "queue.sqlite") as db:
            db.executescript("PRAGMA journal_mode=WAL; CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT,error TEXT,updated_at TEXT,finished_at TEXT); CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,job_id TEXT,kind TEXT,data TEXT);")
            db.executemany("INSERT INTO jobs(id,state) VALUES(?,?)", [("running-job", "running"), ("queued-job", "queued"), ("done-job", "completed")])
        source = self.primary / "sources" / ("a" * 40) / "tree"
        source.mkdir(parents=True)
        (source / "package.json").write_text('{"name":"fixture"}')
        (source / ".env.local").write_text("must-not-copy")
        job = self.worker / "jobs" / ("b" * 32)
        job.mkdir(parents=True)
        (job / "output.log").write_text("test output\n")
        (job / "work").mkdir()
        (job / "work" / "private.txt").write_text("work is not copied")
        self.archive = Path(r.snapshot(self.primary, self.root / "snapshots", self.worker)["snapshot"])

    def tearDown(self):
        self.tmp.cleanup()

    def test_snapshot_online_database_integrity_and_allowlist(self):
        meta = r.verify(self.archive)
        self.assertEqual(meta["generation"], 7)
        with tarfile.open(self.archive) as tf:
            names = tf.getnames()
            self.assertIn("coordinator/queue.sqlite", names)
            self.assertIn("worker/jobs/" + "b" * 32 + "/output.log", names)
            self.assertFalse(any(".env" in x or "private.txt" in x for x in names))

    def test_restore_is_passive_and_does_not_repeat_uncertain_jobs(self):
        target = self.root / "standby"
        result = r.restore(self.archive, target)
        self.assertEqual(result["jobs_requiring_reconciliation"], 1)
        a = r.read_json(target / "authority.json")
        self.assertEqual(a["role"], "standby")
        self.assertIsNone(a["armed_boot_id"])
        with sqlite3.connect(target / "queue.sqlite") as db:
            self.assertEqual(dict(db.execute("SELECT id,state FROM jobs")), {"running-job": "interrupted", "queued-job": "queued", "done-job": "completed"})
            self.assertEqual(db.execute("SELECT count(*) FROM events WHERE kind='recovery_uncertain'").fetchone()[0], 1)
        with self.assertRaises(ValueError):
            r.restore(self.archive, target)

    def test_exact_public_env_examples_survive_capture_verify_restore(self):
        source = self.primary / "sources" / ("a" * 40) / "tree"
        examples = {".env.example": "MAIL_PROVIDER=disabled\n", ".env.sample": "PETICAO_TEST_MODE=1\n"}
        for name, value in examples.items():
            (source / name).write_text(value)
        private = [".env", ".env.local", ".env.production", ".env.example.local", ".env.sample.backup"]
        for name in private:
            (source / name).write_text("synthetic-private-value")
        archive = Path(r.snapshot(self.primary, self.root / "example-snapshots")["snapshot"])
        self.assertTrue(r.verify(archive)["verified"])
        target = self.root / "example-restore"
        r.restore(archive, target)
        restored = target / "sources" / ("a" * 40) / "tree"
        for name, value in examples.items():
            self.assertEqual((restored / name).read_text(), value)
        for name in private:
            self.assertFalse((restored / name).exists())

    def rewrite_archive(self, path, mutate):
        with tarfile.open(self.archive) as tf:
            files = {m.name: tf.extractfile(m).read() for m in tf.getmembers()}
        mutate(files)
        with tarfile.open(path, "w:gz") as tf:
            for name, content in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(content)
                tf.addfile(info, io.BytesIO(content))

    def test_corruption_is_detected_before_restore(self):
        corrupt = self.root / "corrupt.tar.gz"
        self.rewrite_archive(corrupt, lambda f: f.__setitem__("coordinator/authority.json", b"{}"))
        with self.assertRaises(ValueError):
            r.restore(corrupt, self.root / "bad-restore")
        self.assertFalse((self.root / "bad-restore").exists())

    def test_traversal_and_symlinks_are_refused(self):
        evil = self.root / "evil.tar.gz"
        self.rewrite_archive(evil, lambda f: f.__setitem__("../escape", b"no"))
        with self.assertRaises(ValueError):
            r.verify(evil)
        with tarfile.open(evil, "w:gz") as tf:
            m = tarfile.TarInfo("coordinator/link")
            m.type = tarfile.SYMTYPE
            m.linkname = "/etc/shadow"
            tf.addfile(m)
        with self.assertRaises(ValueError):
            r.verify(evil)

    def proof(self, target):
        p = self.root / "proof.json"
        r.atomic_json(p, {"previous_host": r.read_json(target / "recovery-origin.json")["source_host"], "previous_generation": 7, "new_generation": 8, "method": "coordinator-stopped", "verified": True, "verified_at": r.now()})
        return p

    def verifier(self, confirmed):
        script = self.root / ("confirm.py" if confirmed else "reject.py")
        script.write_text("#!/usr/bin/python3\nimport json,os,datetime\np=json.load(__import__('sys').stdin)\np.update(confirmed=" + repr(confirmed) + ",nonce=os.environ['ADMIN_CLUSTER_FENCE_NONCE'],verified_at=datetime.datetime.now(datetime.timezone.utc).isoformat())\nprint(json.dumps(p))\n")
        script.chmod(0o700)
        return [str(script)]

    def test_no_activation_without_live_fencing_or_on_rejected_fencing(self):
        target = self.root / "standby"
        r.restore(self.archive, target)
        proof = self.proof(target)
        for verifier in [None, self.verifier(False)]:
            with self.assertRaises(ValueError):
                r.promote(target, proof, verifier, require_root=False)
            self.assertEqual(r.read_json(target / "authority.json")["role"], "standby")

    def test_verified_promotion_increments_generation_once_and_rejects_replay(self):
        target = self.root / "standby"
        r.restore(self.archive, target)
        proof = self.proof(target)
        r.promote(target, proof, self.verifier(True), require_root=False)
        self.assertEqual(r.read_json(target / "authority.json")["generation"], 8)
        with self.assertRaises(ValueError):
            r.promote(target, proof, self.verifier(True), require_root=False)
        a = r.read_json(target / "authority.json")
        a.update(role="suspended", generation=7)
        r.atomic_json(target / "authority.json", a)
        with self.assertRaises(ValueError):
            r.promote(target, proof, self.verifier(True), require_root=False)

    def test_simulated_handover_does_not_leave_two_dispatch_authorities(self):
        target = self.root / "standby"
        r.restore(self.archive, target)
        boot = "old-boot"
        can_dispatch = lambda a, b: a["role"] == "primary" and a["armed_boot_id"] == b
        self.assertTrue(can_dispatch(r.read_json(self.primary / "authority.json"), boot))
        self.assertFalse(can_dispatch(r.read_json(target / "authority.json"), boot))
        # Simulate the live fence verifier revoking the previous coordinator.
        old = r.read_json(self.primary / "authority.json")
        old.update(role="suspended", armed_boot_id=None)
        r.atomic_json(self.primary / "authority.json", old)
        r.promote(target, self.proof(target), self.verifier(True), require_root=False)
        newboot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.assertFalse(can_dispatch(r.read_json(self.primary / "authority.json"), boot))
        self.assertTrue(can_dispatch(r.read_json(target / "authority.json"), newboot))
        # A reboot cannot rearm the old authority.
        self.assertFalse(can_dispatch(self.authority, "different-boot"))


if __name__ == "__main__":
    unittest.main()
