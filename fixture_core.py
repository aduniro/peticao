"""Prepared reusable qualification-A core; no executable phase dispatcher.

Imported functions perform no host action. Explicit calls are for the reviewed
private synthetic fixture only, behind the separately approved frozen harness.
Runtime/broker closure is verified BEFORE imports. Every transport call uses
one frozen UNIX broker exchange; WorkerRPC is retained for server construction
and read-only fixture inspection, never a client launch bypass.
"""
import contextlib
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
PUBLIC = Path("/opt/peticao-dev-worker-broker-qual-20261115-attempt1")
PRIVATE = Path("/mnt/apps/peticao-final/.runtime/civo-worker-broker-qual-20261115-attempt1")
REQUEST = PUBLIC / "RUN-REQUEST.json"
RUNTIME = frozenset({"remote_contract.py", "admission.py", "artifacts.py", "worker.py", "controller.py", "systemd_adapter.py", "log_redaction.py", "cgroups.py", "project_storage.py", "unit_refs.py"})
BROKER = frozenset({"broker_entry.py", "broker_lifecycle.py", "broker_server.py", "broker_wire.py", "broker_proxy.py"})
HARNESS = frozenset({"qualification_contract.py", "fixture_core.py", "qualification_helper.py", "broker_a_server.py", "qualification_job.py", "storage_probe.py"})
MODULES = ("qualification_contract", "remote_contract", "artifacts", "admission", "systemd_adapter", "worker", "controller", "cgroups", "project_storage", "unit_refs", "log_redaction", "storage_probe", "broker_wire", "broker_server", "broker_lifecycle", "broker_entry", "broker_proxy")


def all_jobs(request):
    return {**request["jobs"], "prestart": request["prestart_job_id"]}


def load():
    if os.geteuid() != 0 or socket.gethostname().split(".")[0] != "peticao-civo":
        raise PermissionError("civo_root_operator_required")
    if Path(__file__).absolute() != PUBLIC / "fixture_core.py":
        raise PermissionError("exact_installed_fixture_core_required")
    root_file(PUBLIC, True, 0o755)
    request = read_json(REQUEST)
    if type(request) is not dict:
        raise ValueError("pinned_operation_required")
    groups = (("runtime_sha256", RUNTIME, PUBLIC / "runtime"),
              ("broker_sha256", BROKER, PUBLIC / "broker"),
              ("harness_sha256", HARNESS, PUBLIC))
    for field, names, directory in groups:
        if type(request.get(field)) is not dict or set(request[field]) != names:
            raise ValueError("exact_import_set_required")
    if {p.name for p in PUBLIC.iterdir()} != HARNESS | {"runtime", "broker", "RUN-REQUEST.json", "readonly-marker"}:
        raise PermissionError("unexpected_public_package_member")
    for directory, names in ((PUBLIC / "runtime", RUNTIME), (PUBLIC / "broker", BROKER)):
        root_file(directory, True, 0o755)
        if {p.name for p in directory.iterdir()} != names:
            raise PermissionError("unexpected_frozen_package_member")
    for field, names, directory in groups:
        for name in names:
            sha = request[field][name]
            if type(sha) is not str or not re.fullmatch("[a-f0-9]{64}", sha):
                raise ValueError("exact_code_digest_required")
            path = root_file(directory / name, mode=0o644)
            if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
                raise PermissionError("frozen_code_changed")
    root_file(PUBLIC / "readonly-marker", mode=0o644)
    if (PUBLIC / "readonly-marker").read_bytes() != b"synthetic public readonly marker\n":
        raise ValueError("public_marker_mismatch")
    # All 21 source pins plus request/marker are now validated; never import
    # a preloaded foreign module from outside the exact installed closure.
    sys.path[:0] = [str(PUBLIC), str(PUBLIC / "runtime"), str(PUBLIC / "broker")]
    # Reject every already-loaded dependency before importing any API, since
    # imports such as systemd_adapter may themselves import cgroups/unit_refs.
    for name in MODULES:
        base = PUBLIC / "runtime" if name + ".py" in RUNTIME else PUBLIC / "broker" if name + ".py" in BROKER else PUBLIC
        loaded = sys.modules.get(name)
        if loaded is not None and Path(getattr(loaded, "__file__", "")).absolute() != base / (name + ".py"):
            raise PermissionError("foreign_preloaded_module_refused")
    modules = {}
    for name in MODULES:
        base = PUBLIC / "runtime" if name + ".py" in RUNTIME else PUBLIC / "broker" if name + ".py" in BROKER else PUBLIC
        loaded = sys.modules.get(name)
        if loaded is not None and Path(getattr(loaded, "__file__", "")).absolute() != base / (name + ".py"):
            raise PermissionError("foreign_preloaded_module_refused")
        value = importlib.import_module(name)
        if Path(getattr(value, "__file__", "")).absolute() != base / (name + ".py"):
            raise PermissionError("frozen_module_import_path_changed")
        modules[name] = value
        if name == "qualification_contract":
            value.operation(request, execution=True)
            if value.PUBLIC != PUBLIC or value.PRIVATE != PRIVATE:
                raise PermissionError("qualification_paths_changed")
    return request, modules


