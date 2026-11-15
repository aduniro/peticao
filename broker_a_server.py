"""Attempt-A broker harness: real pinned lifecycle/reference owner, never a queue.

The only executable entry accepts incarnation 1/2 and the frozen request digest.
Local unit tests exercise pure guards/record sanitization with injected objects;
this source preparation does not qualify a native bus, socket or host runtime.
"""
import importlib
import json
import os
from pathlib import Path
import socket
import stat
import sys

PUBLIC = Path("/opt/peticao-dev-worker-broker-qual-20261115-attempt1")


def private_directory(path, owner=None):
    owner = os.geteuid() if owner is None else owner
    path = Path(path).absolute()
    for ancestor in [*reversed(path.parents), path]:
        if stat.S_ISLNK(ancestor.lstat().st_mode):
            raise PermissionError("private_directory_symlink")
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError("owned_private_directory_required")
    return path


def private_json(path):
    path = Path(path)
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            raise PermissionError("private_regular_proof_required")
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("bounded_private_proof_required")
    return json.loads(raw)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_once(path, value):
    path = Path(path)
    private_directory(path.parent)
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
    if len(raw) > 65536:
        raise ValueError("bounded_private_proof_required")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    finally:
        sync_directory(path.parent)


def process_identity(incarnation, request, request_sha256, contract):
    if type(incarnation) is not str or incarnation not in {"1", "2"}:
        raise ValueError("fixed_incarnation_required")
    contract.hex_value(request_sha256, 64)
    # /proc stat's comm may contain spaces or parentheses; fields start after
    # the final ')' and starttime is field22 (index19 from state/field3).
    fields = Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()
    ticks = int(fields[19])
    if ticks < 1:
        raise PermissionError("actual_process_start_ticks_required")
    return {"incarnation": incarnation, "operation_id": request["operation_id"],
            "request_sha256": request_sha256, "pid": os.getpid(), "start_ticks": str(ticks),
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}


def allowed_reference_records(references, request, contract, require_released=False, incarnation=None):
    expected = {contract.unit(job) for job in request["jobs"].values()}
    records = references.records
    if type(records) is not dict or set(records) - expected:
        raise PermissionError("only_three_fixture_reference_units_required")
    if require_released:
        if references.lost or references.closed:
            raise PermissionError("original_healthy_reference_owner_required")
        if incarnation == "1" and set(records) != expected:
            raise PermissionError("three_released_original_references_required")
        if incarnation == "2" and records:
            raise PermissionError("restart_must_not_rearm_references")
        if any(record.get("state") != "released" for record in records.values()):
            raise PermissionError("all_fixture_references_released_before_quarantine")
    return sorted(records)


def can_remove_socket(references):
    return not references.lost and all(record.get("state") == "released" for record in references.records.values())


def remove_same_socket(path, identity, references):
    if not can_remove_socket(references):
        return False
    info = Path(path).lstat()
    if not stat.S_ISSOCK(info.st_mode) or (info.st_dev, info.st_ino) != identity:
        raise PermissionError("original_exclusive_socket_required_for_removal")
    Path(path).unlink()
    sync_directory(Path(path).parent)
    return True


