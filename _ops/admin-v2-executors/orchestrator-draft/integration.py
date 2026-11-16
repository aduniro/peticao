"""Prepare a Git merge, then independently gate its promotion using queue evidence.

No command runner, SSH, provider, service management or deploy is available here.
A clean Git merge alone is never sufficient evidence of semantic correctness.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import hashlib
import json
import os
import tempfile
import uuid

from git_transport import RepositoryPolicy, ReadyProof, TransportError, branch_ref, commit_id, digest, git, inspect_history, inspect_repository, tree_manifest, private_directory


@dataclass(frozen=True)
class PreparedIntegration:
    report_path: str
    report_sha256: str


def _integrator(policy: RepositoryPolicy, config: dict[str, Any]) -> None:
    if policy != RepositoryPolicy.from_config(config,"santiago"):
        raise TransportError("policy_configuration_mismatch")
    if policy.host_id != config.get("integration_host") or policy.host_id != "santiago" or policy.role != "integrator":
        raise TransportError("only_santiago_integrates")


def _current(repo: Path, ref: str) -> str:
    return commit_id(git(repo, "rev-parse", "--verify", ref + "^{commit}").decode().strip())


def _not_checked_out(repo: Path, ref: str) -> None:
    if ("branch " + ref) in git(repo, "worktree", "list", "--porcelain").decode().splitlines():
        raise TransportError("integration_branch_must_not_be_checked_out")


def _record(policy: RepositoryPolicy, record: dict[str, Any]) -> PreparedIntegration:
    directory = private_directory(policy,".integration-reports")
    path = directory / (record["prepare_id"] + ".json")
    payload = json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False).encode()
    with path.open("xb") as stream:
        os.chmod(path, 0o600)
        stream.write(payload)
    return PreparedIntegration(str(path), hashlib.sha256(payload).hexdigest())


def load_prepared(policy: RepositoryPolicy, prepared: PreparedIntegration) -> dict[str, Any]:
    path = Path(prepared.report_path).resolve(strict=True)
    if path.parent != policy.root / ".integration-reports" or hashlib.sha256(path.read_bytes()).hexdigest() != prepared.report_sha256:
        raise TransportError("prepared_report_modified_or_outside_root")
    return json.loads(path.read_text())


def prepare(policy: RepositoryPolicy, config: dict[str, Any], repository: str | Path, integration_ref: str, expected_base: str, candidate: str, *, execute: bool = False, ready: ReadyProof | None = None) -> dict[str, Any] | PreparedIntegration:
    _integrator(policy, config)
    ref = branch_ref(integration_ref, integration_only=True)
    commit_id(expected_base); commit_id(candidate)
    repo = inspect_repository(policy, repository)
    if _current(repo, ref) != expected_base:
        raise TransportError("integration_base_cas_conflict")
    _not_checked_out(repo, ref)
    common = git(repo, "merge-base", expected_base, candidate).decode().strip()
    history = inspect_history(repo, common, candidate, policy)
    tree_manifest(repo, expected_base, policy)
    plan = {"prepare_id": str(uuid.uuid4()), "state": "planned", "repository": str(repo), "integration_ref": integration_ref, "expected_base": expected_base, "candidate": candidate, "common_base": common, "candidate_manifest_sha256": history["source_manifest_sha256"], "integration_host": policy.host_id, "dry_run": not execute, "integration_ref_advanced": False}
    if common == candidate:
        plan["state"]="noop"
        if execute: policy.permit(ready)
        return plan
    if not execute:
        return plan
    policy.permit(ready)
    staging = private_directory(policy,".integration-worktrees")
    temporary_ref = "worker/admin-v2-merge-" + plan["prepare_id"]
    path = Path(tempfile.mkdtemp(dir=staging)) / "checkout"
    added = False
    keep_ref = False
    try:
        git(repo, "worktree", "add", "-b", temporary_ref, str(path), expected_base)
        added = True
        try:
            git(path, "merge", "--no-ff", "--no-commit", "--no-edit", candidate)
        except TransportError:
            conflicts = [p for p in git(path, "diff", "--name-only", "--diff-filter=U", "-z").decode().split("\0") if p]
            if not conflicts:
                raise
            stages=[]
            for entry in git(path,"ls-files","--unmerged","-z").split(b"\0"):
                if entry:
                    metadata,filename=entry.split(b"\t",1)
                    mode,oid,stage=metadata.decode().split()
                    stages.append({"path":filename.decode(),"mode":mode,"blob":oid,"stage":int(stage)})
            plan.update({"state": "conflict", "conflicts": sorted(conflicts), "conflict_stages":stages, "auto_resolved": False, "dry_run": False})
            return _record(policy, plan)
        # If already merged, do not create a misleading additional commit.
        if git(path, "rev-parse", "HEAD").decode().strip() == candidate:
            merged = candidate
        else:
            merge_head = Path(git(path, "rev-parse", "--git-path", "MERGE_HEAD").decode().strip())
            if not merge_head.is_absolute():
                merge_head = path / merge_head
            if merge_head.exists():
                git(path, "commit", "--no-verify", "-m", "Integrate reviewed admin-v2 worker commit " + candidate)
            merged = git(path, "rev-parse", "HEAD").decode().strip()
        manifest = tree_manifest(path, merged, policy)
        plan.update({"state": "prepared", "dry_run": False, "temporary_ref": temporary_ref, "merged_commit": merged, "source_manifest_sha256": digest(manifest), "conflicts": [], "auto_resolved": False})
        keep_ref = True
        return _record(policy, plan)
    except Exception:
        # Failure is still observable without leaking arbitrary subprocess stderr.
        plan.update({"state": "failed", "dry_run": False, "failure": "prepare_failed_no_promotion"})
        _record(policy, plan)
        raise
    finally:
        if added:
            git(repo, "worktree", "remove", "--force", str(path))
        try:
            path.parent.rmdir()
        except OSError:
            pass
        if not keep_ref:
            try:
                git(repo, "update-ref", "-d", branch_ref(temporary_ref), expected_base)
            except TransportError:
                # Do not force-delete a ref moved concurrently by someone else.
                pass


def promote(policy: RepositoryPolicy, config: dict[str, Any], prepared: PreparedIntegration, queue: Any, job_id: str, *, execute: bool = False, ready: ReadyProof | None = None) -> dict[str, Any]:
    """Only completed_receipt is accepted, never arbitrary result JSON or booleans."""
    _integrator(policy, config)
    record = load_prepared(policy, prepared)
    if record["state"] != "prepared":
        raise TransportError("clean_prepared_merge_required")
    repo = inspect_repository(policy, record["repository"])
    ref = branch_ref(record["integration_ref"], integration_only=True)
    _not_checked_out(repo, ref)
    merged = commit_id(record["merged_commit"])
    current_ref=_current(repo,ref)
    if _current(repo, branch_ref(record["temporary_ref"])) != merged or current_ref not in {record["expected_base"],merged}:
        raise TransportError("prepared_or_integration_ref_changed")
    # The queue rechecks completed status, claim fencing, config, artifact bytes/SHA and coverage.
    receipt = queue.completed_receipt(job_id)
    job, result = receipt.job, receipt.result
    from protocol import validate_job, validate_result, canonical_sha256
    spec = validate_job(job, config)
    checked = validate_result(spec, result, config, receipt.artifact_root, True)
    if receipt.job_id != job_id or receipt.payload_sha256 != spec.payload_sha256 or receipt.result_sha256 != canonical_sha256(checked) or receipt.worker_id != "santiago" or result["exit_code"] != 0 or not all(result["checks"].values()) or result["generation"] != receipt.generation or result["claim_id"] != receipt.claim_id:
        raise TransportError("completed_receipt_mismatch")
    if job["source"]["commit"] != merged or result["commit"] != merged or result["build_commit"] != merged or job["integration"] != {"ref": record["integration_ref"], "expected_base": record["expected_base"]}:
        raise TransportError("evidence_does_not_test_this_merge")
    manifest = tree_manifest(repo, merged, policy)
    if digest(manifest) != record["source_manifest_sha256"] or job["source"]["source_manifest_sha256"] != digest(manifest):
        raise TransportError("source_manifest_mismatch")
    wrapper = config["wrappers"][job["kind"]]
    blob = manifest.get(wrapper["relative_path"])
    if blob is None or blob["sha256"] != wrapper["sha256"] or blob["sha256"] != job["source"]["wrapper_sha256"]:
        raise TransportError("wrapper_is_not_versioned_at_tested_commit")
    lock = manifest.get("site/package-lock.json")
    if lock is None or lock["sha256"] != job["runtime"]["package_lock_sha256"]:
        raise TransportError("package_lock_is_not_versioned_at_tested_commit")
    response = {"dry_run": not execute, "eligible": True, "integration_ref": record["integration_ref"], "expected_base": record["expected_base"], "merged_commit": merged, "job_id": job_id, "generation": receipt.generation, "result_sha256": receipt.result_sha256, "source_manifest_sha256": digest(manifest), "integration_ref_advanced": False}
    if not execute:
        return response
    policy.permit(ready)
    if current_ref==merged:
        response.update({"noop":True,"already_at_tested_commit":True})
        return response
    # Atomic compare-and-swap: test evidence can never overwrite a concurrent newer integration.
    git(repo, "update-ref", ref, merged, record["expected_base"])
    response["integration_ref_advanced"] = True
    _record(policy, {**response, "prepare_id": str(uuid.uuid4()), "state": "promoted", "prepared_report_sha256": prepared.report_sha256})
    return response
