"""Stdlib-only pre-import policy/closure verifier. SOURCE ONLY.

No helper is imported or executed here. The fixed bootstrap must first pin THIS
module and the policy JSON, then load only returned verified helper bytes (never
reopen filenames for import). verify_closure never enables execution itself.
An enabled policy plus release event permits isolated qualification only;
qualified/operationalReady remain false. No installation, host measurement or
credential access is performed. External administrative root writers are part
of the trusted computing base; these checks do not provide CAS against root.

All public toolchain symlinks/hardlinks are rejected, including otherwise-safe
Python/Chrome/PG aliases: the offline producer must materialize regular files.
Inventory covers files below the seven declared roots, not external OS libs.
"""
import ast
from copy import deepcopy
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import stat

TOOLS = "/opt/peticao-dev-profile-tools-v1"
HELPERS = frozenset({"driver_contract.py", "input_provider.py", "artifact_policy.py", "resource_plan.py",
                     "qa_adapter.py", "process_runner.py", "sealed_policy.py", "runtime_steps.py"})
KINDS = frozenset({"admin-typecheck-v1", "admin-build-v1", "admin-qa-v1"})
QA_FILES = frozenset("qa/" + name for name in (
    "common.mjs", "node-owned.mjs", "qa-driver.mjs", "qa-runtime.mjs", "fixture.ts",
    "backend-smoke.mjs", "http-regression.mjs", "refresh-fixture-session.mjs", "browser-bootstrap.py",
    "browser40.py", "maps2.py", "network-guard.cjs", "build-guard.mjs", "python-runtime.json"))
TOOL_ROOTS = ("node20", "python312", "postgres", "chromium", "python-wheels", "pdfjs", "empty-config")
MAX_FILE_BYTES = 512 * 1024**2
MAX_HELPER_BYTES = 4 * 1024**2
MAX_FILES = 50000
_ROOT_UID = 0
SOURCE_ONLY = True
QUALIFIED = False
OPERATIONAL_READY = False
_KEYS = {"version", "tools_root", "execution_enabled", "qualification_release_event", "qualified",
         "operationalReady", "dependencies_ref", "plans", "helpers", "qa_inventory", "toolchain_inventory"}
_PARENT_DEPS = {"sha256": "3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698", "bytes": 207013889}
_TOOLS = {
    "node": ("node20", "20.19.2", "b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac", 99836400),
    "python": ("python312/bin/python3.12", "3.12.3", None, None),
    "postgres": ("postgres/bin/postgres", "18.4", "de0a4a7646c51f032e0088ae6fe9d0833fa280b78d4455681574a32937b32838", 9788000),
    "initdb": ("postgres/bin/initdb", "18.4", "515186eed81a1f2741bdcbfeb080af093a59a27fb2896237b04dd6c48bae349d", 191688),
    "pg_ctl": ("postgres/bin/pg_ctl", "18.4", "6beab6014ea28dcc78b8c6a43ec9e3e20536e13a175d75151107410ac866c481", 77832),
    "chromium": ("chromium/chrome-linux64/chrome", "151.0.7922.34", None, None),
}
_SOURCE = {"app_commit": "c472837fb5a4584d81f34c420f4de30989084f85", "site_tree": "14409ebfce08daa337f6b2dfc392fe38b54ee86d", "harness_commit": "09d1d66d0e821e92d96bd83de70afdb832a31bc6", "sha256": "19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5", "bytes": 11959902}
_LAYOUT = {"source": "source", "site": "source/site", "tmp": "t", "empty_config": "e", "postgres": "p",
           "compiled": "compiled", "artifacts": "artifacts", "relative_to": "trusted_StateDirectory_namespace_alias",
           "fresh_job_root_required": True, "old_paths_or_units_reused": False}
_ENVIRONMENT = {"inherit": False, "dotenv_allowed": False, "credentials_allowed": False,
                "mail": "development_fixture_only", "whatsapp": False, "cron": False,
                "external_network": False, "loopback_fixtures_only": True}
