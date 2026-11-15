"""Fixed driver receipt policy; no execution, stop, cgroup or custody authority.

Only seven bounded receipt names are exportable. JSON has exact typed schemas;
logs must already satisfy the known-pattern sanitizer. This does NOT guarantee
removal of arbitrary secrets. Infra's exporter must independently revalidate
files/policy AFTER authenticated stop and cgroup drain, before bundling.
"""
import contextlib
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat

_POLICY = {
    "allowlist": ["profile-result.json", "integrity-proof.json", "phase-results.json",
                  "sanitized-build.log", "sanitized-qa-summary.json", "process-drain-proof.json",
                  "network-denial-summary.json"],
    "forbidden": ["credentials", "dotfiles", "mail", "whatsapp", "cron", "production_data",
                  "database_state", "signer_exports", "raw_browser_storage"],
    "max_file_bytes": 16777216, "max_files": 7, "max_total_bytes": 33554432,
    "regular_files_only": True, "reject_symlinks_and_hardlinks": True,
    "root": "artifacts", "root_relative_to": "trusted_job_state_directory",
    "sanitize_before_export": True, "version": 1,
}
MAX_LOG_BYTES = 10 * 1024 * 1024
PROFILES = frozenset({"admin-build-v1", "admin-qa-v1", "admin-typecheck-v1"})
SIGNALS = frozenset({"SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGPIPE", "SIGBUS",
                     "SIGILL", "SIGQUIT", "SIGXCPU", "SIGXFSZ", "SIGHUP"})
COUNTS = {"backend": 43, "http": 7, "browser": 40, "maps": 2, "http_reset": 8}
_REDACTED = "[REDACTED]"
# Match common header/env/assignment credentials, including quoted JSON output.
# Negative lookahead avoids treating token_sha256 metadata as a raw token.
_KEY = r"(?:authorization|proxy-authorization|set-cookie|cookie|(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|secret|token|api[_-]?key)|database_url|hash_pepper|cpf_cache_encryption_key|pgpassword|access_token|refresh_token)"
_CREDENTIAL = re.compile(r"(?im)(?<![\w-])([\"']?" + _KEY + r"[\"']?\s*[:=]\s*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\r\n,;}]+)")
_URL_USERINFO = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@]+@")
_EMAIL = re.compile(r"(?iu)(?<![\w.!#$%&'*+/=?^`{|}~-])[\w.!#$%&'*+/=?^`{|}~-]+@(?:[\w-]+\.)+[\w-]+")
_ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DUMP = re.compile(r"(?im)^\s*(?:PGDMP|SQLite format 3|-- PostgreSQL database dump|CREATE TABLE\b|INSERT INTO\b|COPY\s+[^\r\n]+FROM stdin;)")


def policy():
    return copy.deepcopy(_POLICY)