class TracedLifecycle:
    """Delegates actual V3 checks; writes only allowlisted fixture observations."""
    def __init__(self, lifecycle, context, request, contract, identity, socket_identity):
        self.lifecycle, self.context, self.request, self.contract = lifecycle, context, request, contract
        self.identity = identity
        if (type(socket_identity) is not dict or set(socket_identity) != {"device", "inode"}
                or any(type(value) is not int or value < 1 for value in socket_identity.values())):
            raise ValueError("exclusive_listener_device_inode_required")
        self.socket_identity = dict(socket_identity)
        self.root = private_directory(contract.PRIVATE)
        self.incarnation = identity["incarnation"]
        self.started = False
        self.quarantine_attempted = False
        self.trace = self.root / ("ref-trace-" + self.incarnation + ".jsonl")
        fd = os.open(self.trace, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd); sync_directory(self.root)

    @property
    def references(self):
        return self.lifecycle.references

    @property
    def uncertain(self):
        return self.lifecycle.uncertain

    @uncertain.setter
    def uncertain(self, value):
        self.lifecycle.uncertain = value

    def _append(self, value):
        raw = (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
        if len(raw) > 65536:
            raise ValueError("bounded_reference_trace_required")
        fd = os.open(self.trace, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "ab") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size + len(raw) > 4 * 1024 * 1024):
                raise PermissionError("private_bounded_reference_trace_required")
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())

    def _job(self, request):
        job = request.get("manifest", {}).get("job_id") if type(request.get("manifest")) is dict else request.get("id")
        allowed = set(self.request["jobs"].values()) | {self.request["prestart_job_id"]}
        if type(job) is not str or job not in allowed:
            raise PermissionError("only_four_qualification_fixture_jobs_required")
        return job

    def _storage(self, job):
        row, binding = self.context["worker"].stored(job)
        manifest, receipt = json.loads(row["manifest_json"]), json.loads(row["receipt_json"])
        status = self.context["storage"].status(manifest, receipt)
        safe = {key: status[key] for key in ("state", "mount_absent", "manifest_sha256", "receipt_sha256", "stopped_invocation_id") if key in status}
        return manifest, receipt, binding, safe

    def _record(self, stage, job):
        units = allowed_reference_records(self.references, self.request, self.contract)
        own = self.contract.unit(job)
        snapshot = None
        if own in units:
            original = self.references.snapshot(own)
            snapshot = {key: original[key] for key in ("unit", "invocation_id", "state", "process_id", "worker_boot_id", "connection_uncertain", "backend")}
        _, _, _, storage = self._storage(job)
        self._append({"identity": self.identity, "stage": stage, "job_id": job,
                      "reference": snapshot, "reference_count": len(units), "storage": storage})

    def startup(self):
        result = self.lifecycle.startup()
        self.started = True
        write_once(self.root / ("ready-" + self.incarnation + ".json"),
                   {"identity": self.identity, "socket_identity": self.socket_identity,
                    "startup": result, "reference_count": len(self.references.records)})
        return result

    def _quarantine(self, trigger):
        if not self.started:
            raise PermissionError("actual_lifecycle_startup_required")
        if private_json(trigger) != {"identity": self.identity}:
            raise PermissionError("exact_current_server_quarantine_identity_required")
        units = allowed_reference_records(self.references, self.request, self.contract, True, self.incarnation)
        # Re-read all three durable receipts and real retained storage. Inc2
        # has no records by design: startup reconciled without Ref acquisition.
        proofs = []
        for job in sorted(self.request["jobs"].values()):
            manifest, receipt, binding, _ = self._storage(job)
            retained = self.lifecycle.retained(manifest, receipt, binding)
            saved = self.lifecycle.read(self.lifecycle.root / job / "receipt.json")
            intent = self.lifecycle.read(self.lifecycle.root / job / "intent.json")
            self.contract.hex_value(intent.get("custody_receipt_sha256"), 64)
            expected = {"job_id": job, "generation": manifest["generation"],
                        "manifest_sha256": self.contract.digest(manifest),
                        "receipt_sha256": self.contract.digest(receipt),
                        "bundle_sha256": binding["bundle_sha256"],
                        "custody_receipt_sha256": intent["custody_receipt_sha256"],
                        "invocation_id": binding["invocation_id"], "worker_boot_id": receipt["boot_id"]}
            if intent != expected or saved != {"state": "retained", "identity": expected, "unit_reference_released": True}:
                raise PermissionError("three_actual_retirement_receipts_required")
            proofs.append({"job_id": job, "retained": retained["state"], "mount_absent": retained["mount_absent"]})
        self.quarantine_attempted = True
        self.references.bus.close()  # Real connection, after every Ref released.
        try:
            self.lifecycle.check()
        except Exception as error:
            if type(error).__name__ != "ReferenceUncertain" or not self.references.lost:
                raise PermissionError("actual_reference_check_must_latch_loss") from None
            self.lifecycle.uncertain = True
            write_once(self.root / ("quarantine-proof-" + self.incarnation + ".json"),
                       {"identity": self.identity, "error_type": type(error).__name__,
                        "refsLostTrue": self.references.lost is True, "recordsCount": len(units),
                        "retained": proofs, "scope": "closed_connection_after_release_no_held_reference_io_claim"})
            raise
        raise PermissionError("closed_native_bus_was_not_detected")

    def check(self):
        trigger = self.root / ("quarantine-" + self.incarnation + ".json")
        if os.path.lexists(trigger) and not self.quarantine_attempted:
            self._quarantine(trigger)
        return self.lifecycle.check()

    def __call__(self, request):
        job = self._job(request)
        action = request.get("action")
        if action == "retire":
            self._record("before-retire", job)
        result = self.lifecycle(request)
        if action == "retire":
            self._record("after-retire", job)
        return result


def _load_core():
    # -I excludes the script directory. Add only the fixed root-public package
    # after checking ancestors and the bootstrap files, before local imports.
    if os.geteuid() != 0 or socket.gethostname().split(".")[0] != "peticao-civo" or Path(__file__).absolute() != PUBLIC / "broker_a_server.py":
        raise PermissionError("fixed_root_qualification_server_required")
    for directory in [*reversed(PUBLIC.parents), PUBLIC]:
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or not info.st_mode & 0o001:
            raise PermissionError("root_public_harness_directory_required")
    for name in ("broker_a_server.py", "qualification_contract.py", "fixture_core.py"):
        fd = os.open(PUBLIC / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in {0o444, 0o644}:
                raise PermissionError("root_public_harness_bootstrap_required")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(PUBLIC))
    return importlib.import_module("qualification_contract"), importlib.import_module("fixture_core")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"1", "2"}:
        raise ValueError("fixed_incarnation_and_request_digest_required")
    contract, core = _load_core()
    request, modules = core.load()
    # Frozen verifier reads only namespace identities; it does not load the
    # global broker policy, authority floor or deployed runtime qualification.
    modules["broker_entry"].manager_namespace()
    contract.operation(request)
    if contract.digest(request) != contract.hex_value(sys.argv[2], 64):
        raise PermissionError("frozen_request_digest_required")
    keeper = modules["unit_refs"].UnitReferences()
    context = core.build(request, modules, references=keeper)
    lifecycle = modules["broker_lifecycle"].Lifecycle(context["worker"], keeper, contract.PRIVATE / "retirements")
    identity = process_identity(sys.argv[1], request, sys.argv[2], contract)
    private_directory(contract.SOCKET_PARENT, owner=0)
    if os.path.lexists(contract.SOCKET):
        raise PermissionError("exclusive_socket_no_reuse_required")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(str(contract.SOCKET)); os.chmod(contract.SOCKET, 0o600)
        info = contract.SOCKET.lstat()
        socket_identity = (info.st_dev, info.st_ino)
        listener.listen(8)
        try:
            wrapper = TracedLifecycle(lifecycle, context, request, contract, identity,
                                      {"device": info.st_dev, "inode": info.st_ino})
            modules["broker_server"].Server(wrapper).run(listener)
        finally:
            remove_same_socket(contract.SOCKET, socket_identity, keeper)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__}))
        raise SystemExit(1)
