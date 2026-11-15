#!/usr/bin/python3
"""Consistent, verifiable checkpoints and deliberately manual coordinator recovery."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import socket
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
import uuid

MAX_BYTES = 8 * 1024**3
MAX_FILES = 100_000
PRIVATE = {".ssh", "secrets", "authorized_keys", "sudoers", "node_modules", ".git"}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    with tmp.open("x") as f:
        os.chmod(tmp, 0o600)
        json.dump(value, f, sort_keys=True, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path):
    return json.loads(Path(path).read_text())


def safe_name(name):
    parts = PurePosixPath(name).parts
    if not name or name.startswith("/") or "\\" in name or any(x in ("..", ".") for x in name.split("/")):
        raise ValueError("Unsafe archive name")
    if not parts or parts[0] not in {"coordinator", "worker", "snapshot.json", "manifest.json"}:
        raise ValueError("Unexpected archive namespace")
    return parts


def private_name(parts):
    return any(p in PRIVATE or (p.startswith(".env") and p not in {".env.example", ".env.sample"}) or p.endswith((".key", ".pem")) or p.startswith("id_ed25519") or p.startswith("id_rsa") for p in parts)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def checked_copy(source, target):
    source, target = Path(source), Path(target)
    if source.is_symlink() or not stat.S_ISREG(source.lstat().st_mode):
        raise ValueError("Links and special files are not checkpoint data")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with source.open("rb") as src, target.open("xb") as dst:
        os.chmod(target, 0o600)
        shutil.copyfileobj(src, dst, 1024 * 1024)


def copy_tree(source, target):
    source, target = Path(source), Path(target)
    if source.is_symlink():
        raise ValueError("Symlink root refused")
    if not source.exists():
        return
    for p in sorted(source.rglob("*")):
        rel = p.relative_to(source)
        if private_name(rel.parts):
            continue
        if p.is_symlink():
            raise ValueError("Symlink refused")
        if p.is_file():
            checked_copy(p, target / rel)
        elif not p.is_dir():
            raise ValueError("Special file refused")


def snapshot(source, output, worker_root=None, database=None):
    source, output = Path(source), Path(output)
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Invalid coordinator root")
    authority = read_json(source / "authority.json")
    if authority.get("role") != "primary" or not isinstance(authority.get("generation"), int):
        raise ValueError("Only a primary can export a checkpoint")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    ident = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex
    final = output / (ident + ".tar.gz")
    with tempfile.TemporaryDirectory(prefix=".checkpoint-", dir=output) as folder:
        stage = Path(folder)
        coord = stage / "coordinator"
        coord.mkdir(mode=0o700)
        dbpath = Path(database) if database else source / "queue.sqlite"
        if dbpath.is_symlink() or not dbpath.is_file():
            raise ValueError("Missing queue database")
        with sqlite3.connect(dbpath.resolve().as_uri() + "?mode=ro", uri=True) as src, sqlite3.connect(coord / "queue.sqlite") as dst:
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Queue integrity check failed")
        for name in ["authority.json", "config.json", "version.json"]:
            if (source / name).exists():
                checked_copy(source / name, coord / name)
        for name in ["sources", "bundles"]:
            copy_tree(source / name, coord / name)
        if worker_root:
            jobs = Path(worker_root) / "jobs"
            if jobs.is_symlink():
                raise ValueError("Symlink jobs root refused")
            if jobs.exists():
                for job in jobs.iterdir():
                    if job.is_symlink() or not job.is_dir() or not all(c in "0123456789abcdef" for c in job.name) or len(job.name) != 32:
                        raise ValueError("Unexpected job directory")
                    for name in ["config.json", "state.json", "result.json", "output.log"]:
                        if (job / name).exists():
                            checked_copy(job / name, stage / "worker" / "jobs" / job.name / name)
                    copy_tree(job / "artifacts", stage / "worker" / "jobs" / job.name / "artifacts")
        # A role/generation change while copying invalidates this capture.
        if read_json(source / "authority.json") != authority:
            raise ValueError("Authority changed during capture")
        atomic_json(stage / "snapshot.json", {"format": 1, "id": ident, "created_at": now(), "source_host": socket.gethostname(), "generation": authority["generation"], "worker_files_are_best_effort": True})
        files = [p for p in stage.rglob("*") if p.is_file()]
        if len(files) > MAX_FILES or sum(p.stat().st_size for p in files) > MAX_BYTES:
            raise ValueError("Checkpoint limit exceeded")
        manifest = {str(p.relative_to(stage)): {"sha256": sha(p), "size": p.stat().st_size} for p in files}
        atomic_json(stage / "manifest.json", manifest)
        temporary = output / ("." + ident + ".tmp")
        try:
            with tarfile.open(temporary, "w:gz") as tf:
                for p in sorted(stage.rglob("*")):
                    if p.is_file():
                        info = tf.gettarinfo(str(p), str(p.relative_to(stage)))
                        info.uid = info.gid = 0
                        info.uname = info.gname = ""
                        info.mode = 0o600
                        with p.open("rb") as f:
                            tf.addfile(info, f)
            temporary.chmod(0o600)
            verify(temporary)
            os.replace(temporary, final)
            atomic_json(output / "latest.json", {"snapshot": final.name, "sha256": sha(final), "created_at": now(), "generation": authority["generation"]})
        finally:
            if temporary.exists():
                temporary.unlink()
    return {"snapshot": str(final), "sha256": sha(final), "generation": authority["generation"]}


def verify(archive):
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        if len(members) > MAX_FILES + 1 or sum(m.size for m in members) > MAX_BYTES:
            raise ValueError("Archive limit exceeded")
        names = set()
        for m in members:
            safe_name(m.name)
            if not m.isfile() or m.name in names or private_name(PurePosixPath(m.name).parts):
                raise ValueError("Duplicate, special or private member refused")
            names.add(m.name)
        manifest = json.load(tf.extractfile("manifest.json"))
        if names - {"manifest.json"} != set(manifest):
            raise ValueError("Manifest membership mismatch")
        for name, expected in manifest.items():
            m = tf.getmember(name)
            if m.size != expected["size"]:
                raise ValueError("Manifest size mismatch")
            h = hashlib.sha256()
            with tf.extractfile(m) as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            if h.hexdigest() != expected["sha256"]:
                raise ValueError("Manifest checksum mismatch")
        meta = json.load(tf.extractfile("snapshot.json"))
        if meta.get("format") != 1 or not isinstance(meta.get("generation"), int):
            raise ValueError("Unknown checkpoint format")
        authority = json.load(tf.extractfile("coordinator/authority.json"))
        if authority.get("generation") != meta["generation"] or not meta.get("source_host"):
            raise ValueError("Checkpoint authority metadata mismatch")
        return {"verified": True, "files": len(manifest), **meta}


def reconcile(dbpath):
    with sqlite3.connect(dbpath) as db:
        # Match the coordinator's deployed schema. Preserve queued and completed work.
        states = db.execute("SELECT id FROM jobs WHERE state IN ('starting','running')").fetchall()
        for (job_id,) in states:
            db.execute("UPDATE jobs SET state='interrupted',error='recovery_requires_reconciliation',updated_at=?,finished_at=? WHERE id=?", (now(), now(), job_id))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)", (now(), job_id, "recovery_uncertain", json.dumps({"automatic_retry": False})))
        return len(states)


def restore(archive, target):
    meta = verify(archive)
    target = Path(target)
    if target.is_symlink() or target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError("Restore target must be new or empty; never overwrite an active coordinator")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix=".restore-", dir=target.parent) as folder:
        stage = Path(folder)
        with tarfile.open(archive, "r:gz") as tf:
            for m in tf.getmembers():
                safe_name(m.name)
                p = stage / m.name
                p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with tf.extractfile(m) as src, p.open("xb") as dst:
                    os.chmod(p, 0o600)
                    shutil.copyfileobj(src, dst, 1024 * 1024)
        coord = stage / "coordinator"
        authority = read_json(coord / "authority.json")
        authority.update(role="standby", armed_boot_id=None)
        atomic_json(coord / "authority.json", authority)
        interrupted = reconcile(coord / "queue.sqlite")
        atomic_json(coord / "recovery-origin.json", {"source_host": meta["source_host"], "generation": meta["generation"], "snapshot_id": meta["id"], "restored_at": now()})
        atomic_json(coord / "generation-floor.json", {"generation": meta["generation"]})
        if (stage / "worker").exists():
            shutil.move(stage / "worker", coord / "recovered-worker")
        # Result target is a coordinator root, ready only for manual promotion.
        if target.exists():
            target.rmdir()
        os.replace(coord, target)
    return {"restored": str(target), "role": "standby", "generation": meta["generation"], "jobs_requiring_reconciliation": interrupted}


def promote(target, proof_file, verifier, require_root=True):
    # Serialize competing operator invocations; never authorize twice from one floor.
    with (Path(target) / ".recovery.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _promote(target, proof_file, verifier, require_root)


def _promote(target, proof_file, verifier, require_root=True):
    if require_root and os.geteuid() != 0:
        raise PermissionError("Promotion requires the operator's root privileges")
    if not verifier:
        raise ValueError("A live external fencing verifier is mandatory")
    if not Path(verifier[0]).is_absolute():
        raise ValueError("Fencing verifier executable must have an absolute path")
    target = Path(target)
    authority = read_json(target / "authority.json")
    origin = read_json(target / "recovery-origin.json")
    floor = read_json(target / "generation-floor.json")["generation"]
    proof = read_json(proof_file)
    generation = authority["generation"]
    if authority.get("role") not in {"standby", "suspended"} or generation != floor:
        raise ValueError("Active or stale coordinator cannot be promoted")
    if proof.get("previous_host") != origin["source_host"] or proof.get("previous_generation") != generation or proof.get("new_generation") != generation + 1:
        raise ValueError("Fencing proof does not match the restored authority")
    if proof.get("method") not in {"coordinator-stopped", "provider-powered-off"} or proof.get("verified") is not True:
        raise ValueError("Unsupported fencing proof")
    for path in [Path(verifier[0]), *Path(verifier[0]).parents]:
        if require_root and (path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022):
            raise PermissionError("Verifier and parents must be root-owned and not writable by other users")
    nonce = uuid.uuid4().hex
    env = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "ADMIN_CLUSTER_FENCE_NONCE": nonce}
    result = subprocess.run(verifier, input=json.dumps(proof), text=True, capture_output=True, timeout=30, env=env, check=True)
    confirmed = json.loads(result.stdout)
    if confirmed.get("confirmed") is not True or confirmed.get("nonce") != nonce or confirmed.get("previous_host") != origin["source_host"] or confirmed.get("previous_generation") != generation or confirmed.get("method") != proof["method"]:
        raise ValueError("Fencing was not confirmed by the live verifier")
    verified_at = dt.datetime.fromisoformat(confirmed["verified_at"])
    age = (dt.datetime.now(dt.timezone.utc) - verified_at).total_seconds()
    if not 0 <= age <= 60:
        raise ValueError("Live fencing evidence is stale")
    import authority_guard
    epoch_binding = authority_guard.authorize_promotion(authority, proof, confirmed)
    new_generation = generation + 1
    atomic_json(target / "generation-floor.json", {"generation": new_generation})
    authority.update(role="primary", generation=new_generation, armed_boot_id=Path("/proc/sys/kernel/random/boot_id").read_text().strip(), **epoch_binding)
    atomic_json(target / "authority.json", authority)
    atomic_json(target / "promotion.json", {"at": now(), "host": socket.gethostname(), "generation": new_generation, "fence": confirmed})
    return {"promoted": True, "generation": new_generation, "requires_operator_service_start": True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="action", required=True)
    s = sub.add_parser("snapshot"); s.add_argument("--source", required=True); s.add_argument("--output", required=True); s.add_argument("--worker-root"); s.add_argument("--database")
    v = sub.add_parser("verify"); v.add_argument("--snapshot", required=True)
    r = sub.add_parser("restore"); r.add_argument("--snapshot", required=True); r.add_argument("--target", required=True)
    m = sub.add_parser("promote"); m.add_argument("--target", required=True); m.add_argument("--fence-proof", required=True); m.add_argument("--verify-fence-command", nargs="+", required=True)
    a = p.parse_args()
    try:
        if a.action == "snapshot": result = snapshot(a.source, a.output, a.worker_root, a.database)
        elif a.action == "verify": result = verify(a.snapshot)
        elif a.action == "restore": result = restore(a.snapshot, a.target)
        else: result = promote(a.target, a.fence_proof, a.verify_fence_command)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": type(e).__name__, "detail": str(e)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
