#!/usr/bin/python3 -IB
"""PREPARED root-only helper; fixed attempt, no public listener or installation.

No command runs on import. Actual use requires frozen pins, reviewed operation
with execute=true and a separately leased/approved installation/execution phase.
"""
import contextlib
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
PUBLIC = Path("/opt/peticao-dev-worker-qual-20261114-attempt1")
PRIVATE = Path("/srv/peticao-dev-prep/civo-worker-runtime-qual-20261114-attempt1")
REQUEST = PUBLIC / "RUN-REQUEST.json"
MODULES = ("qualification_contract", "remote_contract", "artifacts", "admission", "systemd_adapter", "worker", "controller")


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


def load():
    if os.geteuid() != 0 or socket.gethostname().split(".")[0] != "peticao-civo":
        raise PermissionError("civo_root_operator_required")
    if Path(__file__).absolute() != PUBLIC / "qualification_helper.py":
        raise PermissionError("exact_installed_helper_required")
    root_file(PUBLIC, True, 0o755)
    request = read_json(REQUEST)
    # Validate names BEFORE using request keys as paths or importing any code.
    runtime_names = {"remote_contract.py", "admission.py", "artifacts.py", "worker.py", "controller.py", "systemd_adapter.py", "log_redaction.py"}
    harness_names = {"qualification_contract.py", "qualification_job.py", "qualification_helper.py"}
    if type(request) is not dict or type(request.get("runtime_sha256")) is not dict or type(request.get("harness_sha256")) is not dict:
        raise ValueError("pinned_operation_required")
    if set(request["runtime_sha256"]) != runtime_names or set(request["harness_sha256"]) != harness_names:
        raise ValueError("exact_import_set_required")
    expected = {**request["runtime_sha256"], **request["harness_sha256"]}
    if set(p.name for p in PUBLIC.iterdir()) != set(expected) | {"RUN-REQUEST.json", "readonly-marker"}:
        raise PermissionError("unexpected_public_package_member")
    for name, sha in expected.items():
        if type(sha) is not str or not re.fullmatch("[a-f0-9]{64}", sha):
            raise ValueError("exact_code_digest_required")
        path = root_file(PUBLIC / name, mode=0o644)
        if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
            raise PermissionError("frozen_code_changed")
    root_file(PUBLIC / "readonly-marker", mode=0o644)
    if (PUBLIC / "readonly-marker").read_bytes() != b"synthetic public readonly marker\n":
        raise ValueError("public_marker_mismatch")
    sys.path.insert(0, str(PUBLIC))
    modules = {name: importlib.import_module(name) for name in MODULES}
    modules["qualification_contract"].operation(request, execution=True)
    return request, modules


def command(argv):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}).stdout


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
    root_file(PRIVATE.parent, True, 0o700)  # Never create/chmod an existing parent.
    if os.path.lexists(PRIVATE):
        raise PermissionError("occupied_attempt_refused_no_reinitialization")
    # All three exact unit/state names must be absent before creating the attempt.
    adapter = modules["systemd_adapter"].SystemdAdapter()
    for job in request["jobs"].values():
        adapter.preflight({"job_id": job, "generation": 1}, {})
    PRIVATE.mkdir(mode=0o700)
    durable(modules, "bootstrap-intent.json", {"operation_sha256": q.digest(request), "boot_id": boot_id(), "units": [q.unit(j) for j in request["jobs"].values()]})
    for name in ("control", "queue", "journal", "exports", "custody", "tokens"):
        (PRIVATE / name).mkdir(mode=0o700)
    a.durable_json(PRIVATE / "baseline-before.json", baseline())
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
    for path, job in request["jobs"].items():
        a.durable_json(PRIVATE / "tokens" / (job + ".json"), {"token": secrets.token_hex(32)})
    durable(modules, "bootstrap-receipt.json", {"prepared": True, "boot_id": boot_id(), "job_count": 3, "admission_enabled": False})
    return context


