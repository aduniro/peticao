#!/usr/bin/python3
"""One fixed reviewed runtime profile; extension of the existing queue, not an RPC executor."""
from __future__ import annotations
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

KIND = "runtime-http-r0000-v1"
SOURCE_COMMIT = "0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f"
ROOT = Path("/srv/admin-v2-worker/admin-r0000-runtime-qa-20261110")
WORKER = Path("/srv/admin-v2-worker")
NODE = Path("/usr/bin/node")
NODE_SHA = "ca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e"
ARCHIVE_SHA = "4338322c4f9dee2c30c28c5359b2f537312543cb3cfe7fde20a3db69d747df84"
MANIFEST_SHA = "12b7d8a8e617c98c7d4f22b9e0865b8e3cde63e8d8933b871f65cceb68f72576"
TIMEOUT_SECONDS = 120
PINS = {'smoke.py': '3451aff051138fd7626b8f67e305e906a1e5198e9fb15e9baf0018bab257a6b6', 'runtime-guard.mjs': '3295bce5bcb55ba44ae767b08d88bf4812e62d3336409990ccbac678d095867a', 'guard-probe.mjs': 'd45c163c4eae53bf2298ac71f67fe42c1442ad1ee20cabe51f99fd38fca59cc5', 'probe.py': '24ef7bcd125d5209e8301dbd372082ccc1dbe07dcd0be0b8f8e77cea7cdc8ba9', 'safe_extract.py': '1335211754d8e846f0fc3fc6ff5c1b64199040fae2669f54d82c143198db8326', 'harness-manifest.json': 'bb66b05d4d3d48a1ca6af08bb6c32376282e4db62516b315574216a081e2bc90'}
ID = re.compile(r"[a-f0-9]{32}\Z")

def job_id(value: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value): raise ValueError("invalid_job_id")
    return value

def digest(path: Path, limit: int = 128 * 1024 * 1024) -> str:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit: raise ValueError("profile_regular_file_required")
        h = hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""): h.update(chunk)
        return h.hexdigest()
    finally: os.close(fd)

def validate_inputs(full: bool = False) -> dict:
    if ROOT.resolve() != ROOT or not ROOT.is_dir() or ROOT.stat().st_uid != os.getuid() or ROOT.stat().st_mode & 0o077: raise ValueError("profile_root_not_private")
    for name in ["inputs", "runs"]:
        directory = ROOT / name
        if directory.resolve() != directory or not directory.is_dir() or directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077: raise ValueError("profile_input_directory_not_private")
    for name, expected in PINS.items():
        if digest(ROOT / name, 2 * 1024 * 1024) != expected: raise ValueError("profile_harness_pin_changed:" + name)
    if digest(NODE) != NODE_SHA: raise ValueError("profile_node_pin_changed")
    manifest = ROOT / "inputs/release-manifest.json"
    if digest(manifest, 8 * 1024 * 1024) != MANIFEST_SHA: raise ValueError("profile_release_manifest_changed")
    value = json.loads(manifest.read_text())
    if value.get("source_commit") != SOURCE_COMMIT or value.get("runtime_format") != "next-start-v1" or value.get("release_id") != "r0000-portable-0a5f734-20261110" or not isinstance(value.get("files"), dict) or len(value["files"]) != 12043: raise ValueError("profile_manifest_contract")
    archive = ROOT / "inputs/runtime.tar"
    info = archive.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 1 <= info.st_size <= 512 * 1024 * 1024: raise ValueError("profile_archive_invalid")
    if full and digest(archive, 512 * 1024 * 1024) != ARCHIVE_SHA: raise ValueError("profile_archive_changed")
    return {"source_commit": SOURCE_COMMIT, "runtime_sha256": ARCHIVE_SHA, "manifest_sha256": MANIFEST_SHA, "node_sha256": NODE_SHA}

def payload(data: dict) -> dict:
    if set(data) != {"action", "id", "kind", "source_commit"} or data.get("kind") != KIND or data.get("source_commit") != SOURCE_COMMIT: raise ValueError("profile_fixed_contract_only")
    job_id(data.get("id"))
    return {"kind": KIND, **validate_inputs()}

def argv(job: str) -> list[str]:
    return ["/usr/bin/python3", "/opt/admin-v2-cluster/runtime_profile.py", "run", job_id(job)]