def root_file(path, directory=False, mode=None):
    path = Path(path).absolute()
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError("root_controlled_chain_required")
    info = path.lstat()
    if (directory and not stat.S_ISDIR(info.st_mode)) or (not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)):
        raise PermissionError("root_controlled_type_required")
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        raise PermissionError("existing_mode_mismatch_no_chmod")
    return path



def read_json(path):
    path = root_file(path)
    with path.open("rb") as stream:
        raw = stream.read(2*1024*1024 + 1)
    if len(raw) > 2*1024*1024:
        raise ValueError("bounded_control_json_required")
    return json.loads(raw)



def boot_id():
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()



def command(argv):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}).stdout



def actual_version(request, modules):
    value = subprocess.run(["/usr/bin/systemctl", "--version"], check=True, capture_output=True, timeout=10,
                           env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}).stdout
    return modules["storage_probe"].version_evidence(value, request["systemd_version_sha256"], request["systemd_major"])



def baseline():
    raw = command(["/usr/bin/systemctl", "list-units", "--type=service", "--state=running", "--no-pager", "--no-legend", "--plain"])
    units = []
    for line in raw.splitlines():
        name = line.split()[0]
        if not re.fullmatch(r"[a-zA-Z0-9_.@:\\-]+\.service", name):
            raise ValueError("unexpected_baseline_unit_name")
        # Sessions/gettys may legitimately change as SSH sessions open/close.
        if name.startswith(("user@", "session-", "getty@", "serial-getty@")):
            continue
        units.append(name)
    if len(units) > 500:
        raise ValueError("bounded_service_baseline_required")
    return {unit: command(["/usr/bin/systemctl", "show", unit, "--property=MainPID,InvocationID", "--no-pager"]).splitlines() for unit in units}



def durable(modules, name, value):
    if not re.fullmatch(r"[a-z0-9-]+\.json", name):
        raise ValueError("fixed_evidence_name_required")
    modules["artifacts"].durable_json(PRIVATE / name, value)



