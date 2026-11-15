"""Canonical reviewed()/validate_lease() flow, adapted from passive restore.

No credentials are printed. The executing Infra session owns its own capability;
Apoio authors preparation and independently ACKs Infra's execution notice.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import stat
import time

import qualification_contract as q

ROOT = Path(__file__).resolve().parent
COORD = "/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py"
SESSION = "01a1d130-2948-7140-bcfb-34696b20ab8d"
RESOURCE = "deploy:civo-worker-runtime-qualification"


def central(args):
    result = subprocess.run(["/usr/bin/python3", COORD, *args], capture_output=True, text=True, timeout=30)
    value = json.loads(result.stdout)
    if result.returncode or not value.get("ok"):
        raise PermissionError("canonical_ledger_rejected_operation")
    return value["result"]


def git(*args):
    return subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), *args], text=True).strip()


def source_hashes():
    files = subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), "ls-files", "-z"]).decode().split("\0")
    result = {}
    for name in filter(None, files):
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("source_regular_files_only")
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def independent_ack(event):
    cursor, acknowledged = event, False
    while True:
        events = central(["history", "--after-seq", str(cursor), "--limit", "200"])
        if not events:
            break
        acknowledged |= any(e["kind"] == "ack" and e["actor"] == "apoio" and e["data"].get("event_seq") == event for e in events)
        cursor = events[-1]["seq"]
        if len(events) < 200:
            break
    if not acknowledged:
        raise PermissionError("independent_apoio_ack_required")


def notice(event):
    if type(event) is not int or event < 1:
        raise ValueError("canonical_notice_id_required")
    value = central(["history", "--after-seq", str(event-1), "--limit", "1"])[0]
    if value["seq"] != event or value["kind"] != "notice" or value["actor"] != "admin-recuperacao":
        raise PermissionError("infra_execution_notice_required")
    return value


def reviewed(event):
    if git("status", "--porcelain"):
        raise ValueError("reviewed_source_has_changes")
    value = notice(event)
    data = value["data"]
    if data["manifest"]["commit"] != git("rev-parse", "HEAD") or data["file_sha256"] != source_hashes():
        raise ValueError("reviewed_manifest_source_mismatch")
    if (data.get("operation") != "test" or value["resources"] != [RESOURCE]
            or data.get("preparation_only") is not False or data.get("queue_cutover") is not False
            or data.get("production_access") is not False):
        raise PermissionError("isolated_test_execution_scope_required")
    request = q.operation(data["qualification_operation"], execution=True)
    runtime = notice(data["runtime_notice"])
    if runtime["data"]["manifest"]["commit"] != request["runtime_commit"]:
        raise PermissionError("reviewed_runtime_commit_mismatch")
    for name, sha in request["runtime_sha256"].items():
        if runtime["data"]["file_sha256"].get(name) != sha or data["file_sha256"].get("runtime/"+name) != sha:
            raise PermissionError("reviewed_runtime_hash_closure_mismatch")
    for name, sha in request["harness_sha256"].items():
        if data["file_sha256"].get(name) != sha:
            raise PermissionError("reviewed_helper_hash_closure_mismatch")
    independent_ack(data["runtime_notice"])
    independent_ack(event)
    return data


def validate_lease(path, event, operation="test", budget=180):
    path = Path(path)
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16384 or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PermissionError("private_own_lease_file_required")
    record = json.loads(path.read_text())
    if record.get("operator_session") != SESSION:
        raise PermissionError("infra_session_owned_capability_required")
    cap = record["result"]
    central(["check", "--actor", "admin-recuperacao", "--lease", cap["lease"], "--token", cap["token"], "--fence", str(cap["fence"])])
    status = central(["status"])
    lease = next(x for x in status["leases"] if x["id"] == cap["lease"])
    if (lease["actor"] != "admin-recuperacao" or lease["operation"] != operation
            or set(lease["resources"]) != {RESOURCE} or lease["expires"] - time.time() < budget + 120):
        raise PermissionError("exact_active_own_test_reservation_and_margin_required")
    acquisition = central(["history", "--after-seq", str(cap["seq"]-1), "--limit", "1"])[0]
    if (acquisition["kind"] != "lease_acquired" or acquisition["actor"] != "admin-recuperacao"
            or acquisition["data"].get("manifest_event") != event or acquisition["data"].get("lease") != cap["lease"]):
        raise PermissionError("lease_not_bound_to_execution_manifest")
    return {"operator": "infra", "session": SESSION, "actor": "admin-recuperacao", "fence": cap["fence"], "manifest_event": event}


class Gate:
    def __init__(self, event, capability_file):
        self.event, self.capability_file = event, Path(capability_file)

    def __call__(self, phase):
        if phase not in {"install", "preflight", "bootstrap", "start", "observe", "cleanup"}:
            raise ValueError("fixed_qualification_phase_required")
        data = reviewed(self.event)
        capability = validate_lease(self.capability_file, self.event, operation="test", budget=250 if phase=="start" else 75)
        return {"qualification_operation": data["qualification_operation"], "capability": capability}