def build(request, modules, install=False):
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
    adapter = modules["systemd_adapter"].SystemdAdapter()
    worker = modules["worker"].WorkerRPC(journal, adapter, profiles, PRIVATE / "exports", admission)
    store = modules["artifacts"].ArtifactStore(PRIVATE / "custody")
    finalizer = modules["controller"].Finalizer(claims, store)
    class Transport:
        def __init__(self):
            self.drop = False
        def call(self, node, data):
            if node != "civo":
                raise PermissionError("local_fixture_worker_only")
            value = worker.rpc(data)
            if data["action"] == "start" and self.drop:
                self.drop = False
                raise ConnectionError("synthetic_lost_start_response_observe_same_id")
            return value
    transport = Transport()
    backend = modules["controller"].Backend(claims, transport, finalizer)
    return {"profiles": profiles, "claims": claims, "journal": journal, "admission": admission, "adapter": adapter,
            "worker": worker, "store": store, "transport": transport, "backend": backend}


def enqueue(request, modules, context, path):
    c = modules["remote_contract"]
    job = request["jobs"][path]
    profile = "fixture-pass" if path == "success" else "fixture-fail"
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
    fields = list(modules["qualification_contract"].LIMIT_PROPERTIES) + ["InvocationID"]
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
                if not (root / "artifacts/child-started.json").is_file() or cgroup_pids(state["cgroup_path"]) < 2:
                    time.sleep(0.1); continue
            return state
        time.sleep(0.1)
    raise TimeoutError("observe_same_id_only_no_restart")


def cgroup_pids(path):
    if not re.fullmatch(r"/system.slice/admin-dev-[a-f0-9]{32}-g1\.service", path):
        raise ValueError("own_fixture_cgroup_required")
    root = Path("/sys/fs/cgroup") / path.lstrip("/")
    count = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise ValueError("cgroup_link_forbidden")
        if "cgroup.procs" in files:
            count += len((Path(directory) / "cgroup.procs").read_text().split())
    return count


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
    if root.parent != Path("/var/lib/private") or not root.is_dir() or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise PermissionError("persistent_private_state_directory_required")
    isolation = json.loads(modules["artifacts"].file_bytes(root / "artifacts/isolation.json", 32768))["checks"]
    return {"state": job["state"], "exit_code": result["exit_code"], "invocation_id": proof["invocation_id"],
            "unit_stopped": proof["unit_stopped"], "cgroup_empty": proof["cgroup_empty"], "isolation": isolation,
            "artifact_verified": True, "receipt_sha256": c.digest(receipt), "state_directory_persisted": True}


