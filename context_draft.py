"""Offline R1 evidence draft. No CLI, ledger access, lease acquisition or deploy.

A successful result is reviewable context, NEVER permission to execute. Input
pins must be frozen independently by Root and reviewed by Apoio. This module
does not authenticate an author's statement merely because JSON names them.
"""
import hashlib
import json
import re


SOURCE = "c472837fb5a4584d81f34c420f4de30989084f85"
IMAGE = "sha256:5a582c5c71a860964d6a33c9f431a901fb85671d4b0afdf22481de610cb4aa21"
RUNTIME = "278345b65fd8a384d9b7639faf68e0a1a23d5f837f444fdd039aba4c798c9f78"
ACTORS = {"admin-recuperacao", "apoio", "executor61"}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


class InvalidContext(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidContext(message)


def digest(value, size=64):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % size, value) is not None


def verify_evidence(reference, evidence):
    """Evidence bytes are supplied explicitly, without arbitrary file reads."""
    require(isinstance(reference, dict), "missing evidence reference")
    key, sha = reference.get("id"), reference.get("sha256")
    require(isinstance(key, str) and bool(key) and digest(sha), "unfrozen evidence")
    require(key in evidence and isinstance(evidence[key], bytes), "missing evidence bytes")
    require(hashlib.sha256(evidence[key]).hexdigest() == sha, "evidence drift")


def assess(bundle, pins, evidence):
    """Pure analysis. Inputs include an independently captured ledger snapshot.

    No allowances are inferred from notice numbers, old reviews or a role label.
    The caller remains responsible for authenticating snapshot/evidence origins.
    """
    try:
        require(bundle["schema"] == "r1-context-draft-v1", "wrong schema")
        require(bundle["draft"] is True, "draft only")
        require(bundle["operation_id"] == pins["operation_id"] and
                bool(pins["operation_id"]), "wrong operation")
        manifest = bundle["manifest"]
        require(fingerprint(manifest) == pins["manifest_sha256"], "manifest drift")
        require(manifest["scope"] == "admin-query-r1-only", "wrong scope")
        require(manifest["executor"] == "admin-recuperacao", "wrong executor")
        require(manifest["image"] == IMAGE and manifest["source"] == SOURCE and
                manifest["runtime_sha256"] == RUNTIME, "artifact drift")
        require(digest(manifest["harness"], 40) and
                manifest["harness"] == pins["harness"], "harness not frozen")
        require(isinstance(manifest["notice"], int) and manifest["notice"] > 0 and
                manifest["notice"] == pins["notice"], "notice not frozen")
        for field in ("rollback", "tests", "native_qa", "owner_authorization"):
            verify_evidence(manifest[field], evidence)
        require(bundle["active_actors"] == sorted(ACTORS), "actor set changed")
        require(bundle["roles"] == {"executor61": "channel"}, "role interpretation changed")
        require(bundle["canonical_gate_passed"] is False, "canonical gate misrepresented")
        require(bundle["global_changes"] == [], "global mutation requested")
        snapshot = bundle["snapshot"]
        require(fingerprint(snapshot) == pins["snapshot_sha256"], "snapshot drift")
        require(snapshot["seq"] == pins["snapshot_seq"], "snapshot version changed")
        require(not snapshot["conflicting_leases"], "active or uncertain resource conflict")
        require(not snapshot["inflight_operations"], "inflight operation not reconciled")
        require(bundle["execution_history"] == [], "already attempted or uncertain execution")
        reviews = bundle["reviews"]
        require(len(reviews) == 2 and {r["actor"] for r in reviews} ==
                {"admin-recuperacao", "apoio"}, "distinct current technical reviews required")
        for review in reviews:
            require(review["decision"] == "pass" and review["purpose"] == "r1-context-draft" and
                    review["manifest_sha256"] == pins["manifest_sha256"] and
                    review["receipts_sha256"] == fingerprint(bundle["receipts"]),
                    "review not bound to this context")
            verify_evidence(review["evidence"], evidence)
        pending = snapshot["pending_notices"]
        require(len({n["id"] for n in pending}) == len(pending), "duplicate notices")
        receipts = bundle["receipts"]
        require(len(receipts) == len(pending) and
                {r["target_id"] for r in receipts} == {n["id"] for n in pending},
                "new or unreconciled pending notice")
        for notice in pending:
            require(digest(notice["fingerprint"]), "notice fingerprint absent")
            receipt = next(r for r in receipts if r["target_id"] == notice["id"])
            require(receipt["operation_id"] == pins["operation_id"] and
                    receipt["target_fingerprint"] == notice["fingerprint"], "receipt scope drift")
            require(receipt["author"] == notice["author"] and
                    receipt["preserve_original"] is True and
                    receipt["applied_globally"] is False, "historical state not reconciled")
            verify_evidence(receipt["author_evidence"], evidence)
            verify_evidence(receipt["independent_evidence"], evidence)
            if receipt["decision"] == "archived-completed":
                require(receipt["execution_state"] == "completed-verified" and
                        notice["missing_ack"] == ["executor61"] and
                        receipt["technical_ack_actors"] == ["admin-recuperacao", "apoio"],
                        "completed notice lacks exact completion/channel-only proof")
                verify_evidence(receipt["completion_evidence"], evidence)
                verify_evidence(receipt["technical_reviews_evidence"], evidence)
            else:
                require(receipt["decision"] in {"withdrawn", "superseded"} and
                        receipt["execution_state"] == "not-executed",
                        "historical state not reconciled")
            if notice["nack"]:
                require(receipt["nack_preserved"] is True, "NACK must remain visible")
                verify_evidence(receipt["correction_evidence"], evidence)
            if receipt["decision"] == "superseded":
                replacement = receipt["replacement"]
                require(isinstance(replacement["id"], int) and replacement["id"] > 0 and
                        replacement["id"] != notice["id"] and digest(replacement["fingerprint"]),
                        "invalid replacement")
                require(replacement["technical_ack_actors"] == ["admin-recuperacao", "apoio"] and
                        replacement["scope"] == "neon-only-no-workers-no-cutover",
                        "replacement overstated")
                verify_evidence(replacement["evidence"], evidence)
        return {"status": "context-consistent-draft", "execution_allowed": False,
                "canonical_gate_passed": False, "global_changes": [],
                "remaining": ["Independent origin authentication and live revalidation",
                              "Review and approve any future scoped execution route",
                              "Obtain canonical atomic lease and fencing before execution",
                              "Durable single-use intent; timeout becomes uncertain"]}
    except (KeyError, TypeError, ValueError, StopIteration) as error:
        return {"status": "blocked", "execution_allowed": False,
                "reason": str(error), "global_changes": []}
