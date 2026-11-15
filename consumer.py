"""SOURCE PREPARATION ONLY. Internal one-step consumer of the canonical queue.

No loop, admission API, host adapter, subprocess or second queue. install_schema
is an explicit future migration draft and is never called by construction.
The retirement wire/ACK below is a PENDING contract, not a qualified broker.
Every uncertain mutation retains the same node slot; operator reconciliation is
required, never a retry of prepare/dispatch/finish/retire. Launch secrets remain
in TokenStore and internal calls only. No public action accepts these methods.
"""
from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
import json
from pathlib import Path
import sqlite3

# Frozen runtime modules must be selected by the embedding process, not loaded
# by modifying sys.path here. launch_tokens is the frozen 3127 implementation.
import remote_contract as contract
from controller import Finalizer
from launch_tokens import LaunchSecret

TERMINAL = {"completed", "failed", "canceled"}
TABLE = "canonical_consumer_slots"


class ConsumerPending(RuntimeError):
    """A generic redacted error; the durable intent continues to own the slot."""


@dataclass(frozen=True)
class RetirementRequest:
    """Internal typed pending-wire request; NEVER serialize token or use argv.

    Provider may internally send exactly action=retire, manifest, token,
    receipt_sha256, bundle_sha256, custody_receipt_sha256. Worker validation,
    durable exclusive cleanup intent, Unref and retained receipt are Infra work.
    """
    manifest: dict
    token: LaunchSecret = field(repr=False)
    receipt_sha256: str
    bundle_sha256: str
    custody_receipt_sha256: str


def _json(value):
    return contract.canonical(value)


