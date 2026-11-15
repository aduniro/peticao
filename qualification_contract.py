"""Pure contracts: no imports from unfrozen runtime and no host operations."""
import hashlib
import json
from pathlib import Path
import re

PUBLIC = Path("/opt/peticao-dev-short-alias-native-20261115-attempt1")
PRIVATE = Path("/mnt/apps/peticao-final/.runtime/civo-short-alias-native-20261115-attempt1")
SOCKET_PARENT = Path("/run/peticao-dev-short-alias-native-20261115-attempt1")
SOCKET = SOCKET_PARENT / "worker.sock"
HOST = "peticao-civo"
EXPECTED = {"version", "operation_id", "jobs", "prestart_job_id", "broker_commit", "broker_sha256", "runtime_commit", "runtime_sha256", "harness_sha256", "execute", "systemd_major", "systemd_version_sha256"}
RUNTIME = {"remote_contract.py", "admission.py", "artifacts.py", "worker.py", "controller.py", "systemd_adapter.py", "log_redaction.py", "cgroups.py", "project_storage.py", "unit_refs.py"}
BROKER = {"broker_entry.py", "broker_lifecycle.py", "broker_server.py", "broker_wire.py", "broker_proxy.py"}
HARNESS = {"qualification_contract.py", "fixture_core.py", "qualification_helper.py", "broker_a_server.py", "qualification_job.py", "storage_probe.py", "alias_contract.py", "alias_probe.py"}
CHECKS = {"nonroot_uid", "zero_capabilities", "no_new_privileges", "home_masked", "root_masked", "private_marker_unreadable",
          "public_marker_readonly", "docker_socket_inaccessible", "environment_allowlisted", "private_loopback_works", "tailnet_no_route", "system_tmp_inaccessible", "system_var_tmp_inaccessible", "direct_runtime_access_denied"}
LIMIT_PROPERTIES = {"WorkingDirectory": "/run/peticao-dev-work", "TemporaryFileSystem": "/run:rw", "DynamicUser": "yes", "ProtectSystem": "strict", "ProtectHome": "tmpfs", "PrivateNetwork": "yes",
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


def operation(value, execution=True):
    if type(value) is not dict or set(value) != EXPECTED or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("exact_qualification_operation_required")
    hex_value(value["operation_id"], 32)
    hex_value(value["runtime_commit"], 40)
    hex_value(value["broker_commit"], 40)
    hex_value(value["prestart_job_id"], 32)
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
    if len(set(value["jobs"].values()) | {value["prestart_job_id"]}) != 4:
        raise ValueError("four_distinct_job_ids_required")
    for field, names in (("runtime_sha256", RUNTIME), ("broker_sha256", BROKER), ("harness_sha256", HARNESS)):
        if type(value[field]) is not dict or set(value[field]) != names:
            raise ValueError("exact_pinned_code_set_required")
        for sha in value[field].values():
            hex_value(sha, 64)
    if execution and (any(value[f] == "0"*40 for f in ("runtime_commit", "broker_commit")) or any(h == "0"*64 for f in ("runtime_sha256", "broker_sha256", "harness_sha256") for h in value[f].values())):
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
