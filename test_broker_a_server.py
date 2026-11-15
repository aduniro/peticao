"""Pure harness/trace/guard fixtures; never instantiate a native bus or socket."""
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import broker_a_server as server
import qualification_contract as q


class ReferenceUncertain(RuntimeError):
    """Local simulated error to test proof guards, not a native bus proof."""


class Guards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="server-guard-", dir=Path(__file__).parent)
        self.root = Path(self.tmp.name)
        self.request = {"operation_id": "a" * 32,
                        "jobs": {"success": "1" * 32, "failure": "2" * 32, "cancellation": "3" * 32},
                        "prestart_job_id": "4" * 32}
        self.contract = SimpleNamespace(PRIVATE=self.root, unit=q.unit, digest=q.digest, hex_value=q.hex_value)
        self.identity = {"incarnation": "1", "operation_id": self.request["operation_id"],
                         "request_sha256": "b" * 64, "pid": 123, "start_ticks": "456", "boot_id": "test-boot"}
        self.references = SimpleNamespace(records={q.unit(job): {"state": "released"} for job in self.request["jobs"].values()},
                                          lost=False, closed=False, bus=mock.Mock())
        self.references.snapshot = mock.Mock(side_effect=lambda unit: {"unit": unit, "invocation_id": "c" * 32,
            "state": self.references.records[unit]["state"], "process_id": 123, "worker_boot_id": "test-boot",
            "connection_uncertain": self.references.lost, "backend": "fixture_only_never_native"})
        self.storage = mock.Mock()
        self.storage.status.side_effect = lambda manifest, receipt: {"state": "retained", "mount_absent": True,
            "manifest_sha256": q.digest(manifest), "receipt_sha256": q.digest(receipt),
            "stopped_invocation_id": "c" * 32, "source": "/private/must-not-appear-in-trace"}
        self.documents = {}
        self.rows = {}
        for job in self.request["jobs"].values():
            manifest = {"job_id": job, "generation": 1}
            receipt = {"job_id": job, "boot_id": "test-boot"}
            binding = {"invocation_id": "c" * 32, "bundle_sha256": "d" * 64}
            self.rows[job] = ({"manifest_json": q.canonical(manifest), "receipt_json": q.canonical(receipt)}, binding)
            identity = {"job_id": job, "generation": 1, "manifest_sha256": q.digest(manifest), "receipt_sha256": q.digest(receipt),
                        "bundle_sha256": "d" * 64, "custody_receipt_sha256": "e" * 64,
                        "invocation_id": "c" * 32, "worker_boot_id": "test-boot"}
            self.documents[self.root / "retirements" / job / "intent.json"] = identity
            self.documents[self.root / "retirements" / job / "receipt.json"] = {
                "state": "retained", "identity": identity, "unit_reference_released": True}
        self.worker = mock.Mock()
        self.worker.stored.side_effect = lambda job: self.rows[job]
        self.lifecycle = mock.Mock()
        self.lifecycle.references = self.references
        self.lifecycle.root = self.root / "retirements"
        self.lifecycle.uncertain = False
        self.lifecycle.startup.return_value = {"state": "RECONCILED", "receipt_count": 4}
        self.lifecycle.retained.return_value = {"state": "retained", "mount_absent": True}
        self.lifecycle.read.side_effect = lambda path: self.documents[path]
        self.context = {"worker": self.worker, "storage": self.storage}

    def tearDown(self):
        self.tmp.cleanup()

    def wrapper(self, incarnation="1"):
        return server.TracedLifecycle(self.lifecycle, self.context, self.request, self.contract,
                                      {**self.identity, "incarnation": incarnation}, {"device": 5, "inode": 6})

    def trigger(self, wrapper, identity=None):
        path = self.root / ("quarantine-" + wrapper.incarnation + ".json")
        server.write_once(path, {"identity": wrapper.identity if identity is None else identity})
        return path

    def simulate_closed_connection_detection(self):
        closed = []
        self.references.bus.close.side_effect = lambda: closed.append(True)
        def check():
            if closed:
                self.references.lost = True
                raise ReferenceUncertain("fixture_connection_closed")
        self.lifecycle.check.side_effect = check

    def test_write_once_and_read_private_evidence(self):
        path = self.root / "proof.json"
        server.write_once(path, {"ok": True})
        self.assertEqual(server.private_json(path), {"ok": True})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            server.write_once(path, {"ok": False})
        self.assertEqual(server.private_json(path), {"ok": True})

    def test_private_proofs_reject_symlink_hardlink_mode_and_size(self):
        path = self.root / "proof.json"
        server.write_once(path, {"ok": True})
        link = self.root / "link.json"; link.symlink_to(path)
        with self.assertRaises(OSError):
            server.private_json(link)
        hard = self.root / "hard.json"; os.link(path, hard)
        with self.assertRaises(PermissionError):
            server.private_json(path)
        hard.unlink(); path.chmod(0o644)
        with self.assertRaises(PermissionError):
            server.private_json(path)
        path.chmod(0o600); path.write_bytes(b" " * 65537)
        with self.assertRaises(ValueError):
            server.private_json(path)

    def test_ready_identity_written_only_after_delegated_startup(self):
        wrapper = self.wrapper()
        self.assertEqual(wrapper.startup()["state"], "RECONCILED")
        self.lifecycle.startup.assert_called_once_with()
        proof = server.private_json(self.root / "ready-1.json")
        self.assertEqual(proof["identity"], self.identity)
        self.assertEqual(proof["reference_count"], 3)
        self.assertEqual(proof["socket_identity"], {"device": 5, "inode": 6})
        self.assertIs(wrapper.references, self.references)
        wrapper.uncertain = True
        self.assertIs(self.lifecycle.uncertain, True)

    def test_failed_startup_never_writes_ready(self):
        wrapper = self.wrapper()
        self.lifecycle.startup.side_effect = PermissionError("fixture_failure")
        with self.assertRaises(PermissionError): wrapper.startup()
        self.assertFalse((self.root / "ready-1.json").exists())
        self.assertFalse(wrapper.started)

    def test_retire_trace_delegates_once_and_excludes_raw_request_secrets(self):
        wrapper = self.wrapper()
        job = self.request["jobs"]["success"]
        self.references.records[q.unit(job)]["state"] = "held"
        def retire(request):
            self.references.records[q.unit(job)]["state"] = "released"
            return {"state": "retained"}
        self.lifecycle.side_effect = retire
        request = {"action": "retire", "manifest": {"job_id": job}, "token": "SECRET-TOKEN", "extra": "SECRET-RAW"}
        self.assertEqual(wrapper(request), {"state": "retained"})
        self.lifecycle.assert_called_once_with(request)
        raw = wrapper.trace.read_text()
        lines = [json.loads(line) for line in raw.splitlines()]
        self.assertEqual([value["stage"] for value in lines], ["before-retire", "after-retire"])
        self.assertEqual([value["reference"]["state"] for value in lines], ["held", "released"])
        for forbidden in ("SECRET-TOKEN", "SECRET-RAW", "must-not-appear-in-trace"):
            self.assertNotIn(forbidden, raw)

    def test_foreign_job_never_delegates_or_traces(self):
        wrapper = self.wrapper()
        with self.assertRaises(PermissionError): wrapper({"action": "observe", "id": "f" * 32})
        self.lifecycle.assert_not_called()
        self.assertEqual(wrapper.trace.read_bytes(), b"")
        self.assertEqual(wrapper._job({"action": "observe", "id": self.request["prestart_job_id"]}), self.request["prestart_job_id"])

    def test_reference_guards_refuse_foreign_units_held_or_missing_references(self):
        expected = server.allowed_reference_records(self.references, self.request, q, True, "1")
        self.assertEqual(len(expected), 3)
        self.references.records[expected[0]]["state"] = "held"
        with self.assertRaises(PermissionError): server.allowed_reference_records(self.references, self.request, q, True, "1")
        self.references.records.clear()
        with self.assertRaises(PermissionError): server.allowed_reference_records(self.references, self.request, q, True, "1")
        self.assertEqual(server.allowed_reference_records(self.references, self.request, q, True, "2"), [])
        self.references.records["foreign.service"] = {"state": "released"}
        with self.assertRaises(PermissionError): server.allowed_reference_records(self.references, self.request, q)

    def test_quarantine_wrong_identity_never_closes_bus(self):
        wrapper = self.wrapper(); wrapper.startup()
        self.trigger(wrapper, {**self.identity, "pid": 999})
        with self.assertRaises(PermissionError): wrapper.check()
        self.references.bus.close.assert_not_called()
        self.assertFalse((self.root / "quarantine-proof-1.json").exists())

    def test_quarantine_before_startup_or_with_held_reference_refused(self):
        wrapper = self.wrapper(); self.trigger(wrapper)
        with self.assertRaises(PermissionError): wrapper.check()
        wrapper.startup()
        self.references.records[q.unit(self.request["jobs"]["failure"])]["state"] = "held"
        with self.assertRaises(PermissionError): wrapper.check()
        self.references.bus.close.assert_not_called()

    def test_quarantine_missing_or_changed_retirement_receipt_refused(self):
        wrapper = self.wrapper(); wrapper.startup(); self.trigger(wrapper)
        job = self.request["jobs"]["success"]
        self.documents[self.root / "retirements" / job / "receipt.json"]["identity"]["bundle_sha256"] = "f" * 64
        with self.assertRaises(PermissionError): wrapper.check()
        self.references.bus.close.assert_not_called()

    def test_inc1_closed_connection_proof_after_three_released_refs(self):
        wrapper = self.wrapper(); wrapper.startup(); self.trigger(wrapper)
        self.simulate_closed_connection_detection()
        with self.assertRaises(ReferenceUncertain): wrapper.check()
        self.references.bus.close.assert_called_once_with()
        proof = server.private_json(self.root / "quarantine-proof-1.json")
        self.assertIs(proof["refsLostTrue"], True)
        self.assertEqual(proof["recordsCount"], 3)
        self.assertEqual(len(proof["retained"]), 3)
        self.assertIn("no_held_reference_io_claim", proof["scope"])
        with self.assertRaises(ReferenceUncertain): wrapper.check()
        self.references.bus.close.assert_called_once_with()

    def test_inc2_restart_zero_records_requires_retained_proofs(self):
        self.references.records.clear()
        wrapper = self.wrapper("2"); wrapper.startup(); self.trigger(wrapper)
        self.simulate_closed_connection_detection()
        with self.assertRaises(ReferenceUncertain): wrapper.check()
        proof = server.private_json(self.root / "quarantine-proof-2.json")
        self.assertEqual(proof["recordsCount"], 0)
        self.assertEqual(len(proof["retained"]), 3)
        self.lifecycle.retained.assert_has_calls([mock.call(*self._inputs(job)) for job in sorted(self.request["jobs"].values())])

    def _inputs(self, job):
        row, binding = self.rows[job]
        return json.loads(row["manifest_json"]), json.loads(row["receipt_json"]), binding

    def test_inc2_never_accepts_rearmed_refs(self):
        wrapper = self.wrapper("2"); wrapper.startup(); self.trigger(wrapper)
        with self.assertRaises(PermissionError): wrapper.check()
        self.references.bus.close.assert_not_called()

    def test_quarantine_needs_detected_reference_loss(self):
        wrapper = self.wrapper(); wrapper.startup(); self.trigger(wrapper)
        self.lifecycle.check.side_effect = RuntimeError("unrelated_error")
        with self.assertRaises(PermissionError): wrapper.check()
        self.assertFalse((self.root / "quarantine-proof-1.json").exists())

    def test_socket_cleanup_only_when_released_healthy_and_same_inode(self):
        fake = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600, st_dev=1, st_ino=2)
        with mock.patch.object(Path, "lstat", return_value=fake), mock.patch.object(Path, "unlink") as unlink, mock.patch.object(server, "sync_directory"):
            self.assertTrue(server.remove_same_socket(self.root / "fake.sock", (1, 2), self.references))
            unlink.assert_called_once()
            with self.assertRaises(PermissionError): server.remove_same_socket(self.root / "fake.sock", (1, 3), self.references)
            self.references.lost = True
            self.assertFalse(server.remove_same_socket(self.root / "fake.sock", (1, 2), self.references))
            self.references.lost = False
            next(iter(self.references.records.values()))["state"] = "held"
            self.assertFalse(server.remove_same_socket(self.root / "fake.sock", (1, 2), self.references))

    def test_ready_socket_identity_must_be_exact_positive_integer_pair(self):
        for value in ({}, {"device": 5, "inode": 6, "extra": 7}, {"device": True, "inode": 6}, {"device": 5, "inode": 0}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                server.TracedLifecycle(self.lifecycle, self.context, self.request, self.contract, self.identity, value)
        self.assertFalse((self.root / "ref-trace-1.jsonl").exists())

    def test_main_rejects_nonfixed_arguments_before_loading_core(self):
        for argv in (["server"], ["server", "3", "a" * 64], ["server", "1", "a" * 64, "extra"]):
            with mock.patch.object(server.sys, "argv", argv), mock.patch.object(server, "_load_core") as load:
                with self.assertRaises(ValueError): server.main()
                load.assert_not_called()

    def test_process_identity_checks_incarnation_and_actual_start_ticks(self):
        identity = server.process_identity("1", self.request, "a" * 64, q)
        self.assertEqual(identity["pid"], os.getpid())
        self.assertIs(type(identity["start_ticks"]), str)
        self.assertGreater(int(identity["start_ticks"]), 0)
        for value in (1, True, "0", "3"):
            with self.assertRaises(ValueError): server.process_identity(value, self.request, "a" * 64, q)


if __name__ == "__main__":
    unittest.main()
