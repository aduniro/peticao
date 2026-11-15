"""Sealed root-selected resource recipes and pure, conservative admission.

SOURCE ONLY: no host reads, reservations, installation or qualification. A
passing assessment is a point-in-time capacity check, not a resource lease.
The caller must bind this recipe into the complete root descriptor digest.
Snapshot fields follow the Root read-only capacity receipt: version=1,
observed_unix, affinity_cpus, memory_bytes(MemTotal, MemAvailable), and pressure
for cpu/memory/io with some/full avg10/avg60/avg300/total. Extra receipt metadata
is ignored; optional SwapTotal/SwapFree are validated if supplied. All PSI
averages must be zero (conservative busy policy); historical totals may be >0.
"""
from copy import deepcopy
import math

SOURCE_ONLY = True
QUALIFIED = False
OPERATIONAL_READY = False
DISPATCH_ENABLED = False
INSTALLS_OR_RUNS_HOST = False
MAX_SNAPSHOT_AGE_SECONDS = 30
_GIB = 1024**3


def _recipe(cpu, memory_gib, heap_mib):
    return {
        "version": 1,
        "cpu": cpu,
        "memory_bytes": memory_gib * _GIB,
        "tasks_max": 512,
        "runtime_seconds": 2700,
        "stop_seconds": 30,
        "disk_budget_bytes": 30 * _GIB,
        "disk_budget_is_hard_quota": False,
        "node_heap_mib": heap_mib,
        "workers": 2,
        "measured_minimum": False,
        "admission": {
            "control_cpu_target": 2,
            "control_memory_target_bytes": 8 * _GIB,
            "requires_fresh_host_pressure_and_capacity": True,
            "headroom_guaranteed": False,
            "rounded_marketing_ram_not_authoritative": True,
        },
    }


_PLANS = {
    "balanced-v1": _recipe(4, 8, 3072),
    "heavy-candidate-v1": _recipe(14, 20, 6144),
}


def plan(name):
    """Return an independent fixed recipe; selection belongs to root policy."""
    if type(name) is not str or name not in _PLANS:
        raise ValueError("unknown_resource_plan")
    return deepcopy(_PLANS[name])


def _exact(actual, expected):
    if type(actual) is not type(expected):
        return False
    if type(expected) is dict:
        return (actual.keys() == expected.keys()
                and all(_exact(actual[key], expected[key]) for key in expected))
    return actual == expected


def validate(value):
    """Reject extensions, free values and bool/int/float substitutions."""
    for expected in _PLANS.values():
        if _exact(value, expected):
            return deepcopy(expected)
    raise ValueError("sealed_resource_plan_required")


def systemd_properties(value):
    """Only reviewed resource properties; disk budget is NOT a disk quota."""
    value = validate(value)
    return {
        "CPUQuota": str(value["cpu"] * 100) + "%",
        "MemoryMax": str(value["memory_bytes"]),
        "MemorySwapMax": "0",
        "TasksMax": str(value["tasks_max"]),
        "RuntimeMaxSec": str(value["runtime_seconds"]),
        "TimeoutStopSec": str(value["stop_seconds"]),
    }


def _number(value):
    # Bound before converting an int to float: malformed giant integers must
    # fail closed rather than raise OverflowError inside math.isfinite.
    return (type(value) in (int, float) and 0 <= value <= 2**63 - 1
            and math.isfinite(value))


def _snapshot(value):
    if type(value) is not dict or type(value.get("version")) is not int or value["version"] != 1:
        return False
    if not _number(value.get("observed_unix")):
        return False
    if type(value.get("affinity_cpus")) is not int or value["affinity_cpus"] <= 0:
        return False
    memory = value.get("memory_bytes")
    if type(memory) is not dict:
        return False
    for key in ("MemTotal", "MemAvailable"):
        if type(memory.get(key)) is not int or memory[key] < 0:
            return False
    if memory["MemTotal"] <= 0 or memory["MemAvailable"] > memory["MemTotal"]:
        return False
    for key in ("SwapTotal", "SwapFree"):
        if key in memory and (type(memory[key]) is not int or memory[key] < 0):
            return False
    if "SwapTotal" in memory and "SwapFree" in memory and memory["SwapFree"] > memory["SwapTotal"]:
        return False
    pressure = value.get("pressure")
    if type(pressure) is not dict:
        return False
    for resource in ("cpu", "memory", "io"):
        item = pressure.get(resource)
        if type(item) is not dict:
            return False
        for scope in ("some", "full"):
            metrics = item.get(scope)
            if type(metrics) is not dict:
                return False
            if not all(_number(metrics.get(key)) for key in ("avg10", "avg60", "avg300", "total")):
                return False
            if any(metrics[key] > 100 for key in ("avg10", "avg60", "avg300")):
                return False
    return True


def assess_admission(value, snapshot, now):
    """Return {pass, fail_reasons}; malformed/stale/unknown capacity fails closed.

    Caller supplies trusted RO evidence and time, then must reassess immediately
    before launch under its admission discipline. No qualification or capacity
    guarantee is created. Disk capacity/enforcement is a separate pending gate.
    """
    value = validate(value)
    reasons = []
    if not _number(now):
        reasons.append("invalid_now")
    if not _snapshot(snapshot):
        reasons.append("invalid_snapshot")
    if reasons:
        return {"pass": False, "fail_reasons": reasons}
    age = now - snapshot["observed_unix"]
    if age < 0:
        reasons.append("snapshot_from_future")
    elif age > MAX_SNAPSHOT_AGE_SECONDS:
        reasons.append("snapshot_stale")
    required_cpu = value["cpu"] + value["admission"]["control_cpu_target"]
    required_memory = value["memory_bytes"] + value["admission"]["control_memory_target_bytes"]
    if required_cpu > snapshot["affinity_cpus"]:
        reasons.append("insufficient_cpu_capacity")
    if required_memory > snapshot["memory_bytes"]["MemTotal"]:
        reasons.append("insufficient_memory_capacity")
    if required_memory > snapshot["memory_bytes"]["MemAvailable"]:
        reasons.append("insufficient_memory_available")
    for resource in ("cpu", "memory", "io"):
        if any(snapshot["pressure"][resource][scope][metric] > 0
               for scope in ("some", "full") for metric in ("avg10", "avg60", "avg300")):
            reasons.append("pressure_busy_" + resource)
    return {"pass": not reasons, "fail_reasons": reasons}
