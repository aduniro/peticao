"""Exact attempt2 recovery contract; prepared source, not executed or installed.

The trusted future port must collect fresh evidence under both locks and execute
only the frozen ProjectStorage cleanup. Arbitrary dictionaries are NOT host
proof. Tests inject synthetic pins/ports explicitly; never expose that seam in RPC.
"""
from dataclasses import dataclass
import hashlib
import json
import re


def digest(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode()).hexdigest()


class Refused(RuntimeError):
    pass


class Uncertain(RuntimeError):
    pass


@dataclass(frozen=True)
class Pins:
    job: str = "8b01b1fa889647a184fbe2424263b588"
    boot: str = "c1626328-a278-4baf-a73e-a08803c08678"
    invocation: str = "267d6c39c47d4ec19c0a611f1271f592"
    manifest_sha256: str = "06b00cf3f2f89f4d89c72d213b9f2dd3a1b7d1b9f61b5d64c7b81f64fa6fdfc7"
    receipt_sha256: str = "7e867461b17490d82b8ec3dd13c490a76eca64348a0b684b4787bd44052476c3"
    bundle_sha256: str = "071bbc6f7b756df18847798000c0b8d76cfa69ccb278cbe7f43b17b72031d933"
    mount_id: int = 64
    device: int = 64769
    inode: int = 2105518
    underlay_inode: int = 2105519
    parent_inode: int = 2105517
    runner_pid: int = 45970

    @property
    def name(self):
        return "peticao-dev-job-" + self.job + "-g1"

    @property
    def unit(self):
        return "admin-dev-" + self.job + "-g1.service"

    @property
    def parent(self):
        return "/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2/job-backing/" + self.name

    @property
    def source(self):
        return self.parent + "/work"

    @property
    def target(self):
        return "/var/lib/private/" + self.name

    @property
    def public(self):
        return "/var/lib/" + self.name

    @property
    def cgroup(self):
        return "/system.slice/" + self.unit


PRODUCTION = Pins()
RESOURCE = "deploy:civo-attempt2-storage-reconciliation"
SESSION = "01a1d130-2948-7140-bcfb-34696b20ab8d"


def require(condition, code):
    if not condition:
        raise Refused(code)


def exact(value, expected):
    return (type(value) is dict and set(value) == set(expected)
            and all(type(value[k]) is type(v) and value[k] == v for k, v in expected.items()))


def authorization(value):
    require(type(value) is dict and set(value) == {"operation_id", "event", "operation", "resource", "session", "fence", "reviewed"}, "exact_new_authority_required")
    require(type(value["operation_id"]) is str and re.fullmatch("[a-f0-9]{32}", value["operation_id"]), "fresh_reconciliation_id_required")
    require(value["operation_id"] != "d071f0d87a954a519b8d0e07233ca370", "old_execution_id_refused")
    require(type(value["event"]) is int and value["event"] > 3151 and type(value["fence"]) is int and value["fence"] > 0, "new_reviewed_event_and_own_fence_required")
    require(value["operation"] == "test" and value["resource"] == RESOURCE and value["session"] == SESSION and value["reviewed"] is True, "exact_canonical_scope_required")
    return value


