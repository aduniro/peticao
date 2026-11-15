"""Private fixed-driver subprocess supervision; never a CLI/RPC executor.

Only trusted driver code supplies argv and policy. allowed_executables maps
canonical root-owned executable paths to exact SHA256; it is not job input.
Signals target our direct children through Linux pidfds, never a process group.
Drain reports only tracked direct children: it cannot prove a cgroup empty,
grandchildren stopped, artifact custody or retirement. The runtime owns those.
Raw private logs may contain secrets and must never be exported directly.
"""
from dataclasses import dataclass, field
import hashlib
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time

MAX_LOG_BYTES = 10 * 1024**2
MAX_PHASES = 32
SOURCE_ONLY = True
QUALIFIED = False
OPERATIONAL_READY = False
_TOOLS = "/opt/peticao-dev-profile-tools-v1"
_FIXED_ENV = {"PATH": _TOOLS + ":/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC",
              "NEXT_TELEMETRY_DISABLED": "1", "EMAIL_DELIVERY_MODE": "development",
              "WHATSAPP_ENABLED": "0", "XDG_CONFIG_HOME": _TOOLS + "/empty-config"}
_ENV_CHOICES = {**{key: frozenset({value}) for key, value in _FIXED_ENV.items()},
    "NODE_ENV": frozenset({"production", "test"}),
    "MAIL_PROVIDER": frozenset({"dev"}), "MAIL_PROVIDERS": frozenset({"dev"}),
    "CRON_SECRET": frozenset({""}), "PYTHONDONTWRITEBYTECODE": frozenset({"1"}),
    "NODE": frozenset({_TOOLS + "/node20"}),
    "PYTHON": frozenset({_TOOLS + "/python312/bin/python3.12"}),
    "CHROMIUM": frozenset({_TOOLS + "/chromium/chrome-linux64/chrome"}),
    "QA_ROOT": frozenset({"private-qa"}),
    "WHEELS_ROOT": frozenset({_TOOLS + "/python-wheels/site"}),
    "NEXT_BUILD_CPUS": frozenset({"2"}),
    "PLAYWRIGHT_NODEJS_PATH": frozenset({_TOOLS + "/node20"}),
    "PROFILE_TOOLS_ROOT": frozenset({_TOOLS}),
    "PROFILE_NODE": frozenset({_TOOLS + "/node20"}),
    "PROFILE_PYTHON": frozenset({_TOOLS + "/python312/bin/python3.12"}),
    "PROFILE_CHROMIUM": frozenset({_TOOLS + "/chromium/chrome-linux64/chrome"}),
    "PROFILE_QA_ROOT": frozenset({_TOOLS + "/qa"}),
    "PROFILE_WHEELS_ROOT": frozenset({_TOOLS + "/python-wheels/site"}),
    "PGPORT": frozenset({"28451"}),
    "APP_PORT": frozenset({"28452"}),
    "HASH_PEPPER": frozenset({"PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1",
                              "UI-AUDIT-ONLY-PEPPER-NOT-PRODUCTION-20261113"}),
    "ADMIN_PASSWORD": frozenset({"ProfileFixtureOnly-v1", "QaOnlyPassword-20261113"}),
    "CPF_CACHE_ENCRYPTION_KEY": frozenset({"c" * 64}),
    "DATABASE_URL": frozenset({"postgres://peticao:peticao@127.0.0.1:28451/peticao",
        "postgres://qa_ui_runtime:qa-local-only@127.0.0.1:28451/peticao",
        "postgres://build:build@127.0.0.1:1/build"}),
    "NODE_OPTIONS": frozenset(prefix + heap for heap in
        ("--max-old-space-size=3072", "--max-old-space-size=6144") for prefix in
        ("", "--require=" + _TOOLS + "/qa/network-guard.cjs ",
         "--import=" + _TOOLS + "/qa/build-guard.mjs "))}
_RELATIVE_ENV = frozenset({"HOME", "TMPDIR", "TMP", "TEMP", "XDG_CONFIG_HOME",
                           "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
                           "SECRETS_DIR", "PETICAO_CONFIG_DIR", "CREDENTIALS_DIRECTORY", "GEO_DIR", "MAIL_OUTBOX_DIR"})


def _phase(name):
    if type(name) is not str or len(name) > 64 or not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name):
        raise ValueError("bounded_kebab_phase_required")


