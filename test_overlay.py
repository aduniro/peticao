import datetime
import ast
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "runtime"))
import authority_guard as guard
import remote_contract as shared
import coordinator
import recovery
import gateway
import replicate

ORIGINAL_LOCAL_NODE = guard.local_node


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="overlay-", dir=HERE)
        self.root = Path(self.tmp.name)
        self.queue = self.root / "queue"; self.queue.mkdir(mode=0o700)
        self.control = self.root / "control"; self.control.mkdir(mode=0o700)
        self.worker = self.root / "worker"
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.floor = {"generation": 2, "primary_host": "civo", "coordinator_boot_id": self.boot, "operation_id": "a" * 32}
        self.floor_path = self.control / "epoch.json"
        self.floor_path.write_text(json.dumps(self.floor)); self.floor_path.chmod(0o600)
        self.authority = {"role": "primary", "generation": 2, "armed_boot_id": self.boot,
                          "coordinator_host": "civo", "authority_operation_id": "a" * 32, "epoch_sha256": shared.digest(self.floor)}
        self.authority_path = self.queue / "authority.json"; self.save_authority(self.authority)
        self.patches = [mock.patch.object(guard, "GUARD", shared.EpochGuard(self.floor_path, shared.private_file)),
                        mock.patch.object(guard, "local_node", return_value="civo"),
                        mock.patch.object(guard, "boot_id", return_value=self.boot),
                        mock.patch.object(coordinator, "ROOT", self.queue),
                        mock.patch.object(coordinator, "WORKER", self.worker)]
        for p in self.patches: p.start()
        coordinator.initialize()
        (self.queue / "queue.sqlite").chmod(0o600)

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()

    def save_authority(self, authority):
        self.authority_path.write_text(json.dumps(authority)); self.authority_path.chmod(0o600)

    def fingerprint(self):
        return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob("*") if p.is_file()}

    def passive_old(self):
        self.save_authority({"role": "standby", "generation": 1, "armed_boot_id": None})

    def proof(self):
        return {"previous_host": "sonda-verifica3", "previous_generation": 1, "new_generation": 2,
                "method": "coordinator-stopped", "verified": True, "coordinator_host": "civo",
                "coordinator_boot_id": self.boot, "authority_operation_id": "a" * 32,
                "epoch_sha256": shared.digest(self.floor)}

    def confirmation(self):
        return {**self.proof(), "confirmed": True, "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}

    def promotion_inputs(self):
        self.passive_old()
        (self.queue / "generation-floor.json").write_text('{"generation":1}')
        (self.queue / "recovery-origin.json").write_text('{"source_host":"sonda-verifica3"}')
        path = self.root / "proof.json"; path.write_text(json.dumps(self.proof()))
        return path

    def verifier(self, changed=None):
        def call(argv, **kw):
            value = self.confirmation(); value["nonce"] = kw["env"]["ADMIN_CLUSTER_FENCE_NONCE"]
            if changed: value.update(changed)
            return types.SimpleNamespace(stdout=json.dumps(value), returncode=0)
        return call

    def test_valid_primary_has_same_public_effective_role(self):
        self.assertEqual(coordinator.authority()["effective_role"], "primary")
        self.assertEqual(coordinator.primary()["generation"], 2)

    def test_environment_cannot_spoof_controller_boot_or_node(self):
        with mock.patch.dict(os.environ,{"ADMIN_CLUSTER_BOOT":"forged-boot","HOSTNAME":"sonda-verifica3"}):
            self.assertEqual(coordinator.boot_id(),self.boot)
            self.assertEqual(coordinator.authority()["effective_role"],"primary")

    def test_node_mapping_rejects_unknown_and_ignores_environment(self):
        # Restore the actual mapping function rather than the fixture node ID.
        with mock.patch.object(guard,"local_node",new=ORIGINAL_LOCAL_NODE), mock.patch.object(guard.socket,"gethostname",return_value="unknown-box"), mock.patch.dict(os.environ,{"HOSTNAME":"peticao-civo"}):
            with self.assertRaises(PermissionError): guard.local_node()

    def test_frozen_shared_guard_is_exact_3046(self):
        custody = json.loads((HERE / "SOURCE-CUSTODY.json").read_text())
        self.assertEqual(hashlib.sha256((HERE / "runtime/remote_contract.py").read_bytes()).hexdigest(), custody["shared_epoch_guard_sha256"])

    def test_missing_floor_suspends_authority(self):
        self.floor_path.unlink()
        self.assertEqual(coordinator.authority()["effective_role"], "suspended")
        with self.assertRaises(PermissionError): coordinator.primary()

    def test_malformed_floor_suspends_without_dispatch(self):
        self.floor_path.write_text(json.dumps(list(shared.EpochGuard.KEYS)))
        self.assertEqual(coordinator.authority()["effective_role"],"suspended")
        with self.assertRaises(PermissionError): coordinator.dispatch_once()

    def test_upstream_custody_and_candidate_syntax(self):
        custody = json.loads((HERE / "SOURCE-CUSTODY.json").read_text())
        for name,sha in custody["legacy_sha256"].items():
            self.assertEqual(hashlib.sha256((HERE/"upstream"/name).read_bytes()).hexdigest(),sha)
        for path in [*(HERE/"upstream").glob("*.py"),*(HERE/"runtime").glob("*.py")]:
            ast.parse(path.read_text(),filename=str(path))

    def test_legacy_authority_without_new_binding_fails_closed(self):
        for key in ("coordinator_host", "authority_operation_id", "epoch_sha256"):
            self.save_authority({k:v for k,v in self.authority.items() if k != key})
            self.assertEqual(coordinator.authority()["effective_role"], "suspended")

    def test_old_santiago_cannot_rearm_after_civo_floor(self):
        old = {**self.authority, "generation": 1, "coordinator_host": "santiago"}
        with mock.patch.object(guard, "local_node", return_value="santiago"):
            with self.assertRaises(PermissionError): guard.require_primary(old)
            with self.assertRaises(PermissionError): guard.rearmed_copy(old, "b" * 32, require_root=False)

    def test_reboot_invalidates_current_primary(self):
        with mock.patch.object(guard, "boot_id", return_value="new-boot"):
            self.assertEqual(coordinator.authority()["effective_role"], "suspended")

    def test_old_operation_and_epoch_digest_refused(self):
        for changed in ({"authority_operation_id": "f" * 32}, {"epoch_sha256": "f" * 64}):
            self.save_authority({**self.authority, **changed})
            with self.assertRaises(PermissionError): coordinator.primary()

    def test_canonical_rearm_requires_new_operation_floor(self):
        with self.assertRaises(PermissionError): guard.rearmed_copy(self.authority, "a" * 32, require_root=False)
        self.floor["operation_id"] = "b" * 32; self.floor_path.write_text(json.dumps(self.floor))
        value = guard.rearmed_copy(self.authority, "b" * 32, require_root=False)
        self.assertEqual(value["authority_operation_id"], "b" * 32)
        self.assertEqual(value["epoch_sha256"], shared.digest(self.floor))
        self.assertEqual(self.authority, json.loads(self.authority_path.read_text()))

    def test_nonroot_rearm_denied_and_standby_not_rearmed(self):
        with mock.patch.object(guard.os, "geteuid", return_value=1000):
            with self.assertRaises(PermissionError): guard.rearmed_copy(self.authority, "b" * 32)
        with self.assertRaises(PermissionError): guard.rearmed_copy({**self.authority, "role": "standby"}, "b" * 32, require_root=False)

    def test_initialize_fenced_is_no_write(self):
        self.passive_old(); before = self.fingerprint()
        with self.assertRaises(PermissionError): coordinator.initialize()
        self.assertEqual(before, self.fingerprint())

    def test_submit_cancel_dispatch_and_source_import_refused(self):
        self.passive_old(); before = self.fingerprint()
        operations = [lambda:coordinator.submit({}),lambda:coordinator.cancel("a"*32),coordinator.dispatch_once,lambda:coordinator.import_source({})]
        for op in operations:
            with self.assertRaises(PermissionError): op()
        self.assertEqual(before, self.fingerprint())

    def test_snapshot_fenced_cannot_create_files(self):
        self.passive_old(); before = self.fingerprint()
        with self.assertRaises(PermissionError): coordinator.rpc({"action":"snapshot"})
        self.assertEqual(before, self.fingerprint())

    def test_reconcile_fenced_preserves_queue(self):
        self.passive_old(); before = self.fingerprint()
        coordinator.reconcile()
        self.assertEqual(before, self.fingerprint())

    def test_run_guard_before_execution_marker(self):
        job = "a" * 32; folder = self.worker / "jobs" / job; folder.mkdir(parents=True)
        payload = {"kind":"fixture-pass","duration_seconds":0}
        (folder / "config.json").write_text(json.dumps({"id":job,"payload":payload,"digest":shared.digest(payload),"generation":2}))
        self.passive_old()
        with mock.patch.object(coordinator.subprocess, "Popen", side_effect=AssertionError("must not launch")):
            with self.assertRaises(PermissionError): coordinator.run_job(job)
        self.assertFalse((folder / "execution.started").exists())

    def test_rpc_health_does_not_initialize_or_write(self):
        self.passive_old(); before = self.fingerprint()
        request = types.SimpleNamespace(buffer=io.BytesIO(b'{"action":"health"}'))
        with mock.patch.object(sys,"argv",["coordinator.py","rpc"]), mock.patch.object(sys,"stdin",request), mock.patch("sys.stdout",new=io.StringIO()) as out:
            coordinator.main()
        self.assertTrue(json.loads(out.getvalue())["ok"])
        self.assertEqual(before, self.fingerprint())

    def test_rpc_missing_queue_never_creates_database(self):
        (self.queue / "queue.sqlite").unlink()
        request = types.SimpleNamespace(buffer=io.BytesIO(b'{"action":"health"}'))
        with mock.patch.object(sys,"argv",["coordinator.py","rpc"]), mock.patch.object(sys,"stdin",request):
            with self.assertRaises(ValueError): coordinator.main()
        self.assertFalse((self.queue / "queue.sqlite").exists())

    def test_daemon_exits_without_heartbeat_after_epoch_revoke(self):
        self.passive_old(); coordinator.STOP = False
        with mock.patch.object(coordinator.signal,"signal"):
            coordinator.daemon()
        self.assertFalse((self.queue / "heartbeat.json").exists())

    def test_gateway_blocks_before_request_read_or_subprocess(self):
        with mock.patch.object(gateway.sys,"stdin",None), mock.patch.object(gateway.subprocess,"run",side_effect=AssertionError("no RPC")):
            with self.assertRaises(PermissionError): gateway.main()

    def test_replication_blocks_before_snapshot_or_ssh(self):
        with mock.patch.object(replicate.subprocess,"run",side_effect=AssertionError("no transport")):
            with self.assertRaises(PermissionError): replicate.tick()

    def test_replication_cli_blocks_before_lock_or_other_file_write(self):
        with mock.patch.object(replicate,"ROOT",self.root/"must-not-exist"):
            with self.assertRaises(PermissionError): replicate.main()
        self.assertFalse((self.root/"must-not-exist").exists())

    def test_promotion_guard_accepts_admin_previous_to_new_epoch(self):
        self.passive_old()
        binding = guard.authorize_promotion(json.loads(self.authority_path.read_text()), self.proof(), self.confirmation())
        self.assertEqual(binding["coordinator_host"], "civo")
        self.assertEqual(binding["epoch_sha256"], shared.digest(self.floor))

    def test_promotion_binding_rejects_host_boot_op_and_epoch(self):
        self.passive_old(); authority = json.loads(self.authority_path.read_text())
        for key,value in [("coordinator_host","santiago"),("coordinator_boot_id","wrong-boot"),("authority_operation_id","f"*32),("epoch_sha256","0"*64)]:
            with self.assertRaises(PermissionError): guard.authorize_promotion(authority, self.proof(), {**self.confirmation(),key:value})

    def test_candidate_legacy_promotion_fixture_full_path(self):
        proof = self.promotion_inputs()
        with mock.patch.object(recovery.subprocess,"run",side_effect=self.verifier()):
            result = recovery.promote(self.queue,proof,["/fake-fixture-verifier"],require_root=False)
        self.assertTrue(result["promoted"])
        self.assertEqual(coordinator.authority()["effective_role"], "primary")
        self.assertEqual(json.loads(self.authority_path.read_text())["authority_operation_id"], "a"*32)

    def test_wrong_live_binding_refuses_before_any_promotion_write(self):
        proof = self.promotion_inputs(); before = self.fingerprint()
        with mock.patch.object(recovery.subprocess,"run",side_effect=self.verifier({"coordinator_boot_id":"wrong-boot"})):
            with self.assertRaises(PermissionError): recovery.promote(self.queue,proof,["/fake-fixture-verifier"],require_root=False)
        # promote() creates a lock file; authority and generation-floor must stay identical.
        after = self.fingerprint()
        for name in before: self.assertEqual(before[name], after[name])

    def test_nonce_and_stale_live_proof_still_refused(self):
        proof = self.promotion_inputs()
        for wrong in ({"nonce":"wrong"},{"verified_at":"2000-01-01T00:00:00+00:00"}):
            with mock.patch.object(recovery.subprocess,"run",side_effect=self.verifier(wrong)):
                with self.assertRaises(ValueError): recovery.promote(self.queue,proof,["/fake-fixture-verifier"],require_root=False)

    def test_production_default_guard_remains_root_controlled(self):
        self.assertIs(shared.EpochGuard(self.floor_path).control_validator, shared.root_control_file)


if __name__ == "__main__":
    unittest.main()