def bootstrap(request, modules):
    q, c, a = modules["qualification_contract"], modules["remote_contract"], modules["artifacts"]
    root_file(PRIVATE.parent, True)  # Never create/chmod an existing parent.
    if os.path.lexists(PRIVATE):
        raise PermissionError("occupied_attempt_refused_no_reinitialization")
    version = actual_version(request, modules)
    # All four exact unit/state names must be absent before creating the attempt.
    adapter = modules["systemd_adapter"].SystemdAdapter()
    for job in all_jobs(request).values():
        unit = q.unit(job)
        if adapter.properties(unit)["LoadState"] != "not-found":
            raise PermissionError("preexisting_fixture_unit_refused")
        name = adapter.state_name({"job_id": job, "generation": 1})
        if any(os.path.lexists(Path(base)/name) for base in ("/var/lib", "/var/lib/private")):
            raise PermissionError("preexisting_fixture_state_directory_refused")
    PRIVATE.mkdir(mode=0o700)
    durable(modules, "bootstrap-intent.json", {"operation_sha256": q.digest(request), "boot_id": boot_id(), "units": [q.unit(j) for j in all_jobs(request).values()]})
    for name in ("control", "queue", "journal", "exports", "custody", "tokens", "job-backing"):
        (PRIVATE / name).mkdir(mode=0o700)
    a.durable_json(PRIVATE / "baseline-before.json", baseline())
    a.durable_json(PRIVATE / "version.json", version)
    fd = os.open(PRIVATE / "private-marker", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(b"synthetic root-private marker; not a credential\n"); stream.flush(); os.fsync(stream.fileno())
    epoch = {"generation": 1, "primary_host": "civo", "coordinator_boot_id": boot_id(), "operation_id": request["operation_id"]}
    a.durable_json(PRIVATE / "control/epoch.json", epoch)
    a.durable_json(PRIVATE / "queue/authority.json", {"role": "primary", "generation": 1, "armed_boot_id": boot_id()})
    # Explicit fixture-only schema; no operational queue or second scheduler.
    queue = PRIVATE / "queue/queue.sqlite"
    fd = os.open(queue, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600); os.close(fd)
    with sqlite3.connect(queue) as db:
        db.executescript("CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT,digest TEXT,state TEXT,generation INTEGER,created_at TEXT,updated_at TEXT,started_at TEXT,finished_at TEXT,exit_code INTEGER,error TEXT);CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,job_id TEXT,kind TEXT,data TEXT);")
    c.WorkerJournal.initialize(PRIVATE / "journal/receipts.sqlite", "civo", 1)
    fd = os.open(PRIVATE / "journal/admission.lock", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600); os.close(fd)
    fd = os.open(PRIVATE / "execution.lock", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600); os.close(fd)
    a.durable_json(PRIVATE / "journal/admission.json", {"enabled": False, "epoch_sha256": c.digest(epoch)})
    python = Path(sys.executable).resolve()
    root_file(python)
    python_sha = hashlib.sha256(python.read_bytes()).hexdigest()
    program_sha = hashlib.sha256((PUBLIC / "qualification_job.py").read_bytes()).hexdigest()
    profiles = {name: {"name": name, "program": str(PUBLIC / "qualification_job.py"), "program_sha256": program_sha,
                       "python_path": str(python), "python_sha256": python_sha, "source_sha256": program_sha,
                       "dependencies_sha256": c.digest({"python": python_sha}), "artifact_policy_sha256": c.digest({"protocol": 1, "max": a.MAX_BYTES})}
                for name in ("fixture-pass", "fixture-fail")}
    a.durable_json(PRIVATE / "profiles.json", profiles)
    context = build(request, modules, install=True)
    import secrets
    for path, job in all_jobs(request).items():
        a.durable_json(PRIVATE / "tokens" / (job + ".json"), {"token": secrets.token_hex(32)})
    durable(modules, "bootstrap-receipt.json", {"prepared": True, "boot_id": boot_id(), "job_count": 4, "admission_enabled": False})
    return context



def build(request, modules, install=False, references=None):
    c = modules["remote_contract"]
    root_file(PRIVATE, True, 0o700)
    intent = read_json(PRIVATE / "bootstrap-intent.json")
    if intent["operation_sha256"] != modules["qualification_contract"].digest(request) or intent["boot_id"] != boot_id():
        raise PermissionError("attempt_operation_or_boot_changed")
    profiles = read_json(PRIVATE / "profiles.json")
    hashes = {name: c.digest(value) for name, value in profiles.items()}
    guard = c.EpochGuard(PRIVATE / "control/epoch.json")
    authority = c.Authority(PRIVATE / "queue/authority.json", boot_id, guard, "civo", request["operation_id"])
    claims = c.Claims(PRIVATE / "queue/queue.sqlite", authority, hashes)
    journal = c.WorkerJournal(PRIVATE / "journal/receipts.sqlite", "civo", 1, boot_id, hashes, guard)
    if install:
        claims.install_schema(1)
        modules["worker"].WorkerRPC.install_schema(journal)
    admission = modules["admission"].Admission(PRIVATE / "journal")
    storage = modules["project_storage"].ProjectStorage(PRIVATE / "job-backing")
    adapter = modules["systemd_adapter"].SystemdAdapter(storage=storage, references=references)
    worker = modules["worker"].WorkerRPC(journal, adapter, profiles, PRIVATE / "exports", admission)
    store = modules["artifacts"].ArtifactStore(PRIVATE / "custody")
    finalizer = modules["controller"].Finalizer(claims, store)
    class Transport:
        def __init__(self):
            self.drop = False
        def call(self, node, data):
            if node != "civo":
                raise PermissionError("local_fixture_worker_only")
            q = modules["qualification_contract"]
            modules["broker_server"].trusted_endpoint(q.SOCKET)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(15)
                client.connect(str(q.SOCKET))
                reply = modules["broker_wire"].proxy_once(client, data)
            if type(reply) is not dict:
                raise RuntimeError("broker_fixture_outcome_unknown_observe_same_id")
            if set(reply) == {"ok", "error_type"} and reply.get("ok") is False:
                # Only frozen wire class names cross the boundary; never echo
                # exception text or infer that a failed exchange is retryable.
                kind = reply["error_type"]
                if type(kind) is not str or not re.fullmatch("[A-Za-z_][A-Za-z0-9_]{0,63}", kind):
                    raise RuntimeError("broker_fixture_outcome_unknown_observe_same_id")
                allowed = {"PermissionError": PermissionError, "ValueError": ValueError,
                           "RuntimeError": RuntimeError}
                if kind in {"OutcomeUncertain", "RetirementUncertain"}:
                    raise modules["broker_wire"].OutcomeUncertain("broker_fixture_outcome_unknown_observe_same_id")
                raise allowed.get(kind, RuntimeError)("broker_fixture_request_rejected_no_replay")
            if set(reply) != {"ok", "result"} or reply.get("ok") is not True or type(reply.get("result")) is not dict:
                raise RuntimeError("broker_fixture_outcome_unknown_observe_same_id")
            value = reply["result"]
            if data["action"] == "start" and self.drop:
                self.drop = False
                raise ConnectionError("synthetic_lost_start_response_observe_same_id")
            return value
    transport = Transport()
    backend = modules["controller"].Backend(claims, transport, finalizer)
    return {"profiles": profiles, "claims": claims, "journal": journal, "admission": admission, "adapter": adapter,
            "worker": worker, "store": store, "transport": transport, "backend": backend, "cgroups": modules["cgroups"], "storage": storage, "references": references}



def enqueue(request, modules, context, path):
    c = modules["remote_contract"]
    if type(path) is not str or path not in {"success", "failure", "cancellation", "prestart"}:
        raise ValueError("fixed_fixture_path_required")
    job = all_jobs(request)[path]
    profile = "fixture-pass" if path in {"success", "prestart"} else "fixture-fail"
    descriptor = context["profiles"][profile]
    payload = {"backend": c.BACKEND, "kind": profile, "worker_id": "civo"}
    manifest = {"backend": c.BACKEND, "job_id": job, "generation": 1, "worker_id": "civo", "profile": profile,
                "profile_sha256": c.digest(descriptor), **{k: descriptor[k] for k in ("source_sha256", "dependencies_sha256", "artifact_policy_sha256")},
                "payload_sha256": c.digest(payload), "coordinator_host": "civo", "coordinator_boot_id": boot_id(),
                "authority_operation_id": request["operation_id"], "epoch_sha256": c.digest(read_json(PRIVATE / "control/epoch.json"))}
    c.validate_manifest(manifest, context["journal"].profiles)
    durable(modules, path + "-enqueue-intent.json", {"manifest": manifest})
    with c.transaction(context["claims"].path, True) as db:
        db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,'queued',1,?,?)", (job, c.canonical(payload), c.digest(payload), c.now(), c.now()))
        context["claims"]._event(db, job, "queued", {"synthetic_qualification": True})
    return manifest