def digest_policy():
    return hashlib.sha256(json.dumps(_POLICY, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def sanitize_log(raw):
    """Redact known credentials/userinfo/email, NOT arbitrary secrets; no I/O.

    Reject oversized input rather than silently truncating evidence. Replacement
    bytes are stable on a second call. This is not a content-exfiltration proof.
    """
    if type(raw) is not bytes or len(raw) > MAX_LOG_BYTES:
        raise ValueError("bounded_log_bytes_required")
    text = raw.decode("utf-8", errors="replace")
    text = _ANSI.sub("", text)
    if _DUMP.search(text):
        raise ValueError("structured_database_dump_is_not_a_log_artifact")
    text = _CONTROL.sub("[CONTROL]", text)
    text = _CREDENTIAL.sub(lambda match: match.group(1) + _REDACTED, text)
    text = _URL_USERINFO.sub(lambda match: match.group(1) + _REDACTED + "@", text)
    text = _EMAIL.sub(_REDACTED, text)
    result = text.encode("utf-8")
    if len(result) > MAX_LOG_BYTES:
        raise ValueError("sanitized_log_exceeds_limit")
    return result


def _exact(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise ValueError("exact_artifact_json_fields_required")


def _integer(value, maximum=1000000, minimum=0):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("bounded_artifact_integer_required")


def _boolean(value):
    if type(value) is not bool:
        raise ValueError("artifact_boolean_required")


def _hash(value):
    if type(value) is not str or not re.fullmatch("[a-f0-9]{64}", value):
        raise ValueError("artifact_sha256_required")


def _phase(value):
    if type(value) is not str or len(value) > 64 or not re.fullmatch("[a-z][a-z0-9]*(?:-[a-z0-9]+)*", value):
        raise ValueError("bounded_kebab_phase_required")


def _exit(value):
    if value is not None:
        _integer(value, 255)


def _profile(value):
    if type(value) is not str or value not in PROFILES:
        raise ValueError("fixed_artifact_profile_required")


def _no_duplicates(rows):
    result = {}
    for key, value in rows:
        if key in result:
            raise ValueError("duplicate_artifact_json_key")
        result[key] = value
    return result


def _bad_constant(_):
    raise ValueError("nonfinite_artifact_json_refused")


def validate_json(name, value):
    """Exact receipt schemas only; no free text/dump fields or runtime proof."""
    fields = {
        "profile-result.json": {"version", "profile", "plan_sha256", "source_sha256", "dependencies_sha256", "artifact_policy_sha256", "status", "exit_code", "phase_count", "failed_phase"},
        "integrity-proof.json": {"version", "source_sha256", "dependencies_sha256", "toolchain_sha256", "verified_files", "verified_bytes", "archive_only_provenance"},
        "phase-results.json": {"version", "profile", "phases"},
        "sanitized-qa-summary.json": {"version", "counts", "passed", "page_errors", "blocked_writes", "fixture_only"},
        "process-drain-proof.json": {"version", "scope", "tracked_processes", "remaining_owned_processes", "stop_requested", "all_exited"},
        "network-denial-summary.json": {"version", "mode", "external_allowed", "attempts_denied", "unexpected_attempts", "fixture_pg_loopback", "fixture_http_loopback"},
    }
    if name not in fields:
        raise ValueError("fixed_json_artifact_name_required")
    _exact(value, fields[name])
    if type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("artifact_version_one_required")
    for key, item in value.items():
        if key.endswith("sha256"):
            _hash(item)
    if "profile" in value:
        _profile(value["profile"])
    if name == "profile-result.json":
        if type(value["status"]) is not str or value["status"] not in {"passed", "failed"}:
            raise ValueError("fixed_artifact_status_required")
        _exit(value["exit_code"])
        _integer(value["phase_count"], 32)
        if value["failed_phase"] is not None:
            _phase(value["failed_phase"])
        if value["artifact_policy_sha256"] != digest_policy():
            raise ValueError("exact_artifact_policy_digest_required")
        if value["status"] == "passed" and (value["exit_code"] != 0 or value["failed_phase"] is not None):
            raise ValueError("coherent_passed_profile_required")
        if value["status"] == "failed" and value["exit_code"] == 0:
            raise ValueError("failed_profile_cannot_exit_zero")
    elif name == "integrity-proof.json":
        _integer(value["verified_files"])
        _integer(value["verified_bytes"], 1024 ** 4)
        _boolean(value["archive_only_provenance"])
    elif name == "phase-results.json":
        if type(value["phases"]) is not list or len(value["phases"]) > 32:
            raise ValueError("bounded_phase_array_required")
        seen = set()
        for phase in value["phases"]:
            _exact(phase, {"name", "exit_code", "signal", "duration_ms", "expected_checks", "observed_checks", "success"})
            _phase(phase["name"])
            if phase["name"] in seen:
                raise ValueError("duplicate_phase_name_refused")
            seen.add(phase["name"])
            _exit(phase["exit_code"])
            if phase["signal"] is not None and (type(phase["signal"]) is not str or phase["signal"] not in SIGNALS):
                raise ValueError("fixed_process_signal_required")
            _integer(phase["duration_ms"], 86400000)
            _integer(phase["expected_checks"])
            _integer(phase["observed_checks"])
            _boolean(phase["success"])
            if phase["success"] and (phase["exit_code"] != 0 or phase["signal"] is not None or phase["expected_checks"] != phase["observed_checks"]):
                raise ValueError("coherent_successful_phase_required")
    elif name == "sanitized-qa-summary.json":
        _exact(value["counts"], COUNTS)
        for count in value["counts"].values():
            _integer(count)
        for key in ("passed", "fixture_only"):
            _boolean(value[key])
        for key in ("page_errors", "blocked_writes"):
            _integer(value[key])
        if value["fixture_only"] is not True:
            raise ValueError("fictional_only_qa_receipt_required")
        if value["passed"] and (value["counts"] != COUNTS or value["page_errors"] or value["blocked_writes"]):
            raise ValueError("exact_qa100_pass_receipt_required")
    elif name == "process-drain-proof.json":
        if value["scope"] != "driver_owned_children" or type(value["scope"]) is not str:
            raise ValueError("driver_children_only_not_root_stop_proof")
        _integer(value["tracked_processes"], 512)
        _integer(value["remaining_owned_processes"], 512)
        _boolean(value["stop_requested"])
        _boolean(value["all_exited"])
        if value["remaining_owned_processes"] > value["tracked_processes"] or value["all_exited"] != (value["remaining_owned_processes"] == 0):
            raise ValueError("coherent_driver_children_receipt_required")
    else:
        if type(value["mode"]) is not str or value["mode"] != "offline-loopback-fixtures":
            raise ValueError("fixed_offline_loopback_mode_required")
        for key in ("external_allowed", "fixture_pg_loopback", "fixture_http_loopback"):
            _boolean(value[key])
        if value["external_allowed"] is not False:
            raise ValueError("external_network_never_authorized")
        _integer(value["attempts_denied"])
        _integer(value["unexpected_attempts"])
    return None


def _content(name, raw):
    if type(name) is not str or name not in _POLICY["allowlist"]:
        raise ValueError("artifact_name_not_allowlisted")
    if type(raw) is not bytes or len(raw) > _POLICY["max_file_bytes"]:
        raise ValueError("bounded_artifact_bytes_required")
    if name.endswith(".json"):
        try:
            value = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates, parse_constant=_bad_constant)
            validate_json(name, value)
        except (ValueError, UnicodeError, RecursionError, TypeError):
            raise ValueError("invalid_fixed_schema_artifact_json") from None
    else:
        try:
            raw.decode("utf-8", errors="strict")
        except UnicodeError:
            raise ValueError("utf8_sanitized_log_required") from None
        if sanitize_log(raw) != raw:
            raise ValueError("log_must_be_sanitized_before_export")


def _absolute(path):
    result = Path(path).absolute()
    if ".." in result.parts:
        raise ValueError("canonical_artifact_path_required")
    return result


def _ancestors(path):
    for parent in [*reversed(path.parents), path]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise PermissionError("artifact_directory_ancestors_must_not_be_links")


def _root_identity(path, fd, uid):
    _ancestors(path)
    before, opened = path.lstat(), os.fstat(fd)
    if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
        raise PermissionError("artifact_root_replaced")
    if not stat.S_ISDIR(opened.st_mode) or opened.st_uid != uid or stat.S_IMODE(opened.st_mode) != 0o700:
        raise PermissionError("owned_private_artifact_directory_required")


@contextlib.contextmanager
def _open_root(root, uid):
    path = _absolute(root)
    _ancestors(path)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _root_identity(path, fd, uid)
        yield path, fd
        _root_identity(path, fd, uid)
    finally:
        os.close(fd)


def prepare_artifacts(root):
    """Create a new exclusive directory; never chmod/reuse an existing path."""
    path = _absolute(root)
    _ancestors(path.parent)
    parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        original = os.fstat(parent_fd)
        os.mkdir(path.name, 0o700, dir_fd=parent_fd)
        created = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(created.st_mode) or created.st_uid != os.geteuid():
            raise PermissionError("new_artifact_directory_identity_required")
        # A restrictive umask can make the new directory unreadable. Adjust
        # ONLY this exclusive newly-created child, never an existing ancestor.
        os.chmod(path.name, 0o700, dir_fd=parent_fd, follow_symlinks=False)
        fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            opened = os.fstat(fd)
            if (created.st_dev, created.st_ino) != (opened.st_dev, opened.st_ino):
                raise PermissionError("new_artifact_directory_replaced")
            _root_identity(path, fd, os.geteuid())
            os.fsync(fd)
            os.fsync(parent_fd)
        finally:
            os.close(fd)
        current = path.parent.lstat()
        if (original.st_dev, original.st_ino) != (current.st_dev, current.st_ino):
            raise PermissionError("artifact_parent_replaced")
    finally:
        os.close(parent_fd)
    return path


def _inventory(fd, uid):
    names = sorted(os.listdir(fd))
    if len(names) > _POLICY["max_files"] or any(name not in _POLICY["allowlist"] for name in names):
        raise ValueError("unexpected_or_too_many_artifacts")
    files, fingerprints, total = [], {}, 0
    for name in names:
        before = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != uid or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) != 0o600):
            raise PermissionError("owned_private_regular_single_link_artifact_required")
        if before.st_size > _POLICY["max_file_bytes"] or total + before.st_size > _POLICY["max_total_bytes"]:
            raise ValueError("artifact_byte_budget_exceeded")
        child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            opened = os.fstat(child)
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                raise PermissionError("artifact_replaced_during_open")
            chunks, size = [], 0
            while size <= before.st_size:
                block = os.read(child, min(1048576, before.st_size + 1 - size))
                if not block:
                    break
                chunks.append(block)
                size += len(block)
            after = os.fstat(child)
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_uid", "st_mode", "st_nlink")
            named = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if size != before.st_size or any(getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(named, key) for key in fields):
                raise PermissionError("artifact_changed_during_inspection")
            raw = b"".join(chunks)
            _content(name, raw)
        finally:
            os.close(child)
        fingerprints[name] = tuple(getattr(before, key) for key in fields)
        total += size
        files.append({"name": name, "bytes": size, "sha256": hashlib.sha256(raw).hexdigest()})
    if sorted(os.listdir(fd)) != names:
        raise PermissionError("artifact_members_changed_during_inspection")
    for name in names:
        final = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if tuple(getattr(final, key) for key in fields) != fingerprints[name]:
            raise PermissionError("artifact_changed_before_inventory_completed")
    return {"state": "verified", "policy_sha256": digest_policy(), "files": files, "total_bytes": total}


