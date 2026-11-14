import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import azure_operator as op


class ExactOperator(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=op.SOURCE.parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patcher = patch.object(op, "STATE", self.root)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.args = SimpleNamespace(manifest_event=1)
        self.cap = {"fence": 1, "live_expires": time.time() + 3600}

    def test_exclusive_intent_never_overwrites(self):
        path = self.root / "intent.json"
        op.save(path, {"state": "pending"}, exclusive=True)
        with self.assertRaises(FileExistsError):
            op.save(path, {"state": "another"}, exclusive=True)
        self.assertEqual(json.loads(path.read_text()), {"state": "pending"})

    def test_completed_mutation_is_not_repeated(self):
        with patch.object(op, "gate", return_value=({}, self.cap, {})), patch.object(op, "az", return_value={"id": "fixture"}) as call:
            first = op.mutation(self.args, "fixture", ["fictitious", "create"])
            second = op.mutation(self.args, "fixture", ["fictitious", "create"])
            self.assertEqual(first, second)
            self.assertEqual(call.call_count, 1)

    def test_timeout_remains_uncertain_and_blocks_replay(self):
        with patch.object(op, "gate", return_value=({}, self.cap, {})), patch.object(op, "az", side_effect=TimeoutError) as call:
            with self.assertRaises(TimeoutError):
                op.mutation(self.args, "fixture", ["fictitious", "create"])
            with self.assertRaisesRegex(RuntimeError, "no_retry"):
                op.mutation(self.args, "fixture", ["fictitious", "create"])
            self.assertEqual(call.call_count, 1)

    def test_completed_mutation_rejects_changed_request(self):
        with patch.object(op, "gate", return_value=({}, self.cap, {})), patch.object(op, "az", return_value={}):
            op.mutation(self.args, "fixture", ["request-a"])
            with self.assertRaisesRegex(RuntimeError, "no_retry"):
                op.mutation(self.args, "fixture", ["request-b"])

    def test_ssh_requires_live_gate_before_dispatch(self):
        with patch.object(op, "gate", side_effect=RuntimeError("expired")), patch.object(op.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "expired"):
                op.ssh(self.args, "fictitious")
            run.assert_not_called()

    def test_ssh_pins_host_identity_and_existing_private_key_path(self):
        args = op.ssh_command("fd7a:115c:a1e0::123", "203.0.113.1")
        self.assertIn("StrictHostKeyChecking=yes", args)
        self.assertIn("HostKeyAlias=203.0.113.1", args)
        self.assertIn(op.KEY, args)
        self.assertEqual(args[-1], "builder@fd7a:115c:a1e0::123")

    def test_phase_needs_lease_budget_before_intent_or_api(self):
        with patch.object(op, "gate", return_value=({}, dict(self.cap, live_expires=time.time()+301), {})), patch.object(op, "az") as call:
            with self.assertRaisesRegex(RuntimeError, "phase_budget"):
                op.mutation(self.args, "deploy", ["fictitious"])
            self.assertFalse((self.root/"deploy.intent.json").exists())
            call.assert_not_called()

    def test_ssh_timeout_blocks_replay_before_dispatch(self):
        op.save(self.root/"VM-RECEIPT.json", {"public_ipv4":"203.0.113.1", "id":"fixture"})
        self.args.phase="join"
        with patch.object(op, "gate", return_value=({}, self.cap, {})), patch.object(op.subprocess, "run", side_effect=TimeoutError) as call:
            with self.assertRaises(TimeoutError):op.ssh(self.args,"fake")
            with self.assertRaisesRegex(RuntimeError,"uncertain_ssh"):
                op.ssh(self.args,"fake")
            self.assertEqual(call.call_count,1)


if __name__ == "__main__":
    unittest.main()
