#!/usr/bin/env python3
"""Execution claims inside the existing coordinator SQLite database.

No queue, daemon, automatic retry or job execution. The Kubernetes backend must
reserve BEFORE create, attest the observed Job/Pod owner UIDs, then authorize
the runner once. A lost response is queried by the same ID, never replayed.
"""
import contextlib
import datetime
import hashlib
import hmac
import json
import re
import sqlite3


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class Claims:
    def __init__(self, existing_queue):
        self.path = existing_queue
        # Refuse to create an accidental second queue.
        with self.db() as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").fetchone():
                raise ValueError('existing_coordinator_queue_required')
            db.execute('''CREATE TABLE IF NOT EXISTS kubernetes_execution_claims(
                job_id TEXT PRIMARY KEY REFERENCES jobs(id),
                generation INTEGER NOT NULL, manifest_sha256 TEXT NOT NULL,
                token_sha256 TEXT NOT NULL, reserved_at TEXT NOT NULL,
                job_uid TEXT, pod_uid TEXT, started_at TEXT,
                cancel_requested_at TEXT, result_sha256 TEXT, finished_at TEXT)''')

    @contextlib.contextmanager
    def db(self, write=False):
        db = sqlite3.connect('file:' + str(self.path) + '?mode=rw', uri=True, timeout=15,
                             isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def reserve(self, job_id, generation, manifest_sha256, token):
        if not re.fullmatch('[a-f0-9]{32}', job_id) or not re.fullmatch('[a-f0-9]{64}', manifest_sha256):
            raise ValueError('invalid_identity')
        if not isinstance(token, str) or len(token) < 64:
            raise ValueError('strong_per_job_token_required')
        token_sha = hashlib.sha256(token.encode()).hexdigest()
        with self.db(True) as db:
            job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not job or job['generation'] != generation:
                raise ValueError('existing_job_and_current_generation_required')
            if json.loads(job['payload']).get('backend') != 'kubernetes-v1':
                raise ValueError('kubernetes_job_required')
            prior = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            if prior:
                if prior['generation'] != generation or prior['manifest_sha256'] != manifest_sha256 or not hmac.compare_digest(prior['token_sha256'], token_sha):
                    raise ValueError('job_identity_mismatch')
                return False
            if job['state'] not in ('queued', 'starting'):
                raise ValueError('job_not_admissible')
            db.execute('INSERT INTO kubernetes_execution_claims(job_id,generation,manifest_sha256,token_sha256,reserved_at) VALUES(?,?,?,?,?)',
                       (job_id, generation, manifest_sha256, token_sha, now()))
            return True

    def bind_job(self, job_id, generation, manifest_sha256, observed_job_uid):
        """Caller must GET the actual fixed-name Job and verify its annotations."""
        if not isinstance(observed_job_uid, str) or not observed_job_uid or len(observed_job_uid) > 128:
            raise ValueError('observed_job_uid_required')
        with self.db(True) as db:
            row = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            if not row or row['generation'] != generation or row['manifest_sha256'] != manifest_sha256:
                raise ValueError('reservation_mismatch')
            if row['job_uid'] and row['job_uid'] != observed_job_uid:
                raise ValueError('job_recreated_requires_reconciliation')
            db.execute('UPDATE kubernetes_execution_claims SET job_uid=? WHERE job_id=?', (observed_job_uid, job_id))

    def start_once(self, job_id, generation, token, job_uid, pod_uid):
        """Caller must authenticate runner and attest Pod UID and controller owner."""
        if not isinstance(pod_uid, str) or not pod_uid or len(pod_uid) > 128:
            raise ValueError('attested_pod_uid_required')
        with self.db(True) as db:
            row = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            job = db.execute('SELECT state,generation FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or not job or not isinstance(token, str) or not hmac.compare_digest(row['token_sha256'], hashlib.sha256(token.encode()).hexdigest()):
                raise PermissionError('invalid_execution_token')
            if generation != row['generation'] or generation != job['generation'] or not job_uid or row['job_uid'] != job_uid:
                raise PermissionError('execution_identity_mismatch')
            if row['started_at'] or row['cancel_requested_at'] or row['finished_at'] or job['state'] not in ('starting', 'running'):
                return False
            db.execute('UPDATE kubernetes_execution_claims SET pod_uid=?,started_at=? WHERE job_id=?', (pod_uid, now(), job_id))
            return True

    def cancel(self, job_id):
        with self.db(True) as db:
            db.execute('UPDATE kubernetes_execution_claims SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE job_id=?', (now(), job_id))

    def finish(self, job_id, pod_uid, result_sha256):
        if not re.fullmatch('[a-f0-9]{64}', result_sha256):
            raise ValueError('result_digest_required')
        with self.db(True) as db:
            row = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            if not row or not row['started_at'] or row['pod_uid'] != pod_uid:
                raise PermissionError('only_started_pod_can_finish')
            if row['result_sha256'] and row['result_sha256'] != result_sha256:
                raise ValueError('conflicting_result_requires_reconciliation')
            db.execute('UPDATE kubernetes_execution_claims SET result_sha256=?,finished_at=COALESCE(finished_at,?) WHERE job_id=?', (result_sha256, now(), job_id))

    def status(self, job_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM kubernetes_execution_claims WHERE job_id=?', (job_id,)).fetchone()
            return {key: row[key] for key in row.keys() if key != 'token_sha256'} if row else None