def assert_unit(modules, context, manifest):
    row, binding = context["worker"].stored(manifest["job_id"])
    receipt = json.loads(row["receipt_json"])
    if not binding:
        raise RuntimeError("actual_unit_binding_missing_observe_only")
    fields = list(modules["qualification_contract"].LIMIT_PROPERTIES) + ["InvocationID", "InaccessiblePaths"]
    raw = context["adapter"].command(["/usr/bin/systemctl", "show", receipt["unit"], "--no-pager", "--property=" + ",".join(fields)])
    values = dict(line.split("=", 1) for line in raw.splitlines())
    modules["qualification_contract"].properties(values)
    if values["InvocationID"] != binding["invocation_id"]:
        raise PermissionError("effective_invocation_changed")
    return receipt, binding



def wait_for(context, manifest, cancellation=False):
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        value = context["backend"].observe(manifest)
        if value.get("reconciliation_required"):
            raise RuntimeError("worker_reboot_observe_only")
        state = value.get("unit")
        if state and (state["main_pid"] > 0 if cancellation else state["exited"] and state["main_pid"] == 0):
            if cancellation:
                row, _ = context["worker"].stored(manifest["job_id"])
                receipt = json.loads(row["receipt_json"])
                root = context["adapter"].output_root(manifest, receipt, context["profiles"][manifest["profile"]])
                if not (root / "artifacts/isolation.json").is_file():
                    time.sleep(0.1); continue
                if not (root / "artifacts/child-started.json").is_file() or cgroup_pids(state["cgroup_path"], context["cgroups"]) < 2:
                    time.sleep(0.1); continue
            return state
        time.sleep(0.1)
    raise TimeoutError("observe_same_id_only_no_restart")



