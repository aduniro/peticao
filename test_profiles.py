"""Metadata-only regression tests. No app, DB, package or browser execution."""
import hashlib
import json
from pathlib import Path
import unittest

import profiles


class ProfileTests(unittest.TestCase):
    def test_closed_kind_set_and_strict_input(self):
        self.assertEqual(profiles.KINDS, frozenset({"admin-typecheck-v1", "admin-build-v1", "admin-qa-v1"}))
        for value in (None, True, 1, [], {}, "fixture-pass", "ADMIN-QA-V1", "admin-qa-v1 ", "../../runner"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                profiles.descriptor(value)
            with self.assertRaises(ValueError):
                profiles.catalog_record(value)

    def test_catalog_hashes_actual_manifest_without_recursive_self_hash(self):
        for kind in sorted(profiles.KINDS):
            manifest = profiles.descriptor(kind)
            record = profiles.catalog_record(kind)
            expected = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
            self.assertEqual(record["profile_sha256"], expected)
            self.assertNotIn("profile_sha256", manifest)
            self.assertEqual(record["source_sha256"], manifest["source"]["archive_sha256"])
            self.assertEqual(record["dependencies_sha256"], profiles.digest(manifest["dependencies"]))
            self.assertEqual(record["artifact_policy_sha256"], profiles.digest(manifest["artifact_policy"]))
            self.assertEqual(set(record), {"profile", "profile_sha256", "source_sha256", "dependencies_sha256", "artifact_policy_sha256", "qualified", "qualification_manifest_event", "qualification_evidence_sha256"})
            self.assertIs(record["qualified"], False)
            self.assertIsNone(record["qualification_manifest_event"])
            self.assertIsNone(record["qualification_evidence_sha256"])

    def test_each_profile_hash_binds_different_phases_and_returns_fresh_data(self):
        hashes = {profiles.catalog_record(kind)["profile_sha256"] for kind in profiles.KINDS}
        self.assertEqual(len(hashes), 3)
        before = profiles.catalog_record("admin-qa-v1")
        candidate = profiles.descriptor("admin-qa-v1")
        candidate["dependencies"]["python_wheels"].clear()
        candidate["phases"][0]["argv"].append("injected")
        candidate["qualification"]["qualified"] = True
        self.assertEqual(profiles.catalog_record("admin-qa-v1"), before)
        original = profiles.descriptor("admin-qa-v1")
        candidate = profiles.descriptor("admin-qa-v1")
        candidate["phases"][0]["argv"][0] = "/unexpected/env"
        self.assertNotEqual(profiles.digest(candidate), profiles.digest(original))

    def test_frozen_source_and_dependency_pins_match_handoff_metadata(self):
        root = Path(__file__).resolve().parent
        handoff = json.loads((root / "APP-HANDOFF.json").read_text())
        baseline = json.loads((root / "BASELINE-QA-POLICY.json").read_text())
        manifest = profiles.descriptor("admin-qa-v1")
        source, deps = manifest["source"], manifest["dependencies"]
        self.assertEqual(source["app_commit"], handoff["last_authorized_app_delivery_by_sender"])
        self.assertEqual(source["site_tree"], handoff["site_tree"])
        self.assertEqual(source["harness_commit"], handoff["head"])
        self.assertEqual(source["archive_sha256"], baseline["source_sha256"])
        self.assertEqual(source["archive_bytes"], handoff["source_archive"]["bytes"])
        self.assertEqual(deps["package_lock_sha256"], baseline["lock_sha256"])
        self.assertEqual(deps["node"]["version"], "20.19.2")
        self.assertEqual(deps["node"]["sha256"], baseline["node_sha256"])
        self.assertEqual(deps["qa_inputs"], baseline["inputs"])
        self.assertEqual(deps["python_wheels"], baseline["wheels"])
        self.assertEqual(deps["chromium"]["version"], baseline["chromium_version"])
        self.assertEqual(deps["public_dependencies_archive"]["sha256"], "3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698")
        self.assertEqual(deps["public_dependencies_archive"]["bytes"], 207013889)

    def test_pending_proofs_cannot_be_misread_as_qualification(self):
        for kind in profiles.KINDS:
            manifest = profiles.descriptor(kind)
            deps, qualification = manifest["dependencies"], manifest["qualification"]
            self.assertIs(deps["original_cache_full_integrity_verified"], False)
            self.assertIs(deps["public_dependencies_archive"]["full_integrity_verified_in_new_workspace"], False)
            for name in ("python", "postgres", "chromium"):
                self.assertIsNone(deps[name]["executable_sha256"])
                self.assertEqual(deps[name]["status"], "pending_exact_executable_pin")
            self.assertIsNone(deps["python"]["exact_version"])
            self.assertIsNone(deps["postgres"]["exact_native_version"])
            self.assertIs(qualification["qualified"], False)
            self.assertIs(qualification["operationalReady"], False)
            self.assertGreaterEqual(len(qualification["pending"]), 5)
            self.assertIs(manifest["resource_budget"]["measured_minimum"], False)
            self.assertEqual(manifest["resource_budget"]["timeout_seconds"], 2700)

    def test_fixed_offline_recipe_isolated_from_baseline_and_inherited_environment(self):
        expected = {"admin-typecheck-v1": ["prepare-pdfjs-offline", "typecheck"], "admin-build-v1": ["prepare-pdfjs-offline", "typecheck", "build"], "admin-qa-v1": ["prepare-pdfjs-offline", "typecheck", "build", "qa"]}
        for kind, names in expected.items():
            manifest = profiles.descriptor(kind)
            self.assertEqual([phase["name"] for phase in manifest["phases"]], names)
            self.assertIs(manifest["environment"]["inherit"], False)
            self.assertIs(manifest["environment"]["home_present"], False)
            self.assertIs(manifest["environment"]["secrets_allowed"], False)
            self.assertEqual(manifest["environment"]["cron_entries"], [])
            self.assertIs(manifest["network_policy"]["external_network_allowed"], False)
            self.assertEqual(manifest["network_policy"]["postgres_bind"], "127.0.0.1")
            for phase in manifest["phases"]:
                self.assertEqual(phase["argv"][:2], ["/usr/bin/env", "-i"])
                self.assertFalse(any(value.startswith("HOME=") for value in phase["argv"]))
                self.assertEqual(phase["cwd"], "source/site")
                self.assertNotIn(".runtime", json.dumps(phase))
                self.assertIn("TMPDIR=../../t", phase["argv"])
                self.assertIn("XDG_CONFIG_HOME=/opt/peticao-dev-profile-tools-v1/empty-config", phase["argv"])
            self.assertNotIn(".runtime", json.dumps(manifest["environment"]))
            self.assertIn("--offline", manifest["phases"][0]["argv"])
            serialized = json.dumps(manifest)
            for forbidden in (".qt1", "3184", "54524", "peticao-civo-c472-complete-qa", "--install", "npm ci", ".env.local"):
                self.assertNotIn(forbidden, serialized)

    def test_physical_backing_is_metadata_only_and_namespace_is_pending(self):
        for kind in profiles.KINDS:
            manifest = profiles.descriptor(kind)
            workspace = manifest["workspace"]
            self.assertTrue(workspace["physical_backing_root"].startswith("/mnt/apps/peticao-final/.runtime/"))
            self.assertIs(workspace["physical_backing_accessible_to_job"], False)
            self.assertEqual(workspace["logical_work_root"], ".")
            self.assertEqual(workspace["mapper_authority"], "root_trusted_only_no_rpc_path_override")
            self.assertEqual(workspace["mapper_status"], "pending_namespace_mapping_and_driver_proof")
            self.assertEqual(workspace["tmp_resolved_relative_to_job"], "t")
            self.assertEqual(manifest["artifact_policy"]["root"], "artifacts")
            tools = workspace["toolchain"]
            self.assertEqual(tools["root"], "/opt/peticao-dev-profile-tools-v1")
            self.assertIs(tools["immutable"], True)
            self.assertIs(tools["root_owned"], True)
            self.assertIs(tools["read_only_to_job"], True)
            self.assertEqual(tools["installation_status"], "pending_future_installation_and_integrity_proof")
            for phase in manifest["phases"]:
                command = phase["argv"]
                executable_index = next(index for index in range(2, len(command)) if "=" not in command[index])
                self.assertTrue(command[executable_index].startswith(tools["root"] + "/"))
                self.assertFalse(Path(command[executable_index + 1]).is_absolute())
            pending = manifest["qualification"]["pending"]
            self.assertIn("qa_driver_adaptation_and_new_package_pin_not_completed", pending)
            self.assertIn("trusted_state_directory_mapper_and_relative_cwd_tmp_containment_proof", pending)
        qa = profiles.descriptor("admin-qa-v1")["phases"][-1]
        self.assertEqual(qa["argv"][-2:], ["/opt/peticao-dev-profile-tools-v1/python3", "../../inputs/runner.py"])

    def test_reference_counts_and_artifact_boundary(self):
        manifest = profiles.descriptor("admin-qa-v1")
        reference = manifest["reference_qa"]
        self.assertEqual(reference["counts"], {"backend": 43, "http": 7, "browser": 40, "maps_helper": 2, "http_reset": 8})
        self.assertEqual(sum(reference["counts"].values()), 100)
        self.assertEqual(reference["total"], 100)
        self.assertIs(reference["real_tiles_qualified"], False)
        self.assertIs(reference["real_geocoding_qualified"], False)
        policy = manifest["artifact_policy"]
        self.assertIs(policy["reject_symlinks_and_hardlinks"], True)
        self.assertIs(policy["sanitize_before_export"], True)
        self.assertIn("database_state", policy["forbidden"])
        self.assertLessEqual(policy["max_file_bytes"], policy["max_total_bytes"])


if __name__ == "__main__":
    unittest.main()
