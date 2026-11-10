"""Strict local contracts. No subprocess, environment lookup, remote command or transport."""
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import copy
import hashlib
import json
import math
import re
import uuid

NODE_VERSION = "20.19.2"
NODE_SHA256 = "b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac"
NEXT_VERSION = "14.2.35"
KINDS = {"qualification_delivery", "qa_history_metadata"}
ROLES = {"local": "coordinator", "santiago": "integrator", "sao_paulo": "production_read_only"}
PREFIXES = {"integration/admin-v2-", "worker/admin-v2-", "review/admin-v2-"}
HARD_PROTECTED = ("/mnt/apps/peticao-final/peticao", "/mnt/dev/peticao", "/opt/peticao", "/home/adunir/peticao-stage", "/var/lib/postgresql")
CHECKS = {"source_stable", "runtime_assets_stable", "commit_stable", "build_source_map_equal", "data_invariants", "network_guard", "ports_closed", "coverage_complete"}
ENV = {"NODE_ENV": "test", "MAIL_PROVIDER": "dev", "MAIL_PROVIDERS": "dev", "SIGNER": "none", "CRON_SECRET": "", "BATCH_A1_ENABLED": "0", "A1_VALIDATION_ENABLED": "0", "PRESIDENT_OWN_ENABLED": "0"}

class ValidationError(ValueError):
    pass

def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

def canonical_sha256(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()

def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys.split()):
        raise ValidationError("invalid_" + label + "_keys")

def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None

def commit(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value) is not None

def uuid4(value):
    try:
        parsed = uuid.UUID(value)
        return isinstance(value, str) and parsed.version == 4 and str(parsed) == value
    except (ValueError, TypeError, AttributeError):
        return False

def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

def integer(value, low, high):
    return type(value) is int and low <= value <= high

def absolute_path(value):
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096 or "\\" in value or any(ord(c) < 32 for c in value) or ".." in PurePosixPath(value).parts:
        raise ValidationError("invalid_absolute_path")
    return Path(value).resolve()

def validate_branch(ref, integration_only=False):
    if not isinstance(ref, str) or len(ref) > 120 or not re.fullmatch(r"(?:integration|worker|review)/admin-v2-[a-z0-9][a-z0-9._-]*", ref) or ".." in ref or ref.endswith((".", ".lock")):
        raise ValidationError("protected_or_invalid_branch")
    if integration_only and not ref.startswith("integration/admin-v2-"):
        raise ValidationError("integration_branch_required")
    return ref

def validate_repository_path(path, config, host="santiago"):
    if host not in ROLES or config["hosts"][host]["role"] == "production_read_only":
        raise ValidationError("read_only_or_unknown_host")
    resolved = absolute_path(path)
    for raw in (*HARD_PROTECTED, *config["protected_paths"]):
        protected = absolute_path(raw)
        if resolved == protected or resolved.is_relative_to(protected):
            raise ValidationError("protected_live_path")
    root = absolute_path(config["hosts"][host]["repository_root"])
    if resolved == root or not resolved.is_relative_to(root):
        raise ValidationError("repository_outside_worker_root")
    return resolved