def cgroup_pids(path, reader):
    if not re.fullmatch(r"/system.slice/admin-dev-[a-f0-9]{32}-g1\.service", path):
        raise ValueError("own_fixture_cgroup_required")
    value = reader.snapshot(path)
    if (set(value) != {"empty", "absent", "pids_count", "populated"} or value["absent"] is not False
            or type(value["pids_count"]) is not int or value["pids_count"] < 0
            or value["populated"] not in {0, 1} or bool(value["pids_count"]) != bool(value["populated"])
            or value["empty"] != (value["pids_count"] == 0)):
        raise RuntimeError("own_cgroup_observation_incomplete_or_changed")
    return value["pids_count"]



def outcome(modules, context, manifest, expected):
    c = modules["remote_contract"]
    with c.transaction(context["claims"].path) as db:
        job, claim, _ = context["claims"]._identity(db, manifest)
    result = json.loads(claim["result_json"])
    proof = result["unit_stop"]
    receipt = json.loads(claim["receipt_json"])
    observed = context["store"].observe(result["identity"])
    if observed["state"] != "verified" or job["state"] != expected:
        raise PermissionError("fixture_result_or_custody_unverified")
    # Read only own synthetic probe from the verified worker export, not logs.
    root = context["adapter"].output_root(manifest, receipt, context["profiles"][manifest["profile"]])
    storage_proof = context["storage"].verify(manifest, receipt)
    if root != Path(storage_proof["source"]) or not root.is_relative_to(PRIVATE / "job-backing") or not root.is_dir() or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise PermissionError("persistent_project_state_directory_required")
    probe = json.loads(modules["artifacts"].file_bytes(root / "artifacts/isolation.json", 32768))
    isolation = probe["checks"]
    physical = modules["storage_probe"].backing_evidence(storage_proof, c.digest(manifest), c.digest(receipt), receipt["boot_id"], probe["filesystem"], PRIVATE / "job-backing" / modules["project_storage"].state_name(manifest))
    return {"state": job["state"], "exit_code": result["exit_code"], "invocation_id": proof["invocation_id"],
            "unit_stopped": proof["unit_stopped"], "cgroup_empty": proof["cgroup_empty"], "isolation": isolation,
            "artifact_verified": True, "receipt_sha256": c.digest(receipt), "state_directory_persisted": True, "physical_backing": physical}



def process_identity(pid):
    if type(pid) is not int or pid < 1:
        raise ValueError("positive_process_id_required")
    fields = Path("/proc/" + str(pid) + "/stat").read_text().rpartition(") ")[2].split()
    return {"pid": pid, "start_ticks": fields[19], "boot_id": boot_id()}



def alive(value):
    if value.get("boot_id") != boot_id() or type(value.get("pid")) is not int:
        raise PermissionError("runner_identity_boot_mismatch")
    try:
        return process_identity(value["pid"]) == {key: value[key] for key in ("pid", "start_ticks", "boot_id")}
    except FileNotFoundError:
        return False