def history(manifest, receipt, binding, runners, p):
    require(digest(manifest) == p.manifest_sha256 and digest(receipt) == p.receipt_sha256, "actual_manifest_receipt_digest_mismatch")
    require(manifest.get("job_id") == p.job and type(manifest.get("generation")) is int and manifest["generation"] == 1 and manifest.get("worker_id") == "civo", "exact_historical_job_required")
    require(receipt.get("unit") == p.unit and receipt.get("boot_id") == p.boot, "historical_receipt_identity_mismatch")
    require(type(binding) is dict and set(binding) == {"receipt_sha256", "invocation_id", "cgroup_path", "stop_proof", "bundle_sha256"}, "exact_durable_binding_required")
    require(binding["receipt_sha256"] == p.receipt_sha256 and binding["invocation_id"] == p.invocation and binding["cgroup_path"] == p.cgroup and binding["bundle_sha256"] == p.bundle_sha256, "historical_binding_identity_mismatch")
    stopped = binding["stop_proof"]
    expected = {"canceled": False, "cgroup_empty": True, "exit_code": 0, "invocation_id": p.invocation, "main_pid": 0, "receipt_sha256": p.receipt_sha256, "unit": p.unit, "unit_stopped": True, "worker_boot_id": p.boot}
    require(type(stopped) is dict and set(stopped) == set(expected) and all(type(stopped[k]) is type(v) and stopped[k] == v for k, v in expected.items()), "full_durable_own_stop_proof_required")
    require(type(runners) is dict and set(runners) == {"run-intent.json", "runner-receipt.json"}, "both_original_runner_records_required")
    identities = []
    for value in runners.values():
        require(type(value) is dict and type(value.get("pid")) is int and value["pid"] == p.runner_pid and value.get("boot_id") == p.boot, "original_runner_boot_pid_required")
        require(type(value.get("start_ticks")) is str and re.fullmatch("[0-9]+", value["start_ticks"]) and int(value["start_ticks"]) > 0, "original_runner_start_ticks_required")
        identities.append({k: value[k] for k in ("pid", "start_ticks", "boot_id")})
    require(identities[0] == identities[1], "original_runner_records_disagree")
    require(set(runners['run-intent.json']) == {'pid', 'start_ticks', 'boot_id', 'operation_id'} and runners['run-intent.json']['operation_id'] == 'd071f0d87a954a519b8d0e07233ca370', "original_run_operation_required")
    require(set(runners['runner-receipt.json']) == {'pid', 'start_ticks', 'boot_id', 'started_detached'} and runners['runner-receipt.json']['started_detached'] is True, "original_detached_runner_receipt_required")
    return {"manifest_sha256": p.manifest_sha256, "receipt_sha256": p.receipt_sha256,
            "binding_sha256": digest(binding), "runners_sha256": digest(runners), "runner_identity": identities[0]}


def locks(value, manifest):
    require(type(value) is dict and set(value) == {"execution_exclusive", "admission_exclusive", "enabled", "epoch_sha256"}, "exact_lock_receipt_required")
    require(value["execution_exclusive"] is True and value["admission_exclusive"] is True and value["enabled"] is False, "exclusive_closed_admission_required")
    require(type(manifest.get("epoch_sha256")) is str and re.fullmatch("[a-f0-9]{64}", manifest["epoch_sha256"]) and value["epoch_sha256"] == manifest["epoch_sha256"], "same_epoch_closed_required")


def fresh(value, historical, p):
    require(type(value) is dict and set(value) == {"boot_id", "manager_view_verified", "runner_identity", "runner_state", "unit", "cgroup", "mount", "paths", "storage_state", "durable_records_sha256"}, "complete_fresh_snapshot_required")
    require(value["boot_id"] == p.boot and value["manager_view_verified"] is True, "same_boot_manager_view_required")
    require(value["runner_identity"] == historical["runner_identity"] and value["runner_state"] == "absent", "exact_original_runner_must_be_absent")
    require(value["durable_records_sha256"] == {k: historical[k] for k in ("manifest_sha256", "receipt_sha256", "binding_sha256", "runners_sha256")}, "durable_records_changed")
    expected_unit = {"name": p.unit, "LoadState": "not-found", "ActiveState": "inactive", "SubState": "dead", "MainPID": 0, "ControlGroup": "", "InvocationID": ""}
    require(type(value["unit"]) is dict and set(value["unit"]) == set(expected_unit) and all(type(value["unit"][k]) is type(v) and value["unit"][k] == v for k, v in expected_unit.items()), "fresh_collected_exact_unit_required")
    cg = value["cgroup"]
    require(type(cg) is dict and set(cg) == {"path", "v2_mount_verified", "empty", "absent", "pids_count", "populated"}, "fresh_complete_cgroup_required")
    require(cg["path"] == p.cgroup and cg["v2_mount_verified"] is True and cg["empty"] is True and cg["absent"] is True and type(cg["pids_count"]) is int and cg["pids_count"] == 0 and type(cg["populated"]) is int and cg["populated"] == 0, "own_absent_cgroup_under_verified_v2_required")
    expected_mount = {"mount_id": p.mount_id, "device": p.device, "inode": p.inode, "source": p.source, "target": p.target, "underlay_device": p.device, "underlay_inode": p.underlay_inode, "single": True, "nested": False, "rw": True}
    require(type(value["mount"]) is dict and set(value["mount"]) == set(expected_mount) and all(type(value["mount"][k]) is type(v) and value["mount"][k] == v for k, v in expected_mount.items()), "fresh_exact_unique_mount_required")
    paths = value["paths"]
    require(type(paths) is dict and set(paths) == {"parent", "source", "target", "alias"}, "exact_path_identity_required")
    expected_parent = {"path": p.parent, "device": p.device, "inode": p.parent_inode, "uid": 0, "gid": 0, "mode": 448, "no_symlink_chain": True}
    require(exact(paths["parent"], expected_parent), "root_private_parent_required")
    for name, path in (("source", p.source), ("target", p.target)):
        item = paths[name]
        require(type(item) is dict and set(item) == {"path", "device", "inode", "uid", "gid", "mode", "no_symlink_chain"}, "exact_backing_metadata_required")
        require(item["path"] == path and type(item["device"]) is int and item["device"] == p.device and type(item["inode"]) is int and item["inode"] == p.inode and type(item["mode"]) is int and item["mode"] == 448 and item["no_symlink_chain"] is True, "backing_identity_mode_required")
        require(type(item["uid"]) is int and type(item["gid"]) is int and item["uid"] >= 0 and item["gid"] >= 0, "numeric_leaf_ownership_required")
    require(paths["source"]["uid"] == paths["target"]["uid"] and paths["source"]["gid"] == paths["target"]["gid"], "same_bound_leaf_ownership_required")
    require(exact(paths["alias"], {"path": p.public, "uid": 0, "symlink": True, "target": p.target}), "exact_managed_alias_required")
    require(value["storage_state"] == "mounted", "mounted_record_required_no_intent_replay")


