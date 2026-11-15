"""SOURCE ONLY: single-queue admission/read facade; no transport or launcher.

Public RPC cannot dispatch, complete jobs, accept artifacts or read envelopes.
Known credential spans are masked in the bounded full log before byte slicing.
This does not detect arbitrary secrets. Log exposure needs qualification before
deployment; never put log contents into tool context or review reports.
Installation, catalog qualification and executor fencing remain separate gates.
"""
import contextlib
import json
from pathlib import Path
import re
import sqlite3

import authority_guard
import coordinator as legacy
import log_redaction
import log_access
import remote_contract as contract


KINDS = {"fixture-pass", "fixture-fail"}
DIGESTS = {"profile_sha256", "source_sha256", "dependencies_sha256", "artifact_policy_sha256"}
CATALOG_KEYS = {"version", "profiles", "nodes"}
PROFILE_KEYS = DIGESTS | {"profile", "qualified"}
PUBLIC_JOB_KEYS = {"id", "state", "generation", "created_at", "updated_at", "started_at", "finished_at", "exit_code"}


def exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError("exact_fields_required")


class Catalog:
    def __init__(self, path, validator=contract.root_control_file):
        self.path, self.validator = Path(path), validator

    def load(self):
        path = self.validator(self.path)
        if path.stat().st_size > 32768:
            raise ValueError("catalog_too_large")
        value = json.loads(path.read_bytes())
        exact(value, CATALOG_KEYS)
        if type(value["version"]) is not int or value["version"] != 1:
            raise ValueError("catalog_version_required")
        exact(value["profiles"], KINDS)
        exact(value["nodes"], contract.WORKERS)
        for node in value["nodes"].values():
            exact(node, {"qualified"})
            if type(node["qualified"]) is not bool:
                raise ValueError("boolean_qualification_required")
        for kind, descriptor in value["profiles"].items():
            exact(descriptor, PROFILE_KEYS)
            if descriptor["profile"] != kind or type(descriptor["qualified"]) is not bool:
                raise ValueError("fixed_fixture_profile_required")
            for key in DIGESTS:
                contract.hex_value(descriptor[key], 64)
        return value

    def select(self, kind, worker):
        if type(kind) is not str or kind not in KINDS or type(worker) is not str or worker not in contract.WORKERS:
            raise ValueError("fixed_profile_and_worker_required")
        value = self.load()
        profile = value["profiles"][kind]
        if profile["qualified"] is not True or value["nodes"][worker]["qualified"] is not True:
            raise PermissionError("profile_or_node_not_qualified")
        return {key: profile[key] for key in DIGESTS | {"profile"}}, contract.digest(value)