def phase_commands(job: str) -> list[list[str]]:
    job_id(job)
    http = ROOT / "runs" / (job + "-http")
    guard = ROOT / "runs" / (job + "-guard")
    return [
        ["/usr/bin/python3", str(ROOT / "safe_extract.py"), "--archive", str(ROOT / "inputs/runtime.tar"), "--manifest", str(ROOT / "inputs/release-manifest.json"), "--run", str(http)],
        ["/usr/bin/python3", str(ROOT / "probe.py"), "--run", str(guard)],
        ["/usr/bin/python3", str(ROOT / "smoke.py"), "--run", str(http), "--port", "31387"],
    ]

def export_receipts(job: str, target: Path) -> None:
    target.mkdir(mode=0o770)
    budget = 0
    for label in ["http", "guard"]:
        source = ROOT / "runs" / (job + "-" + label)
        for name in ["extraction-proof.json", "result.json", "pid.json", "guard.jsonl", "server.log", "probe.log"]:
            p = source / name
            if not p.exists() and not p.is_symlink(): continue
            # Follow no links; technical allowlist only, never export the 475MB runtime.
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16 * 1024 * 1024: raise ValueError("profile_receipt_invalid")
                budget += info.st_size
                if budget > 32 * 1024 * 1024: raise ValueError("profile_receipts_too_large")
                with os.fdopen(fd, "rb", closefd=False) as src, (target / (label + "-" + name)).open("xb") as dest: shutil.copyfileobj(src, dest)
            finally: os.close(fd)

def run(job: str) -> int:
    job_id(job)
    artifacts = WORKER / "jobs" / job / "work" / "artifacts"
    # Supplement the queue's execution.started; preserve receipts even if this internal CLI is invoked twice.
    marker = WORKER / "jobs" / job / "runtime-profile.started"
    fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o660)
    os.close(fd)
    child = None
    result = {"kind": KIND, "source_commit": SOURCE_COMMIT, "exit": 1, "phases": [], "operationalReady": False}
    def interrupted(signum, frame): raise KeyboardInterrupt("profile_signal:" + str(signum))
    old = {sig: signal.signal(sig, interrupted) for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGALRM]}
    # Leave supervisor's final 15s for child drain; systemd remains the cgroup authority.
    signal.alarm(TIMEOUT_SECONDS - 15)
    try:
        result.update(validate_inputs(full=True))
        http = ROOT / "runs" / (job + "-http"); guard = ROOT / "runs" / (job + "-guard")
        if http.exists() or http.is_symlink() or guard.exists() or guard.is_symlink(): raise ValueError("profile_run_exists_never_replay")
        guard.mkdir(mode=0o700)
        env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "RUNTIME_SMOKE_NODE_SHA256": NODE_SHA}
        for index, command in enumerate(phase_commands(job), 1):
            child = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, start_new_session=True)
            code = child.wait()
            result["phases"].append({"phase": index, "exit": code})
            if code: raise RuntimeError("profile_phase_failed:" + str(index))
            if index == 2:
                proof = json.loads((guard / "result.json").read_text())
                if proof.get("exit") != 0 or proof.get("observedDenials") != 11 or proof.get("guardInstalled") is not True or proof.get("processGroupDrained") is not True or proof.get("remainingProcesses") != []: raise ValueError("profile_guard_evidence_incomplete")
        proof = json.loads((http / "result.json").read_text())
        if proof.get("exit") != 0 or len(proof.get("checks", [])) != 5 or proof.get("verifiedFiles") != 12043 or proof.get("guardInstalled") is not True or proof.get("networkOrProcessDenials") != 0 or proof.get("sourceStable") is not True or proof.get("processGroupDrained") is not True or proof.get("remainingProcesses") != []: raise ValueError("profile_http_evidence_incomplete")
        result["exit"] = 0
    except BaseException as exc:
        result["error"] = type(exc).__name__ + ":" + str(exc)[:300]
    finally:
        if child and child.poll() is None:
            with contextlib.suppress(ProcessLookupError): os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError): os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=3)
        signal.alarm(0)
        for sig, handler in old.items(): signal.signal(sig, handler)
        try:
            export_receipts(job, artifacts)
        except Exception as exc:
            result["exit"] = 1; result["exportError"] = type(exc).__name__ + ":" + str(exc)[:200]
            artifacts.mkdir(mode=0o770, exist_ok=True)
        (artifacts / "runtime-profile-result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result["exit"]

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "run": raise SystemExit(2)
    raise SystemExit(run(sys.argv[2]))