def admission_proof(modules, context, manifest):
    admission = context["admission"]
    with admission.mutation(manifest):
        # Independent exec closes all inherited descriptors; positive mutation
        # baseline and exact error causes prevent false admission qualification.
        expected_operation = modules["qualification_contract"].digest(read_json(REQUEST))
        answer = subprocess.run([str(Path(sys.executable).resolve()), "-I", "-B", str(PUBLIC / "qualification_helper.py"), "probe-ex", expected_operation],
                                capture_output=True, timeout=30, close_fds=True,
                                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
        if answer.returncode or len(answer.stdout) > 1024 or json.loads(answer.stdout) != {"busy": True}:
            raise PermissionError("shared_mutation_did_not_block_exclusive_fence")
    with admission.closed_for_fencing():
        if read_json(PRIVATE / "journal/admission.json")["enabled"] is not False:
            raise PermissionError("persistent_admission_close_not_observed")
    denied = 0
    token = read_json(PRIVATE / "tokens" / (manifest["job_id"] + ".json"))["token"]
    row, _ = context["worker"].stored(manifest["job_id"])
    receipt_sha = modules["remote_contract"].digest(json.loads(row["receipt_json"]))
    for action in ("prepare", "start"):
        try:
            request = {"action": action, "manifest": manifest}
            if action == "prepare":
                request["token_sha256"] = hashlib.sha256(token.encode()).hexdigest()
            else:
                request.update(token=token, receipt_sha256=receipt_sha)
            context["worker"].rpc(request)
        except PermissionError as exc:
            if str(exc) != "worker_admission_closed_or_epoch_changed":
                raise PermissionError("admission_probe_failed_for_wrong_cause") from None
            denied += 1
    if denied != 2:
        raise PermissionError("closed_admission_did_not_block_both_mutations")
    return {"shared_blocks_exclusive": True, "persistent_closed": True, "new_prepare_start_denied": denied}


def process_identity(pid):
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


def run(request, modules):
    root_file(PRIVATE, True, 0o700)
    with execution_lock():
        return run_locked(request, modules)


def run_locked(request, modules):
    durable(modules, "run-intent.json", {**process_identity(os.getpid()), "operation_id": request["operation_id"]})
    # Never retry this phase. A helper lost mid-effect leaves evidence, not a new start.
    context = build(request, modules)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("bounded_qualification_deadline")))
    signal.alarm(250)
    values = {}
    try:
        epoch = read_json(PRIVATE / "control/epoch.json")
        admission = context["admission"]
        with admission.fencing_barrier():
            if read_json(PRIVATE / "journal/admission.json")["enabled"] is not False:
                raise PermissionError("fixture_initial_admission_must_be_closed")
            pending = PRIVATE / "journal/admission-open.json"
            modules["artifacts"].durable_json(pending, {"enabled": True, "epoch_sha256": modules["remote_contract"].digest(epoch)})
            os.replace(pending, PRIVATE / "journal/admission.json"); modules["artifacts"].sync_dir(PRIVATE / "journal")
        for path, expected in (("success", "completed"), ("failure", "failed"), ("cancellation", "canceled")):
            manifest = enqueue(request, modules, context, path)
            token = read_json(PRIVATE / "tokens" / (manifest["job_id"] + ".json"))["token"]
            durable(modules, path + "-dispatch-intent.json", {"manifest_sha256": modules["remote_contract"].digest(manifest)})
            context["transport"].drop = path == "success"
            try:
                context["backend"].dispatch(manifest, token)
            except ConnectionError:
                if path != "success":
                    raise
                # Deliberate response loss AFTER actual start: observe SAME ID.
                durable(modules, "lost-response-observation.json", {"simulated": True, "dispatch_retried": False})
            observed_before_stop = wait_for(context, manifest, cancellation=path == "cancellation")
            before_stop = cgroup_pids(observed_before_stop["cgroup_path"]) if path == "cancellation" else 0
            assert_unit(modules, context, manifest)
            durable(modules, path + "-finish-intent.json", {"cancel": path == "cancellation"})
            context["backend"].finish(manifest, cancel=path == "cancellation")
            values[path] = outcome(modules, context, manifest, expected)
            values[path]["cgroup_pids_before_stop"] = before_stop
            durable(modules, path + "-receipt.json", values[path])
        barrier = admission_proof(modules, context, manifest)
        modules["qualification_contract"].accept_results(values)
        after = baseline()
        before = read_json(PRIVATE / "baseline-before.json")
        durable(modules, "baseline-after.json", after)
        if before != after:
            raise PermissionError("unrelated_service_baseline_changed")
        durable(modules, "result.json", {"state": "REAL_FIXTURE_QUALIFICATION_PASS", "paths": values, "admission": barrier,
                "baseline_unchanged": True, "production_data_accessed": False, "distributed_readiness": False, "cutover": False})
    except BaseException as exc:
        # Do not blind-stop or replay after uncertainty. Keep evidence and exact
        # units for a fresh bound observation/cleanup under the reviewed scope.
        with contextlib.suppress(FileExistsError):
            durable(modules, "failure.json", {"type": type(exc).__name__, "state": "UNCERTAIN_PRESERVE_OBSERVE_ONLY", "no_replay": True})
        raise
    finally:
        signal.alarm(0)


