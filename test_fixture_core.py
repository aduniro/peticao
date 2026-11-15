"""Local pure/mocked checks only; never invokes a host manager or real socket."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import types
import unittest
from unittest import mock

import fixture_core as core
import qualification_contract as q


class FixtureCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fixture-core-test-")
        self.root = Path(self.temp.name)
        self.request = {"version": 1, "operation_id": "a" * 32,
                        "jobs": {"success": "1" * 32, "failure": "2" * 32, "cancellation": "3" * 32},
                        "prestart_job_id": "4" * 32, "broker_commit": "b" * 40, "runtime_commit": "c" * 40,
                        "execute": True, "systemd_major": 255, "systemd_version_sha256": "d" * 64}
        for field, names in (("runtime_sha256", q.RUNTIME), ("broker_sha256", q.BROKER), ("harness_sha256", q.HARNESS)):
            self.request[field] = {name: "e" * 64 for name in names}

    def tearDown(self):
        self.temp.cleanup()

    def layout(self):
        public = self.root / "installed"
        public.mkdir()
        (public / "runtime").mkdir()
        (public / "broker").mkdir()
        for field, names, base in (("runtime_sha256", core.RUNTIME, public / "runtime"),
                                   ("broker_sha256", core.BROKER, public / "broker"),
                                   ("harness_sha256", core.HARNESS, public)):
            for name in names:
                data = ("frozen synthetic " + name).encode()
                (base / name).write_bytes(data)
                self.request[field][name] = hashlib.sha256(data).hexdigest()
        (public / "readonly-marker").write_bytes(b"synthetic public readonly marker\n")
        (public / "RUN-REQUEST.json").write_text(json.dumps(self.request))
        return public

    @contextlib.contextmanager
    def installed(self, public):
        private = self.root / "private"
        def imported(name):
            base = public / "runtime" if name + ".py" in core.RUNTIME else public / "broker" if name + ".py" in core.BROKER else public
            value = types.SimpleNamespace(__file__=str(base / (name + ".py")))
            if name == "qualification_contract":
                value.operation, value.PUBLIC, value.PRIVATE = q.operation, public, private
            return value
        # Explicit test seams: no root path, trusted installation, host or code
        # import is impersonated outside this isolated mocked call.
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(core, "PUBLIC", public))
            stack.enter_context(mock.patch.object(core, "PRIVATE", private))
            stack.enter_context(mock.patch.object(core, "REQUEST", public / "RUN-REQUEST.json"))
            stack.enter_context(mock.patch.object(core, "__file__", str(public / "fixture_core.py")))
            stack.enter_context(mock.patch.object(core, "root_file", side_effect=lambda path, *args, **kwargs: Path(path)))
            stack.enter_context(mock.patch.object(core.os, "geteuid", return_value=0))
            stack.enter_context(mock.patch.object(core.socket, "gethostname", return_value="peticao-civo"))
            stack.enter_context(mock.patch.object(core.sys, "modules", {}))
            stack.enter_context(mock.patch.object(core.sys, "path", list(core.sys.path)))
            importer = stack.enter_context(mock.patch.object(core.importlib, "import_module", side_effect=imported))
            yield importer

    def test_no_old_phase_executables_or_direct_rpc_transport(self):
        for name in ("run", "run_locked", "start", "observe", "cleanup", "main", "finish_storage", "admission_proof"):
            self.assertFalse(hasattr(core, name))
        self.assertEqual(len(core.RUNTIME) + len(core.BROKER) + len(core.HARNESS), 23)
        # Frozen inventory is 10 runtime + 5 broker + 8 harness (23 source files).
        self.assertEqual((len(core.RUNTIME), len(core.BROKER), len(core.HARNESS)), (10, 5, 8))

    def test_load_verifies_entire_closure_before_import(self):
        public = self.layout()
        with self.installed(public) as importer:
            request, modules = core.load()
            self.assertEqual(request, self.request)
            self.assertIn("broker_wire", modules)
            self.assertEqual(importer.call_count, len(core.MODULES))
        (public / "broker" / "broker_proxy.py").write_text("changed")
        with self.installed(public) as importer:
            with self.assertRaisesRegex(PermissionError, "frozen_code_changed"):
                core.load()
            importer.assert_not_called()

    def test_load_rejects_extra_package_member_before_import(self):
        public = self.layout()
        for relative in ("rogue.py", "runtime/rogue.py", "broker/rogue.py"):
            with self.subTest(relative=relative):
                rogue = public / relative
                rogue.write_text("unfrozen")
                with self.installed(public) as importer:
                    with self.assertRaises(PermissionError):
                        core.load()
                    importer.assert_not_called()
                rogue.unlink()

    def test_load_rejects_unpinned_names_marker_and_foreign_cached_module(self):
        public = self.layout()
        original = dict(self.request["runtime_sha256"])
        self.request["runtime_sha256"]["../outside.py"] = "e" * 64
        (public / "RUN-REQUEST.json").write_text(json.dumps(self.request))
        with self.installed(public) as importer:
            with self.assertRaisesRegex(ValueError, "exact_import_set"):
                core.load()
            importer.assert_not_called()
        self.request["runtime_sha256"] = original
        (public / "RUN-REQUEST.json").write_text(json.dumps(self.request))
        (public / "readonly-marker").write_text("different")
        with self.installed(public) as importer:
            with self.assertRaisesRegex(ValueError, "marker_mismatch"):
                core.load()
            importer.assert_not_called()
        (public / "readonly-marker").write_bytes(b"synthetic public readonly marker\n")
        with self.installed(public) as importer:
            core.sys.modules["cgroups"] = types.SimpleNamespace(__file__="/foreign/cgroups.py")
            with self.assertRaisesRegex(PermissionError, "foreign_preloaded"):
                core.load()
            importer.assert_not_called()

    def test_load_requires_exact_fixture_core_path_root_and_host(self):
        public = self.layout()
        for case in ("file", "uid", "host"):
            with self.subTest(case=case), self.installed(public) as importer:
                patch = (mock.patch.object(core, "__file__", str(public / "qualification_helper.py")) if case == "file"
                         else mock.patch.object(core.os, "geteuid", return_value=1000) if case == "uid"
                         else mock.patch.object(core.socket, "gethostname", return_value="other-host"))
                with patch, self.assertRaises(PermissionError):
                    core.load()
                importer.assert_not_called()

    def build_modules(self):
        c = types.SimpleNamespace(digest=q.digest, EpochGuard=mock.Mock(return_value="epoch-guard"),
                                  Authority=mock.Mock(return_value="authority"), Claims=mock.Mock(), WorkerJournal=mock.Mock())
        worker_module = types.SimpleNamespace(WorkerRPC=mock.Mock())
        worker_module.WorkerRPC.return_value.rpc.side_effect = AssertionError("direct WorkerRPC bypass")
        result = {"remote_contract": c, "qualification_contract": types.SimpleNamespace(digest=q.digest, SOCKET=self.root / "worker.sock"),
                  "admission": types.SimpleNamespace(Admission=mock.Mock()),
                  "project_storage": types.SimpleNamespace(ProjectStorage=mock.Mock()),
                  "systemd_adapter": types.SimpleNamespace(SystemdAdapter=mock.Mock()), "worker": worker_module,
                  "artifacts": types.SimpleNamespace(ArtifactStore=mock.Mock()),
                  "controller": types.SimpleNamespace(Finalizer=mock.Mock(), Backend=mock.Mock()), "cgroups": object(),
                  "broker_wire": types.SimpleNamespace(proxy_once=mock.Mock(return_value={"ok": True, "result": {"state": "prepared"}}), OutcomeUncertain=ConnectionError),
                  "broker_server": types.SimpleNamespace(trusted_endpoint=mock.Mock())}
        return result

    def build(self, modules, **kwargs):
        profiles = {"fixture-pass": {"name": "fixture-pass"}, "fixture-fail": {"name": "fixture-fail"}}
        def read(path):
            if Path(path).name == "bootstrap-intent.json":
                return {"operation_sha256": q.digest(self.request), "boot_id": "test-boot"}
            if Path(path).name == "profiles.json":
                return profiles
            raise AssertionError("unexpected read")
        with mock.patch.object(core, "root_file"), mock.patch.object(core, "read_json", side_effect=read), mock.patch.object(core, "boot_id", return_value="test-boot"):
            return core.build(self.request, modules, **kwargs)

    def test_build_client_has_no_keeper_or_schema_install_and_uses_one_unix_proxy(self):
        modules = self.build_modules()
        context = self.build(modules)
        modules["remote_contract"].Claims.return_value.install_schema.assert_not_called()
        modules["worker"].WorkerRPC.install_schema.assert_not_called()
        self.assertIsNone(context["references"])
        client = mock.MagicMock()
        client.__enter__.return_value = client
        with mock.patch.object(core.socket, "socket", return_value=client) as constructor:
            data = {"action": "observe", "id": self.request["jobs"]["success"]}
            self.assertEqual(context["transport"].call("civo", data), {"state": "prepared"})
        constructor.assert_called_once_with(socket.AF_UNIX, socket.SOCK_STREAM)
        modules["broker_server"].trusted_endpoint.assert_called_once_with(modules["qualification_contract"].SOCKET)
        client.connect.assert_called_once_with(str(modules["qualification_contract"].SOCKET))
        modules["broker_wire"].proxy_once.assert_called_once_with(client, data)
        context["worker"].rpc.assert_not_called()

    def test_build_server_uses_only_supplied_reference_keeper(self):
        modules = self.build_modules()
        keeper = object()
        context = self.build(modules, install=True, references=keeper)
        self.assertIs(context["references"], keeper)
        modules["systemd_adapter"].SystemdAdapter.assert_called_once_with(storage=context["storage"], references=keeper)
        modules["remote_contract"].Claims.return_value.install_schema.assert_called_once_with(1)
        modules["worker"].WorkerRPC.install_schema.assert_called_once_with(context["journal"])

    def test_proxy_rejection_lost_reply_and_drop_never_retry_or_fall_back(self):
        modules = self.build_modules()
        context = self.build(modules)
        client = mock.MagicMock()
        client.__enter__.return_value = client
        with mock.patch.object(core.socket, "socket", return_value=client):
            modules["broker_wire"].proxy_once.return_value = {"ok": False, "error_type": "PermissionError"}
            with self.assertRaisesRegex(PermissionError, "rejected_no_replay"):
                context["transport"].call("civo", {"action": "start"})
            self.assertEqual(modules["broker_wire"].proxy_once.call_count, 1)
            modules["broker_wire"].proxy_once.side_effect = ConnectionError("lost response")
            with self.assertRaises(ConnectionError):
                context["transport"].call("civo", {"action": "start"})
            self.assertEqual(modules["broker_wire"].proxy_once.call_count, 2)
            modules["broker_wire"].proxy_once.side_effect = None
            modules["broker_wire"].proxy_once.return_value = {"ok": True, "result": {"state": "started"}}
            context["transport"].drop = True
            with self.assertRaisesRegex(ConnectionError, "observe_same_id"):
                context["transport"].call("civo", {"action": "start"})
            self.assertFalse(context["transport"].drop)
            self.assertEqual(modules["broker_wire"].proxy_once.call_count, 3)
            with self.assertRaises(PermissionError):
                context["transport"].call("azure", {"action": "observe"})
        context["worker"].rpc.assert_not_called()

    def test_transport_only_maps_allowlisted_error_classes_without_text(self):
        modules = self.build_modules()
        context = self.build(modules)
        client = mock.MagicMock()
        client.__enter__.return_value = client
        for kind, expected in (("PermissionError", PermissionError), ("ValueError", ValueError),
                               ("RuntimeError", RuntimeError), ("OutcomeUncertain", ConnectionError),
                               ("RetirementUncertain", ConnectionError), ("UnrecognizedError", RuntimeError)):
            with self.subTest(kind=kind), mock.patch.object(core.socket, "socket", return_value=client):
                modules["broker_wire"].proxy_once.return_value = {"ok": False, "error_type": kind}
                before = modules["broker_wire"].proxy_once.call_count
                with self.assertRaises(expected) as error:
                    context["transport"].call("civo", {"action": "retire", "token": "f" * 64})
                self.assertEqual(modules["broker_wire"].proxy_once.call_count, before + 1)
                self.assertNotIn("f" * 64, str(error.exception))
        for invalid in ({"ok": 1, "result": {}}, {"ok": True, "result": {}, "extra": True},
                        {"ok": False, "error_type": "token\nleak"}, {"ok": False, "error_type": "PermissionError", "message": "secret"}):
            with self.subTest(invalid=invalid), mock.patch.object(core.socket, "socket", return_value=client):
                modules["broker_wire"].proxy_once.return_value = invalid
                with self.assertRaisesRegex(RuntimeError, "outcome_unknown"):
                    context["transport"].call("civo", {"action": "observe"})

    def test_enqueue_prestart_uses_fourth_id_and_pass_profile(self):
        c = types.SimpleNamespace(BACKEND="ssh-systemd-v1", digest=q.digest, canonical=q.canonical,
                                  validate_manifest=mock.Mock(), now=lambda: "test")
        database = mock.MagicMock()
        database.__enter__.return_value = database
        c.transaction = mock.Mock(return_value=database)
        modules = {"remote_contract": c}
        descriptor = {"source_sha256": "a" * 64, "dependencies_sha256": "b" * 64, "artifact_policy_sha256": "c" * 64}
        context = {"profiles": {"fixture-pass": descriptor}, "journal": types.SimpleNamespace(profiles={}),
                   "claims": types.SimpleNamespace(path=self.root / "queue.sqlite", _event=mock.Mock())}
        with mock.patch.object(core, "durable") as durable, mock.patch.object(core, "read_json", return_value={}), mock.patch.object(core, "boot_id", return_value="test"):
            manifest = core.enqueue(self.request, modules, context, "prestart")
        self.assertEqual(manifest["job_id"], self.request["prestart_job_id"])
        self.assertEqual(manifest["profile"], "fixture-pass")
        durable.assert_called_once_with(modules, "prestart-enqueue-intent.json", {"manifest": manifest})
        database.execute.assert_called_once()
        with self.assertRaises(ValueError):
            core.enqueue(self.request, modules, context, "../other")

    def test_bootstrap_includes_four_tokens_and_four_absence_checks(self):
        private = self.root / "new-private"
        modules = self.build_modules()
        modules["qualification_contract"].unit = q.unit
        modules["artifacts"].durable_json = mock.Mock()
        modules["artifacts"].MAX_BYTES = 1024
        modules["remote_contract"].WorkerJournal.initialize = mock.Mock()
        modules["systemd_adapter"].SystemdAdapter.return_value.properties.return_value = {"LoadState": "not-found"}
        modules["systemd_adapter"].SystemdAdapter.return_value.state_name.return_value = "synthetic-state"
        public = self.root / "public"
        public.mkdir()
        (public / "qualification_job.py").write_text("synthetic probe")
        with mock.patch.object(core, "PUBLIC", public), mock.patch.object(core, "PRIVATE", private), mock.patch.object(core, "root_file"), mock.patch.object(core, "baseline", return_value={}), mock.patch.object(core, "actual_version", return_value={}), mock.patch.object(core, "build", return_value={}), mock.patch.object(core, "boot_id", return_value="test"):
            core.bootstrap(self.request, modules)
        writes = modules["artifacts"].durable_json.call_args_list
        token_paths = [call.args[0] for call in writes if call.args[0].parent == private / "tokens"]
        self.assertEqual({path.stem for path in token_paths}, set(core.all_jobs(self.request).values()))
        self.assertEqual(len(token_paths), 4)
        self.assertEqual(modules["systemd_adapter"].SystemdAdapter.return_value.properties.call_count, 4)
        receipt = next(call.args[1] for call in writes if call.args[0].name == "bootstrap-receipt.json")
        self.assertEqual(receipt["job_count"], 4)
        with mock.patch.object(core, "PRIVATE", private), mock.patch.object(core, "root_file"), self.assertRaises(PermissionError):
            core.bootstrap(self.request, modules)

    def test_reference_proof_enforces_same_process_boot_and_real_backend(self):
        unit, invocation = q.unit("1" * 32), "a" * 32
        before = {"unit": unit, "invocation_id": invocation, "state": "held", "process_id": 123,
                  "worker_boot_id": "test", "connection_uncertain": False, "backend": "libsystemd-sd-bus"}
        after = {**before, "state": "released"}
        self.assertTrue(core.reference_proof(before, after, unit, invocation, 123, "test")["released_after_retained"])
        for changed in ({"process_id": 124}, {"worker_boot_id": "other"}, {"connection_uncertain": True}, {"backend": "fake"}):
            with self.subTest(changed=changed), self.assertRaises(PermissionError):
                core.reference_proof(before, {**after, **changed}, unit, invocation, 123, "test")

    def test_execution_lock_is_nonblocking_and_same_file(self):
        private = self.root / "private"
        private.mkdir()
        (private / "execution.lock").touch(mode=0o600)
        with mock.patch.object(core, "PRIVATE", private), mock.patch.object(core, "root_file", side_effect=lambda path, **kwargs: path):
            with core.execution_lock():
                with self.assertRaisesRegex(RuntimeError, "runner_active_observe_only"):
                    with core.execution_lock():
                        self.fail("second execution lock acquired")

    def test_process_identity_is_bounded_to_positive_pid_and_boot(self):
        for invalid in (0, -1, True, "../../etc/passwd"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                core.process_identity(invalid)
        identity = core.process_identity(os.getpid())
        self.assertEqual(identity["pid"], os.getpid())
        self.assertTrue(identity["start_ticks"].isdigit())
        self.assertEqual(identity["boot_id"], core.boot_id())
        self.assertTrue(core.alive(identity))
        with self.assertRaises(PermissionError):
            core.alive({**identity, "boot_id": "different-boot"})

    def test_wait_timeout_never_restarts(self):
        backend = types.SimpleNamespace(observe=mock.Mock(return_value={}))
        with mock.patch.object(core.time, "monotonic", side_effect=[0, 66]), self.assertRaisesRegex(TimeoutError, "no_restart"):
            core.wait_for({"backend": backend}, {})
        backend.observe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