def validate_config(raw):
    exact(raw, "schema_version execution_enabled coordinator_host integration_host state_path artifact_root hosts protected_paths allowed_branch_prefixes wrappers required_checks limits", "config")
    c = copy.deepcopy(raw)
    if type(c["schema_version"]) is not int or c["schema_version"] != 1 or type(c["execution_enabled"]) is not bool or c["coordinator_host"] != "local" or c["integration_host"] != "santiago":
        raise ValidationError("invalid_roles_or_config_version")
    exact(c["hosts"], "local santiago sao_paulo", "hosts")
    for host, role in ROLES.items():
        h = c["hosts"][host]
        exact(h, "role enabled repository_root machine_id_sha256", "host")
        if h["role"] != role or type(h["enabled"]) is not bool or h["machine_id_sha256"] is not None and not sha(h["machine_id_sha256"]):
            raise ValidationError("invalid_host_identity")
        if host == "sao_paulo":
            if h["enabled"] or h["repository_root"] is not None:
                raise ValidationError("production_must_remain_read_only")
        else:
            absolute_path(h["repository_root"])
    if c["execution_enabled"] and (not c["hosts"]["santiago"]["enabled"] or not sha(c["hosts"]["santiago"]["machine_id_sha256"])):
        raise ValidationError("activation_requires_infra_identity")
    absolute_path(c["state_path"]); absolute_path(c["artifact_root"])
    if not isinstance(c["protected_paths"], list) or not c["protected_paths"]:
        raise ValidationError("protected_paths_required")
    for p in c["protected_paths"]: absolute_path(p)
    if not {str(absolute_path(p)) for p in HARD_PROTECTED}.issubset({str(absolute_path(p)) for p in c["protected_paths"]}):
        raise ValidationError("live_path_policy_cannot_be_relaxed")
    for value in [c["state_path"], c["artifact_root"], c["hosts"]["local"]["repository_root"], c["hosts"]["santiago"]["repository_root"]]:
        resolved = absolute_path(value)
        if any(resolved == absolute_path(p) or resolved.is_relative_to(absolute_path(p)) for p in (*HARD_PROTECTED,*c["protected_paths"])):
            raise ValidationError("config_path_is_live_application")
    if not isinstance(c["allowed_branch_prefixes"], list) or set(c["allowed_branch_prefixes"]) != PREFIXES:
        raise ValidationError("branch_policy_cannot_be_relaxed")
    if not isinstance(c["wrappers"], dict) or set(c["wrappers"]) != KINDS or not isinstance(c["required_checks"], dict) or set(c["required_checks"]) != KINDS:
        raise ValidationError("invalid_job_allowlist")
    expected = {"qualification_delivery": "tools/admin-qa/mail-delivery-compiled-local.py", "qa_history_metadata": "tools/admin-qa/mail-history-compiled-local.py"}
    for kind in KINDS:
        exact(c["wrappers"][kind], "relative_path sha256", "wrapper")
        if c["wrappers"][kind]["relative_path"] != expected[kind] or not sha(c["wrappers"][kind]["sha256"]):
            raise ValidationError("invalid_wrapper_identity")
        checks = c["required_checks"][kind]
        if not isinstance(checks, list) or not checks or not all(isinstance(x, str) and re.fullmatch(r"[a-z0-9_]{1,64}", x) for x in checks) or len(checks) != len(set(checks)):
            raise ValidationError("invalid_required_coverage")
        minimum = {"qualification_delivery": {"http","csv24_50004","roles","ui_6_widths","data_invariants","network_guard"}, "qa_history_metadata": {"http","history26","attempts251","events205","bigint_microseconds","roles","ui_6_widths","data_invariants","network_guard"}}
        if not minimum[kind].issubset(set(checks)):
            raise ValidationError("required_coverage_cannot_be_relaxed")
    exact(c["limits"], "concurrent_per_worker lease_seconds ready_max_age_seconds max_cpu_cores max_memory_mib max_timeout_seconds max_artifact_bytes max_total_artifact_bytes", "limits")
    limits = c["limits"]
    if type(limits["concurrent_per_worker"]) is not int or limits["concurrent_per_worker"] != 1 or not integer(limits["lease_seconds"], 60, 600) or not integer(limits["ready_max_age_seconds"], 60, 3600) or not integer(limits["max_cpu_cores"], 1, 8) or not integer(limits["max_memory_mib"], 512, 16384) or not integer(limits["max_timeout_seconds"], 60, 14400) or not integer(limits["max_artifact_bytes"], 1024, 268435456) or not integer(limits["max_total_artifact_bytes"], limits["max_artifact_bytes"], 1073741824):
        raise ValidationError("invalid_resource_limits")
    return c

@dataclass(frozen=True)
class JobSpec:
    canonical_json: str
    payload_sha256: str
    execution_sha256: str

    @property
    def data(self):
        return json.loads(self.canonical_json)