def start(request, modules):
    root_file(PRIVATE, True, 0o700)
    durable(modules, "runner-intent.json", {"boot_id": boot_id(), "operation_id": request["operation_id"]})
    executable = Path(sys.executable).resolve()
    with (PRIVATE / "runner.log").open("xb") as output:
        os.chmod(PRIVATE / "runner.log", 0o600)
        child = subprocess.Popen([str(executable), "-I", "-B", str(PUBLIC / "qualification_helper.py"), "run", modules["qualification_contract"].digest(request)],
                                 stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True,
                                 env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    durable(modules, "runner-receipt.json", {**process_identity(child.pid), "started_detached": True})
    return {"state": "STARTED_OBSERVE_ONLY", "job_count": 3}


def observe(request, modules):
    context = build(request, modules)
    if (PRIVATE / "result.json").exists():
        result = read_json(PRIVATE / "result.json")
        return {"state": result["state"], "job_count": len(result["paths"]), "cutover": False}
    states = []
    for job in request["jobs"].values():
        try:
            value = context["worker"].rpc({"action": "observe", "id": job})
            states.append({"state": value.get("state"), "bound_unit": value.get("unit") is not None})
        except ValueError:
            states.append({"state": "not_observed", "bound_unit": False})
    return {"state": "UNCERTAIN_OBSERVE_ONLY" if (PRIVATE / "failure.json").exists() else "IN_PROGRESS_OR_UNCERTAIN", "jobs": states, "no_replay": True}


def cleanup(request, modules):
    # Cleanup never finalizes/dispatches/recreates artifacts. Only three exact
    # fixture bindings may be stopped after independently re-observing identity.
    with execution_lock():
        for name in ("run-intent.json", "runner-receipt.json"):
            if (PRIVATE / name).exists() and alive(read_json(PRIVATE / name)):
                raise RuntimeError("live_runner_cleanup_refused")
        if not (PRIVATE / "run-intent.json").exists():
            raise RuntimeError("runner_phase_unknown_no_cleanup_authority")
        context = build(request, modules)
        durable(modules, "cleanup-intent.json", {"boot_id": boot_id(), "job_count": 3})
        count = 0
        with context["admission"].closed_for_fencing():
            for job in request["jobs"].values():
                try:
                    row, binding = context["worker"].stored(job)
                except ValueError:
                    # No receipt is not stop authority. Prove name absent only.
                    state = context["adapter"].properties(modules["qualification_contract"].unit(job))
                    if state["LoadState"] != "not-found":
                        raise PermissionError("unbound_unit_do_not_touch")
                    continue
                manifest, receipt = json.loads(row["manifest_json"]), json.loads(row["receipt_json"])
                current = context["adapter"].observe(manifest, receipt, context["profiles"][manifest["profile"]])
                if current is not None and (not binding or current["invocation_id"] != binding["invocation_id"]):
                    raise PermissionError("cleanup_foreign_or_uncertain_invocation_refused")
                if binding and binding["stop_proof"]:
                    if current is not None and (current["main_pid"] or not current["cgroup_empty"]):
                        raise PermissionError("stopped_binding_has_active_unit_refused")
                    if not context["adapter"].cgroup_empty(binding["cgroup_path"]):
                        raise PermissionError("cleanup_cgroup_not_empty")
                else:
                    # Same frozen WorkerRPC/adapter performs its own fresh
                    # identity check immediately before stopping this one unit.
                    context["worker"].stop(job, cancel=True)
                count += 1
        durable(modules, "cleanup-receipt.json", {"bound_jobs_checked": count, "job_limit": 3, "admission_closed": True, "evidence_deleted": False})
        return {"state": "OWN_FIXTURE_CLEANUP_VERIFIED", "job_count": count}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"preflight", "bootstrap", "start", "run", "observe", "probe-ex", "cleanup"}:
        raise ValueError("fixed_qualification_phase_required")
    os.umask(0o077)
    request, modules = load()
    if sys.argv[2] != modules["qualification_contract"].digest(request):
        raise PermissionError("remote_operation_does_not_match_reviewed_request")
    phase = sys.argv[1]
    if phase == "preflight":
        if os.path.lexists(PRIVATE):
            raise PermissionError("occupied_attempt_refused")
        root_file(PRIVATE.parent, True, 0o700)
        result = {"state": "PREFLIGHT_ONLY", "job_count": 3}
    elif phase == "bootstrap":
        bootstrap(request, modules); result = {"state": "PREPARED_ONLY", "job_count": 3}
    elif phase == "start":
        result = start(request, modules)
    elif phase == "run":
        run(request, modules); result = {"state": "FINISHED_CHECK_RECEIPT", "job_count": 3}
    elif phase == "probe-ex":
        context = build(request, modules)
        try:
            with context["admission"].fencing_barrier():
                result = {"busy": False}
        except RuntimeError as exc:
            if str(exc) != "worker_admission_busy_observe_only":
                raise
            result = {"busy": True}
    elif phase == "cleanup":
        result = cleanup(request, modules)
    else:
        result = observe(request, modules)
    print(json.dumps(result))  # Only aggregate status; no tokens, log text or private paths.


if __name__ == "__main__":
    main()