def inspect_artifacts(root, expected_uid=None):
    uid = os.geteuid() if expected_uid is None else expected_uid
    if type(uid) is not int or uid < 0:
        raise ValueError("nonnegative_expected_uid_required")
    with _open_root(root, uid) as (_, fd):
        return _inventory(fd, uid)


def write_artifact(root, name, raw):
    """Publish one validated receipt exclusively, syncing file and directory.

    A crash/failed fsync preserves the partial file and refuses overwrite. This
    module does not attest artifact completeness after process death or stop.
    """
    _content(name, raw)
    with _open_root(root, os.geteuid()) as (_, fd):
        # Directory locking needs no extra artifact/lock filename. Concurrent
        # callers of this API cannot jointly exceed the aggregate byte budget.
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            current = _inventory(fd, os.geteuid())
            if len(current["files"]) >= _POLICY["max_files"] or current["total_bytes"] + len(raw) > _POLICY["max_total_bytes"]:
                raise ValueError("artifact_aggregate_budget_exceeded")
            child = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                os.fchmod(child, 0o600)
                view = memoryview(raw)
                while view:
                    written = os.write(child, view)
                    if written <= 0:
                        raise OSError("artifact_write_did_not_progress")
                    view = view[written:]
                os.fsync(child)
            finally:
                os.close(child)
            os.fsync(fd)
            result = _inventory(fd, os.geteuid())
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    return next(value for value in result["files"] if value["name"] == name)
