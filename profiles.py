"""Fixed, unqualified real-profile descriptors; preparation only, never execution.

Digests use UTF-8 canonical JSON (sorted keys, compact separators, no NaN).
The profile digest covers the descriptor itself, without recursive self hashes.
Values below are frozen from the supplied handoff and QA metadata; these are
reference pins, not evidence that this new workspace has been qualified.
"""
from copy import deepcopy
import hashlib
import json

KINDS = frozenset({"admin-typecheck-v1", "admin-build-v1", "admin-qa-v1"})
PHYSICAL_ROOT = "/mnt/apps/peticao-final/.runtime/canonical-real-profiles-v1"
TOOLS = "/opt/peticao-dev-profile-tools-v1"
NODE = TOOLS + "/node20"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


QA_INPUTS = {'PYTHON-WHEELS.json': {'bytes': 2250,
                        'sha256': 'd16166f5e0ad61340aa79b48f9346b3c1214d04f511deb817f47f1749e26711e'},
 'backend-smoke.mjs': {'bytes': 2774,
                       'sha256': 'ffd16f401d2bbb17d115fcd64df16079248833aca289cef2b679d8bf3721b437'},
 'fixture.ts': {'bytes': 4186,
                'sha256': 'b546639c72549b6f06e99a7ac1a5ecd687e2c47f3581734b0e0e26e6c78f2e39'},
 'http-regression.mjs': {'bytes': 3581,
                         'sha256': '63caec3ded4215070d0c0cc155811be9643cce4217cda25e485342ee5f4083b4'},
 'network-guard.cjs': {'bytes': 1171,
                       'sha256': 'f3ba91a83d63fb7e4425da0a177134ae0ce57724a76549fbdc5b7007411e4ad3'},
 'qa-driver.mjs': {'bytes': 8827,
                   'sha256': '68f5483ae08e7f8ef811fc5d1a8155650bed512db1249b8bfbb8f4fd1bf94f6d'},
 'qa-runtime.mjs': {'bytes': 4138,
                    'sha256': '8c6e5b53ddda7524fd178c506eb97b172976e77210da077d4cd3104cfda6dd72'},
 'real-map-browser.py': {'bytes': 3528,
                         'sha256': '790fb17ac9403abb9d5a6a2de2651abb941e24fd78496de24800aa652641114e'},
 'refresh-fixture-session.mjs': {'bytes': 1069,
                                 'sha256': '7147d5c659e62ce921a952f0ba8866ffd6a9eaebe68fb464e836fa00b774ad17'},
 'requirements.lock': {'bytes': 390,
                       'sha256': '77131b0576f84f61ecec600d899633ed1f721989791e76fdd824e4240b1575e0'},
 'runner.py': {'bytes': 22038,
               'sha256': '6d5b393e60aa8bfcaad4d89ecb6dc55caa1f4b361ecffeddc0a313a31a7288e6'},
 'signature-explorer-r1-browser.py': {'bytes': 16659,
                                      'sha256': 'a457b830c3de2841122f2a58122fbd32de26aef47b9103bcdc90fdb296f04e80'}}

PYTHON_WHEELS = {'greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl': {'bytes': 621404,
                                                                                'name': 'greenlet',
                                                                                'sha256': '975736b002ed080d124cf81a79cb7e05cb26d6b3f5c7a7b651c0fcce70353aa1',
                                                                                'version': '3.5.6'},
 'playwright-1.62.0-py3-none-manylinux1_x86_64.whl': {'bytes': 47748926,
                                                      'name': 'playwright',
                                                      'sha256': 'ba33bae6a13b3d9d354c751cb618af357d20fe1d57767cbcce52079bbef17ad3',
                                                      'version': '1.62.0'},
 'pyee-13.0.1-py3-none-any.whl': {'bytes': 15659,
                                  'name': 'pyee',
                                  'sha256': 'af2f8fede4171ef667dfded53f96e2ed0d6e6bd7ee3bb46437f77e3b57689228',
                                  'version': '13.0.1'},
 'typing_extensions-4.16.0-py3-none-any.whl': {'bytes': 45571,
                                               'name': 'typing_extensions',
                                               'sha256': '481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8',
                                               'version': '4.16.0'}}

