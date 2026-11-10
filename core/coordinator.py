#!/usr/bin/python3
"""Private SSH RPC, durable queue and fixed-command worker for admin-v2.

No web listener, production configuration, email delivery or automatic failover.
The systemd launcher is installed separately by the infrastructure operator.
"""
from __future__ import annotations

import base64
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

ROOT = Path(os.environ.get("ADMIN_CLUSTER_ROOT", "/srv/admin-v2-coordinator"))
WORKER = Path(os.environ.get("ADMIN_WORKER_ROOT", "/srv/admin-v2-worker"))
LAUNCHER = "/usr/local/libexec/admin-v2-launch"
MAX_RPC = 100 * 1024 * 1024
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_SOURCE = 500 * 1024 * 1024
MAX_LOG = 10 * 1024 * 1024
MAX_ARTIFACTS = 500 * 1024 * 1024
TERMINAL = {"completed", "failed", "interrupted", "canceled"}
KINDS = {"fixture-pass", "fixture-fail", "build", "typecheck", "test"}
ID = re.compile(r"[a-f0-9]{32}\Z")
COMMIT = re.compile(r"[a-f0-9]{40}\Z")
STOP = False
INLINE_CHILDREN = []


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def boot_id():
    return os.environ.get("ADMIN_CLUSTER_BOOT") or Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def atomic(path, value, mode=0o660):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("." + uuid.uuid4().hex)
    try:
        with tmp.open("x") as f:
            f.write(canonical(value) + "\n")
            f.flush()
            os.fsync(f.fileno())
        tmp.chmod(mode)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def validate_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("invalid_job_id")
    return value


def relative(value, allow_dot=False):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("invalid_relative_path")
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or (str(p) == "." and not allow_dot):
        raise ValueError("invalid_relative_path")
    return p


def authority():
    try:
        data = json.loads((ROOT / "authority.json").read_text())
    except (OSError, ValueError):
        return {"role": "suspended", "generation": 0, "effective_role": "suspended"}
    role = data.get("role")
    generation = data.get("generation")
    if role not in {"primary", "standby", "suspended"} or not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
        return {"role": "suspended", "generation": 0, "effective_role": "suspended"}
    data["effective_role"] = role if role != "primary" or data.get("armed_boot_id") == boot_id() else "suspended"
    return data


def primary():
    value = authority()
    if value["effective_role"] != "primary":
        raise PermissionError("coordinator_not_primary_or_boot_not_armed")
    return value


