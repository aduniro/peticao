#!/usr/bin/python3
"""Refresh only existing-daemon metadata; never a live execution adapter.

Only initialize, initialized, thread/read(includeTurns=false) and the separately
authorized thread/goal/get on the same two fixed IDs are sent.
The original gateway module is imported into an isolated Python namespace; its
client path is overridden there only, without editing any source/configuration.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

BASE = Path(__file__).resolve().parents[1]
GATEWAY = BASE / "infra/local_codex_gateway.py"
SOCKET = Path("/home/barre/.codex/app-server-control/app-server-control.sock")
RELEASES = Path("/home/barre/.codex/packages/app-server-daemon/releases")
ALIASES = {
    "admin": "01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7",
    "apoio": "01a1c0b3-f069-75a0-a2e9-e691094c9bab",
}
FLAGS = {"waitingOnApproval", "waitingOnUserInput", "reviewing", "compacting", "running"}
DOCUMENTATION = "https://learn.chatgpt.com/docs/app-server"
GOAL_STATUSES = {"active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"}


def socket_identity():
    info = SOCKET.stat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.geteuid():
        raise PermissionError("existing_owned_socket_required")
    return {"device": info.st_dev, "inode": info.st_ino, "uid": info.st_uid}


def socket_owners():
    """Inspect only executable/socket metadata, never argv, environment or chat."""
    target = str(SOCKET.resolve())
    inodes = set()
    for line in Path("/proc/net/unix").read_text().splitlines()[1:]:
        fields = line.split(maxsplit=7)
        if len(fields) == 8 and fields[7] == target and int(fields[3], 16) & 0x10000:
            inodes.add("socket:[" + fields[6] + "]")
    found = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            executable = os.readlink(proc / "exe")
            if not executable.startswith(str(RELEASES) + "/"):
                continue
            if any(os.readlink(fd) in inodes for fd in (proc / "fd").iterdir()):
                found.append({"pid": int(proc.name), "executable": executable})
        except OSError:
            continue
    return sorted(found, key=lambda item: item["pid"])


def validate_client(client):
    client = Path(client)
    if not client.is_absolute() or not re.fullmatch(
        r"0\.167\.[01]-x86_64-unknown-linux-musl", client.parent.parent.name
    ) or client.parent.parent.parent != RELEASES or client.name != "codex" or client.parent.name != "bin":
        raise ValueError("qualified_0167_client_required")
    if not client.is_file() or client.is_symlink() or not os.access(client, os.X_OK):
        raise PermissionError("qualified_client_unavailable")
    return client


def select_client(owners):
    paths = {item["executable"] for item in owners}
    if len(paths) != 1:
        raise RuntimeError("existing_socket_owner_not_unique_client")
    return validate_client(next(iter(paths)))


def schema_summary(directory):
    directory = Path(directory)
    names = ["ThreadReadParams", "ThreadReadResponse", "ThreadGoalGetParams", "ThreadGoalGetResponse"]
    schemas = {}
    hashes = {}
    for name in names:
        raw = (directory / "v2" / (name + ".json")).read_bytes()
        schemas[name] = json.loads(raw)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    params = schemas["ThreadReadParams"].get("properties", {})
    if "threadId" not in params or params.get("includeTurns", {}).get("type") != "boolean":
        raise ValueError("metadata_only_thread_read_schema_required")
    thread_fields = schemas["ThreadReadResponse"].get("definitions", {}).get("Thread", {}).get("properties", {})
    goal_params = schemas["ThreadGoalGetParams"].get("properties", {})
    goal = schemas["ThreadGoalGetResponse"].get("definitions", {}).get("ThreadGoal", {})
    return {
        "schema_sha256": hashes,
        "thread_read_has_goal": "goal" in thread_fields,
        "thread_read_has_objective": "objective" in thread_fields,
        "native_goal_get_schema_present": set(goal_params) == {"threadId"} and "status" in goal.get("properties", {}),
        "native_goal_get_live_scope": "separately_authorized_fixed_two_ids_only",
    }


def sanitize_thread(alias, result):
    thread = result.get("thread") if isinstance(result, dict) else None
    if not isinstance(thread, dict) or thread.get("id") != ALIASES[alias]:
        raise ValueError("thread_identity_mismatch")
    if thread.get("turns") not in (None, []):
        raise ValueError("unexpected_history_returned")
    status = thread.get("status", {})
    kind = status.get("type") if isinstance(status, dict) else None
    if kind not in {"notLoaded", "idle", "active", "systemError"}:
        raise ValueError("unknown_thread_state")
    flags = status.get("activeFlags", [])
    return {
        "alias": alias, "thread_id": thread["id"], "status_type": kind,
        "active_flags": [flag for flag in flags if flag in FLAGS] if isinstance(flags, list) else [],
        "history_requested": False, "history_stored": False,
        "native_goal_status": "unqualified_not_read",
        "exclusive_execution_authority_verified": False,
        "dispatch_ready": False,
    }


def load_gateway():
    spec = importlib.util.spec_from_file_location("isolated_readonly_refresh_gateway", GATEWAY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if module.ReadOnlyProxy.METHODS != {"initialize", "thread/read"} or module.ALIASES != ALIASES:
        raise PermissionError("original_rpc_allowlist_or_targets_changed")
    return module


def refresh_proxy_class(gateway):
    """Extend only this isolated helper; original gateway class stays untouched."""
    class RefreshProxy(gateway.ReadOnlyProxy):
        METHODS = {"initialize", "thread/read", "thread/goal/get"}

        def rpc(self, method, params):
            if method == "thread/goal/get":
                if not isinstance(params, dict) or set(params) != {"threadId"} or params["threadId"] not in ALIASES.values():
                    raise gateway.GatewayError("goal_target_or_fields_forbidden")
                self.goal_error_code = None
                self.goal_query_in_flight = True
                try:
                    return super().rpc(method, params)
                finally:
                    self.goal_query_in_flight = False
            return super().rpc(method, params)

        def receive_json(self, deadline):
            response = super().receive_json(deadline)
            if getattr(self, "goal_query_in_flight", False) and isinstance(response, dict) and response.get("id") == self.counter and isinstance(response.get("error"), dict):
                code = response["error"].get("code")
                self.goal_error_code = code if type(code) is int else "unknown_rpc_error"
            return response

    return RefreshProxy


def sanitize_goal(alias, result=None, error_code=None):
    row = {"alias": alias, "thread_id": ALIASES[alias], "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(), "exists": None, "status": "unknown", "error_code": error_code, "query_succeeded": False, "native_goal_status_qualified": False}
    if error_code is not None:
        return row
    if not isinstance(result, dict) or "goal" not in result:
        row["error_code"] = "invalid_goal_response"
        return row
    goal = result["goal"]
    if goal is None:
        row.update(exists=False, status="none", query_succeeded=True)
        return row
    if not isinstance(goal, dict) or goal.get("threadId") != ALIASES[alias] or goal.get("status") not in GOAL_STATUSES:
        row["error_code"] = "goal_identity_or_status_unqualified"
        return row
    row.update(exists=True, status=goal["status"], query_succeeded=True, native_goal_status_qualified=True)
    return row


def qualify(client, directory, *, gateway_factory=load_gateway, identity=socket_identity, owners=socket_owners):
    client = validate_client(client)
    before = identity()
    owner_before = owners()
    if not owner_before or any(item["executable"] != str(client) for item in owner_before):
        raise ValueError("socket_owner_client_mismatch")
    original_hash = hashlib.sha256(GATEWAY.read_bytes()).hexdigest()
    gateway = gateway_factory()
    # This is an isolated import, not the running gateway or its persisted config.
    gateway.CODEX = client
    proxy_class = refresh_proxy_class(gateway)
    with proxy_class(timeout=15) as proxy:
        threads = [sanitize_thread(alias, proxy.rpc("thread/read", {"threadId": thread_id, "includeTurns": False})) for alias, thread_id in ALIASES.items()]
        goals = []
        for alias, thread_id in ALIASES.items():
            try:
                value = proxy.rpc("thread/goal/get", {"threadId": thread_id})
                goals.append(sanitize_goal(alias, value))
            except gateway.GatewayError as error:
                if error.code != "readonly_rpc_rejected":
                    raise
                goals.append(sanitize_goal(alias, error_code=getattr(proxy, "goal_error_code", "unknown_rpc_error")))
        methods = list(proxy.methods)
        same = proxy.same_daemon()
    after = identity()
    owner_after = owners()
    if not same or after != before or owner_after != owner_before:
        raise RuntimeError("existing_daemon_changed_during_read")
    if methods != ["initialize", "initialized", "thread/read", "thread/read", "thread/goal/get", "thread/goal/get"]:
        raise PermissionError("unexpected_rpc_method_observed")
    if gateway.ReadOnlyProxy.METHODS != {"initialize", "thread/read"}:
        raise RuntimeError("original_gateway_allowlist_changed")
    if hashlib.sha256(GATEWAY.read_bytes()).hexdigest() != original_hash:
        raise RuntimeError("gateway_source_changed_during_read")
    return {
        "state": "qualified_readonly_metadata_only", "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "client_path": str(client), "client_release": client.parent.parent.name,
        "existing_socket": str(SOCKET), "socket_identity": before,
        "socket_owners_before_and_after": owner_before, "same_daemon_socket": True,
        "gateway_source_sha256": original_hash, "gateway_source_edited": False,
        "rpc_methods_sent": methods, "threads": threads, "goals": goals,
        "new_app_server_started": False, "turn_methods_sent": False,
        "goal_read_methods_sent": True, "goal_mutation_methods_sent": False, "model_or_provider_override_sent": False,
        "live_bridge_enabled": False, "execution_correlation_qualified": False,
        "paused_false_is_not_native_goal_evidence": True,
        "schema": schema_summary(directory), "documentation": DOCUMENTATION,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema-directory", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    destination = BASE / "evidence/readonly-refresh-0.167.json"
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("existing_readonly_proof_must_be_inspected_not_repeated")
    client = select_client(socket_owners())
    directory = args.schema_directory
    if directory is None:
        directory = Path(tempfile.mkdtemp(prefix="codex-readonly-refresh-schema-", dir="/dev/shm"))
        subprocess.run([str(client), "app-server", "generate-json-schema", "--experimental", "--out", str(directory)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    proof = qualify(client, directory)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(proof, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    print(json.dumps({"state": proof["state"], "proof": str(destination), "live_bridge_enabled": False}))


if __name__ == "__main__":
    main()