_COUNTS = {"backend": 43, "http": 7, "browser": 40, "maps": 2, "http_reset": 8}
_WHEELS = frozenset({"greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl",
    "playwright-1.62.0-py3-none-manylinux1_x86_64.whl", "pyee-13.0.1-py3-none-any.whl",
    "typing_extensions-4.16.0-py3-none-any.whl"})


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _digest(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError("exact_sealed_schema_required")


def _integer(value, minimum=0, maximum=2**63 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("bounded_exact_integer_required")


def _sha(value):
    if type(value) is not str or not re.fullmatch(r"[a-f0-9]{64}", value) or value == "0" * 64:
        raise ValueError("nonzero_canonical_sha256_required")


def _relative(value):
    if (type(value) is not str or not value or len(value) > 1024 or "\\" in value or "\0" in value
            or value.startswith("/") or value != str(PurePosixPath(value))
            or any(part in (".", "..") for part in value.split("/"))):
        raise ValueError("canonical_relative_inventory_path_required")
    return value


def _absolute(value):
    if (type(value) is not str or not value.startswith("/") or value == "/" or len(value) > 4096
            or "\0" in value or "\\" in value or value != str(PurePosixPath(value))
            or ".." in PurePosixPath(value).parts):
        raise ValueError("canonical_absolute_public_path_required")
    return value


def _directory_info(info):
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != _ROOT_UID or info.st_mode & 0o022
            or not info.st_mode & 0o001):
        raise PermissionError("root_controlled_public_directory_required")


def _trusted_parent(path):
    parts = PurePosixPath(_absolute(path)).parts
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _directory_info(os.fstat(fd))
        for part in parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
            _directory_info(os.fstat(fd))
        return fd
    except BaseException:
        os.close(fd)
        raise


def _file_info(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != _ROOT_UID or info.st_nlink != 1
            or info.st_mode & 0o022 or not info.st_mode & 0o004
            or not 0 <= info.st_size <= MAX_FILE_BYTES):
        raise PermissionError("bounded_root_public_regular_single_link_required")


def _signature(info):
    return tuple(getattr(info, key) for key in ("st_dev", "st_ino", "st_size", "st_uid", "st_gid",
                 "st_mode", "st_nlink", "st_mtime_ns", "st_ctime_ns"))


def read_verified(path, sha, size=None):
    """Return exactly the bytes hashed from one held fd; no path reopen import.

    Paths are canonical absolute/public/root-controlled. The named entry must
    still refer to the held file after the bounded read. A bootstrap must parse
    returned policy bytes using duplicate-key/nonfinite rejection as well.
    """
    _absolute(path); _sha(sha)
    if size is not None:
        _integer(size, 0, MAX_FILE_BYTES)
    parent = _trusted_parent(path)
    fd = -1
    try:
        name = PurePosixPath(path).name
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        before = os.fstat(fd); _file_info(before)
        if size is not None and before.st_size != size:
            raise PermissionError("pinned_public_file_size_mismatch")
        raw = bytearray()
        hashed = hashlib.sha256()
        while True:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk); hashed.update(chunk)
            if len(raw) > before.st_size:
                raise PermissionError("public_file_grew_during_read")
        after = os.fstat(fd)
        named = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (len(raw) != before.st_size or _signature(before) != _signature(after)
                or _signature(before) != _signature(named) or hashed.hexdigest() != sha):
            raise PermissionError("public_file_identity_or_hash_changed")
        return bytes(raw)
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(parent)


def _pin(row, *, pending=False, maximum=MAX_FILE_BYTES, nonempty=False):
    _exact(row, {"sha256", "bytes"})
    for key in ("sha256", "bytes"):
        if row[key] is None and pending:
            continue
        if key == "sha256":
            _sha(row[key])
        else:
            _integer(row[key], 1 if nonempty else 0, maximum)


def _inventory(value, names=None, *, pending=False, maximum=MAX_HELPER_BYTES):
    if type(value) is not dict or len(value) > MAX_FILES:
        raise ValueError("bounded_public_inventory_required")
    if names is not None and set(value) != set(names):
        raise ValueError("exact_public_inventory_members_required")
    for name, row in value.items():
        _relative(name)
        _pin(row, pending=pending, maximum=maximum, nonempty=names is not None)