def validate_job(raw, config):
    c = validate_config(config)
    exact(raw, "schema_version job_id intent_id kind target_worker source runtime integration env resources safety", "job")
    job = copy.deepcopy(raw)
    if type(job["schema_version"]) is not int or job["schema_version"] != 1 or not uuid4(job["job_id"]) or not uuid4(job["intent_id"]) or job["kind"] not in KINDS or job["target_worker"] != "santiago":
        raise ValidationError("invalid_job_identity_or_role")
    s = job["source"]
    exact(s, "commit ref repository_path bundle_sha256 source_manifest_sha256 wrapper_sha256", "source")
    if not commit(s["commit"]) or not all(sha(s[k]) for k in ("bundle_sha256", "source_manifest_sha256", "wrapper_sha256")):
        raise ValidationError("invalid_source_identity")
    validate_branch(s["ref"]); validate_repository_path(s["repository_path"], c)
    if s["wrapper_sha256"] != c["wrappers"][job["kind"]]["sha256"]:
        raise ValidationError("wrapper_not_approved")
    r = job["runtime"]
    exact(r, "node_version node_sha256 next_version package_lock_sha256 assets_manifest_sha256 assets_count", "runtime")
    if r["node_version"] != NODE_VERSION or r["node_sha256"] != NODE_SHA256 or r["next_version"] != NEXT_VERSION or type(r["assets_count"]) is not int or r["assets_count"] != 202 or not all(sha(r[k]) for k in ("package_lock_sha256", "assets_manifest_sha256")):
        raise ValidationError("runtime_mismatch")
    exact(job["integration"], "ref expected_base", "integration")
    validate_branch(job["integration"]["ref"], True)
    if not commit(job["integration"]["expected_base"]): raise ValidationError("invalid_expected_base")
    if job["env"] != ENV: raise ValidationError("environment_must_be_explicit_dev_only")
    exact(job["resources"], "cpu_cores memory_mib timeout_seconds", "resources")
    if not integer(job["resources"]["cpu_cores"], 1, c["limits"]["max_cpu_cores"]) or not integer(job["resources"]["memory_mib"], 512, c["limits"]["max_memory_mib"]) or not integer(job["resources"]["timeout_seconds"], 60, c["limits"]["max_timeout_seconds"]):
        raise ValidationError("resource_budget_exceeded")
    if job["safety"] != {"production": False, "external_messages": False, "automatic_retry": False} or not isinstance(job["safety"], dict) or any(type(v) is not bool for v in job["safety"].values()):
        raise ValidationError("unsafe_job_policy")
    wire = canonical_json(job)
    identity = copy.deepcopy(job); identity.pop("job_id")
    return JobSpec(wire, hashlib.sha256(wire.encode()).hexdigest(), canonical_sha256(identity))

def validate_ready(raw, config, now):
    exact(raw, "schema_version handshake_id worker_id role repository_root machine_id_sha256 issued_at expires_at config_sha256 capability_sha256 node_version node_sha256 next_version", "ready")
    h = copy.deepcopy(raw)
    if type(h["schema_version"]) is not int or h["schema_version"] != 1 or not uuid4(h["handshake_id"]) or h["worker_id"] not in ("local","santiago") or h["role"] != ROLES[h["worker_id"]] or not sha(h["machine_id_sha256"]) or h["repository_root"] != config["hosts"][h["worker_id"]]["repository_root"]:
        raise ValidationError("invalid_ready_identity")
    if not number(h["issued_at"], now - config["limits"]["ready_max_age_seconds"], now + 5) or not number(h["expires_at"], now + 1, h["issued_at"] + config["limits"]["ready_max_age_seconds"]):
        raise ValidationError("expired_or_future_ready")
    if h["config_sha256"] != canonical_sha256(config) or not sha(h["capability_sha256"]) or h["node_version"] != NODE_VERSION or h["node_sha256"] != NODE_SHA256 or h["next_version"] != NEXT_VERSION:
        raise ValidationError("ready_contract_mismatch")
    expected = config["hosts"][h["worker_id"]]["machine_id_sha256"]
    if expected is not None and expected != h["machine_id_sha256"]:
        raise ValidationError("ready_machine_mismatch")
    return h

