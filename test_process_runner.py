"""Private fixtures and trivial local Python only; no app/DB/browser/systemd."""
import hashlib
import io
import os
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import process_runner as runner

TMP = Path("/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp")
PYTHON = str(Path("/usr/bin/python3").resolve())


class ProcessRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.digest = hashlib.sha256(Path(PYTHON).read_bytes()).hexdigest()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="process-runner-", dir=TMP)
        self.root = Path(self.temp.name)
        self.supervisor = runner.Supervisor(self.root, {PYTHON: self.digest})

    def tearDown(self):
        # Tests never leave deliberately running children outside this scope.
        self.supervisor.drain(stop=True)
        self.supervisor.close()
        self.temp.cleanup()

    def command(self, script):
        return [PYTHON, "-I", "-S", "-B", "-c", script]

    def test_trivial_python_result_private_log_and_direct_drain(self):
        result = self.supervisor.run("fixture-pass", self.command("print('fictitious-output')"),
                                     expected_checks=1, observed_checks=1)
        self.assertEqual(set(result), {"name", "exit_code", "signal", "duration_ms",
                                      "expected_checks", "observed_checks", "success"})
        self.assertTrue(result["success"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIsNone(result["signal"])
        path = self.supervisor.log_path("fixture-pass")
        self.assertEqual(path.read_bytes(), b"fictitious-output\n")
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        proof = self.supervisor.drain()
        self.assertEqual(proof, {"version": 1, "scope": "driver_owned_children", "tracked_processes": 1,
                                "remaining_owned_processes": 0, "stop_requested": False, "all_exited": True})

    def test_nonzero_and_check_mismatch_are_failures(self):
        failed = self.supervisor.run("fixture-fail", self.command("raise SystemExit(3)"))
        self.assertEqual(failed["exit_code"], 3)
        self.assertFalse(failed["success"])
        mismatch = self.supervisor.run("missing-check", self.command("pass"),
                                       expected_checks=1, observed_checks=0)
        self.assertFalse(mismatch["success"])

    def test_timeout_stops_only_own_child_and_reports_signal(self):
        result = self.supervisor.run("timeout", self.command("import time;time.sleep(10)"), timeout=0.05)
        self.assertFalse(result["success"])
        self.assertIn(result["signal"], {"SIGTERM", "SIGKILL"})
        self.assertIsNone(result["exit_code"])
        self.assertTrue(self.supervisor.drain()["stop_requested"])

    def test_exact_fresh_environment_no_inherited_secrets(self):
        with mock.patch.dict(os.environ, {"UNTRUSTED_SECRET": "fictitious-only", "LD_PRELOAD": "bad"}):
            value = self.supervisor._environment({"HOME": ".", "TMPDIR": "."}, ".")
        self.assertNotIn("UNTRUSTED_SECRET", value)
        self.assertNotIn("LD_PRELOAD", value)
        self.assertEqual(value["HOME"], ".")
        self.assertEqual(value["TMPDIR"], ".")

    def test_relative_environment_is_preserved_with_containment(self):
        (self.root / "source" / "site").mkdir(parents=True)
        (self.root / "t").mkdir()
        value = self.supervisor._environment({"HOME": "../../t", "TMPDIR": "../../t"}, "source/site")
        self.assertEqual(value["TMPDIR"], "../../t")
        for invalid in ("../../../tmp", "/tmp", "../../missing"):
            with self.subTest(invalid=invalid), self.assertRaises((ValueError, OSError)):
                self.supervisor._environment({"TMPDIR": invalid}, "source/site")

    def test_environment_symlink_parent_rejected(self):
        (self.root / "alias").symlink_to(TMP, target_is_directory=True)
        with self.assertRaises(OSError):
            self.supervisor._environment({"HOME": "alias"}, ".")

    def test_fictitious_fixed_values_allowed_and_real_like_overrides_denied(self):
        good = {"HASH_PEPPER": "PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1",
                "ADMIN_PASSWORD": "QaOnlyPassword-20261113", "CPF_CACHE_ENCRYPTION_KEY": "c" * 64,
                "DATABASE_URL": "postgres://build:build@127.0.0.1:1/build", "NEXT_BUILD_CPUS": "2",
                "PLAYWRIGHT_NODEJS_PATH": runner._TOOLS + "/node20",
                "NODE_OPTIONS": "--require=" + runner._TOOLS + "/qa/network-guard.cjs --max-old-space-size=6144"}
        self.assertEqual(self.supervisor._environment(good, ".")["NODE_OPTIONS"], good["NODE_OPTIONS"])
        for value in ({"LD_PRELOAD": "fictitious"}, {"PYTHONPATH": "."}, {"PATH": "/tmp"},
                      {"NODE_OPTIONS": "--require=/tmp/evil"}, {"ADMIN_PASSWORD": "arbitrary"},
                      {"DATABASE_URL": "postgres://build:build@127.0.0.1:5432/build"},
                      {"XDG_CONFIG_HOME": "/home/user/.config"}):
            with self.subTest(keys=list(value)), self.assertRaises(ValueError):
                self.supervisor._environment(value, ".")

    def test_cwd_traversal_and_symlinks_rejected(self):
        (self.root / "alias").symlink_to(TMP, target_is_directory=True)
        for cwd in ("..", "../outside", "/tmp", "a/../b", "alias", "alias/subdir", "a//b"):
            with self.subTest(cwd=cwd), self.assertRaises((ValueError, OSError)):
                self.supervisor.start("unsafe-cwd", self.command("pass"), cwd=cwd)
        self.assertEqual(len(self.supervisor._handles), 0)

    def test_phase_name_and_argv_are_bounded(self):
        for name in ("../x", "a/b", "Bad", "a--b", "x" * 65, True):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.supervisor.start(name, self.command("pass"))
        for argv in (["/bin/sh", "-c", "true"], [], [PYTHON, "\0"], [PYTHON, "x" * 65537]):
            with self.subTest(argv_size=len(argv)), self.assertRaises(ValueError):
                self.supervisor.start("bad-argv", argv)

    def test_failed_spawn_intent_cannot_be_replayed(self):
        with mock.patch.object(runner.subprocess, "Popen", side_effect=OSError("fixture-no-spawn")):
            with self.assertRaises(OSError):
                self.supervisor.start("once-only", self.command("pass"))
        with self.assertRaises(PermissionError):
            self.supervisor.start("once-only", self.command("pass"))
        self.assertEqual(len(self.supervisor._handles), 0)

    def test_existing_log_cannot_be_truncated(self):
        path = self.root / ".driver-process-logs" / "occupied.log"
        path.write_bytes(b"preserve-fixture")
        with mock.patch.object(runner.subprocess, "Popen") as spawn, self.assertRaises(FileExistsError):
            self.supervisor.start("occupied", self.command("pass"))
        spawn.assert_not_called()
        self.assertEqual(path.read_bytes(), b"preserve-fixture")

    def test_pin_validated_before_each_spawn(self):
        self.supervisor.allowed_executables[PYTHON] = "0" * 64
        with mock.patch.object(runner.subprocess, "Popen") as spawn, self.assertRaises(PermissionError):
            self.supervisor.start("bad-pin", self.command("pass"))
        spawn.assert_not_called()

    def test_root_executable_symlink_and_untrusted_ancestor_refused(self):
        with self.assertRaises(OSError):
            runner._executable("/usr/bin/python3", self.digest)
        with self.assertRaises(PermissionError):
            runner._executable(str(self.root / "fake"), "0" * 64)

    def fake_handle(self, identity=("boot-fixture", 123, 1000)):
        process = mock.Mock()
        process.pid = 424242
        process.poll.return_value = None
        handle = runner._Handle("mock-child", process, 19, identity, 0, 0)
        self.supervisor._handles[handle.name] = handle
        return handle

    def test_pidfd_signal_requires_same_boot_ticks_owner(self):
        handle = self.fake_handle()
        try:
            with mock.patch.object(runner, "_identity", return_value=handle.identity), \
                    mock.patch.object(runner.signal, "pidfd_send_signal") as send:
                self.supervisor._signal(handle, signal.SIGTERM)
                send.assert_called_once_with(19, signal.SIGTERM)
        finally:
            self.supervisor._handles.clear()

    def test_uncertain_reused_or_foreign_identity_never_signalled(self):
        handle = self.fake_handle()
        try:
            for identity in (("other-boot", 123, 1000), ("boot-fixture", 124, 1000),
                             ("boot-fixture", 123, 0)):
                handle.uncertain = False
                with mock.patch.object(runner, "_identity", return_value=identity), \
                        mock.patch.object(runner.signal, "pidfd_send_signal") as send, \
                        mock.patch.object(runner.os, "kill") as kill, \
                        self.assertRaises(PermissionError):
                    self.supervisor._signal(handle, signal.SIGTERM)
                send.assert_not_called(); kill.assert_not_called()
        finally:
            self.supervisor._handles.clear()

    def test_no_foreign_handle_or_numeric_pid_api(self):
        for value in (123, SimpleNamespace(name="none"), None):
            with self.assertRaises(PermissionError):
                self.supervisor.stop(value)

    def test_forced_stop_uses_pidfd_and_reports_escalation(self):
        handle = self.fake_handle()
        handle.process.wait.side_effect = [subprocess.TimeoutExpired("fixture", 0.01), None]
        handle.process.returncode = -signal.SIGKILL
        try:
            with mock.patch.object(runner, "_identity", return_value=handle.identity), \
                    mock.patch.object(runner.signal, "pidfd_send_signal") as send, \
                    mock.patch.object(runner.os, "kill") as kill:
                result = self.supervisor.stop(handle, grace=0.01)
            self.assertEqual(send.call_args_list, [mock.call(19, signal.SIGTERM), mock.call(19, signal.SIGKILL)])
            kill.assert_not_called()
            self.assertEqual(result, {"exit_code": None, "signal": "SIGKILL", "forced": True})
        finally:
            self.supervisor._handles.clear()

    def test_open_pipe_or_unknown_identity_is_not_drain_success(self):
        handle = self.fake_handle()
        handle.process.returncode = 0
        handle.reader = mock.Mock()
        handle.reader.is_alive.return_value = True
        handle.pidfd = -1
        try:
            self.assertFalse(self.supervisor.drain()["all_exited"])
            handle.reader.is_alive.return_value = False
            handle.uncertain = True
            self.assertFalse(self.supervisor.drain()["all_exited"])
            with self.assertRaises(PermissionError):
                self.supervisor.close()
        finally:
            self.supervisor._handles.clear()

    def test_log_stream_drains_beyond_bound_without_unbounded_buffer(self):
        class Stream:
            def __init__(self): self.remaining = 163; self.closed = False
            def read(self, count):
                self.assert_count = count
                if not self.remaining: return b""
                self.remaining -= 1
                return b"x" * count
            def close(self): self.closed = True
        stream = Stream()
        handle = runner._Handle("large-log", SimpleNamespace(stdout=stream), -1, (), 0, 0)
        path = self.root / "reader-fixture.log"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        runner.Supervisor._read(handle, fd)
        self.assertEqual(path.stat().st_size, runner.MAX_LOG_BYTES)
        self.assertEqual(stream.remaining, 0)
        self.assertEqual(stream.assert_count, 65536)
        self.assertTrue(stream.closed)
        self.assertTrue(handle.overflow)
        self.assertFalse(handle.reader_error)

    def test_reader_error_cannot_be_successful_drain(self):
        handle = runner._Handle("io-error", SimpleNamespace(stdout=io.BytesIO(b"fixture")), -1, (), 0, 0)
        fd = os.open(self.root / "bad-reader.log", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with mock.patch.object(runner.os, "write", side_effect=OSError("fixture-disk-full")):
            runner.Supervisor._read(handle, fd)
        self.assertTrue(handle.reader_error)

    def test_root_private_and_restart_refused(self):
        with self.assertRaises(FileExistsError):
            runner.Supervisor(self.root, {PYTHON: self.digest})
        other = self.root / "public"
        other.mkdir(mode=0o755)
        with self.assertRaises(PermissionError):
            runner.Supervisor(other, {PYTHON: self.digest})

    def test_spawn_contract_one_public_execfd_and_no_shell(self):
        with mock.patch.object(runner.subprocess, "Popen", wraps=subprocess.Popen) as spawn:
            self.supervisor.run("spawn-contract", self.command("pass"))
        _, options = spawn.call_args
        self.assertTrue(options["close_fds"])
        self.assertTrue(options["start_new_session"])
        self.assertEqual(len(options["pass_fds"]), 1)
        self.assertTrue(options["executable"].startswith("/proc/self/fd/"))
        self.assertFalse(options.get("shell", False))

    def test_actual_cwd_and_relative_environment_are_preserved(self):
        (self.root / "source" / "site").mkdir(parents=True)
        (self.root / "t").mkdir()
        result = self.supervisor.run("relative-context", self.command(
            "import os; assert os.getcwd().endswith('/source/site'); "
            "assert os.environ['TMPDIR']=='../../t'; "
            "assert os.environ['HOME']=='../../t'; "
            "assert 'UNTRUSTED_SECRET' not in os.environ"), cwd="source/site",
            env={"HOME": "../../t", "TMPDIR": "../../t"})
        self.assertTrue(result["success"])

    def test_log_overflow_prevents_success_even_when_child_exits_zero(self):
        actual = self.supervisor._read
        def overflow(handle, fd):
            actual(handle, fd)
            handle.overflow = True
        with mock.patch.object(self.supervisor, "_read", side_effect=overflow):
            result = self.supervisor.run("overflow-result", self.command("pass"))
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["success"])

    def test_observed_verifier_after_exit_zero_and_durable_log(self):
        def verify():
            handle = self.supervisor._handles["receipt-check"]
            self.assertEqual(handle.process.returncode, 0)
            self.assertFalse(handle.reader.is_alive())
            self.assertEqual(self.supervisor.log_path("receipt-check").read_bytes(), b"fixture\n")
            return 100
        result = self.supervisor.run("receipt-check", self.command("print('fixture')"),
                                     expected_checks=100, observed_checks=verify)
        self.assertEqual(result["observed_checks"], 100)
        self.assertTrue(result["success"])

    def test_verifier_not_called_after_nonzero_or_log_overflow(self):
        verifier = mock.Mock(return_value=1)
        result = self.supervisor.run("no-verifier", self.command("raise SystemExit(1)"),
                                     expected_checks=1, observed_checks=verifier)
        verifier.assert_not_called()
        self.assertFalse(result["success"])

    def test_verifier_invalid_or_exception_fails_without_raw_log(self):
        for index, value in enumerate((True, -1, 10001, 1.0)):
            result = self.supervisor.run("invalid-count-" + str(index), self.command("pass"),
                                         observed_checks=lambda: value)
            self.assertFalse(result["success"])
            self.assertEqual(result["observed_checks"], 0)
        def fail():
            raise ValueError("FICTITIOUS-DO-NOT-LOG")
        result = self.supervisor.run("verifier-error", self.command("pass"), observed_checks=fail)
        self.assertFalse(result["success"])
        self.assertEqual(self.supervisor.log_path("verifier-error").read_bytes(), b"")

    def test_invalid_counts_timeouts_and_flags_refused(self):
        for value in (True, -1, 1.0, 1000001):
            with self.assertRaises(ValueError):
                self.supervisor.run("bad-count", self.command("pass"), expected_checks=value)
        for value in (True, 0, float("nan"), float("inf"), 86401):
            with self.assertRaises(ValueError):
                self.supervisor.run("bad-timeout", self.command("pass"), timeout=value)
        with self.assertRaises(ValueError):
            self.supervisor.drain(stop=1)
        self.assertTrue(runner.SOURCE_ONLY)
        self.assertFalse(runner.QUALIFIED)
        self.assertFalse(runner.OPERATIONAL_READY)


if __name__ == "__main__":
    unittest.main()