def template():
    """Deliberately incomplete preparation skeleton; never a launch policy."""
    return {"version": 1, "tools_root": TOOLS, "execution_enabled": False,
            "qualification_release_event": None, "qualified": False, "operationalReady": False,
            "dependencies_ref": None, "plans": {kind: None for kind in sorted(KINDS)},
            "helpers": {name: {"sha256": None, "bytes": None} for name in sorted(HELPERS)},
            "qa_inventory": {name: {"sha256": None, "bytes": None} for name in sorted(QA_FILES)},
            "toolchain_inventory": {"version": 1, "roots": list(TOOL_ROOTS), "files": {}}}


def _dependencies(value, pending):
    if value is None and pending:
        return
    _exact(value, {"version", "parent_archive", "normalized_archive", "normalization_receipt_sha256",
        "toolchain", "toolchain_inventory_sha256", "qa_closure_sha256", "full_integrity_attestation",
        "original_cache_full_integrity_verified"})
    if type(value["version"]) is not int or value["version"] != 1 or value["original_cache_full_integrity_verified"] is not False:
        raise ValueError("frozen_dependency_provenance_required")
    if _canonical(value["parent_archive"]) != _canonical(_PARENT_DEPS):
        raise ValueError("frozen_parent_dependency_archive_required")
    _exact(value["normalized_archive"], {"path", "sha256", "bytes"})
    if value["normalized_archive"]["path"] != TOOLS + "/inputs/dependencies.normalized.tar.gz":
        raise ValueError("fixed_normalized_archive_required")
    _pin({key: value["normalized_archive"][key] for key in ("sha256", "bytes")}, pending=pending, nonempty=True)
    for key in ("normalization_receipt_sha256", "toolchain_inventory_sha256", "qa_closure_sha256"):
        if value[key] is not None or not pending:
            _sha(value[key])
    _exact(value["toolchain"], _TOOLS)
    for name, (path, version, sha, size) in _TOOLS.items():
        row = value["toolchain"][name]
        _exact(row, {"path", "version", "sha256", "bytes"})
        if row["path"] != TOOLS + "/" + path or row["version"] != version:
            raise ValueError("fixed_tool_path_and_version_required")
        _pin({key: row[key] for key in ("sha256", "bytes")}, pending=pending, nonempty=True)
        if sha is not None and row["sha256"] is not None and row["sha256"] != sha:
            raise ValueError("frozen_tool_hash_changed")
        if size is not None and row["bytes"] is not None and row["bytes"] != size:
            raise ValueError("frozen_tool_size_changed")
    proof = value["full_integrity_attestation"]
    _exact(proof, {"manifest_event", "inventory_sha256", "evidence_sha256"})
    for key in proof:
        if proof[key] is None and pending:
            continue
        if key == "manifest_event":
            _integer(proof[key], 1, 2**53)
        else:
            _sha(proof[key])