def retained(value, p):
    expected = {"state": "retained", "source": p.source, "device": p.device, "inode": p.inode,
                "uid": 0, "mode": 448, "mount_absent": True, "target_absent": True, "alias_absent": True,
                "manifest_sha256": p.manifest_sha256, "receipt_sha256": p.receipt_sha256,
                "stopped_invocation_id": p.invocation, "root_private_parent_preserved": True}
    require(type(value) is dict and set(value) == set(expected) and all(type(value[k]) is type(v) and value[k] == v for k, v in expected.items()), "full_retained_readback_required")


def reconcile(port, *, pins=PRODUCTION):
    """Source-only orchestration. Port is trusted, NOT a public JSON interface.

    exclusive_closed holds execution EX and admission EX and persists closed.
    history reads no-follow root-private originals, journal SQLite read-only.
    snapshot freshly observes manager/proc/cgroup/mount and rehashes originals.
    intent is exclusive+file/dir fsynced BEFORE any cleanup, never overwritten.
    cleanup invokes only exact frozen ProjectStorage cleanup, no stop/start.
    final_readback additionally proves source owner/mode and absent aliases.
    receipt is exclusive+file/dir fsynced; uncertain effects NEVER replayed.
    host.py implements the fixed port; gate.py/client.py implement the canonical
    transport. A NEW independently reviewed execution notice and own Infra lease
    remain prerequisites. Tests never run that port against a host.
    """
    approved = authorization(port.authorize())
    with port.exclusive_closed() as lock_receipt:
        manifest, receipt, binding, runners = port.history()
        historical = history(manifest, receipt, binding, runners, pins)
        locks(lock_receipt, manifest)
        fresh(port.snapshot(), historical, pins)
        require(authorization(port.authorize()) == approved, "authority_changed_before_intent")
        intent = {"operation_id": approved["operation_id"], "event": approved["event"], "fence": approved["fence"],
                  "job_id": pins.job, "stop_proof_sha256": digest(binding["stop_proof"]),
                  "binding_sha256": historical["binding_sha256"], "mount_id": pins.mount_id,
                  "source": pins.source, "target": pins.target, "device": pins.device, "inode": pins.inode}
        # Failure here also requires explicit inspection. The port must NEVER
        # implement a check-then-overwrite intent or consume the old success one.
        try:
            port.new_intent(intent)
        except BaseException:
            raise Uncertain("new_intent_not_confirmed_do_not_retry") from None
        try:
            locks(port.lock_receipt(), manifest)
            fresh(port.snapshot(), historical, pins)
            require(authorization(port.authorize()) == approved, "authority_changed_before_cleanup")
            port.cleanup(manifest, receipt, binding["stop_proof"])
            after = port.final_readback()
            retained(after, pins)
            locks(port.lock_receipt(), manifest)
            require(authorization(port.authorize()) == approved, "authority_changed_before_receipt")
            result = {"state": "EXACT_ATTEMPT2_RECONCILIATION_RETAINED", "operation_id": approved["operation_id"],
                      "event": approved["event"], "intent_sha256": digest(intent), "stop_proof_sha256": digest(binding["stop_proof"]),
                      "retained": after, "qualification_pass": False, "old_attempt_retried": False}
            port.new_receipt(result)
            return result
        except BaseException:
            raise Uncertain("reconciliation_incomplete_preserve_no_replay") from None