class Consumer:
    def __init__(self, queue, facade, token_store, backend, custody_provider=None,
                 retire_provider=None, *, queue_validator=contract.private_file,
                 authority_validator=None, paired_guard=None, retirement_observer=None):
        self.queue = Path(queue).absolute()
        if self.queue != Path(facade.queue).absolute() or self.queue != Path(backend.claims.path).absolute():
            raise ValueError("same_canonical_queue_required")
        self.facade, self.tokens, self.backend = facade, token_store, backend
        self.custody_provider = custody_provider
        self.retire_provider = retire_provider
        self.retirement_observer = retirement_observer
        self.queue_validator = queue_validator
        self.paired_guard = paired_guard
        # Optional test-only seam; production uses Claims._identity, including
        # the externally stored authority/floor and exact payload binding.
        self.authority_validator = authority_validator

    @contextlib.contextmanager
    def _db(self, write=False, schema=True):
        path = Path(self.queue_validator(self.queue)).absolute()
        if path != self.queue:
            raise PermissionError("queue_validator_changed_identity")
        db = sqlite3.connect(path.as_uri() + ("?mode=rw" if write else "?mode=ro"),
                             uri=True, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA synchronous=FULL" if write else "PRAGMA query_only=ON")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            for name in ("jobs", "events", "remote_execution_claims") + ((TABLE,) if schema else ()):
                if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone():
                    raise ConsumerPending("explicit_existing_queue_schema_required")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def install_schema(self, expected_generation):
        """Explicit opt-in migration, SAME DB; preserve every old row/event."""
        with self._db(True, schema=False) as db:
            current = self.facade.primary()
            if current["generation"] != expected_generation:
                raise PermissionError("current_generation_required")
            self.backend.claims.authority.require(expected_generation)
            db.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE}(
                job_id TEXT PRIMARY KEY REFERENCES jobs(id), generation INTEGER NOT NULL,
                manifest_sha256 TEXT NOT NULL, worker_id TEXT NOT NULL,
                backend TEXT NOT NULL, state TEXT NOT NULL,
                active INTEGER NOT NULL CHECK(active IN (0,1)),
                start_intent TEXT, finish_intent TEXT, retire_intent TEXT,
                custody_json TEXT, custody_sha256 TEXT, ack_json TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            db.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS canonical_consumer_one_slot ON {TABLE}(worker_id) WHERE active=1")

    def _bound(self, db, job_id):
        contract.hex_value(job_id, 32)
        job = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if job is None:
            raise ValueError("existing_job_required")
        payload = json.loads(job["payload"])
        manifest = self.facade.manifest(job_id, payload)
        if self.paired_guard is None:
            raise ConsumerPending("paired_legacy_successor_guard_required")
        self.paired_guard.check(db, manifest["worker_id"])
        current = self.facade.primary()
        for left, right in (("generation", "generation"), ("coordinator_host", "coordinator_host"),
                            ("armed_boot_id", "coordinator_boot_id"),
                            ("authority_operation_id", "authority_operation_id"), ("epoch_sha256", "epoch_sha256")):
            if current.get(left) != manifest.get(right):
                raise PermissionError("current_authority_identity_required")
        profile, catalog_sha = self.facade.catalog.select(payload["kind"], payload["worker_id"])
        if payload.get("catalog_sha256") != catalog_sha or any(payload.get(k) != v for k, v in profile.items()):
            raise PermissionError("current_qualified_profile_identity_required")
        if self.authority_validator is None:
            _, claim, _ = self.backend.claims._identity(db, manifest)
        else:
            self.authority_validator(db, manifest)
            claim = db.execute("SELECT * FROM remote_execution_claims WHERE job_id=?", (job_id,)).fetchone()
        slot = db.execute(f"SELECT * FROM {TABLE} WHERE job_id=?", (job_id,)).fetchone()
        if slot and (slot["generation"] != manifest["generation"] or slot["manifest_sha256"] != contract.digest(manifest)
                     or slot["worker_id"] != manifest["worker_id"] or slot["backend"] != contract.BACKEND):
            raise PermissionError("slot_identity_mismatch")
        return job, manifest, claim, slot

    def _effect_guard(self, job_id):
        with self._db() as db:
            return self._bound(db, job_id)[1]

    @staticmethod
    def _no_other_active(db, job_id, worker_id):
        # First successor has one local legacy executor on Civo. Remote jobs
        # bind their own node; a Civo legacy process must not block Akamai.
        for row in db.execute("SELECT payload FROM jobs WHERE id<>? AND state IN ('starting','running')", (job_id,)):
            payload = json.loads(row["payload"])
            if payload.get("backend") == contract.BACKEND:
                node = payload.get("worker_id")
                if node not in contract.WORKERS:
                    raise ConsumerPending("active_remote_job_node_unknown")
            else:
                node = "civo"
            if node == worker_id:
                raise ConsumerPending("legacy_or_remote_active_job_blocks_start")

    def _start_guard(self, job_id):
        with self._db() as db:
            manifest = self._bound(db, job_id)[1]
            self._no_other_active(db, job_id, manifest["worker_id"])
            return manifest

    @staticmethod
    def _metadata(job, manifest, slot):
        return {"job_id": job["id"], "generation": manifest["generation"],
                "manifest_sha256": contract.digest(manifest), "job_state": job["state"],
                "slot_state": slot["state"] if slot else "unreserved",
                "slot_retained": bool(slot and slot["active"]),
                "retirement_contract": "pending_infra_freeze"}

    def _metadata_now(self, job_id):
        with self._db() as db:
            job, manifest, _, slot = self._bound(db, job_id)
            return self._metadata(job, manifest, slot)

    def _event(self, db, job_id, kind, value):
        db.execute("INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)",
                   (contract.now(), job_id, kind, _json(value)))

    def start(self, job_id):
        with self._db(True) as db:
            job, manifest, claim, slot = self._bound(db, job_id)
            if slot:
                existing = True
            else:
                existing = False
            if not existing and db.execute(f"SELECT 1 FROM {TABLE} WHERE active=1 AND worker_id=?", (manifest["worker_id"],)).fetchone():
                raise ConsumerPending("node_slot_occupied")
            # Every legacy remote claim without a consumer record needs explicit
            # retirement too; terminal state alone is never evidence of cleanup.
            legacy = db.execute(f"SELECT 1 FROM remote_execution_claims c LEFT JOIN {TABLE} s ON s.job_id=c.job_id WHERE c.job_id<>? AND c.worker_id=? AND (s.job_id IS NULL OR s.active=1) LIMIT 1", (job_id, manifest["worker_id"])).fetchone()
            if not existing and legacy:
                raise ConsumerPending("legacy_claim_requires_same_job_reconciliation")
            if not existing and not claim and job["state"] != "queued":
                raise ConsumerPending("nonqueued_job_observe_only")
            if not existing:
                self._no_other_active(db, job_id, manifest["worker_id"])
                state = "observe_same_id" if claim else "starting_uncertain"
                instant = contract.now()
                db.execute(f"INSERT INTO {TABLE}(job_id,generation,manifest_sha256,worker_id,backend,state,active,start_intent,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)",
                           (job_id, manifest["generation"], contract.digest(manifest), manifest["worker_id"], contract.BACKEND, state, instant, instant, instant))
                self._event(db, job_id, "consumer_slot_reserved", {"manifest_sha256": contract.digest(manifest)})
        if existing or claim:
            if slot and not slot["active"]:
                return self._metadata_now(job_id)
            return self.observe(job_id)
        try:
            self._start_guard(job_id)
            secret = self.tokens.prepare(manifest)  # durable BEFORE Claims.reserve
            self._start_guard(job_id)
            self.backend.dispatch(manifest, secret.value_for_dispatch())
        except Exception:
            raise ConsumerPending("start_uncertain_observe_same_id_no_replay") from None
        with self._db(True) as db:
            self._bound(db, job_id)
            db.execute(f"UPDATE {TABLE} SET state='dispatched',updated_at=? WHERE job_id=?", (contract.now(), job_id))
        return self._metadata_now(job_id)

    def observe(self, job_id):
        manifest = self._effect_guard(job_id)
        # Backend.observe may persist note_running. Discard its untrusted reply;
        # raw worker output and token-bearing messages are never public metadata.
        try:
            self.backend.observe(manifest)
        except Exception:
            raise ConsumerPending("same_id_observation_pending") from None
        return self._metadata_now(job_id)

    def finish(self, job_id, cancel=False):
        if type(cancel) is not bool:
            raise ValueError("boolean_cancel_required")
        with self._db(True) as db:
            job, manifest, _, slot = self._bound(db, job_id)
            if not slot or not slot["active"]:
                raise ConsumerPending("active_same_job_slot_required")
            if slot["finish_intent"] or slot["retire_intent"]:
                return self._metadata(job, manifest, slot)
            db.execute(f"UPDATE {TABLE} SET finish_intent=?,state='finish_uncertain',updated_at=? WHERE job_id=?",
                       (_json({"at": contract.now(), "cancel": cancel}), contract.now(), job_id))
            self._event(db, job_id, "consumer_finish_intent", {"cancel": cancel})
        try:
            self._effect_guard(job_id)
            self.backend.finish(manifest, cancel=cancel)
            self._attest(job_id)
        except Exception:
            raise ConsumerPending("finish_or_custody_pending_slot_retained_no_replay") from None
        return self._metadata_now(job_id)

    def _attest(self, job_id):
        with self._db() as db:
            job, manifest, claim, slot = self._bound(db, job_id)
            if (not slot or not slot["active"] or job["state"] not in TERMINAL or not claim
                    or claim["phase"] != job["state"]):
                raise ConsumerPending("coherent_terminal_claim_and_retained_slot_required")
            # Prestart cancellation has no invocation/bundle and must use a
            # separate future reconciliation, never backing retirement.
            if not claim["invocation_id"] or not claim["result_json"]:
                raise ConsumerPending("started_invocation_and_complete_finalizer_result_required")
            result = json.loads(claim["result_json"])
            if _json(result) != claim["result_json"]:
                raise PermissionError("canonical_finalizer_result_required")
            receipt = json.loads(claim["receipt_json"])
            identity = {"job_id": job_id, "generation": manifest["generation"],
                        "manifest_sha256": contract.digest(manifest), "receipt_sha256": claim["receipt_sha256"],
                        "invocation_id": claim["invocation_id"], "worker_boot_id": receipt["boot_id"]}
            contract.hex_value(identity["invocation_id"], 32)
            if contract.digest(receipt) != identity["receipt_sha256"]:
                raise PermissionError("bound_receipt_required")
            Finalizer(self.backend.claims, None).validate_result(manifest, receipt, identity, result)
            if result["outcome"] != job["state"]:
                raise PermissionError("result_outcome_must_match_terminal_claim_and_job")
        self._effect_guard(job_id)
        provider = self.custody_provider or self.backend.finalizer.store.observe
        custody = provider(dict(identity))
        if (custody.get("state") != "verified" or custody.get("identity") != identity
                or custody.get("result") != result):
            raise ConsumerPending("verified_actual_custody_identity_and_result_required")
        wire = contract.hex_value(custody.get("wire_sha256"), 64)
        index = contract.hex_value(custody.get("index_sha256"), 64)
        # V4's SAME-DB accepted terminal event is mandatory, including its
        # result hash, original bundle wire and artifact index proof.
        with self._db() as db:
            current_job, _, current_claim, _ = self._bound(db, job_id)
            if (current_job["state"] != result["outcome"] or current_claim["phase"] != result["outcome"]
                    or current_claim["result_json"] != _json(result)):
                raise PermissionError("terminal_result_changed_during_custody_verification")
            result_sha = contract.digest(result)
            proofs = db.execute("SELECT data FROM events WHERE job_id=? AND kind=? ORDER BY seq DESC",
                                (job_id, "remote_" + result["outcome"])).fetchall()
            proof = None
            for row in proofs:
                value = json.loads(row["data"])
                if type(value) is dict and value.get("result_sha256") == result_sha:
                    proof = value
                    break
            if not proof or proof.get("wire_sha256") != wire or proof.get("artifact_index_sha256") != index:
                raise PermissionError("mandatory_accepted_result_wire_index_custody_proof_required")
        # This explicit durable attestation binds ArtifactStore's verified files,
        # index and original wire. Its digest is the pending retirement receipt.
        attestation = {"version": 1, "identity": identity, "bundle_sha256": wire,
                       "index_sha256": index, "artifact_custody_verified": True}
        with self._db(True) as db:
            _, _, _, slot = self._bound(db, job_id)
            if slot["custody_json"]:
                if slot["custody_json"] != _json(attestation):
                    raise PermissionError("custody_attestation_changed")
                return attestation
            if not slot["active"] or slot["retire_intent"]:
                raise ConsumerPending("retirement_already_in_progress_observe_only")
            db.execute(f"UPDATE {TABLE} SET custody_json=?,custody_sha256=?,state='custody_verified',updated_at=? WHERE job_id=?",
                       (_json(attestation), contract.digest(attestation), contract.now(), job_id))
        return attestation

    def retire(self, job_id):
        with self._db() as db:
            job, manifest, _, slot = self._bound(db, job_id)
            if not slot or not slot["active"] or slot["retire_intent"]:
                # Lost ACK, failed cleanup, repeated retirement: read only.
                return self._metadata(job, manifest, slot)
        if self.retire_provider is None:
            raise ConsumerPending("retirement_provider_pending_infra_slot_retained")
        try:
            attestation = self._attest(job_id)
            with self._db(True) as db:
                _, _, claim, slot = self._bound(db, job_id)
                if not slot["active"] or slot["retire_intent"]:
                    return self._metadata_now_after_transaction(job_id, db)
                if contract.digest(attestation) != slot["custody_sha256"]:
                    raise PermissionError("durable_custody_attestation_digest_required")
                db.execute(f"UPDATE {TABLE} SET retire_intent=?,state='retirement_uncertain',updated_at=? WHERE job_id=?",
                           (contract.now(), contract.now(), job_id))
                self._event(db, job_id, "consumer_retirement_intent", {"custody_receipt_sha256": slot["custody_sha256"]})
                custody_sha = slot["custody_sha256"]
            self._effect_guard(job_id)
            secret = self.tokens.load(manifest)
            if secret.sha256() != claim["token_sha256"]:
                raise PermissionError("bound_launch_secret_required")
            request = RetirementRequest(dict(manifest), secret, claim["receipt_sha256"],
                                        attestation["bundle_sha256"], custody_sha)
            self._effect_guard(job_id)
            ack = self.retire_provider(request)
            self._accept_retirement_ack(job_id, request, attestation, ack)
        except Exception:
            raise ConsumerPending("retirement_pending_slot_retained_no_replay") from None
        return self._metadata_now(job_id)

    def _accept_retirement_ack(self, job_id, request, attestation, ack):
        expected = {"state": "retired", **attestation["identity"],
                    "bundle_sha256": request.bundle_sha256,
                    "custody_receipt_sha256": request.custody_receipt_sha256,
                    "storage_retained": True, "mount_absent": True, "reference_released": True}
        if (type(ack) is not dict or set(ack) != set(expected)
                or any(type(ack[k]) is not type(v) or ack[k] != v for k, v in expected.items())):
            raise ConsumerPending("exact_verified_storage_retained_retirement_ack_required")
        with self._db(True) as db:
            _, _, _, slot = self._bound(db, job_id)
            if (not slot or not slot["retire_intent"] or slot["custody_sha256"] != request.custody_receipt_sha256
                    or slot["custody_json"] != _json(attestation)):
                raise PermissionError("durable_matching_retirement_and_custody_required")
            if not slot["active"]:
                if slot["ack_json"] != _json(expected):
                    raise PermissionError("retained_retirement_ack_changed")
                return
            db.execute(f"UPDATE {TABLE} SET ack_json=?,state='retired',active=0,updated_at=? WHERE job_id=?",
                       (_json(expected), contract.now(), job_id))
            self._event(db, job_id, "consumer_slot_retired", {"custody_receipt_sha256": request.custody_receipt_sha256})

    def retirement(self, job_id):
        """PENDING read-only worker receipt observation, never cleanup replay.

        Only an authenticated provider reading the retained bound receipt may
        answer the same exact ACK. An uncertain/no_replay reply retains the slot.
        The coordinator persists the ACK locally after authority/peer rechecks.
        """
        with self._db() as db:
            job, manifest, claim, slot = self._bound(db, job_id)
            if not slot or not slot["active"]:
                return self._metadata(job, manifest, slot)
            if not slot["retire_intent"] or not slot["custody_json"] or not slot["custody_sha256"]:
                raise ConsumerPending("existing_retirement_intent_and_custody_required")
        if self.retirement_observer is None:
            raise ConsumerPending("retirement_observer_pending_infra_slot_retained")
        try:
            attestation = self._attest(job_id)
            if contract.digest(attestation) != slot["custody_sha256"]:
                raise PermissionError("durable_custody_attestation_digest_required")
            self._effect_guard(job_id)
            secret = self.tokens.load(manifest)
            if secret.sha256() != claim["token_sha256"]:
                raise PermissionError("bound_launch_secret_required")
            request = RetirementRequest(dict(manifest), secret, claim["receipt_sha256"],
                                        attestation["bundle_sha256"], slot["custody_sha256"])
            self._effect_guard(job_id)
            ack = self.retirement_observer(request)
            self._accept_retirement_ack(job_id, request, attestation, ack)
        except Exception:
            raise ConsumerPending("retirement_observation_uncertain_slot_retained_no_cleanup_replay") from None
        return self._metadata_now(job_id)

    def _metadata_now_after_transaction(self, job_id, db):
        job, manifest, _, slot = self._bound(db, job_id)
        return self._metadata(job, manifest, slot)