def _plan(value, name, deps, pending):
    if value is None and pending:
        return
    _exact(value, {"version", "name", "source", "dependencies", "resources", "artifact_policy", "phases", "layout",
        "environment_policy", "qa_counts", "qa_steps", "qualification", "pending_pins", "historical_budget_is_measured_minimum"})
    if type(value["version"]) is not int or value["version"] != 1 or value["name"] != name:
        raise ValueError("fixed_plan_identity_required")
    if deps is None or _canonical(value["dependencies"]) != _canonical(deps):
        raise ValueError("same_sealed_dependencies_for_all_plans_required")
    source = {**_SOURCE, "path": TOOLS + "/inputs/source.tar.gz"}
    phases = ["verify-inputs", "prepare-offline-assets", "typecheck"]
    if name != "admin-typecheck-v1":
        phases += ["build", "export-runtime"]
    if name == "admin-qa-v1":
        phases += ["qa100"]
    phases += ["drain"]
    qa_steps = ["postgres-init", "backend43", "fixture-seed", "runtime-start", "http7", "browser40",
                "maps2", "http-reset8", "fixture-refresh"] if name == "admin-qa-v1" else None
    for key, expected in (("source", source), ("layout", _LAYOUT), ("environment_policy", _ENVIRONMENT),
                          ("phases", phases), ("qa_counts", _COUNTS if name == "admin-qa-v1" else None),
                          ("qa_steps", qa_steps)):
        if _canonical(value[key]) != _canonical(expected):
            raise ValueError("fixed_driver_plan_recipe_required")
    if _canonical(value["resources"]) not in {_canonical(_resources(4, 8, 3072)), _canonical(_resources(14, 20, 6144))}:
        raise ValueError("fixed_driver_resource_recipe_required")
    _exact(value["qualification"], {"qualified", "operationalReady", "qualification_manifest_event"})
    if value["qualification"] != {"qualified": False, "operationalReady": False, "qualification_manifest_event": None} or any(
            type(value["qualification"][key]) is not bool for key in ("qualified", "operationalReady")):
        raise ValueError("plan_qualification_must_remain_false")
    if value["historical_budget_is_measured_minimum"] is not False:
        raise ValueError("historical_budget_not_measurement_required")
    if type(value["pending_pins"]) is not list or any(type(item) is not str for item in value["pending_pins"]):
        raise ValueError("typed_pending_pin_list_required")
    if not pending and value["pending_pins"]:
        raise PermissionError("complete_plan_pins_required")
    # Artifact equality is checked against verified helper literal data below.
    _canonical(value)


def _resources(cpu, memory, heap):
    return {"version": 1, "cpu": cpu, "memory_bytes": memory * 1024**3, "tasks_max": 512,
        "runtime_seconds": 2700, "stop_seconds": 30, "disk_budget_bytes": 30 * 1024**3,
        "disk_budget_is_hard_quota": False, "node_heap_mib": heap, "workers": 2, "measured_minimum": False,
        "admission": {"control_cpu_target": 2, "control_memory_target_bytes": 8 * 1024**3,
            "requires_fresh_host_pressure_and_capacity": True, "headroom_guaranteed": False,
            "rounded_marketing_ram_not_authoritative": True}}


def validate_policy(obj, execution=False):
    """Validate a complete root schema; False also permits explicit None pins.

    This returns a deepcopy, never modifies readiness. verify_closure separately
    insists on complete pins even when execution_enabled remains false.
    """
    if type(execution) is not bool:
        raise ValueError("exact_execution_boolean_required")
    _exact(obj, _KEYS)
    if type(obj["version"]) is not int or obj["version"] != 1 or obj["tools_root"] != TOOLS:
        raise ValueError("fixed_public_tools_policy_required")
    if type(obj["execution_enabled"]) is not bool or obj["qualified"] is not False or obj["operationalReady"] is not False:
        raise ValueError("source_policy_flags_required")
    event = obj["qualification_release_event"]
    if event is not None:
        _integer(event, 1, 2**53)
    if obj["execution_enabled"] and event is None:
        raise PermissionError("isolated_qualification_release_event_required")
    if execution and not obj["execution_enabled"]:
        raise PermissionError("policy_execution_disabled")
    pending = not execution
    _inventory(obj["helpers"], HELPERS, pending=pending)
    _inventory(obj["qa_inventory"], QA_FILES, pending=pending)
    inventory = obj["toolchain_inventory"]
    _exact(inventory, {"version", "roots", "files"})
    if type(inventory["version"]) is not int or inventory["version"] != 1 or inventory["roots"] != list(TOOL_ROOTS):
        raise ValueError("fixed_toolchain_inventory_roots_required")
    _inventory(inventory["files"], pending=pending, maximum=MAX_FILE_BYTES)
    for name in inventory["files"]:
        if name.split("/")[0] not in TOOL_ROOTS:
            raise ValueError("toolchain_member_outside_fixed_roots")
    _dependencies(obj["dependencies_ref"], pending)
    deps = obj["dependencies_ref"]
    if deps is not None:
        for field, expected in (("qa_closure_sha256", _digest(obj["qa_inventory"])),
                                ("toolchain_inventory_sha256", _digest(inventory))):
            if deps[field] is not None and deps[field] != expected:
                raise PermissionError("sealed_inventory_digest_mismatch")
        for row in deps["toolchain"].values():
            relative = row["path"][len(TOOLS) + 1:]
            actual = inventory["files"].get(relative)
            expected = {key: row[key] for key in ("sha256", "bytes")}
            if actual is not None and actual != expected:
                raise PermissionError("tool_binary_inventory_pin_mismatch")
            if not pending and actual is None:
                raise PermissionError("tool_binary_missing_from_inventory")
    _exact(obj["plans"], KINDS)
    for name, value in obj["plans"].items():
        _plan(value, name, deps, pending)
    return deepcopy(obj)


