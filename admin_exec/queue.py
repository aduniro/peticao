"""Local durable coordination only. This module never executes or sends a job."""
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import json
import os
import sqlite3
import stat
import time
import uuid

from protocol import JobSpec, ValidationError, canonical_json, canonical_sha256, validate_config, validate_job, validate_ready, validate_result, uuid4

APPLICATION_ID = 0x41563251

class QueueError(RuntimeError):
    pass

@dataclass(frozen=True)
class CompletionReceipt:
    job_id: str
    claim_id: str
    generation: int
    worker_id: str
    version: int
    payload_sha256: str
    result_sha256: str
    job: dict
    result: dict
    artifact_root: str

class Queue:
    def __init__(self, path, config, clock=time.time):
        validated = validate_config(config)
        self.path = Path(path).resolve()
        if self.path != Path(validated["state_path"]).resolve(): raise ValidationError("queue_path_must_match_validated_config")
        self._config_json = canonical_json(validated)
        self.clock = clock

    @property
    def config(self):
        return json.loads(self._config_json)

    @contextmanager
    def _write(self):
        validate_config(self.config)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if stat.S_IMODE(self.path.parent.stat().st_mode) & 0o077:
            raise QueueError("queue_directory_must_already_be_private")
        existed = self.path.exists()
        if existed:
            if not self.path.is_file() or stat.S_IMODE(self.path.stat().st_mode) & 0o077:
                raise QueueError("queue_file_must_be_private")
            probe = sqlite3.connect(self.path.resolve().as_uri()+"?mode=ro", uri=True)
            try:
                if probe.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
                    raise QueueError("foreign_database_not_modified")
            finally:
                probe.close()
        else:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        c = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        c.row_factory = sqlite3.Row
        if not existed:
            c.execute(f"PRAGMA application_id={APPLICATION_ID}")
        try:
            c.executescript("""PRAGMA foreign_keys=ON;
              CREATE TABLE IF NOT EXISTS jobs(
                job_id TEXT PRIMARY KEY,intent_id TEXT UNIQUE NOT NULL,execution_sha256 TEXT NOT NULL,payload_sha256 TEXT NOT NULL,
                payload TEXT NOT NULL,worker_id TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,generation INTEGER NOT NULL,
                claim_id TEXT,lease_until REAL,process_ref TEXT,phase TEXT,created_at REAL NOT NULL,updated_at REAL NOT NULL,
                result_sha256 TEXT,result TEXT,reason TEXT,started_at REAL);
              CREATE TABLE IF NOT EXISTS ready(worker_id TEXT PRIMARY KEY,handshake_id TEXT NOT NULL,payload TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,job_id TEXT NOT NULL,version INTEGER NOT NULL,event TEXT NOT NULL,at REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS heartbeat_receipts(message_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,digest TEXT NOT NULL);
            """)
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    @contextmanager
    def _read(self):
        validate_config(self.config)
        if not self.path.is_file():
            yield None
            return
        c = sqlite3.connect(self.path.resolve().as_uri()+"?mode=ro", uri=True, timeout=5)
        c.row_factory = sqlite3.Row
        try:
            c.execute("PRAGMA query_only=ON")
            if c.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
                raise QueueError("foreign_database_not_modified")
            c.execute("BEGIN")
            yield c
        finally:
            c.rollback(); c.close()

    def _row(self, c, job_id):
        r = c.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if r is None: raise QueueError("job_not_found")
        return dict(r)

    def _public(self, row):
        r = dict(row)
        r.pop("payload", None); r.pop("result", None)
        if r.get("process_ref"): r["process_ref"] = json.loads(r["process_ref"])
        expired = self._expiry_reason(row) is not None
        r["effective_status"] = "uncertain" if expired else r["status"]
        r["active_lease"] = r["status"] in ("claimed", "running") and not expired
        r["review_required"] = r["status"] == "completed"
        return r

    def _event(self, c, row, event):
        c.execute("INSERT INTO events(job_id,version,event,at)VALUES(?,?,?,?)", (row["job_id"], row["version"], event, self.clock()))

    def _expiry_reason(self, row):
        if row["status"] not in ("claimed","running"): return None
        if row["lease_until"] <= self.clock(): return "lease_expired_no_automatic_retry"
        if row["status"] == "running" and row.get("started_at") is not None and self.clock() - row["started_at"] >= json.loads(row["payload"])["resources"]["timeout_seconds"]:
            return "execution_timeout_no_automatic_retry"
        return None

    def _expire(self, c, row):
        reason = self._expiry_reason(row)
        if reason:
            c.execute("UPDATE jobs SET status='uncertain',version=version+1,lease_until=NULL,reason=?,updated_at=? WHERE job_id=? AND version=?", (reason,self.clock(), row["job_id"], row["version"]))
            row = self._row(c, row["job_id"]); self._event(c, row, "expired_uncertain")
        return row

    def _cas(self, row, expected_version):
        if type(expected_version) is not int or expected_version != row["version"]:
            raise QueueError("version_conflict_read_state_before_retry")

    def _claim_owner(self, row, claim_id, generation):
        if claim_id != row["claim_id"] or not uuid4(claim_id) or type(generation) is not int or generation != row["generation"]:
            raise QueueError("claim_or_generation_mismatch")

    def _current_ready(self, c, worker_id):
        if not self.config["execution_enabled"] or not self.config["hosts"][worker_id]["enabled"]:
            raise QueueError("activation_disabled")
        raw = c.execute("SELECT payload FROM ready WHERE worker_id=?", (worker_id,)).fetchone()
        if raw is None: raise QueueError("ready_handshake_required")
        try: return validate_ready(json.loads(raw["payload"]), self.config, self.clock())
        except ValidationError: raise QueueError("ready_handshake_expired_or_mismatch") from None

    def enqueue(self, spec):
        if not isinstance(spec, JobSpec): raise ValidationError("validated_job_required")
        spec = validate_job(spec.data, self.config); job = spec.data
        with self._write() as c:
            existing = c.execute("SELECT * FROM jobs WHERE job_id=? OR intent_id=?", (job["job_id"], job["intent_id"])).fetchall()
            if existing:
                if len(existing) != 1: raise QueueError("job_and_intent_conflict")
                row = dict(existing[0])
                if row["job_id"] == job["job_id"] and row["payload_sha256"] != spec.payload_sha256 or row["execution_sha256"] != spec.execution_sha256:
                    raise QueueError("idempotency_payload_conflict")
                return {"ok": True, "created": False, "job": self._public(row)}
            now = self.clock()
            c.execute("INSERT INTO jobs(job_id,intent_id,execution_sha256,payload_sha256,payload,worker_id,status,version,generation,created_at,updated_at)VALUES(?,?,?,?,?,?,'ready',1,0,?,?)", (job["job_id"],job["intent_id"],spec.execution_sha256,spec.payload_sha256,spec.canonical_json,job["target_worker"],now,now))
            row=self._row(c,job["job_id"]);self._event(c,row,"enqueued_local_only")
            return {"ok":True,"created":True,"job":self._public(row)}

    def register_ready(self, raw):
        if not isinstance(raw,dict) or raw.get("worker_id")!="santiago":raise QueueError("only_santiago_can_register_as_job_worker")
        h=validate_ready(raw,self.config,self.clock())
        with self._write() as c:
            old=c.execute("SELECT payload FROM ready WHERE worker_id=?",(h["worker_id"],)).fetchone()
            if old and json.loads(old["payload"])["issued_at"]>h["issued_at"]:raise QueueError("older_ready_cannot_replace_newer")
            if old and json.loads(old["payload"])["handshake_id"]==h["handshake_id"] and old["payload"]!=canonical_json(h):raise QueueError("ready_id_payload_conflict")
            c.execute("INSERT INTO ready(worker_id,handshake_id,payload)VALUES(?,?,?) ON CONFLICT(worker_id)DO UPDATE SET handshake_id=excluded.handshake_id,payload=excluded.payload",(h["worker_id"],h["handshake_id"],canonical_json(h)))
        return {"ok":True,"worker_id":h["worker_id"],"expires_at":h["expires_at"],"execution_enabled":self.config["execution_enabled"],"remote_identity_verified_by_this_tool":False}

    def claim(self, job_id, worker_id, expected_version):
        if worker_id!="santiago":raise QueueError("worker_role_forbidden")
        with self._write() as c:
            row=self._row(c,job_id);row=self._expire(c,row)
            if row["status"]=="uncertain":return {"ok":False,"reason":"uncertain_requires_reconciliation","job":self._public(row)}
            self._cas(row,expected_version)
            if row["worker_id"]!=worker_id or row["status"]!="ready":raise QueueError("job_not_claimable")
            self._current_ready(c,worker_id)
            active=c.execute("SELECT job_id FROM jobs WHERE worker_id=? AND status IN('claimed','running','uncertain')",(worker_id,)).fetchone()
            if active:raise QueueError("worker_busy_or_uncertain")
            claim_id=str(uuid.uuid4());now=self.clock()
            c.execute("UPDATE jobs SET status='claimed',claim_id=?,generation=generation+1,version=version+1,lease_until=?,phase='claimed',updated_at=? WHERE job_id=? AND version=?",(claim_id,now+self.config["limits"]["lease_seconds"],now,job_id,row["version"]))
            row=self._row(c,job_id);self._event(c,row,"claimed_not_execution")
            return {"ok":True,"job":self._public(row)}

    def start(self, job_id, claim_id, generation, expected_version, process_ref):
        if not isinstance(process_ref,dict) or set(process_ref)!={"host","pid","session_id"} or process_ref["host"]!="santiago" or type(process_ref["pid"])is not int or process_ref["pid"]<1 or not uuid4(process_ref["session_id"]):raise QueueError("invalid_owned_process_reference")
        with self._write() as c:
            row=self._expire(c,self._row(c,job_id))
            if row["status"]=="uncertain":return {"ok":False,"reason":"lease_expired_uncertain","job":self._public(row)}
            self._cas(row,expected_version);self._claim_owner(row,claim_id,generation)
            if row["status"]!="claimed":raise QueueError("job_not_startable")
            self._current_ready(c,row["worker_id"])
            c.execute("UPDATE jobs SET status='running',version=version+1,process_ref=?,phase='preparing',started_at=?,updated_at=? WHERE job_id=? AND version=?",(canonical_json(process_ref),self.clock(),self.clock(),job_id,row["version"]))
            row=self._row(c,job_id);self._event(c,row,"worker_reported_started")
            return {"ok":True,"job":self._public(row)}

    def heartbeat(self, job_id, claim_id, generation, expected_version, message_id, phase):
        if not uuid4(message_id) or phase not in ("claimed","preparing","building","testing","collecting"):raise QueueError("invalid_heartbeat")
        digest=canonical_sha256([job_id,claim_id,generation,expected_version,message_id,phase])
        with self._write() as c:
            row=self._expire(c,self._row(c,job_id))
            self._claim_owner(row,claim_id,generation)
            prior=c.execute("SELECT * FROM heartbeat_receipts WHERE message_id=?",(message_id,)).fetchone()
            if prior:
                if prior["job_id"]!=job_id or prior["digest"]!=digest:raise QueueError("heartbeat_id_conflict")
                return {"ok":row["status"] in ("claimed","running"),"duplicate":True,"job":self._public(row)}
            if row["status"]=="uncertain":return {"ok":False,"reason":"lease_expired_uncertain","job":self._public(row)}
            self._cas(row,expected_version)
            if row["status"] not in ("claimed","running"):raise QueueError("terminal_job_no_heartbeat")
            self._current_ready(c,row["worker_id"])
            now=self.clock();c.execute("UPDATE jobs SET version=version+1,lease_until=?,phase=?,updated_at=? WHERE job_id=? AND version=?",(now+self.config["limits"]["lease_seconds"],phase,now,job_id,row["version"]))
            c.execute("INSERT INTO heartbeat_receipts VALUES(?,?,?)",(message_id,job_id,digest))
            return {"ok":True,"duplicate":False,"job":self._public(self._row(c,job_id))}

    def finish(self, job_id, claim_id, generation, expected_version, raw_result):
        with self._write() as c:
            row=self._expire(c,self._row(c,job_id));self._claim_owner(row,claim_id,generation)
            if row["status"]=="uncertain":return {"ok":False,"reason":"late_result_not_accepted","job":self._public(row)}
            spec=validate_job(json.loads(row["payload"]),self.config)
            result=validate_result(spec,raw_result,self.config,self.config["artifact_root"],True)
            if result["claim_id"]!=claim_id or result["generation"]!=generation:raise QueueError("result_claim_mismatch")
            digest=canonical_sha256(result)
            row=self._expire(c,self._row(c,job_id))
            if row["status"]=="uncertain":return {"ok":False,"reason":"result_validation_outlived_lease","job":self._public(row)}
            if row["status"] in ("completed","failed"):
                if row["result_sha256"]!=digest:raise QueueError("conflicting_final_result")
                return {"ok":True,"duplicate":True,"job":self._public(row)}
            self._cas(row,expected_version)
            if row["status"]!="running":raise QueueError("job_not_running")
            self._current_ready(c,row["worker_id"])
            state="completed" if result["exit_code"]==0 else "failed"
            c.execute("UPDATE jobs SET status=?,version=version+1,lease_until=NULL,result_sha256=?,result=?,phase='finished',updated_at=? WHERE job_id=? AND version=?",(state,digest,canonical_json(result),self.clock(),job_id,row["version"]))
            row=self._row(c,job_id);self._event(c,row,"result_received_review_required")
            return {"ok":True,"duplicate":False,"job":self._public(row)}

    def expire(self, job_id):
        with self._write() as c:return self._public(self._expire(c,self._row(c,job_id)))

    def status(self, job_id=None):
        with self._read() as c:
            if c is None:return {"exists":False,"execution_enabled":self.config["execution_enabled"],"jobs":[]}
            rows=[self._row(c,job_id)] if job_id else [dict(r)for r in c.execute("SELECT * FROM jobs ORDER BY created_at,job_id")]
            return {"exists":True,"execution_enabled":self.config["execution_enabled"],"jobs":[self._public(r)for r in rows]}

    def completed_receipt(self, job_id):
        with self._read() as c:
            if c is None:raise QueueError("job_not_found")
            row=self._row(c,job_id)
            if row["status"]!="completed" or row["lease_until"]is not None:raise QueueError("completed_verified_job_required")
            job=validate_job(json.loads(row["payload"]),self.config)
            if job.payload_sha256!=row["payload_sha256"] or job.execution_sha256!=row["execution_sha256"]:raise QueueError("stored_job_digest_mismatch")
            result=validate_result(job,json.loads(row["result"]),self.config,self.config["artifact_root"],True)
            if canonical_sha256(result)!=row["result_sha256"] or result["claim_id"]!=row["claim_id"] or result["generation"]!=row["generation"] or result["exit_code"]!=0:raise QueueError("stored_result_mismatch")
            return CompletionReceipt(job_id,row["claim_id"],row["generation"],row["worker_id"],row["version"],row["payload_sha256"],row["result_sha256"],job.data,result,self.config["artifact_root"])