@contextlib.contextmanager
def execution_lock():
    path = root_file(PRIVATE / "execution.lock", mode=0o600)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("runner_active_observe_only") from None
        yield
    finally:
        os.close(fd)



def retained(context, modules, manifest, receipt, binding):
    status = context["storage"].status(manifest, receipt)
    if (status.get("state") != "retained" or status.get("mount_absent") is not True
            or status.get("stopped_invocation_id") != binding["invocation_id"]
            or status.get("manifest_sha256") != modules["remote_contract"].digest(manifest)
            or status.get("receipt_sha256") != modules["remote_contract"].digest(receipt)):
        raise PermissionError("retained_own_storage_receipt_required")
    source = Path(status["source"])
    if not source.is_relative_to(PRIVATE / "job-backing") or source.is_symlink():
        raise PermissionError("retained_source_outside_private_project")
    info = source.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError("retained_source_not_root_private")
    return status



def host_tmp_proof(audit):
    value = audit.proof()
    if value.get("scope") != "manager_host_tmp_roots" or value.get("manager_namespace_verified") is not True:
        raise PermissionError("actual_service_manager_host_tmp_evidence_required")
    return value



def reference_snapshot(value, state, unit, invocation, pid, boot):
    fields = {"unit", "invocation_id", "state", "process_id", "worker_boot_id", "connection_uncertain", "backend"}
    if (type(value) is not dict or set(value) != fields or value["unit"] != unit or value["invocation_id"] != invocation
            or value["state"] != state or type(value["process_id"]) is not int or value["process_id"] != pid
            or value["worker_boot_id"] != boot or value["connection_uncertain"] is not False
            or value["backend"] != "libsystemd-sd-bus"):
        raise PermissionError("real_same_runner_reference_lifetime_required")



def reference_proof(before, after, unit, invocation, pid, boot):
    reference_snapshot(before, "held", unit, invocation, pid, boot)
    reference_snapshot(after, "released", unit, invocation, pid, boot)
    return {"backend": "libsystemd-sd-bus", "held_before_cleanup": True, "released_after_retained": True,
            "process_id": pid, "worker_boot_id": boot, "invocation_id": invocation}



def new_reference_keeper(modules):
    # Deliberately default factory, exactly once in the persistent runner. Never
    # pass a fake factory or share a connection with one-shot observer helpers.
    keeper = modules["unit_refs"].UnitReferences()
    if keeper.bus.backend_kind != "libsystemd-sd-bus" or keeper.pid != os.getpid() or keeper.boot != boot_id():
        raise PermissionError("real_runner_owned_unit_reference_backend_required")
    keeper.check()
    return keeper



def close_reference_session(keeper, units):
    keeper.check()
    if (set(keeper.records) != set(units) or len(units) != 3
            or any(r["state"] != "released" for r in keeper.records.values())
            or keeper.bus.backend_kind != "libsystemd-sd-bus" or keeper.pid != os.getpid() or keeper.boot != boot_id()):
        raise PermissionError("all_three_same_runner_references_must_be_released")
    keeper.close()
    if keeper.closed is not True:
        raise PermissionError("reference_session_not_closed")
    return {"backend": "libsystemd-sd-bus", "process_id": os.getpid(), "worker_boot_id": boot_id(),
            "released_count": 3, "closed": True}



def validate_reference_session(session, values, runner):
    if (type(session) is not dict or set(session) != {"backend", "process_id", "worker_boot_id", "released_count", "closed"}
            or session["backend"] != "libsystemd-sd-bus" or session["worker_boot_id"] != boot_id()
            or type(session["process_id"]) is not int or session["process_id"] < 1 or session["process_id"] != runner["pid"]
            or runner["boot_id"] != session["worker_boot_id"]
            or type(session["released_count"]) is not int or session["released_count"] != 3 or session["closed"] is not True
            or any(value["unit_reference"]["process_id"] != session["process_id"] or value["unit_reference"]["worker_boot_id"] != session["worker_boot_id"] for value in values.values())):
        raise PermissionError("final_reference_session_not_verified")