def _declared_names(raw, symbol):
    """Parse only a narrow literal frozenset declaration; never eval/exec."""
    tree = ast.parse(raw)
    nodes = [node.value for node in tree.body if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == symbol for target in node.targets)]
    if len(nodes) != 1:
        raise PermissionError("single_literal_closure_declaration_required")
    node = nodes[0]
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset"
            and len(node.args) == 1 and not node.keywords):
        raise PermissionError("literal_frozenset_closure_required")
    arg = node.args[0]
    if isinstance(arg, ast.GeneratorExp):
        if (len(arg.generators) != 1 or arg.generators[0].ifs or arg.generators[0].is_async
                or not isinstance(arg.generators[0].target, ast.Name) or not isinstance(arg.elt, ast.BinOp)
                or not isinstance(arg.elt.op, ast.Add) or not isinstance(arg.elt.left, ast.Constant)
                or arg.elt.left.value != "qa/" or not isinstance(arg.elt.right, ast.Name)
                or arg.elt.right.id != arg.generators[0].target.id):
            raise PermissionError("fixed_qa_literal_prefix_required")
        names = ast.literal_eval(arg.generators[0].iter)
        if type(names) not in (tuple, list) or any(type(name) is not str for name in names):
            raise PermissionError("literal_string_closure_required")
        names = ["qa/" + name for name in names]
    else:
        names = ast.literal_eval(arg)
    if type(names) not in (set, tuple, list) or any(type(name) is not str for name in names) or len(names) != len(set(names)):
        raise PermissionError("unique_literal_string_closure_required")
    return set(names)


def _literal(raw, symbol):
    tree = ast.parse(raw)
    nodes = [node.value for node in tree.body if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == symbol for target in node.targets)]
    if len(nodes) != 1:
        raise PermissionError("single_literal_policy_declaration_required")
    return ast.literal_eval(nodes[0])