class Facade:
    def __init__(self, queue, catalog, authority, queue_validator=contract.private_file, worker_root=None, backend=None):
        self.queue = Path(queue).absolute()
        self.catalog, self.authority, self.queue_validator = catalog, authority, queue_validator
        self.worker_root, self.backend = Path(worker_root) if worker_root is not None else None, backend

    @contextlib.contextmanager
    def connect(self, write=False):
        path = self.queue_validator(self.queue)
        db = sqlite3.connect(path.as_uri() + ("?mode=rw" if write else "?mode=ro"), uri=True,
                             timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute("PRAGMA synchronous=FULL")
            else:
                db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            for table in ("jobs", "events"):
                if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    raise ValueError("existing_legacy_queue_required")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def primary(self):
        current = self.authority()
        authority_guard.require_primary(current)
        return current

    @staticmethod
    def bound_payload(kind, worker, profile, catalog_sha, current):
        return {"backend": contract.BACKEND, "kind": kind, "worker_id": worker,
                **profile, "catalog_sha256": catalog_sha,
                "generation": current["generation"], "coordinator_host": current["coordinator_host"],
                "coordinator_boot_id": current["armed_boot_id"],
                "authority_operation_id": current["authority_operation_id"], "epoch_sha256": current["epoch_sha256"]}

    @staticmethod
    def manifest(job_id, payload):
        manifest = {key: payload[key] for key in contract.MANIFEST_KEYS - {"job_id", "payload_sha256"}}
        manifest.update(job_id=job_id, payload_sha256=contract.digest(payload))
        contract.validate_manifest(manifest, {payload["profile"]: payload["profile_sha256"]})
        return manifest

    def submit(self, request):
        exact(request, {"action", "id", "kind", "worker_id"})
        if request["action"] != "submit":
            raise ValueError("submit_action_required")
        job = contract.hex_value(request["id"], 32)
        profile, catalog_sha = self.catalog.select(request["kind"], request["worker_id"])
        current = self.primary()
        payload = self.bound_payload(request["kind"], request["worker_id"], profile, catalog_sha, current)
        self.manifest(job, payload)
        sha = contract.digest(payload)
        with self.connect(True) as db:
            # Recheck the durable floor after acquiring the queue write lock.
            if self.primary() != current:
                raise PermissionError("authority_changed_during_admission")
            if self.catalog.select(request["kind"], request["worker_id"]) != (profile, catalog_sha):
                raise PermissionError("catalog_changed_during_admission")
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_execution_claims'").fetchone():
                raise PermissionError("explicit_remote_schema_install_required")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
            if row:
                if row["digest"] != sha or row["payload"] != contract.canonical(payload) or row["generation"] != current["generation"]:
                    raise ValueError("job_identity_mismatch")
                return {"id": job, "existing": True, "state": row["state"]}
            stamp = contract.now()
            db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                       (job, contract.canonical(payload), sha, "queued", current["generation"], stamp, stamp))
            db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)",
                       (stamp, job, "queued", contract.canonical({"digest": sha, "generation": current["generation"], "kind": request["kind"]})))
        return {"id": job, "existing": False, "state": "queued"}

    def manifest_for(self, job_id):
        """Internal-only envelope preparation. No token creation or dispatch."""
        job_id = contract.hex_value(job_id, 32)
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise ValueError("unknown_job")
            payload = json.loads(row["payload"])
            profile, catalog_sha = self.catalog.select(payload["kind"], payload["worker_id"])
            expected = self.bound_payload(payload["kind"], payload["worker_id"], profile, catalog_sha, self.primary())
            if payload != expected or row["digest"] != contract.digest(payload) or row["generation"] != payload["generation"]:
                raise PermissionError("stored_job_identity_or_authority_changed")
            return self.manifest(job_id, payload)

    @staticmethod
    def public_job(row):
        value = {key: row[key] for key in PUBLIC_JOB_KEYS if key in row.keys()}
        payload = json.loads(row["payload"])
        kind = payload.get("kind")
        commit = payload.get("source_commit")
        value.update(kind=kind if type(kind) is str and kind in {"fixture-pass", "fixture-fail", "build", "test", "typecheck", "runtime-http-r0000-v1"} else "legacy",
                     source_commit=commit if type(commit) is str and re.fullmatch("[a-f0-9]{40}", commit) else None,
                     project_subdir=payload.get("project_subdir") if payload.get("project_subdir") in {"site", "."} else None,
                     paths={}, error=None)
        return value

    @staticmethod
    def number(value, default, maximum):
        if value is None:
            return default
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError("bounded_integer_required")
        return value

    def logs(self, request):
        if set(request) - {"action", "id", "offset", "metadata_only"} or "id" not in request:
            raise ValueError("exact_log_fields_required")
        job = contract.hex_value(request["id"], 32)
        offset = self.number(request.get("offset"), 0, log_redaction.MAX_LOG)
        if type(request.get("metadata_only", False)) is not bool:
            raise ValueError("boolean_metadata_only_required")
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
            if not row:
                raise ValueError("unknown_job")
            remote = json.loads(row["payload"]).get("backend") == contract.BACKEND
        empty = {"id": job, "offset": offset, "output": "", "available": False}
        if request.get("metadata_only"):
            return {**empty, "policy": "metadata_only"}
        if remote:
            if self.backend is None:
                return empty
            answer = self.backend.logs(self.manifest_for(job), offset=offset)
            if (type(answer) is not dict or answer.get("id") != job
                    or type(answer.get("output")) is not str or len(answer["output"].encode()) > 32768
                    or type(answer.get("offset")) is not int or not offset <= answer["offset"] <= offset + 32768):
                raise ValueError("bounded_remote_log_reply_required")
            return {"id": job, "offset": answer["offset"], "output": legacy.sanitize(answer["output"]), "available": True}
        if self.worker_root is None:
            return empty
        return log_access.read_log(self.worker_root, job, offset)

    def rpc(self, request):
        if type(request) is not dict or type(request.get("action")) is not str:
            raise ValueError("object_action_required")
        action = request["action"]
        if action == "submit":
            return self.submit(request)
        if action == "health":
            exact(request, {"action"})
            # Authority exposes only nonsecret status. Never return raw config.
            current = self.authority()
            with self.connect():
                pass
            return {"at": contract.now(), "authority": {key: current.get(key) for key in ("role", "effective_role", "generation")},
                    "boot_id": authority_guard.boot_id(), "root": None, "worker_root": None}
        if action == "status":
            exact(request, {"action", "id"})
            job = contract.hex_value(request["id"], 32)
            with self.connect() as db:
                row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
                if not row:
                    raise ValueError("unknown_job")
                return self.public_job(row)
        if action == "jobs":
            if set(request) - {"action", "limit", "after_seq"}:
                raise ValueError("unknown_read_field")
            limit = max(1, self.number(request.get("limit"), 50, 200))
            after = self.number(request.get("after_seq"), 0, 2**63-1)
            with self.connect() as db:
                rows = db.execute("SELECT * FROM jobs ORDER BY created_at DESC,id DESC LIMIT ?", (limit,)).fetchall()
                events = db.execute("SELECT seq,at,job_id,kind FROM events WHERE seq>? ORDER BY seq LIMIT 500", (after,)).fetchall()
                # Preserve event sequence and references; free-form data stays private.
                public_events = [{**dict(row), "data": {}} for row in events]
                return {"jobs": [self.public_job(row) for row in rows], "events": public_events,
                        "authority": {key: self.authority().get(key) for key in ("role", "effective_role", "generation")}}
        if action == "logs":
            return self.logs(request)
        raise PermissionError("public_action_not_qualified")