def initialize():
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "sources").mkdir(exist_ok=True)
    if os.environ.get("ADMIN_CLUSTER_DISPATCH", "1") == "1":
        (WORKER / "jobs").mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL,
          state TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
          exit_code INTEGER, error TEXT);
        CREATE TABLE IF NOT EXISTS events(
          seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
          job_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL);
        """)
    (ROOT / "queue.sqlite").chmod(0o660)


@contextlib.contextmanager
def connect():
    db = sqlite3.connect(ROOT / "queue.sqlite", timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=10000")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def event(db, job, kind, data):
    db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)", (stamp(), job, kind, canonical(data)))


def public_job(row):
    data = dict(row)
    payload = json.loads(data.pop("payload"))
    data.update(kind=payload["kind"], source_commit=payload.get("source_commit"), project_subdir=payload.get("project_subdir"))
    data["paths"] = {name: str(WORKER / "jobs" / data["id"] / name) for name in ("output.log", "state.json", "result.json")}
    return data


def status(job_id):
    job_id = validate_id(job_id)
    reconcile()
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise ValueError("unknown_job")
        result = public_job(row)
    path = WORKER / "jobs" / job_id / "result.json"
    if path.is_file():
        result["result"] = json.loads(path.read_text())
    return result


def submit(data):
    current = primary()
    allowed = {"action", "id", "kind", "source_commit", "project_subdir", "duration_seconds"}
    if set(data) - allowed:
        raise ValueError("unknown_submit_field")
    job = validate_id(data.get("id"))
    kind = data.get("kind")
    if kind not in KINDS:
        raise ValueError("unsupported_job_kind")
    payload = {"kind": kind}
    if kind.startswith("fixture-"):
        duration = data.get("duration_seconds", 0.2)
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 <= duration <= 30:
            raise ValueError("invalid_fixture_duration")
        if data.get("source_commit") or data.get("project_subdir"):
            raise ValueError("fixture_does_not_accept_source")
        payload["duration_seconds"] = duration
    else:
        commit = data.get("source_commit", "")
        if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
            raise ValueError("explicit_source_commit_required")
        manifest = ROOT / "sources" / commit / "manifest.json"
        if not manifest.is_file():
            raise ValueError("source_not_imported")
        subdir = str(relative(data.get("project_subdir", "site"), allow_dot=True))
        project = ROOT / "sources" / commit / "tree" / subdir
        if not (project / "package-lock.json").is_file() or not (project / "package.json").is_file():
            raise ValueError("project_requires_package_and_lockfile")
        payload.update(source_commit=commit, project_subdir=subdir)
    digest = hashlib.sha256(canonical(payload).encode()).hexdigest()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
        if row:
            if row["digest"] != digest:
                raise ValueError("job_identity_mismatch")
            return {"id": job, "existing": True, "state": row["state"]}
        now = stamp()
        db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                   (job, canonical(payload), digest, "queued", current["generation"], now, now))
        event(db, job, "queued", {"digest": digest, "generation": current["generation"], "kind": kind})
    return {"id": job, "existing": False, "state": "queued"}


def sanitize(text):
    # Redact common credential forms without loading any app configuration.
    text = re.sub(r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)((?:[A-Z_]*TOKEN|[A-Z_]*PASSWORD|[A-Z_]*SECRET|[A-Z_]*API_KEY|DATABASE_URL)\s*[:=]\s*)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(r"(https?://)[^/@\s:]+:[^/@\s]+@", r"\1[REDACTED]@", text)
    return text


def import_source(data):
    primary()
    if set(data) - {"action", "commit", "sha256", "archive_base64"}:
        raise ValueError("unknown_import_field")
    commit = data.get("commit", "")
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise ValueError("invalid_commit")
    encoded = data.get("archive_base64", "")
    if not isinstance(encoded, str) or len(encoded) > (MAX_ARCHIVE * 4 // 3 + 4):
        raise ValueError("archive_too_large")
    raw = base64.b64decode(encoded, validate=True)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != data.get("sha256"):
        raise ValueError("archive_checksum_mismatch")
    target = ROOT / "sources" / commit
    if target.exists():
        old = json.loads((target / "manifest.json").read_text())
        if old["sha256"] != digest:
            raise ValueError("source_commit_checksum_mismatch")
        return {**old, "existing": True}
    staging = Path(tempfile.mkdtemp(prefix=".source-", dir=ROOT / "sources"))
    try:
        tree = staging / "tree"
        tree.mkdir()
        count = size = 0
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as archive:
            for entry in archive:
                name = relative(entry.name, allow_dot=True)
                if entry.issym() or entry.islnk() or not (entry.isdir() or entry.isfile()):
                    raise ValueError("archive_links_or_special_files_not_allowed")
                for part in name.parts:
                    if part in {".git", "node_modules", ".next", "secrets", "preview-state", ".pgdata", "pgdata"} or (part.startswith(".env") and part not in {".env.example", ".env.sample"}):
                        raise ValueError("archive_contains_runtime_or_secret_path")
                count += 1
                size += max(0, entry.size)
                if count > 50000 or size > MAX_SOURCE:
                    raise ValueError("archive_expansion_limit")
                dest = tree.joinpath(*name.parts)
                if entry.isdir():
                    dest.mkdir(parents=True, exist_ok=True)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if dest.exists():
                        raise ValueError("duplicate_archive_path")
                    with archive.extractfile(entry) as source, dest.open("xb") as out:
                        shutil.copyfileobj(source, out)
                    dest.chmod(0o550 if entry.mode & 0o111 else 0o440)
        manifest = {"commit": commit, "sha256": digest, "files": count, "unpacked_bytes": size, "imported_at": stamp()}
        atomic(staging / "manifest.json", manifest, 0o440)
        for directory, _, _ in os.walk(staging, topdown=False):
            Path(directory).chmod(0o2550)
        os.rename(staging, target)
        with connect() as db:
            event(db, None, "source_imported", manifest)
        return {**manifest, "existing": False}
    except Exception:
        # chmod directories back to writable so rejected archives leave no partial source.
        for directory, _, _ in os.walk(staging):
            Path(directory).chmod(0o750)
        shutil.rmtree(staging)
        raise


def read_runtime(job):
    path = WORKER / "jobs" / job / "state.json"
    try:
        data = json.loads(path.read_text())
        if data.get("id") != job:
            return None
        return data
    except (OSError, ValueError):
        return None


def alive(state):
    if state.get("boot_id") != boot_id():
        return False
    try:
        fields = Path(f"/proc/{int(state['pid'])}/stat").read_text().rpartition(") ")[2].split()
        return fields[0] != "Z" and fields[19] == state.get("start_ticks")
    except (OSError, KeyError, ValueError, IndexError):
        return False


def reconcile():
    if authority()["effective_role"] != "primary":
        return
    with connect() as db:
        rows = db.execute("SELECT * FROM jobs WHERE state IN ('starting','running')").fetchall()
        for row in rows:
            state = read_runtime(row["id"])
            if state and state.get("state") in TERMINAL:
                new = state["state"]
            elif state and state.get("state") == "running":
                new = "running" if alive(state) else "interrupted"
            elif (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(row["updated_at"])).total_seconds() > 45:
                new = "interrupted"
            else:
                continue
            if new != row["state"]:
                finished = state.get("finished_at", stamp()) if new in TERMINAL and state else stamp() if new in TERMINAL else None
                error = state.get("error") if state else "launcher_result_unknown"
                if new == "interrupted" and not error:
                    error = "worker_lost_or_boot_changed"
                db.execute("UPDATE jobs SET state=?,updated_at=?,started_at=COALESCE(started_at,?),finished_at=?,exit_code=?,error=? WHERE id=?",
                           (new, stamp(), state.get("started_at") if state else None, finished, state.get("exit_code") if state else None, error, row["id"]))
                event(db, row["id"], new, {"exit_code": state.get("exit_code") if state else None, "error": error})


def dispatch_once():
    current = primary()
    INLINE_CHILDREN[:] = [child for child in INLINE_CHILDREN if child.poll() is None]
    if os.environ.get("ADMIN_CLUSTER_DISPATCH", "1") != "1":
        return None
    reconcile()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM jobs WHERE state IN ('starting','running')").fetchone():
            return None
        row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1").fetchone()
        if not row:
            return None
        if row["generation"] != current["generation"]:
            # Queued jobs from a restored checkpoint require explicit resubmission with a new ID.
            db.execute("UPDATE jobs SET state='interrupted',error='authority_generation_changed',finished_at=?,updated_at=? WHERE id=?", (stamp(), stamp(), row["id"]))
            event(db, row["id"], "interrupted", {"error": "authority_generation_changed"})
            return None
        folder = WORKER / "jobs" / row["id"]
        folder.mkdir(mode=0o2770)
        folder.chmod(0o2770)
        atomic(folder / "config.json", {"id": row["id"], "payload": json.loads(row["payload"]), "digest": row["digest"], "generation": row["generation"]}, 0o660)
        db.execute("UPDATE jobs SET state='starting',updated_at=? WHERE id=?", (stamp(), row["id"]))
        event(db, row["id"], "starting", {"generation": row["generation"]})
    try:
        if os.environ.get("ADMIN_CLUSTER_TEST_INLINE") == "1":
            env = os.environ.copy()
            INLINE_CHILDREN.append(subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "run", row["id"]], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True))
        else:
            subprocess.run(["/usr/bin/sudo", "-n", LAUNCHER, row["id"]], check=True, capture_output=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        # Launcher may have acted before losing the response. Never automatically resubmit.
        with connect() as db:
            db.execute("UPDATE jobs SET error='launcher_result_uncertain' WHERE id=?", (row["id"],))
            event(db, row["id"], "launcher_result_uncertain", {})
    return row["id"]


def commands(payload):
    kind = payload["kind"]
    if kind.startswith("fixture-"):
        code = "import time; print('fixture-start',flush=True); time.sleep(%r); print('fixture-finished',flush=True); raise SystemExit(%d)" % (payload["duration_seconds"], 0 if kind == "fixture-pass" else 7)
        return [["/usr/bin/python3", "-c", code]]
    command = {"build": ["/usr/bin/npm", "run", "build"], "typecheck": ["/usr/bin/npm", "run", "typecheck"], "test": ["/usr/bin/npm", "test"]}[kind]
    return [["/usr/bin/npm", "ci", "--include=dev", "--no-audit", "--no-fund"], command]


def collect_artifacts(folder):
    """Export independent regular-file artifacts for checkpoint replication.

    Walk through directory descriptors with O_NOFOLLOW; never copy links, devices
    or files outside the artifact tree. Publish only a fully validated export.
    """
    folder = Path(folder)
    source = folder / "work" / "artifacts"
    target = folder / "artifacts"
    if not source.exists() and not source.is_symlink():
        return []
    if target.exists() or target.is_symlink():
        raise ValueError("artifact_export_already_exists")
    result = []
    total = 0
    staging = Path(tempfile.mkdtemp(prefix=".artifacts-", dir=folder))
    staging.chmod(0o2770)
    flags = os.O_RDONLY | os.O_NOFOLLOW

    def export(directory_fd, destination, relative_path=Path()):
        nonlocal total
        for name in sorted(os.listdir(directory_fd)):
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            child_relative = relative_path / name
            dest = destination / name
            if stat.S_ISDIR(info.st_mode):
                child_fd = os.open(name, flags | os.O_DIRECTORY, dir_fd=directory_fd)
                try:
                    dest.mkdir(mode=0o2770)
                    export(child_fd, dest, child_relative)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                file_fd = os.open(name, flags | os.O_NONBLOCK, dir_fd=directory_fd)
                try:
                    opened = os.fstat(file_fd)
                    if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
                        raise ValueError("artifact_special_file")
                    if total + opened.st_size > MAX_ARTIFACTS:
                        raise ValueError("artifact_limit")
                    digest = hashlib.sha256()
                    size = 0
                    with os.fdopen(file_fd, "rb", closefd=False) as stream, dest.open("xb") as output:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            size += len(chunk)
                            total += len(chunk)
                            if total > MAX_ARTIFACTS:
                                raise ValueError("artifact_limit")
                            output.write(chunk)
                            digest.update(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    dest.chmod(0o660)
                    result.append({"path": str(Path("artifacts") / child_relative), "bytes": size, "sha256": digest.hexdigest()})
                finally:
                    os.close(file_fd)
            else:
                raise ValueError("artifact_links_or_special_files_not_allowed")

    try:
        source_fd = os.open(source, flags | os.O_DIRECTORY)
        try:
            export(source_fd, staging)
        finally:
            os.close(source_fd)
        os.rename(staging, target)
        return result
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def run_job(job):
    job = validate_id(job)
    folder = WORKER / "jobs" / job
    config = json.loads((folder / "config.json").read_text())
    if config.get("id") != job or hashlib.sha256(canonical(config["payload"]).encode()).hexdigest() != config["digest"]:
        raise ValueError("job_config_mismatch")
    current = primary()
    if config["generation"] != current["generation"]:
        raise PermissionError("authority_generation_changed")
    # An exclusive marker survives process loss and prevents replaying a possibly executed job.
    marker = folder / "execution.started"
    fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o660)
    os.close(fd)
    fields = Path(f"/proc/{os.getpid()}/stat").read_text().rpartition(") ")[2].split()
    state = {"id": job, "state": "running", "started_at": stamp(), "boot_id": boot_id(), "pid": os.getpid(), "start_ticks": fields[19], "generation": config["generation"], "exit_code": None}
    atomic(folder / "state.json", state)
    child = None
    canceled = False

    def stop(*_):
        nonlocal canceled
        canceled = True
        if child and child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGTERM)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    code = 1
    error = None
    phases = []
    artifacts = []
    try:
        payload = config["payload"]
        work = folder / "work"
        work.mkdir()
        if not payload["kind"].startswith("fixture-"):
            source = ROOT / "sources" / payload["source_commit"] / "tree"
            shutil.copytree(source, work, dirs_exist_ok=True)
            for directory, _, files in os.walk(work):
                Path(directory).chmod(0o770)
                for name in files:
                    path = Path(directory) / name
                    path.chmod(0o770 if path.stat().st_mode & 0o111 else 0o660)
            cwd = work / payload["project_subdir"]
        else:
            cwd = work
        home = folder / "home"
        home.mkdir(mode=0o770)
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(home), "LANG": "C.UTF-8", "TZ": "UTC", "CI": "true", "NEXT_TELEMETRY_DISABLED": "1", "NODE_OPTIONS": "--max-old-space-size=3072", "NODE_ENV": "production" if payload["kind"] == "build" else "test", "PETICAO_TEST_MODE": "1", "MAIL_PROVIDER": "disabled", "npm_config_cache": str(folder / "npm-cache")}
        log_size = 0
        with (folder / "output.log").open("w", buffering=1) as log:
            for index, command in enumerate(commands(payload)):
                if canceled:
                    break
                phase_start = stamp()
                log.write("[phase %d] %s\n" % (index + 1, canonical(command)))
                child = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, text=True, errors="replace", start_new_session=True)
                for line in iter(lambda: child.stdout.readline(65536), ""):
                    line = sanitize(line)
                    data = line.encode()
                    if log_size + len(data) <= MAX_LOG:
                        log.write(line)
                        log_size += len(data)
                code = child.wait()
                phases.append({"phase": index + 1, "started_at": phase_start, "finished_at": stamp(), "exit_code": code})
                if code:
                    break
            artifacts = collect_artifacts(folder)
    except Exception as exc:
        error = type(exc).__name__ + ": " + str(exc)[:300]
        if child and child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    final = "canceled" if canceled else "completed" if code == 0 and not error else "failed"
    state.update(state=final, exit_code=code, finished_at=stamp(), error=error)
    result = {**state, "source_commit": config["payload"].get("source_commit"), "digest": config["digest"], "phases": phases, "artifacts": artifacts}
    atomic(folder / "result.json", result)
    atomic(folder / "state.json", state)
    return code


def cancel(job):
    primary()
    job = validate_id(job)
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
        if not row:
            raise ValueError("unknown_job")
        if row["state"] in TERMINAL:
            return {"id": job, "state": row["state"], "existing": True}
        if row["state"] == "queued":
            db.execute("UPDATE jobs SET state='canceled',updated_at=?,finished_at=? WHERE id=?", (stamp(), stamp(), job))
            event(db, job, "canceled", {})
            return {"id": job, "state": "canceled"}
    if os.environ.get("ADMIN_CLUSTER_TEST_INLINE") == "1":
        state = read_runtime(job)
        if state and alive(state):
            os.kill(state["pid"], signal.SIGTERM)
    else:
        subprocess.run(["/usr/bin/sudo", "-n", LAUNCHER, "--cancel", job], capture_output=True, check=True, timeout=20)
    return {"id": job, "state": "cancel_requested"}


def rpc(data):
    if not isinstance(data, dict):
        raise ValueError("object_required")
    action = data.get("action")
    if action == "health":
        return {"at": stamp(), "authority": authority(), "boot_id": boot_id(), "root": str(ROOT), "worker_root": str(WORKER)}
    if action == "submit":
        return submit(data)
    if action == "import-source":
        return import_source(data)
    if action == "status":
        return status(data.get("id"))
    if action == "jobs":
        reconcile()
        limit = max(1, min(200, int(data.get("limit", 50))))
        with connect() as db:
            rows = db.execute("SELECT * FROM jobs ORDER BY created_at DESC,id DESC LIMIT ?", (limit,)).fetchall()
            events = db.execute("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 500", (max(0, int(data.get("after_seq", 0))),)).fetchall()
            return {"jobs": [public_job(r) for r in rows], "events": [{**dict(r), "data": json.loads(r["data"])} for r in events], "authority": authority()}
    if action == "logs":
        job = validate_id(data.get("id"))
        offset = max(0, int(data.get("offset", 0)))
        path = WORKER / "jobs" / job / "output.log"
        content = b""
        if path.is_file():
            with path.open("rb") as stream:
                stream.seek(offset)
                content = stream.read(32768)
        return {"id": job, "offset": offset + len(content), "output": sanitize(content.decode(errors="replace"))}
    if action == "cancel":
        return cancel(data.get("id"))
    if action == "snapshot":
        # Only a consistent controlled-path database copy; no private key or production data.
        folder = ROOT / "snapshots" / uuid.uuid4().hex
        folder.mkdir(parents=True, mode=0o750)
        with connect() as db, sqlite3.connect(folder / "queue.sqlite") as backup:
            db.backup(backup)
        atomic(folder / "authority.json", authority(), 0o640)
        (folder / "queue.sqlite").chmod(0o640)
        return {"path": str(folder), "sha256": hashlib.sha256((folder / "queue.sqlite").read_bytes()).hexdigest(), "at": stamp()}
    raise ValueError("unknown_action")


def daemon():
    global STOP
    signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("STOP", True))
    signal.signal(signal.SIGINT, lambda *_: globals().__setitem__("STOP", True))
    # The lock stays held for the complete daemon lifetime; a second daemon exits.
    import fcntl
    with (ROOT / "daemon.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while not STOP:
            try:
                reconcile()
                if authority()["effective_role"] == "primary":
                    dispatch_once()
                atomic(ROOT / "heartbeat.json", {"at": stamp(), "authority": authority(), "pid": os.getpid()}, 0o640)
            except Exception as exc:
                print(canonical({"at": stamp(), "error": type(exc).__name__, "detail": str(exc)[:200]}), flush=True)
            for _ in range(50):
                if STOP:
                    break
                time.sleep(0.1)


def main():
    os.umask(0o007)
    if len(sys.argv) >= 2 and sys.argv[1] == "run":
        return run_job(sys.argv[2])
    initialize()
    if len(sys.argv) == 2 and sys.argv[1] == "daemon":
        daemon()
        return 0
    if len(sys.argv) == 2 and sys.argv[1] == "rpc":
        raw = sys.stdin.buffer.read(MAX_RPC + 1)
        if len(raw) > MAX_RPC:
            raise ValueError("request_too_large")
        print(canonical({"ok": True, "result": rpc(json.loads(raw))}))
        return 0
    raise ValueError("usage: coordinator.py rpc | daemon | run JOBID")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(canonical({"ok": False, "error": type(exc).__name__, "detail": sanitize(str(exc))[:500]}))
        sys.exit(1)