def _scan_root(path):
    """File inventory through held directory fds; reject every link/special."""
    parent = _trusted_parent(path)
    result = set()
    nodes = 0
    def walk(fd, relative, depth):
        nonlocal nodes
        if depth > 32:
            raise PermissionError("public_inventory_depth_exceeded")
        _directory_info(os.fstat(fd))
        with os.scandir(fd) as entries:
            for entry in entries:
                nodes += 1
                if nodes > MAX_FILES:
                    raise PermissionError("public_inventory_member_limit")
                name = relative + "/" + entry.name
                info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        walk(child, name, depth + 1)
                    finally:
                        os.close(child)
                else:
                    _file_info(info)
                    result.add(name)
    try:
        info = os.stat(PurePosixPath(path).name, dir_fd=parent, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            fd = os.open(PurePosixPath(path).name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                walk(fd, PurePosixPath(path).name, 0)
            finally:
                os.close(fd)
        else:
            _file_info(info)
            result.add(PurePosixPath(path).name)
        return result
    finally:
        os.close(parent)


def _json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError("duplicate_public_json_key")
            result[key] = value
        return result
    def constant(_):
        raise ValueError("nonfinite_public_json_refused")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def _python_runtime(raw, inventory):
    runtime = _json(raw)
    _exact(runtime, {"version", "site_root", "source_wheels", "files"})
    if type(runtime["version"]) is not int or runtime["version"] != 1 or runtime["site_root"] != TOOLS + "/python-wheels/site":
        raise PermissionError("fixed_python_runtime_inventory_required")
    if type(runtime["source_wheels"]) is not list or len(runtime["source_wheels"]) != len(_WHEELS):
        raise PermissionError("four_source_wheel_pins_required")
    seen = set()
    for row in runtime["source_wheels"]:
        _exact(row, {"name", "sha256", "bytes"})
        if type(row["name"]) is not str or row["name"] not in _WHEELS or row["name"] in seen:
            raise PermissionError("fixed_unique_wheel_name_required")
        seen.add(row["name"])
        pin = {key: row[key] for key in ("sha256", "bytes")}
        _pin(pin, nonempty=True)
        if inventory.get("python-wheels/" + row["name"]) != pin:
            raise PermissionError("source_wheel_inventory_pin_mismatch")
    _inventory(runtime["files"], maximum=MAX_FILE_BYTES)
    if not 1 <= len(runtime["files"]) <= 20000:
        raise PermissionError("nonempty_normalized_python_runtime_required")
    expected = {}
    for name, pin in runtime["files"].items():
        if PurePosixPath(name).suffix in {".pth", ".pyc"} or "__pycache__" in PurePosixPath(name).parts:
            raise PermissionError("no_python_startup_hook_or_cache")
        expected["python-wheels/site/" + name] = pin
    actual = {name: pin for name, pin in inventory.items() if name.startswith("python-wheels/site/")}
    if actual != expected:
        raise PermissionError("complete_python_runtime_inventory_disagreement")


def verify_closure(policy):
    """Verify COMPLETE inputs and return verified helper bytes, no imports.

    A false execution flag does not waive any byte/inventory check. None pins,
    unexpected files and links fail closed. Caller must use returned bytes for
    import and keep source-only disposition until external release gates pass.
    """
    policy = validate_policy(policy)
    _dependencies(policy["dependencies_ref"], pending=False)
    for inventory in (policy["helpers"], policy["qa_inventory"], policy["toolchain_inventory"]["files"]):
        for row in inventory.values():
            _pin(row, pending=False)
    for name, value in policy["plans"].items():
        _plan(value, name, policy["dependencies_ref"], pending=False)
    for row in policy["dependencies_ref"]["toolchain"].values():
        relative = row["path"][len(TOOLS) + 1:]
        if policy["toolchain_inventory"]["files"].get(relative) != {key: row[key] for key in ("sha256", "bytes")}:
            raise PermissionError("complete_tool_binary_inventory_required")
    helpers = {name: read_verified(TOOLS + "/" + name, row["sha256"], row["bytes"])
               for name, row in sorted(policy["helpers"].items())}
    if _declared_names(helpers["driver_contract.py"], "HELPERS") != set(policy["helpers"]):
        raise PermissionError("driver_helper_closure_disagreement")
    if _declared_names(helpers["qa_adapter.py"], "QA_FILES") != set(policy["qa_inventory"]):
        raise PermissionError("qa_helper_closure_disagreement")
    expected_artifacts = _literal(helpers["artifact_policy.py"], "_POLICY")
    for value in policy["plans"].values():
        if _canonical(value["artifact_policy"]) != _canonical(expected_artifacts):
            raise PermissionError("plan_artifact_policy_disagreement")
    qa = {name: read_verified(TOOLS + "/" + name, row["sha256"], row["bytes"])
          for name, row in sorted(policy["qa_inventory"].items())}
    _python_runtime(qa["qa/python-runtime.json"], policy["toolchain_inventory"]["files"])
    if _scan_root(TOOLS + "/qa") != set(qa):
        raise PermissionError("unexpected_qa_public_member")
    actual = set()
    for root in TOOL_ROOTS:
        actual.update(_scan_root(TOOLS + "/" + root))
    if actual != set(policy["toolchain_inventory"]["files"]):
        raise PermissionError("exact_toolchain_file_inventory_required")
    for name, row in sorted(policy["toolchain_inventory"]["files"].items()):
        read_verified(TOOLS + "/" + name, row["sha256"], row["bytes"])
    # A second scan catches membership changes during file verification.
    after = set()
    for root in TOOL_ROOTS:
        after.update(_scan_root(TOOLS + "/" + root))
    if after != actual or _scan_root(TOOLS + "/qa") != set(qa):
        raise PermissionError("public_inventory_changed_during_verification")
    return helpers