_SOURCE = {
    "app_commit": "c472837fb5a4584d81f34c420f4de30989084f85",
    "site_tree": "14409ebfce08daa337f6b2dfc392fe38b54ee86d",
    "harness_commit": "09d1d66d0e821e92d96bd83de70afdb832a31bc6",
    "archive_sha256": "19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5",
    "archive_bytes": 11959902,
    "required_source_paths": ["site", "tools/preview"],
    "provenance": "authorized_app_handoff_not_latest_production_verification",
}
_DEPENDENCIES = {
    "package_lock_sha256": "52963634411e4f0dcdb829d53a5c51d98eba853f87227930fae4a1c87f0abe74",
    "pdfjs_assets_lock_sha256": "da3a1d711714a7684e702312087c02b080acdb2bfdc1212d8543b3f455343922",
    "public_dependencies_archive": {
        "sha256": "3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698",
        "bytes": 207013889,
        "full_integrity_verified_in_new_workspace": False,
    },
    "original_cache_full_integrity_verified": False,
    "node": {"version": "20.19.2", "sha256": "b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac", "path": NODE},
    "reported_packages": {"next": "14.2.35", "typescript": "5.9.3", "tsx": "4.23.15", "esbuild": "0.28.2", "embedded_postgres": "18.4.0-beta.17", "pg": "8.23.1"},
    "pdfjs_version": "6.5.438",
    "python": {"abi": "cp312", "exact_version": None, "executable_sha256": None, "status": "pending_exact_executable_pin"},
    "python_wheels": PYTHON_WHEELS,
    "postgres": {"major": 18, "exact_native_version": None, "executable_sha256": None, "status": "pending_exact_executable_pin", "export_client_major": 18, "seed": "isolated_native_sp_only_never_production"},
    "chromium": {"version": "151.0.7922.34", "playwright_revision": "1234", "executable_sha256": None, "status": "pending_exact_executable_pin"},
    "playwright_python_version": "1.62.0",
    "qa_inputs": QA_INPUTS,
    "env_executable": {"path": "/usr/bin/env", "sha256": None, "status": "pending_exact_executable_pin"},
}
_ARTIFACT_POLICY = {
    "version": 1,
    "root": "artifacts",
    "root_relative_to": "trusted_job_state_directory",
    "allowlist": ["profile-result.json", "integrity-proof.json", "phase-results.json", "sanitized-build.log", "sanitized-qa-summary.json", "process-drain-proof.json", "network-denial-summary.json"],
    "max_file_bytes": 16777216,
    "max_total_bytes": 33554432,
    "regular_files_only": True,
    "reject_symlinks_and_hardlinks": True,
    "sanitize_before_export": True,
    "forbidden": ["credentials", "dotfiles", "mail", "whatsapp", "cron", "production_data", "database_state", "signer_exports", "raw_browser_storage"],
}


def _phase(name, argv):
    # The trusted driver resolves cwd beneath its StateDirectory alias. No job
    # pathname can traverse the physical .runtime tree masked by systemd V4.
    # ../../t is root-job/t from source/site; the mapper must prove containment
    # and prepare it before launch. This recipe is still unqualified metadata.
    # env -i is mandatory even if a caller itself has a populated environment.
    environment = {
        "PATH": TOOLS + ":/usr/bin:/bin",
        "LANG": "C.UTF-8", "TZ": "UTC", "NEXT_TELEMETRY_DISABLED": "1",
        "NODE_OPTIONS": "--max-old-space-size=3072",
        "TMPDIR": "../../t",
        "XDG_CONFIG_HOME": TOOLS + "/empty-config",
        "EMAIL_DELIVERY_MODE": "development", "WHATSAPP_ENABLED": "0",
    }
    return {"name": name, "cwd": "source/site", "argv": ["/usr/bin/env", "-i"] + [key + "=" + value for key, value in sorted(environment.items())] + argv}


