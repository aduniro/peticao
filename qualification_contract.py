"""Pure contracts: no imports from unfrozen runtime and no host operations."""
import hashlib
import json
from pathlib import Path
import re

PUBLIC = Path("/opt/peticao-dev-worker-qual-20261114-attempt3")
PRIVATE = Path("/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt3")
HOST = "peticao-civo"
EXPECTED = {"version", "operation_id", "jobs", "runtime_commit", "runtime_sha256", "harness_sha256", "execute", "systemd_major", "systemd_version_sha256"}
RUNTIME = {"remote_contract.py", "admission.py", "artifacts.py", "worker.py", "controller.py", "systemd_adapter.py", "log_redaction.py", "cgroups.py", "project_storage.py", "unit_refs.py"}
HARNESS = {"qualification_contract.py", "qualification_job.py", "qualification_helper.py", "storage_probe.py"}
CHECKS = {"nonroot_uid", "zero_capabilities", "no_new_privileges", "home_masked", "root_masked", "private_marker_unreadable",
          "public_marker_readonly", "docker_socket_inaccessible", "environment_allowlisted", "private_loopback_works", "tailnet_no_route", "system_tmp_inaccessible", "system_var_tmp_inaccessible", "direct_runtime_access_denied"}
LIMIT_PROPERTIES = {"DynamicUser": "yes", "ProtectSystem": "strict", "ProtectHome": "tmpfs", "PrivateNetwork": "yes",
                    "PrivateDevices": "yes", "PrivateTmp": "yes", "NoNewPrivileges": "yes", "MemoryMax": "536870912",
                    "CPUQuotaPerSecUSec": "1s", "TasksMax": "32", "KillMode": "control-group", "CapabilityBoundingSet": "",
                    "AmbientCapabilities": "", "ProtectControlGroups": "yes", "ProtectKernelTunables": "yes",
                    "ProtectKernelModules": "yes", "RestrictSUIDSGID": "yes", "UMask": "0077", "StateDirectoryMode": "0700"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def hex_value(value, size):
    if type(value) is not str or not re.fullmatch("[a-f0-9]{%d}" % size, value):
        raise ValueError("canonical_hex_required")
    return value


def operation(value, execution=False):
    if type(value) is not dict or set(value) != EXPECTED or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("exact_qualification_operation_required")
    hex_value(value["operation_id"], 32)
    hex_value(value["runtime_commit"], 40)
    if type(value["systemd_major"]) is not int or value["systemd_major"] != 255:
        raise PermissionError("reviewed_systemd255_name_format_required")
    hex_value(value["systemd_version_sha256"], 64)
    if execution and value["systemd_version_sha256"] == "0"*64:
        raise PermissionError("actual_systemd_version_pin_required")
    if type(value["execute"]) is not bool or (execution and value["execute"] is not True):
        raise PermissionError("preparation_only_not_released")
    if type(value["jobs"]) is not dict or set(value["jobs"]) != {"success", "failure", "cancellation"}:
        raise ValueError("exact_three_jobs_required")
    for job in value["jobs"].values():
        hex_value(job, 32)
    if len(set(value["jobs"].values())) != 3:
        raise ValueError("distinct_job_ids_required")
    for field, names in (("runtime_sha256", RUNTIME), ("harness_sha256", HARNESS)):
        if type(value[field]) is not dict or set(value[field]) != names:
            raise ValueError("exact_pinned_code_set_required")
        for sha in value[field].values():
            hex_value(sha, 64)
    if execution and (value["runtime_commit"] == "0"*40 or any(h == "0"*64 for h in value["runtime_sha256"].values())):
        raise PermissionError("frozen_runtime_required")
    return value


def unit(job):
    return "admin-dev-" + hex_value(job, 32) + "-g1.service"


def properties(value):
    if type(value) is not dict or any(value.get(k) != v for k, v in LIMIT_PROPERTIES.items()):
        raise PermissionError("effective_unit_isolation_or_limits_mismatch")
    if not {"/tmp", "/var/tmp", "/mnt/apps/peticao-final/.runtime"} <= set(value.get("InaccessiblePaths", "").split()):
        raise PermissionError("system_tmp_and_project_direct_access_not_masked")
    hex_value(value.get("InvocationID"), 32)
    return True


def accept_results(values):
    if type(values) is not dict or set(values) != {"success", "failure", "cancellation"}:
        raise ValueError("complete_three_path_results_required")
    for name, expected in (("success", "completed"), ("failure", "failed"), ("cancellation", "canceled")):
        value = values[name]
        required = {"state", "exit_code", "invocation_id", "unit_stopped", "cgroup_empty", "isolation", "artifact_verified",
                    "receipt_sha256", "state_directory_persisted", "cgroup_pids_before_stop", "physical_backing", "storage_retained", "host_tmp_absent", "unit_reference"}
        if type(value) is not dict or set(value) != required:
            raise ValueError("exact_verified_path_result_required")
        if value.get("state") != expected or value.get("unit_stopped") is not True or value.get("cgroup_empty") is not True:
            raise PermissionError("fixture_outcome_or_quiescence_not_verified")
        hex_value(value.get("invocation_id"), 32)
        hex_value(value.get("receipt_sha256"), 64)
        reference = value["unit_reference"]
        if (type(reference) is not dict or set(reference) != {"backend", "held_before_cleanup", "released_after_retained", "process_id", "worker_boot_id", "invocation_id"}
                or reference["backend"] != "libsystemd-sd-bus" or reference["held_before_cleanup"] is not True
                or reference["released_after_retained"] is not True or type(reference["process_id"]) is not int or reference["process_id"] < 1
                or reference["invocation_id"] != value["invocation_id"]
                or type(reference["worker_boot_id"]) is not str or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", reference["worker_boot_id"])):
            raise PermissionError("real_process_bound_unit_reference_lifetime_required")
        if value["artifact_verified"] is not True:
            raise PermissionError("verified_artifact_custody_required")
        if name == "success" and (type(value.get("exit_code")) is not int or value.get("exit_code") != 0):
            raise PermissionError("success_exit0_required")
        if name == "failure" and (type(value.get("exit_code")) is not int or value.get("exit_code") != 7):
            raise PermissionError("failure_exit7_required")
        if name == "cancellation" and value.get("exit_code") is not None and type(value.get("exit_code")) is not int:
            raise PermissionError("cancel_requires_bound_stop_not_fabricated_exit")
        if value["exit_code"] is not None and not 0 <= value["exit_code"] <= 255:
            raise PermissionError("bounded_actual_exit_status_required")
        if name == "cancellation" and (type(value.get("cgroup_pids_before_stop")) is not int or value["cgroup_pids_before_stop"] < 2):
            raise PermissionError("cancel_must_prove_child_in_same_cgroup")
        if value.get("state_directory_persisted") is not True:
            raise PermissionError("persistent_private_state_directory_required")
        if value["storage_retained"] is not True or value["host_tmp_absent"] is not True or value["physical_backing"] != {"same_device_inode": True, "project_backing": True, "root_private_parent": True, "direct_access_denied": True}:
            raise PermissionError("project_storage_lifecycle_and_tmp_absence_required")
        checks = value.get("isolation")
        if type(checks) is not dict or set(checks) != CHECKS or not all(type(v) is bool and v for v in checks.values()):
            raise PermissionError("actual_namespace_checks_required")
    return True