def _count(value):
    if type(value) is not int or not 0 <= value <= 10000:
        raise ValueError("bounded_check_count_required")


def _seconds(value):
    if type(value) not in (int, float) or not 0 < value <= 86400 or not math.isfinite(value):
        raise ValueError("bounded_positive_timeout_required")


def _directory(path, *, root_owned=False):
    """Hold a canonical absolute directory without following any parent link."""
    value = os.fspath(path)
    if type(value) is not str or not value.startswith("/") or value != str(Path(value)) or ".." in Path(value).parts:
        raise ValueError("canonical_absolute_directory_required")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in Path(value).parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
            info = os.fstat(fd)
            if root_owned and (info.st_uid != 0 or info.st_mode & 0o022):
                raise PermissionError("root_controlled_executable_ancestors_required")
        return fd
    except BaseException:
        os.close(fd)
        raise


def _executable(path, digest):
    parent = _directory(str(Path(path).parent), root_owned=True)
    try:
        fd = os.open(Path(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o022
                or not before.st_mode & 0o111 or before.st_nlink != 1):
            raise PermissionError("root_owned_immutable_executable_required")
        hashed = hashlib.sha256()
        while chunk := os.read(fd, 65536):
            hashed.update(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise PermissionError("executable_changed_during_hash")
        if hashed.hexdigest() != digest:
            raise PermissionError("executable_sha256_mismatch")
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except BaseException:
        os.close(fd)
        raise


def _boot():
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def _identity(pid):
    # comm can contain whitespace and ')'; fields after the LAST ')' are stable.
    raw = Path("/proc", str(pid), "stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    if len(fields) < 20:
        raise PermissionError("process_identity_unreadable")
    return (_boot(), int(fields[19]), Path("/proc", str(pid)).stat().st_uid)


@dataclass(eq=False)
class _Handle:
    name: str
    process: object
    pidfd: int
    identity: tuple
    started: float
    expected_checks: int
    reader: object = None
    overflow: bool = False
    reader_error: bool = False
    stop_requested: bool = False
    forced: bool = False
    uncertain: bool = False
    result: object = None
    lock: object = field(default_factory=threading.Lock)


class Supervisor:
    def __init__(self, root, allowed_executables):
        if (type(allowed_executables) is not dict or not allowed_executables
                or len(allowed_executables) > 32):
            raise ValueError("sealed_executable_map_required")
        for path, digest in allowed_executables.items():
            if (type(path) is not str or not path.startswith("/") or path != str(Path(path))
                    or ".." in Path(path).parts or type(digest) is not str
                    or not re.fullmatch(r"[a-f0-9]{64}", digest)):
                raise ValueError("canonical_executable_pin_required")
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("linux_pidfd_required")
        self.root = str(Path(root))
        self.allowed_executables = dict(allowed_executables)
        self._handles = {}
        self._used = set()
        self._closed = False
        self._logfd = -1
        self._rootfd = _directory(root)
        try:
            info = os.fstat(self._rootfd)
            if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise PermissionError("owned_private_job_root_required")
            # Exclusive directory denies a restarted supervisor replaying names.
            os.mkdir(".driver-process-logs", 0o700, dir_fd=self._rootfd)
            self._logfd = os.open(".driver-process-logs", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                  dir_fd=self._rootfd)
            os.fsync(self._rootfd)
        except BaseException:
            if self._logfd >= 0:
                os.close(self._logfd)
            os.close(self._rootfd)
            raise

    def _cwd(self, cwd):
        if type(cwd) is not str or (cwd != "." and (not cwd or cwd != str(Path(cwd))
                or Path(cwd).is_absolute() or ".." in Path(cwd).parts)):
            raise ValueError("contained_relative_cwd_required")
        fd = os.dup(self._rootfd)
        try:
            if cwd != ".":
                for part in Path(cwd).parts:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd); fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise

    def _environment(self, env, cwd):
        if env is None:
            env = {}
        if type(env) is not dict:
            raise ValueError("fixed_driver_environment_required")
        for key, value in env.items():
            if type(key) is not str or type(value) is not str:
                raise ValueError("fixed_driver_environment_required")
            if key in _ENV_CHOICES and value in _ENV_CHOICES[key]:
                continue
            if key not in _RELATIVE_ENV or not value or len(value) > 1024 or "\0" in value or Path(value).is_absolute():
                raise ValueError("fixed_driver_environment_required")
            parts = list(Path(cwd).parts) if cwd != "." else []
            for part in value.split("/"):
                if part in ("", "."):
                    continue
                if part == "..":
                    if not parts:
                        raise ValueError("environment_path_escapes_job")
                    parts.pop()
                else:
                    parts.append(part)
            # Require pre-created mapper directories with no symlink parents.
            fd = self._cwd("/".join(parts) or ".")
            os.close(fd)
        return {**_FIXED_ENV, "HOME": ".", "TMPDIR": ".", **env}

    def start(self, name, argv, *, cwd=".", env=None, expected_checks=0):
        """Start once per phase; argv comes only from the sealed driver recipe."""
        if self._closed:
            raise RuntimeError("supervisor_closed")
        _phase(name); _count(expected_checks)
        if name in self._used or len(self._used) >= MAX_PHASES:
            raise PermissionError("phase_replay_or_budget_refused")
        if (type(argv) not in (tuple, list) or not 1 <= len(argv) <= 128
                or any(type(item) is not str or "\0" in item for item in argv)
                or sum(len(item.encode()) for item in argv) > 65536
                or argv[0] not in self.allowed_executables):
            raise ValueError("bounded_fixed_driver_argv_required")
        # Validate cwd before resolving relative environment paths.
        cwd_check = self._cwd(cwd)
        os.close(cwd_check)
        environment = self._environment(env, cwd)
        execfd = _executable(argv[0], self.allowed_executables[argv[0]])
        cwdfd = None
        logfd = None
        try:
            cwdfd = self._cwd(cwd)
            self._used.add(name)  # Failure after this point never authorizes replay.
            logfd = os.open(name + ".log", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600, dir_fd=self._logfd)
            os.fchmod(logfd, 0o600)
            os.fsync(logfd); os.fsync(self._logfd)
            started = time.monotonic()
            process = subprocess.Popen(list(argv), executable="/proc/self/fd/" + str(execfd),
                cwd="/proc/self/fd/" + str(cwdfd), env=environment, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                close_fds=True, pass_fds=(execfd,), bufsize=0)
            # Keep the child tracked even if binding becomes uncertain; no
            # speculative kill and no retry. A zombie retains its PID identity.
            handle = _Handle(name, process, -1, (), started, expected_checks)
            self._handles[name] = handle
            try:
                handle.pidfd = os.pidfd_open(process.pid, 0)
                handle.identity = _identity(process.pid)
                if handle.identity[2] != os.geteuid():
                    raise PermissionError("foreign_process_owner")
            except (OSError, ValueError, PermissionError):
                handle.uncertain = True
            handle.reader = threading.Thread(target=self._read, args=(handle, logfd), daemon=True)
            try:
                handle.reader.start()
            except BaseException:
                handle.uncertain = True
                handle.reader_error = True
                process.stdout.close()
                raise
            logfd = None
            if handle.uncertain:
                raise PermissionError("child_identity_uncertain_preserved")
            return handle
        finally:
            os.close(execfd)
            if cwdfd is not None:
                os.close(cwdfd)
            if logfd is not None:
                os.close(logfd)

    @staticmethod
    def _read(handle, fd):
        written = 0
        try:
            while chunk := handle.process.stdout.read(65536):
                keep = chunk[:max(0, MAX_LOG_BYTES - written)]
                if keep:
                    view = memoryview(keep)
                    while view:
                        count = os.write(fd, view)
                        if count <= 0:
                            raise OSError("short_log_write")
                        view = view[count:]
                    written += len(keep)
                if len(keep) != len(chunk):
                    handle.overflow = True
                # Continue draining/discarding after the bound; never buffer.
            os.fsync(fd)
        except (OSError, ValueError):
            handle.reader_error = True
        finally:
            handle.process.stdout.close()
            os.close(fd)

    def _owned(self, handle):
        if not isinstance(handle, _Handle) or self._handles.get(handle.name) is not handle:
            raise PermissionError("own_process_handle_required")

    def _signal(self, handle, sig):
        self._owned(handle)
        if handle.process.poll() is not None:
            return
        try:
            if handle.uncertain or handle.pidfd < 0 or _identity(handle.process.pid) != handle.identity:
                raise PermissionError("process_identity_changed")
            signal.pidfd_send_signal(handle.pidfd, sig)
        except (OSError, ValueError, PermissionError):
            handle.uncertain = True
            raise PermissionError("process_identity_uncertain_no_signal") from None

    def stop(self, handle, *, grace=1):
        """Stop this direct child only; no PID/PGID signalling fallback."""
        _seconds(grace); self._owned(handle)
        with handle.lock:
            handle.stop_requested = True
            self._signal(handle, signal.SIGTERM)
            try:
                handle.process.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                handle.forced = True
                self._signal(handle, signal.SIGKILL)
                handle.process.wait(timeout=grace)
            code = handle.process.returncode
            return {"exit_code": code if code is not None and code >= 0 else None,
                    "signal": signal.Signals(-code).name if code is not None and code < 0 else None,
                    "forced": handle.forced}

    def run(self, name, argv, *, cwd=".", env=None, expected_checks=0,
            observed_checks=0, timeout=2700):
        """observed_checks may be a trusted zero-arg receipt verifier.

        The verifier runs only after exit zero and durable bounded log drain.
        Exceptions/invalid counts fail the phase without logging their content.
        """
        verifier = observed_checks if callable(observed_checks) else None
        if verifier is None:
            _count(observed_checks)
        _seconds(timeout)
        handle = self.start(name, argv, cwd=cwd, env=env, expected_checks=expected_checks)
        timed_out = False
        try:
            handle.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            self.stop(handle)
        handle.reader.join(timeout=1)
        code = handle.process.returncode
        ready = (code == 0 and not timed_out and not handle.stop_requested and not handle.uncertain
                 and not handle.reader.is_alive() and not handle.reader_error and not handle.overflow)
        verification_failed = False
        if verifier is not None:
            observed_checks = 0
            if ready:
                try:
                    checked = verifier()
                    _count(checked)
                    observed_checks = checked
                except Exception:
                    verification_failed = True
            else:
                verification_failed = True
        sig = signal.Signals(-code).name if code is not None and code < 0 else None
        result = {"name": name, "exit_code": code if code is not None and code >= 0 else None,
                  "signal": sig, "duration_ms": max(0, int((time.monotonic() - handle.started) * 1000)),
                  "expected_checks": expected_checks, "observed_checks": observed_checks,
                  "success": ready and not verification_failed and expected_checks == observed_checks}
        handle.result = dict(result)
        return result

    def log_path(self, name):
        """Private raw log path for a trusted sanitizer; never an artifact path."""
        _phase(name)
        if name not in self._handles:
            raise KeyError("unknown_phase")
        return Path(self.root) / ".driver-process-logs" / (name + ".log")

    def drain(self, *, stop=False, timeout=1):
        if type(stop) is not bool:
            raise ValueError("exact_stop_boolean_required")
        _seconds(timeout)
        if stop:
            for handle in self._handles.values():
                try:
                    self.stop(handle, grace=timeout)
                except (PermissionError, subprocess.TimeoutExpired):
                    handle.uncertain = True
        remaining = 0
        for handle in self._handles.values():
            handle.process.poll()
            if handle.process.returncode is None:
                remaining += 1
            try:
                handle.reader.join(timeout=timeout)
            except (AttributeError, RuntimeError):
                # Reader initialization failure cannot become drain success.
                handle.reader_error = True
            if handle.process.returncode is not None and handle.pidfd >= 0:
                os.close(handle.pidfd); handle.pidfd = -1
        # Unknown identity or still-open output is NOT a completed drain proof.
        complete = (remaining == 0 and all(not handle.uncertain and handle.reader is not None and not handle.reader.is_alive()
                    and not handle.reader_error for handle in self._handles.values()))
        return {"version": 1, "scope": "driver_owned_children", "tracked_processes": len(self._handles),
                "remaining_owned_processes": remaining,
                "stop_requested": any(handle.stop_requested for handle in self._handles.values()),
                "all_exited": complete}

    def close(self):
        """Release fds only after a complete direct-child drain; never stop here."""
        if self._closed:
            return
        if not self.drain()["all_exited"]:
            raise PermissionError("undrained_children_preserved")
        os.close(self._logfd); os.close(self._rootfd)
        self._closed = True