def validate_result(spec, raw, config, artifact_root, verify_files=True):
    job = spec.data
    exact(raw, "schema_version job_id claim_id generation worker_id commit build_commit source_manifest_sha256 wrapper_sha256 assets_manifest_sha256 package_lock_sha256 node_sha256 exit_code checks coverage artifacts execution_artifact", "result")
    r = copy.deepcopy(raw)
    if type(r["schema_version"]) is not int or r["schema_version"] != 1 or r["job_id"] != job["job_id"] or not uuid4(r["claim_id"]) or not integer(r["generation"], 1, 1000000) or r["worker_id"] != job["target_worker"] or r["commit"] != job["source"]["commit"] or r["build_commit"] != job["source"]["commit"] or not integer(r["exit_code"], 0, 255):
        raise ValidationError("result_execution_mismatch")
    for key in ("source_manifest_sha256", "wrapper_sha256"):
        if r[key] != job["source"][key]: raise ValidationError("result_source_mismatch")
    for key in ("assets_manifest_sha256", "package_lock_sha256", "node_sha256"):
        if r[key] != job["runtime"][key]: raise ValidationError("result_runtime_mismatch")
    if not isinstance(r["checks"], dict) or set(r["checks"]) != CHECKS or not all(type(x) is bool for x in r["checks"].values()):
        raise ValidationError("invalid_result_checks")
    required = config["required_checks"][job["kind"]]
    if not isinstance(r["coverage"], list) or not all(isinstance(x,str) for x in r["coverage"]) or len(r["coverage"]) != len(set(r["coverage"])) or set(r["coverage"]) != set(required):
        raise ValidationError("incomplete_result_coverage")
    if not isinstance(r["artifacts"], list) or not 1 <= len(r["artifacts"]) <= 100:
        raise ValidationError("invalid_artifacts")
    root = absolute_path(str(artifact_root)); names = set(); total = 0; execution = None
    for a in r["artifacts"]:
        exact(a, "path sha256 bytes", "artifact")
        name = a["path"]
        if not isinstance(name, str) or len(name) > 512 or "\\" in name or any(ord(c)<32 for c in name) or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or name in names or not sha(a["sha256"]) or not integer(a["bytes"], 0, config["limits"]["max_artifact_bytes"]):
            raise ValidationError("invalid_artifact_path_or_size")
        names.add(name); total += a["bytes"]
        path = (root / name).resolve()
        expected_prefix = f'{job["job_id"]}/generation-{r["generation"]}/'
        if not name.startswith(expected_prefix) or not path.is_relative_to(root): raise ValidationError("artifact_outside_job")
        if verify_files:
            if not path.is_file() or path.stat().st_size != a["bytes"]: raise ValidationError("artifact_missing_or_size_mismatch")
            digest = hashlib.sha256(); metadata = []
            if name == r["execution_artifact"] and a["bytes"] > 2*1024*1024: raise ValidationError("execution_metadata_too_large")
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b""):
                    digest.update(chunk)
                    if name == r["execution_artifact"]: metadata.append(chunk)
            if digest.hexdigest() != a["sha256"]: raise ValidationError("artifact_sha_mismatch")
            if name == r["execution_artifact"]:
                if a["bytes"] > 2*1024*1024: raise ValidationError("execution_metadata_too_large")
                try: execution = json.loads(b"".join(metadata))
                except (OSError, ValueError): raise ValidationError("execution_metadata_invalid") from None
    if total > config["limits"]["max_total_artifact_bytes"] or r["execution_artifact"] not in names:
        raise ValidationError("artifact_budget_or_execution_missing")
    if verify_files:
        if not isinstance(execution, dict) or execution.get("commit") != r["commit"] or execution.get("buildCommit") != r["build_commit"] or execution.get("exit") != r["exit_code"] or execution.get("runtimeAssets") != 202:
            raise ValidationError("execution_artifact_identity_mismatch")
        pairs = {"sourceStable":"source_stable", "runtimeAssetsStable":"runtime_assets_stable", "commitStable":"commit_stable", "completeBuildSourceMapEqual":"build_source_map_equal"}
        for key, check in pairs.items():
            if type(execution.get(key)) is not bool or execution[key] != r["checks"][check]: raise ValidationError("execution_artifact_check_mismatch")
        if not isinstance(execution.get("portsClosed"), dict) or not execution["portsClosed"] or not all(type(v) is bool for v in execution["portsClosed"].values()) or all(execution["portsClosed"].values()) != r["checks"]["ports_closed"]:
            raise ValidationError("execution_artifact_ports_mismatch")
    if r["exit_code"] == 0 and not all(r["checks"].values()): raise ValidationError("success_with_failed_checks")
    return r
