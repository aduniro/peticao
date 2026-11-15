"""Candidate durable contract. Library only: no SSH, daemon or systemd adapter.

The coordinator uses its EXISTING queue. The worker journal is a launch receipt,
not another queue. A committed start intent is never retried, including after
an exception, reboot or controller restart. Production adapters remain gated.
"""
from __future__ import annotations

import contextlib
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import stat


BACKEND = "ssh-systemd-v1"
WORKERS = {"civo", "akamai", "azure"}
MANIFEST_KEYS = {
    "backend", "job_id", "generation", "worker_id", "profile",
    "profile_sha256", "source_sha256", "dependencies_sha256",
    "artifact_policy_sha256", "payload_sha256",
    "coordinator_host", "coordinator_boot_id", "authority_operation_id", "epoch_sha256",
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def hex_value(value, size):
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{%d}" % size, value):
        raise ValueError("invalid_identity_or_digest")
    return value


def generation(value):
    if type(value) is not int or value < 1:
        raise ValueError("positive_integer_generation_required")
    return value


def private_file(path):
    """Refuse links, foreign ownership, hardlinks and permissive journal files."""
    p = Path(path).absolute()
    for parent in [*reversed(p.parents), p]:
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("symlink_forbidden")
    info = p.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
        raise PermissionError("owned_private_regular_file_required")
    parent = p.parent.stat()
    if parent.st_uid != os.geteuid() or stat.S_IMODE(parent.st_mode) != 0o700:
        raise PermissionError("owned_private_parent_required")
    return p


def private_parent(path):
    p = Path(path).absolute()
    for parent in [*reversed(p.parents), p]:
        if stat.S_ISLNK(parent.lstat().st_mode):
            raise ValueError("symlink_forbidden")
    info = p.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError("private_parent_required")


def root_control_file(path):
    """Readable by services, writable only by root, under root-owned ancestors."""
    p = Path(path).absolute()
    for parent in [*reversed(p.parents), p]:
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError("root_control_chain_required")
    info = p.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in {0o400, 0o600, 0o444, 0o644}:
        raise PermissionError("root_control_file_required")
    return p


@contextlib.contextmanager
def transaction(path, write=False):
    p = private_file(path)
    # mode=rw forbids creating an accidental coordinator queue.
    db = sqlite3.connect(p.as_uri() + "?mode=rw", uri=True, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def validate_manifest(value, profiles):
    if not isinstance(value, dict) or set(value) != MANIFEST_KEYS:
        raise ValueError("exact_manifest_fields_required")
    if value["backend"] != BACKEND or value["worker_id"] not in WORKERS:
        raise ValueError("backend_or_worker_not_qualified")
    hex_value(value["job_id"], 32)
    generation(value["generation"])
    if value["coordinator_host"] != "civo":
        raise PermissionError("civo_controller_required_for_candidate")
    hex_value(value["authority_operation_id"], 32)
    if not isinstance(value["coordinator_boot_id"], str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", value["coordinator_boot_id"]):
        raise ValueError("coordinator_boot_identity_required")
    for key in MANIFEST_KEYS:
        if key.endswith("sha256"):
            hex_value(value[key], 64)
    profile = value["profile"]
    if not isinstance(profile, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", profile):
        raise ValueError("invalid_profile")
    if profiles.get(profile) != value["profile_sha256"]:
        raise PermissionError("profile_not_qualified")
    return digest(value)


class EpochGuard:
    """Operator-controlled persistent floor, outside the restored queue tree.

    This is NOT distributed consensus. Installation, durable distribution to all
    possible primaries/workers and old-primary fencing need separate proofs.
    A queue restore can never restore this floor backwards.
    """
    KEYS = {"generation", "primary_host", "coordinator_boot_id", "operation_id"}

    def __init__(self, path, control_validator=root_control_file):
        self.path, self.control_validator = Path(path).absolute(), control_validator

    def require(self, current_generation, host, boot, operation_id, expected_sha=None):
        generation(current_generation)
        value = json.loads(self.control_validator(self.path).read_text())
        if (set(value) != self.KEYS or type(value.get("generation")) is not int
                or value != {"generation": current_generation, "primary_host": host,
                             "coordinator_boot_id": boot, "operation_id": operation_id}):
            raise PermissionError("persistent_epoch_owner_boot_operation_mismatch")
        hex_value(operation_id, 32)
        sha = digest(value)
        if expected_sha is not None and sha != expected_sha:
            raise PermissionError("persistent_epoch_digest_mismatch")
        return sha


class Authority:
    def __init__(self, path, boot_id, epoch_guard, host, operation_id):
        self.path, self.boot_id = Path(path), boot_id
        self.epoch_guard, self.host, self.operation_id = epoch_guard, host, operation_id

    def require(self, expected_generation):
        value = json.loads(private_file(self.path).read_text())
        generation(expected_generation)
        if (value.get("role") != "primary" or value.get("generation") != expected_generation
                or type(value.get("generation")) is not int
                or value.get("armed_boot_id") != self.boot_id()):
            raise PermissionError("authority_not_primary_current_generation_and_boot")
        return self.epoch_guard.require(expected_generation, self.host, self.boot_id(), self.operation_id)


class Claims:
    """Explicit schema migration and atomic claims in the legacy queue database.

    Integrators MUST exclude remote jobs from the legacy local dispatcher and
    reconciler before enabling admission. This library does not patch either.
    """
    def __init__(self, queue, authority, profiles):
        self.path, self.authority, self.profiles = Path(queue), authority, dict(profiles)
        if self.authority.epoch_guard.path.is_relative_to(self.path.absolute().parent):
            raise ValueError("epoch_floor_must_be_outside_queue_restore_tree")
        with transaction(self.path) as db:
            for table in ("jobs", "events"):
                if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    raise ValueError("existing_legacy_queue_required")

    def install_schema(self, expected_generation):
        with transaction(self.path, True) as db:
            self.authority.require(expected_generation)
            db.execute("""CREATE TABLE IF NOT EXISTS remote_execution_claims(
                job_id TEXT PRIMARY KEY REFERENCES jobs(id), generation INTEGER NOT NULL,
                manifest_sha256 TEXT NOT NULL, worker_id TEXT NOT NULL,
                token_sha256 TEXT NOT NULL, phase TEXT NOT NULL,
                receipt_json TEXT, receipt_sha256 TEXT, invocation_id TEXT,
                result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")

    def _event(self, db, job, kind, value):
        db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)", (now(), job, kind, canonical(value)))

    def _identity(self, db, manifest):
        sha = validate_manifest(manifest, self.profiles)
        epoch_sha = self.authority.require(manifest["generation"])
        if (manifest["coordinator_host"] != self.authority.host
                or manifest["coordinator_boot_id"] != self.authority.boot_id()
                or manifest["authority_operation_id"] != self.authority.operation_id
                or manifest["epoch_sha256"] != epoch_sha):
            raise PermissionError("manifest_authority_identity_mismatch")
        job = db.execute("SELECT * FROM jobs WHERE id=?", (manifest["job_id"],)).fetchone()
        if not job or job["generation"] != manifest["generation"]:
            raise ValueError("existing_job_generation_required")
        payload = json.loads(job["payload"])
        if payload.get("backend") != BACKEND or job["digest"] != manifest["payload_sha256"] or digest(payload) != job["digest"]:
            raise PermissionError("remote_job_payload_digest_required")
        row = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (manifest["job_id"],)).fetchone()
        if row and (row["manifest_sha256"] != sha or row["generation"] != manifest["generation"] or row["worker_id"] != manifest["worker_id"]):
            raise PermissionError("claim_identity_mismatch")
        return job, row, sha

    def reserve(self, manifest, token):
        hex_value(token, 64)
        token_sha = hashlib.sha256(token.encode()).hexdigest()
        with transaction(self.path, True) as db:
            job, row, sha = self._identity(db, manifest)
            if row:
                if not hmac.compare_digest(row["token_sha256"], token_sha):
                    raise PermissionError("claim_token_mismatch")
                return False
            if job["state"] != "queued":
                raise ValueError("queued_job_required")
            db.execute("INSERT INTO remote_execution_claims VALUES(?,?,?,?,?,'reserved',NULL,NULL,NULL,NULL,?,?)",
                       (job["id"], manifest["generation"], sha, manifest["worker_id"], token_sha, now(), now()))
            db.execute("UPDATE jobs SET state='starting',updated_at=? WHERE id=?", (now(), job["id"]))
            self._event(db, job["id"], "remote_reserved", {"manifest_sha256": sha, "worker_id": manifest["worker_id"]})
            return True

    def bind(self, manifest, receipt):
        with transaction(self.path, True) as db:
            job, row, sha = self._identity(db, manifest)
            validate_receipt(receipt, manifest, sha)
            if not row or job["state"] != "starting":
                raise PermissionError("reserved_starting_job_required")
            receipt_sha = digest(receipt)
            if row["receipt_sha256"]:
                if row["receipt_sha256"] != receipt_sha:
                    raise PermissionError("worker_receipt_changed")
                return False
            if row["phase"] != "reserved":
                raise PermissionError("claim_not_reserved")
            db.execute("UPDATE remote_execution_claims SET receipt_json=?,receipt_sha256=?,phase='bound',updated_at=? WHERE job_id=?",
                       (canonical(receipt), receipt_sha, now(), job["id"]))
            self._event(db, job["id"], "remote_bound", {"receipt_sha256": receipt_sha})
            return True

    def authorize_once(self, manifest, token, receipt_sha):
        hex_value(token, 64)
        with transaction(self.path, True) as db:
            job, row, _ = self._identity(db, manifest)
            if not row or not hmac.compare_digest(row["token_sha256"], hashlib.sha256(token.encode()).hexdigest()) or row["receipt_sha256"] != receipt_sha:
                raise PermissionError("bound_receipt_and_token_required")
            if row["phase"] != "bound" or job["state"] != "starting":
                return False
            db.execute("UPDATE remote_execution_claims SET phase='permit_committed',updated_at=? WHERE job_id=?", (now(), job["id"]))
            self._event(db, job["id"], "remote_permit_committed", {"receipt_sha256": receipt_sha})
            return True

    def cancel_intent(self, manifest):
        with transaction(self.path, True) as db:
            job, row, _ = self._identity(db, manifest)
            if not row or row["phase"] in {"completed", "failed", "cancel_requested"}:
                return False
            db.execute("UPDATE remote_execution_claims SET phase='cancel_requested',updated_at=? WHERE job_id=?", (now(), job["id"]))
            self._event(db, job["id"], "remote_cancel_requested", {})
            # A cancellation request does NOT prove the remote process stopped.
            return True

    def observe(self, job_id):
        hex_value(job_id, 32)
        with transaction(self.path) as db:
            row = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (job_id,)).fetchone()
            return {k: row[k] for k in row.keys() if k != "token_sha256"} if row else None


RECEIPT_KEYS = {"job_id", "generation", "manifest_sha256", "worker_id", "boot_id", "unit", "prepared_at"}


def validate_receipt(receipt, manifest, sha):
    if not isinstance(receipt, dict) or set(receipt) != RECEIPT_KEYS:
        raise ValueError("exact_receipt_fields_required")
    generation(receipt["generation"])
    unit = "admin-dev-" + manifest["job_id"] + "-g" + str(manifest["generation"]) + ".service"
    if (any(receipt[k] != manifest[k] for k in ("job_id", "generation", "worker_id"))
            or receipt["manifest_sha256"] != sha or receipt["unit"] != unit):
        raise PermissionError("receipt_identity_mismatch")
    if not isinstance(receipt["boot_id"], str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", receipt["boot_id"]):
        raise ValueError("worker_boot_identity_required")
    datetime.datetime.fromisoformat(receipt["prepared_at"])


class WorkerJournal:
    """Receipt on persistent worker OS disk. No source/archive or shell inputs.

    launch is a TRUSTED, separately reviewed root-owned fixed-profile adapter.
    It must start the fixed unit exactly once and return its actual InvocationID.
    This library alone does not authenticate an RPC or attest a unit namespace.
    """
    def __init__(self, journal, worker_id, current_generation, boot_id, profiles, epoch_guard):
        self.path = Path(journal)
        if worker_id not in WORKERS:
            raise ValueError("unknown_worker")
        self.worker, self.generation = worker_id, generation(current_generation)
        self.boot_id, self.profiles = boot_id, dict(profiles)
        self.epoch_guard = epoch_guard
        with transaction(self.path) as db:
            metadata = dict(db.execute("SELECT key,value FROM metadata"))
            if metadata != {"worker_id": worker_id, "generation": str(current_generation)}:
                raise PermissionError("worker_journal_identity_mismatch")

    @staticmethod
    def initialize(journal, worker_id, current_generation):
        if worker_id not in WORKERS:
            raise ValueError("unknown_worker")
        generation(current_generation)
        p = Path(journal).absolute()
        # The operator prepares the private parent explicitly; no mkdir or chmod here.
        private_parent(p.parent)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        with transaction(p, True) as db:
            db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            db.executemany("INSERT INTO metadata VALUES(?,?)", [("worker_id", worker_id), ("generation", str(current_generation))])
            db.execute("""CREATE TABLE receipts(job_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,
                receipt_json TEXT NOT NULL, receipt_sha256 TEXT NOT NULL, token_sha256 TEXT NOT NULL,
                state TEXT NOT NULL, invocation_id TEXT, updated_at TEXT NOT NULL)""")

    def _manifest(self, manifest):
        sha = validate_manifest(manifest, self.profiles)
        if manifest["worker_id"] != self.worker or manifest["generation"] != self.generation:
            raise PermissionError("worker_or_generation_mismatch")
        self.epoch_guard.require(manifest["generation"], manifest["coordinator_host"],
                                 manifest["coordinator_boot_id"], manifest["authority_operation_id"], manifest["epoch_sha256"])
        return sha

    def _epoch(self, db):
        metadata = dict(db.execute("SELECT key,value FROM metadata"))
        if metadata != {"worker_id": self.worker, "generation": str(self.generation)}:
            raise PermissionError("worker_epoch_changed_requires_reconciliation")

    def prepare(self, manifest, token_sha):
        # Preparation receives only the digest. The launch secret is withheld
        # until the coordinator has durably consumed its authorization.
        hex_value(token_sha, 64)
        with transaction(self.path, True) as db:
            self._epoch(db)
            sha = self._manifest(manifest)
            row = db.execute("SELECT * FROM receipts WHERE job_id=?", (manifest["job_id"],)).fetchone()
            if row:
                receipt = json.loads(row["receipt_json"])
                validate_receipt(receipt, manifest, sha)
                if not hmac.compare_digest(row["token_sha256"], token_sha) or receipt["boot_id"] != self.boot_id():
                    raise PermissionError("worker_receipt_changed_or_rebooted")
                return receipt
            receipt = {"job_id": manifest["job_id"], "generation": self.generation,
                       "manifest_sha256": sha, "worker_id": self.worker, "boot_id": self.boot_id(),
                       "unit": "admin-dev-" + manifest["job_id"] + "-g" + str(self.generation) + ".service", "prepared_at": now()}
            validate_receipt(receipt, manifest, sha)
            db.execute("INSERT INTO receipts VALUES(?,?,?,?,?,'prepared',NULL,?)",
                       (manifest["job_id"], canonical(manifest), canonical(receipt), digest(receipt), token_sha, now()))
            return receipt

    def start_once(self, manifest, token, receipt_sha, launch):
        self._manifest(manifest)
        hex_value(token, 64)
        with transaction(self.path, True) as db:
            self._epoch(db)
            self._manifest(manifest)
            row = db.execute("SELECT * FROM receipts WHERE job_id=?", (manifest["job_id"],)).fetchone()
            if not row or row["manifest_json"] != canonical(manifest) or row["receipt_sha256"] != receipt_sha or not hmac.compare_digest(row["token_sha256"], hashlib.sha256(token.encode()).hexdigest()):
                raise PermissionError("worker_permit_identity_mismatch")
            receipt = json.loads(row["receipt_json"])
            if receipt["boot_id"] != self.boot_id():
                raise PermissionError("worker_reboot_requires_reconciliation")
            if row["state"] != "prepared":
                return False
            db.execute("UPDATE receipts SET state='start_intent',updated_at=? WHERE job_id=?", (now(), manifest["job_id"]))
        # FULL synchronous COMMIT precedes the one possible process creation.
        # A crash here burns the permit, even if no workload ever starts.
        try:
            invocation = launch(dict(manifest), dict(receipt))
            hex_value(invocation, 32)
        except BaseException:
            with transaction(self.path, True) as db:
                db.execute("UPDATE receipts SET state='uncertain',updated_at=? WHERE job_id=?", (now(), manifest["job_id"]))
            raise
        with transaction(self.path, True) as db:
            db.execute("UPDATE receipts SET state='running',invocation_id=?,updated_at=? WHERE job_id=?",
                       (invocation, now(), manifest["job_id"]))
        return True

    def cancel_intent(self, manifest):
        self._manifest(manifest)
        with transaction(self.path, True) as db:
            self._epoch(db)
            self._manifest(manifest)
            row = db.execute("SELECT * FROM receipts WHERE job_id=?", (manifest["job_id"],)).fetchone()
            if not row or row["manifest_json"] != canonical(manifest):
                raise PermissionError("worker_job_identity_required")
            if row["state"] == "prepared":
                db.execute("UPDATE receipts SET state='canceled_before_start',updated_at=? WHERE job_id=?", (now(), manifest["job_id"]))
                return "canceled_before_start"
            # Never claim process cancellation without the external unit/cgroup proof.
            return "stop_observation_required"

    def observe(self, job_id):
        hex_value(job_id, 32)
        with transaction(self.path) as db:
            row = db.execute("SELECT * FROM receipts WHERE job_id=?", (job_id,)).fetchone()
            if not row:
                return None
            receipt = json.loads(row["receipt_json"])
            return {"receipt": receipt, "receipt_sha256": row["receipt_sha256"], "state": row["state"],
                    "invocation_id": row["invocation_id"], "boot_matches": receipt["boot_id"] == self.boot_id()}