def descriptor(kind):
    """Return a fresh fixed manifest; refuse every arbitrary or unknown kind."""
    if type(kind) is not str or kind not in KINDS:
        raise ValueError("fixed_real_profile_required")
    prepare = _phase("prepare-pdfjs-offline", [NODE, "scripts/prepare-pdfjs-assets.mjs", "--offline", "--cache-dir", TOOLS + "/pdfjs"])
    tsc = _phase("typecheck", [NODE, "node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"])
    build = _phase("build", [NODE, "node_modules/next/dist/bin/next", "build"])
    qa = _phase("qa", [TOOLS + "/python3", "../../inputs/runner.py"])
    phases = [prepare, tsc]
    if kind in {"admin-build-v1", "admin-qa-v1"}:
        phases.append(build)
    if kind == "admin-qa-v1":
        phases.append(qa)
    return deepcopy({
        "version": 1, "profile": kind,
        "source": _SOURCE, "dependencies": _DEPENDENCIES,
        "artifact_policy": _ARTIFACT_POLICY,
        "workspace": {
            "physical_backing_root": PHYSICAL_ROOT,
            "physical_job_backing_template": PHYSICAL_ROOT + "/jobs/{job_id}",
            "physical_backing_accessible_to_job": False,
            "logical_work_root": ".",
            "logical_work_root_kind": "trusted_job_state_directory_alias",
            "cwd_relative_to": "trusted_job_state_directory",
            "mapper_authority": "root_trusted_only_no_rpc_path_override",
            "mapper_status": "pending_namespace_mapping_and_driver_proof",
            "tmp_relative_to_phase_cwd": "../../t",
            "tmp_resolved_relative_to_job": "t",
            "fresh_work_required": True, "project_runtime_only": True,
            "reuse_baseline_paths_units_ports": False,
            "toolchain": {
                "root": TOOLS, "immutable": True, "root_owned": True,
                "read_only_to_job": True, "contains_credentials": False,
                "installation_status": "pending_future_installation_and_integrity_proof",
                "pdfjs_cache_read_only": True, "empty_config_directory_required": True,
            },
        },
        "environment": {"inherit": False, "env_i_required": True, "home_present": False, "empty_config_required": True, "dotenv_files_allowed": False, "mail": "development_only_no_external_delivery", "whatsapp_enabled": False, "cron_entries": [], "secrets_allowed": False},
        "network_policy": {"mode": "offline_with_loopback_fixture_services_only", "external_network_allowed": False, "postgres_bind": "127.0.0.1", "production_connections_allowed": False, "guard_required": True},
        "phases": phases,
        "reference_qa": {"counts": {"backend": 43, "http": 7, "browser": 40, "maps_helper": 2, "http_reset": 8}, "total": 100, "reference_only": True, "real_tiles_qualified": False, "real_geocoding_qualified": False, "browser_api_success_error_mocked": True},
        "resource_budget": {"cpu": 4, "memory_gib": 8, "disk_gib": 30, "node_heap_mib": 3072, "workers": 2, "timeout_seconds": 2700, "measured_minimum": False, "origin": "prior_budget_not_new_profile_measurement"},
        "qualification": {"qualified": False, "operationalReady": False, "qualification_manifest_event": None, "qualification_evidence_sha256": None, "pending": ["exact_python_postgres_chromium_env_executable_pins", "full_source_and_dependencies_integrity_in_new_workspace", "fixed_runner_new_root_argv_environment_and_guard_validation", "qa_driver_adaptation_and_new_package_pin_not_completed", "trusted_state_directory_mapper_and_relative_cwd_tmp_containment_proof", "immutable_root_public_opt_toolchain_installation_and_integrity_proof", "new_root_tmp_units_ports_matrix_freeze", "actual_per_worker_per_profile_qualification_and_drain_evidence"]},
    })


def catalog_record(kind):
    """CatalogV2 reference only; no preparation result qualifies a worker."""
    manifest = descriptor(kind)
    return {
        "profile": kind,
        "profile_sha256": digest(manifest),
        "source_sha256": manifest["source"]["archive_sha256"],
        "dependencies_sha256": digest(manifest["dependencies"]),
        "artifact_policy_sha256": digest(manifest["artifact_policy"]),
        "qualified": False,
        "qualification_manifest_event": None,
        "qualification_evidence_sha256": None,
    }
