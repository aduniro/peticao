"""Deterministic admission and power policy; never creates a task queue.

Inputs must be collected under the existing primary queue's admission lock.
The caller commits the returned reservation with the original task claim before
dispatch. A decision by itself is not a cloud action or an admitted task.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import json


def money(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("invalid monetary value") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("money must be finite and nonnegative")
    return result


def instant(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timezone required")
    return result


@dataclass(frozen=True)
class Budget:
    initial: Decimal
    remaining: Decimal
    committed: Decimal
    fixed_remaining: Decimal
    hourly: Decimal
    expiry: datetime
    verified_at: datetime
    quantum_seconds: int

    @classmethod
    def from_dict(cls, d):
        if d.get("verified") is not True:
            raise ValueError("credit not verified")
        quantum = d.get("quantum_seconds")
        if type(quantum) is not int or quantum < 1:
            raise ValueError("positive billing quantum required")
        return cls(*(money(d[x]) for x in ["initial", "remaining", "committed", "fixed_remaining", "hourly"]),
                   instant(d["expiry"]), instant(d["verified_at"]), quantum)

    def cost(self, seconds):
        units = (Decimal(seconds) / self.quantum_seconds).to_integral_value(rounding=ROUND_CEILING)
        return self.hourly * units * self.quantum_seconds / Decimal(3600)

    def reserve(self):
        return self.initial * Decimal("0.20")

    def usable(self):
        return self.remaining - self.committed - self.fixed_remaining - self.reserve()


def admit(budget, now, timeout_seconds, cleanup_seconds=3600):
    if type(timeout_seconds) is not int or timeout_seconds <= 0:
        return {"allowed": False, "reason": "missing_positive_task_timeout"}
    if type(cleanup_seconds) is not int or cleanup_seconds < 1:
        return {"allowed": False, "reason": "invalid_cleanup_timeout"}
    if now < budget.verified_at or now - budget.verified_at > timedelta(hours=1):
        return {"allowed": False, "reason": "stale_credit_observation"}
    duration = timeout_seconds + cleanup_seconds
    if now + timedelta(seconds=duration) >= budget.expiry:
        return {"allowed": False, "reason": "credit_expires_before_cleanup"}
    cost = budget.cost(duration)
    if budget.usable() < cost:
        return {"allowed": False, "reason": "insufficient_uncommitted_credit"}
    return {"allowed": True, "reason": "covered", "reserve_usd": str(cost),
            "must_commit_with_original_queue_claim": True}


def lifecycle(snapshot, now):
    """Return a proposed action. Executor must recheck scope/lease and state.

    running includes startup, active jobs, finalization and artifact export.
    Missing or uncertain observations fail closed, never default to idle.
    """
    if snapshot.get("queue_primary_verified") is not True:
        return {"action": "hold", "reason": "queue_authority_unverified"}
    if snapshot.get("provider_state") in [None, "unknown", "starting", "stopping", "uncertain"]:
        return {"action": "reconcile", "reason": "provider_state_not_stable"}
    counts = [snapshot.get(k) for k in ["queued", "running", "finalizing", "exports_pending"]]
    if any(type(x) is not int or x < 0 for x in counts):
        return {"action": "hold", "reason": "incomplete_queue_observation"}
    try:
        b = Budget.from_dict(snapshot["budget"])
    except (KeyError, TypeError, ValueError):
        return {"action": "hold", "reason": "unverified_budget"}
    if now < b.verified_at or now - b.verified_at > timedelta(hours=1):
        return {"action": "hold", "reason": "stale_credit_observation"}
    policy = snapshot.get("billing_policy")
    if policy not in ["allocated_until_destroyed", "deallocate_saves_compute", "permanent_existing"]:
        return {"action": "hold", "reason": "unknown_billing_policy"}
    if policy == "permanent_existing":
        return {"action": "keep", "reason": "permanent_control_or_production"}
    cutoff = now + timedelta(hours=1) >= b.expiry or b.usable() < b.cost(3600)
    busy = any(counts[1:])
    if cutoff:
        if busy:
            return {"action": "drain", "reason": "financial_cutoff", "admit_new": False}
        if snapshot.get("backup_verified") is not True:
            return {"action": "export", "reason": "financial_cutoff_preserve_data", "admit_new": False}
        return {"action": "retire", "reason": "financial_cutoff", "admit_new": False,
                "requires_owned_resource_inventory": True}
    if any(counts):
        if snapshot["provider_state"] == "deallocated":
            return {"action": "start", "reason": "queued_work"}
        return {"action": "keep", "reason": "work_pending"}
    if policy == "allocated_until_destroyed":
        return {"action": "keep", "reason": "stopping_does_not_save"}
    idle = snapshot.get("idle_since")
    if not idle:
        return {"action": "hold", "reason": "missing_idle_observation"}
    try:
        age = (now - instant(idle)).total_seconds()
    except ValueError:
        return {"action": "hold", "reason": "invalid_idle_observation"}
    if age < 0:
        return {"action": "hold", "reason": "future_idle_observation"}
    if age >= 600 and snapshot["provider_state"] == "running":
        return {"action": "deallocate", "reason": "idle_ten_minutes"}
    return {"action": "keep", "reason": "idle_grace_or_already_deallocated"}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot")
    parser.add_argument("--now", required=True, help="ISO8601 with timezone")
    args = parser.parse_args()
    with open(args.snapshot, encoding="utf-8") as handle:
        print(json.dumps(lifecycle(json.load(handle), instant(args.now)), sort_keys=True))
