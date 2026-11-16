import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("readonly_refresh_test_subject", ROOT / "infra/readonly_refresh.py")
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


class FixtureError(Exception):
    def __init__(self, code): self.code = code


class FixtureProxy:
    METHODS = {"initialize", "thread/read"}
    goal_failure = False
    def __init__(self, timeout):
        self.methods = []
    def __enter__(self):
        self.methods = ["initialize", "initialized"]
        return self
    def __exit__(self, *args): pass
    def same_daemon(self): return True
    def rpc(self, method, params):
        if method not in self.METHODS: raise FixtureError("rpc_method_forbidden")
        self.methods.append(method)
        if method == "thread/read":
            return {"thread": {"id": params["threadId"], "status": {"type": "active", "activeFlags": []}, "turns": [], "preview": "PRIVATE CHAT", "cwd": "/PRIVATE/CWD", "name": "PRIVATE TITLE"}}
        if self.goal_failure:
            self.goal_error_code = -32601
            raise FixtureError("readonly_rpc_rejected")
        return {"goal": {"threadId": params["threadId"], "status": "paused", "objective": "PRIVATE GOAL", "tokenBudget": 123456789}}


class ReadonlyRefreshTests(unittest.TestCase):
    def schema(self, directory):
        v2 = directory / "v2"
        v2.mkdir()
        fixtures = {
            "ThreadReadParams": {"properties": {"threadId": {"type": "string"}, "includeTurns": {"type": "boolean"}}},
            "ThreadReadResponse": {"definitions": {"Thread": {"properties": {"id": {}, "status": {}, "turns": {}}}}},
            "ThreadGoalGetParams": {"properties": {"threadId": {"type": "string"}}},
            "ThreadGoalGetResponse": {"definitions": {"ThreadGoal": {"properties": {"status": {}, "objective": {}}}}},
        }
        for name, value in fixtures.items(): (v2 / (name + ".json")).write_text(json.dumps(value))

    def test_original_gateway_allowlist_and_source_are_unchanged(self):
        original = hashlib.sha256(r.GATEWAY.read_bytes()).hexdigest()
        gateway = r.load_gateway()
        child = r.refresh_proxy_class(gateway)
        self.assertEqual(gateway.ReadOnlyProxy.METHODS, {"initialize", "thread/read"})
        self.assertEqual(child.METHODS, {"initialize", "thread/read", "thread/goal/get"})
        self.assertEqual(hashlib.sha256(r.GATEWAY.read_bytes()).hexdigest(), original)

    def test_goal_target_and_fields_are_fixed(self):
        gateway = r.load_gateway()
        proxy = r.refresh_proxy_class(gateway)()
        for value in [None, [], {"threadId": "unapproved"}, {"threadId": next(iter(r.ALIASES.values())), "objective": "forbidden"}, {"threadId": True}]:
            with self.assertRaises(gateway.GatewayError): proxy.rpc("thread/goal/get", value)

    def test_mutating_or_history_methods_never_reach_transport(self):
        gateway = r.load_gateway()
        proxy = r.refresh_proxy_class(gateway)()
        with patch.object(proxy, "send") as transport:
            for method in ["thread/start", "thread/resume", "turn/start", "turn/steer", "turn/interrupt", "thread/goal/set", "thread/goal/clear", "thread/turns/list"]:
                with self.assertRaises(gateway.GatewayError): proxy.rpc(method, {"threadId": r.ALIASES["admin"]})
            with self.assertRaises(gateway.GatewayError): proxy.rpc("thread/read", {"threadId": r.ALIASES["admin"], "includeTurns": True})
        transport.assert_not_called()

    def test_sanitizers_remove_history_goal_objective_and_budget(self):
        thread = r.sanitize_thread("admin", {"thread": {"id": r.ALIASES["admin"], "status": {"type": "idle"}, "preview": "PRIVATE CHAT", "objective": {"status": "active", "text": "PRIVATE GOAL"}}})
        self.assertFalse(thread["dispatch_ready"])
        self.assertEqual(thread["native_goal_status"], "unqualified_not_read")
        goal = r.sanitize_goal("admin", {"goal": {"threadId": r.ALIASES["admin"], "status": "paused", "objective": "PRIVATE GOAL", "tokenBudget": 123456789}})
        serialized = json.dumps([thread, goal])
        for private in ["PRIVATE CHAT", "PRIVATE GOAL", "123456789", "tokenBudget"]: self.assertNotIn(private, serialized)
        self.assertEqual(goal["status"], "paused")
        with self.assertRaises(ValueError): r.sanitize_thread("admin", {"thread": {"id": r.ALIASES["admin"], "turns": [{"text": "PRIVATE CHAT"}], "status": {"type": "idle"}}})

    def test_null_error_unknown_or_mismatched_goal_never_infers_active(self):
        for item in [r.sanitize_goal("admin", {"goal": None}), r.sanitize_goal("admin", error_code=-32601), r.sanitize_goal("admin", {"goal": {"threadId": r.ALIASES["apoio"], "status": "active"}}), r.sanitize_goal("admin", {"goal": {"threadId": r.ALIASES["admin"], "status": "futureUnknown"}})]:
            self.assertNotEqual(item["status"], "active")
            self.assertFalse(item["native_goal_status_qualified"])
        self.assertEqual(r.sanitize_goal("admin", {"goal": None})["status"], "none")

    def fixture_qualification(self, directory, failure=False, changed_identity=False):
        self.schema(directory)
        releases = directory / "releases"
        client = releases / "0.167.1-x86_64-unknown-linux-musl/bin/codex"
        client.parent.mkdir(parents=True)
        client.write_text("fixture binary never executed")
        client.chmod(0o700)
        gateway = types.SimpleNamespace(ReadOnlyProxy=FixtureProxy, GatewayError=FixtureError)
        owners = lambda: [{"pid": 1, "executable": str(client)}]
        identities = iter([{"inode": 1}, {"inode": 2 if changed_identity else 1}])
        with patch.object(r, "RELEASES", releases), patch.object(FixtureProxy, "goal_failure", failure), patch.object(r.subprocess, "Popen") as popen:
            result = r.qualify(client, directory, gateway_factory=lambda: gateway, identity=lambda: next(identities), owners=owners)
            popen.assert_not_called()
        return result

    def test_fictitious_two_reads_then_two_goal_reads_no_execution_authority(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            result = self.fixture_qualification(Path(folder))
        self.assertEqual(result["rpc_methods_sent"], ["initialize", "initialized", "thread/read", "thread/read", "thread/goal/get", "thread/goal/get"])
        self.assertFalse(result["live_bridge_enabled"])
        self.assertFalse(result["execution_correlation_qualified"])
        self.assertFalse(result["goal_mutation_methods_sent"])
        self.assertEqual([item["status"] for item in result["goals"]], ["paused", "paused"])
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_method_not_found_is_sanitized_and_unqualified(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            result = self.fixture_qualification(Path(folder), failure=True)
        self.assertTrue(all(item["error_code"] == -32601 and item["status"] == "unknown" for item in result["goals"]))

    def test_daemon_change_invalidates_qualification(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            with self.assertRaises(RuntimeError): self.fixture_qualification(Path(folder), changed_identity=True)


if __name__ == "__main__": unittest.main()
