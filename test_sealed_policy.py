"""Fictitious public-file trees only, under the authorized private TMPDIR.

The fixture seam substitutes the external root ancestor TCB and expected UID;
it does not change users or permissions outside the fixture. Real file fds,
mode/link/hash/stat checks and inventory walks remain active. No helper bytes
are imported/executed by the verifier (the fixture helpers raise on execution).
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

import sealed_policy as sealed

TMP = Path("/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp")


def pin(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


class SealedPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sealed-policy-", dir=TMP)
        self.root = Path(self.temp.name)
        self.tools = self.root / "tools"
        self.tools.mkdir(mode=0o755)
        self.original_refs = deepcopy(sealed._TOOLS)
        refs = {key: (row[0], row[1], None, None) for key, row in self.original_refs.items()}
        self.patches = [mock.patch.object(sealed, "TOOLS", str(self.tools)),
                        mock.patch.object(sealed, "_ROOT_UID", os.geteuid()),
                        mock.patch.object(sealed, "_TOOLS", refs),
                        mock.patch.object(sealed, "_trusted_parent", side_effect=self.anchor)]
        for patch in self.patches:
            patch.start()
        self.policy = self.fixture_policy()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def anchor(self, path):
        relative = Path(path).relative_to(self.root)
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in relative.parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = child
                sealed._directory_info(os.fstat(fd))
            return fd
        except BaseException:
            os.close(fd)
            raise

    def write(self, relative, raw):
        path = self.tools / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        path.write_bytes(raw)
        path.chmod(0o644)
        return pin(raw)

    def fixture_policy(self):
        value = sealed.template()
        artifact = {"version": 1, "fixture": "sanitized-receipts-only"}
        for name in sealed.HELPERS:
            if name == "driver_contract.py":
                body = "HELPERS = frozenset(" + repr(set(sealed.HELPERS)) + ")\n"
            elif name == "qa_adapter.py":
                body = "QA_FILES = frozenset('qa/' + name for name in " + repr(tuple(
                    name[3:] for name in sorted(sealed.QA_FILES))) + ")\n"
            elif name == "artifact_policy.py":
                body = "_POLICY = " + repr(artifact) + "\n"
            else:
                body = "# fixed fictitious helper\n"
            body += "raise AssertionError('FIXTURE_HELPERS_MUST_NEVER_EXECUTE')\n"
            value["helpers"][name] = self.write(name, body.encode())
        files = value["toolchain_inventory"]["files"]
        for root in sealed.TOOL_ROOTS:
            if root != "node20":
                (self.tools / root).mkdir(mode=0o755, exist_ok=True)
        tools = {}
        for name, (path, version, _, _) in sealed._TOOLS.items():
            row = self.write(path, ("fictitious-executable-" + name).encode())
            files[path] = row
            tools[name] = {"path": str(self.tools / path), "version": version, **row}
        wheels = []
        for name in sorted(sealed._WHEELS):
            row = self.write("python-wheels/" + name, ("fictitious-wheel-" + name).encode())
            files["python-wheels/" + name] = row
            wheels.append({"name": name, **row})
        site_row = self.write("python-wheels/site/fixture_pkg.py", b"# fictitious normalized package\n")
        files["python-wheels/site/fixture_pkg.py"] = site_row
        files["pdfjs/offline.dat"] = self.write("pdfjs/offline.dat", b"fictitious offline cache")
        runtime = {"version": 1, "site_root": str(self.tools / "python-wheels/site"),
                   "source_wheels": wheels, "files": {"fixture_pkg.py": site_row}}
        for name in sealed.QA_FILES:
            raw = json.dumps(runtime).encode() if name == "qa/python-runtime.json" else b"// fictitious QA\n"
            value["qa_inventory"][name] = self.write(name, raw)
        sha = hashlib.sha256(b"fictitious root attestation").hexdigest()
        deps = {"version": 1, "parent_archive": deepcopy(sealed._PARENT_DEPS),
                "normalized_archive": {"path": str(self.tools / "inputs/dependencies.normalized.tar.gz"),
                                       "sha256": sha, "bytes": 32},
                "normalization_receipt_sha256": sha, "toolchain": tools,
                "toolchain_inventory_sha256": sealed._digest(value["toolchain_inventory"]),
                "qa_closure_sha256": sealed._digest(value["qa_inventory"]),
                "full_integrity_attestation": {"manifest_event": 123, "inventory_sha256": sha, "evidence_sha256": sha},
                "original_cache_full_integrity_verified": False}
        value["dependencies_ref"] = deps
        for name in sealed.KINDS:
            phases = ["verify-inputs", "prepare-offline-assets", "typecheck"]
            if name != "admin-typecheck-v1": phases += ["build", "export-runtime"]
            if name == "admin-qa-v1": phases += ["qa100"]
            phases += ["drain"]
            value["plans"][name] = {"version": 1, "name": name,
                "source": {**sealed._SOURCE, "path": str(self.tools / "inputs/source.tar.gz")},
                "dependencies": deepcopy(deps), "resources": sealed._resources(4, 8, 3072),
                "artifact_policy": artifact, "phases": phases, "layout": deepcopy(sealed._LAYOUT),
                "environment_policy": deepcopy(sealed._ENVIRONMENT),
                "qa_counts": deepcopy(sealed._COUNTS) if name == "admin-qa-v1" else None,
                "qa_steps": ["postgres-init", "backend43", "fixture-seed", "runtime-start", "http7", "browser40",
                             "maps2", "http-reset8", "fixture-refresh"] if name == "admin-qa-v1" else None,
                "qualification": {"qualified": False, "operationalReady": False, "qualification_manifest_event": None},
                "pending_pins": [], "historical_budget_is_measured_minimum": False}
        return value

    def resync(self):
        deps = self.policy["dependencies_ref"]
        deps["toolchain_inventory_sha256"] = sealed._digest(self.policy["toolchain_inventory"])
        deps["qa_closure_sha256"] = sealed._digest(self.policy["qa_inventory"])
        for value in self.policy["plans"].values():
            value["dependencies"] = deepcopy(deps)

    def test_complete_false_policy_verifies_bytes_without_imports(self):
        before = deepcopy(self.policy)
        result = sealed.verify_closure(self.policy)
        self.assertEqual(set(result), set(sealed.HELPERS))
        for name, raw in result.items():
            self.assertEqual(pin(raw), self.policy["helpers"][name])
            self.assertIn(b"FIXTURE_HELPERS_MUST_NEVER_EXECUTE", raw)
        self.assertEqual(self.policy, before)
        self.assertIs(self.policy["execution_enabled"], False)

    def test_template_is_incomplete_source_only(self):
        value = sealed.template()
        self.assertEqual(sealed.validate_policy(value), value)
        with self.assertRaises((ValueError, PermissionError)):
            sealed.verify_closure(value)
        with self.assertRaises(PermissionError):
            sealed.validate_policy(value, execution=True)
        self.assertTrue(sealed.SOURCE_ONLY)
        self.assertFalse(sealed.QUALIFIED)
        self.assertFalse(sealed.OPERATIONAL_READY)

    def test_execution_release_is_typed_and_never_qualification(self):
        self.policy["execution_enabled"] = True
        for value in (None, True, 0, -1, 1.0):
            self.policy["qualification_release_event"] = value
            with self.subTest(value=value), self.assertRaises((ValueError, PermissionError)):
                sealed.validate_policy(self.policy, execution=True)
        self.policy["qualification_release_event"] = 456
        result = sealed.validate_policy(self.policy, execution=True)
        self.assertIs(result["qualified"], False)
        self.assertIs(result["operationalReady"], False)

    def test_flags_and_schema_extensions_rejected(self):
        for key, value in (("qualified", True), ("operationalReady", 0), ("execution_enabled", 1),
                           ("version", True), ("tools_root", "/tmp/arbitrary"), ("argv", [])):
            changed = deepcopy(self.policy); changed[key] = value
            with self.subTest(key=key), self.assertRaises((ValueError, PermissionError)):
                sealed.validate_policy(changed)

    def test_missing_helper_qa_tool_pins_fail_closed(self):
        for category, name in (("helpers", "process_runner.py"), ("qa_inventory", "qa/common.mjs")):
            changed = deepcopy(self.policy); changed[category][name]["sha256"] = None
            with self.subTest(category=category), self.assertRaises((ValueError, PermissionError)):
                sealed.verify_closure(changed)
        self.policy["dependencies_ref"]["toolchain"]["python"]["sha256"] = None
        self.resync()
        with self.assertRaises((ValueError, PermissionError)):
            sealed.verify_closure(self.policy)

    def test_extra_and_missing_helper_names_rejected(self):
        for name in ("arbitrary.py", "../driver_contract.py"):
            changed = deepcopy(self.policy); changed["helpers"][name] = pin(b"fixture")
            with self.assertRaises(ValueError): sealed.validate_policy(changed)
        del self.policy["helpers"]["runtime_steps.py"]
        with self.assertRaises(ValueError): sealed.validate_policy(self.policy)

    def test_plan_cannot_select_free_paths_env_resources_or_phase(self):
        for key, value in (("resources", {**sealed._resources(4, 8, 3072), "cpu": True}),
                           ("layout", {**sealed._LAYOUT, "site": "/tmp/site"}),
                           ("environment_policy", {**sealed._ENVIRONMENT, "inherit": True}),
                           ("phases", ["arbitrary-command"]), ("pending_pins", ["still-missing"])):
            changed = deepcopy(self.policy)
            changed["plans"]["admin-build-v1"][key] = value
            with self.subTest(key=key), self.assertRaises((ValueError, PermissionError)):
                sealed.verify_closure(changed)

    def test_qa_is_single_phase_with_exact_internal_steps(self):
        value = self.policy["plans"]["admin-qa-v1"]
        self.assertEqual(value["phases"], ["verify-inputs", "prepare-offline-assets", "typecheck", "build",
                                           "export-runtime", "qa100", "drain"])
        self.assertEqual(len(value["qa_steps"]), 9)
        changed = deepcopy(self.policy)
        changed["plans"]["admin-qa-v1"]["qa_steps"] = None
        with self.assertRaises(ValueError): sealed.validate_policy(changed)

    def test_actual_pure_contract_reference_plans_match_validator(self):
        # A schema compatibility check, not closure admission or execution.
        # driver_contract's constructors are pure preparation functions.
        import driver_contract
        with mock.patch.object(sealed, "TOOLS", driver_contract.TOOLS), \
                mock.patch.object(sealed, "_TOOLS", self.original_refs):
            value = sealed.template()
            value["dependencies_ref"] = driver_contract.dependencies_reference()
            value["plans"] = {name: driver_contract.plan(name) for name in driver_contract.KINDS}
            self.assertEqual(sealed.validate_policy(value), value)

    def test_digest_and_same_dependency_binding(self):
        self.policy["dependencies_ref"]["qa_closure_sha256"] = "1" * 64
        self.resync()
        self.policy["plans"]["admin-qa-v1"]["dependencies"]["normalization_receipt_sha256"] = "2" * 64
        with self.assertRaises(ValueError): sealed.validate_policy(self.policy)
        self.resync()
        self.policy["dependencies_ref"]["toolchain_inventory_sha256"] = "1" * 64
        with self.assertRaises(PermissionError): sealed.validate_policy(self.policy)

    def test_frozen_real_tool_refs_are_not_replaced_by_fixture_values(self):
        with mock.patch.object(sealed, "_TOOLS", self.original_refs), self.assertRaises(ValueError):
            sealed.validate_policy(self.policy)

    def test_complete_tool_binary_must_exist_in_inventory(self):
        del self.policy["toolchain_inventory"]["files"]["node20"]
        self.resync()
        with self.assertRaises(PermissionError): sealed.verify_closure(self.policy)

    def test_read_returns_held_verified_bytes_and_rejects_bad_hash_size(self):
        path = str(self.tools / "driver_contract.py")
        row = self.policy["helpers"]["driver_contract.py"]
        self.assertEqual(pin(sealed.read_verified(path, row["sha256"], row["bytes"])), row)
        for sha, size in (("0" * 64, row["bytes"]), ("1" * 64, row["bytes"]),
                          (row["sha256"], row["bytes"] + 1), (row["sha256"], True)):
            with self.subTest(size=size), self.assertRaises((ValueError, PermissionError)):
                sealed.read_verified(path, sha, size)

    def test_public_file_mode_owner_and_hardlink_guards(self):
        path = self.tools / "driver_contract.py"
        row = self.policy["helpers"]["driver_contract.py"]
        for mode in (0o666, 0o664, 0o600):
            path.chmod(mode)
            with self.assertRaises(PermissionError): sealed.read_verified(str(path), **{"sha": row["sha256"], "size": row["bytes"]})
        path.chmod(0o644)
        with mock.patch.object(sealed, "_ROOT_UID", os.geteuid() + 1), self.assertRaises(PermissionError):
            sealed.read_verified(str(path), row["sha256"])
        os.link(path, self.tools / "hardlink.py")
        with self.assertRaises(PermissionError): sealed.read_verified(str(path), row["sha256"])

    def test_canonical_paths_and_all_symlinks_refused(self):
        row = self.policy["helpers"]["driver_contract.py"]
        for name in ("relative.py", str(self.tools) + "/../driver_contract.py", str(self.tools) + "//driver_contract.py"):
            with self.assertRaises(ValueError): sealed.read_verified(name, row["sha256"])
        (self.tools / "link.py").symlink_to(self.tools / "driver_contract.py")
        with self.assertRaises(OSError): sealed.read_verified(str(self.tools / "link.py"), row["sha256"])
        (self.tools / "parent-link").symlink_to(self.tools / "qa", target_is_directory=True)
        with self.assertRaises(OSError): sealed.read_verified(str(self.tools / "parent-link/common.mjs"), "1" * 64)

    def test_named_file_replacement_while_reading_refused(self):
        path = self.tools / "driver_contract.py"
        row = self.policy["helpers"]["driver_contract.py"]
        real_read = os.read
        replaced = False
        def read(fd, count):
            nonlocal replaced
            value = real_read(fd, count)
            if value and not replaced:
                replaced = True
                replacement = self.tools / "replacement.py"
                replacement.write_bytes(value); replacement.chmod(0o644)
                os.replace(replacement, path)
            return value
        with mock.patch.object(sealed.os, "read", side_effect=read), self.assertRaises(PermissionError):
            sealed.read_verified(str(path), row["sha256"], row["bytes"])

    def test_root_ancestor_policy_checks_mode_owner_and_type(self):
        info = self.tools.stat()
        sealed._directory_info(info)
        self.tools.chmod(0o775)
        with self.assertRaises(PermissionError): sealed._directory_info(self.tools.stat())
        self.tools.chmod(0o755)
        with mock.patch.object(sealed, "_ROOT_UID", os.geteuid() + 1), self.assertRaises(PermissionError):
            sealed._directory_info(info)

    def test_unexpected_qa_and_toolchain_members_refused(self):
        self.write("qa/extra.mjs", b"fictitious")
        with self.assertRaises(PermissionError): sealed.verify_closure(self.policy)
        (self.tools / "qa/extra.mjs").unlink()
        self.write("postgres/unlisted.dat", b"fictitious")
        with self.assertRaises(PermissionError): sealed.verify_closure(self.policy)

    def test_toolchain_symlink_even_inside_root_refused(self):
        (self.tools / "python312/alias").symlink_to(self.tools / "node20")
        with self.assertRaises(PermissionError): sealed.verify_closure(self.policy)

    def test_changed_membership_during_verification_refused(self):
        original = sealed.read_verified
        def read(path, sha, size=None):
            result = original(path, sha, size)
            if path == str(self.tools / "node20"):
                self.write("postgres/late-member", b"late-fictitious")
            return result
        with mock.patch.object(sealed, "read_verified", side_effect=read), self.assertRaises(PermissionError):
            sealed.verify_closure(self.policy)

    def test_literal_declarations_cannot_run_code(self):
        with self.assertRaises((PermissionError, ValueError)):
            sealed._declared_names(b"HELPERS=frozenset(__import__('os').listdir('/'))", "HELPERS")
        with self.assertRaises(PermissionError):
            sealed._declared_names(b"HELPERS=frozenset({'a'})\nHELPERS=frozenset({'b'})", "HELPERS")
        with self.assertRaises(PermissionError):
            sealed._declared_names(b"HELPERS=frozenset(['a','a'])", "HELPERS")

    def test_verified_contract_inventory_must_agree(self):
        raw = b"HELPERS=frozenset({'driver_contract.py'})\n"
        self.policy["helpers"]["driver_contract.py"] = self.write("driver_contract.py", raw)
        with self.assertRaises(PermissionError): sealed.verify_closure(self.policy)

    def test_python_placeholder_hook_and_mismatched_inventory_refused(self):
        raw = (self.tools / "qa/python-runtime.json").read_bytes()
        runtime = json.loads(raw)
        for files in ({}, {"evil.pth": pin(b"fictitious")}, {"missing.py": pin(b"fictitious")}):
            changed = deepcopy(runtime); changed["files"] = files
            with self.subTest(files=files), self.assertRaises((ValueError, PermissionError)):
                sealed._python_runtime(json.dumps(changed).encode(), self.policy["toolchain_inventory"]["files"])
        for bad in (b'{"x":1,"x":2}', b'{"x":NaN}'):
            with self.assertRaises(ValueError): sealed._json(bad)


if __name__ == "__main__":
    unittest.main()
