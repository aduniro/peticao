#!/usr/bin/python3
"""Offline source checks. No network, cloud, credentials, or --apply execution."""
import copy
import json
import pathlib
import re
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parent
BOOTSTRAP = SOURCE / "bootstrap.sh"
SMOKE = SOURCE / "smoke.sh"


def example_pins():
    return {
        "docker_packages": {
            "docker-ce": "5:29.0.0-1~debian.13~trixie",
            "docker-ce-cli": "5:29.0.0-1~debian.13~trixie",
            "containerd.io": "2.1.5-1~debian.13~trixie",
            "docker-buildx-plugin": "0.29.1-1~debian.13~trixie",
            "docker-compose-plugin": "2.40.3-1~debian.13~trixie",
        },
        "docker_gpg_sha256": "a" * 64,
        "node20": {"version": "20.19.2", "sha256": "b" * 64},
        "node22": {"version": "22.21.1", "sha256": "c" * 64},
        "playwright_version": "1.56.1",
        "smoke_image": "alpine@sha256:" + "d" * 64,
    }


class BootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bootstrap = BOOTSTRAP.read_text()
        cls.smoke = SMOKE.read_text()

    def validate(self, pins):
        with tempfile.TemporaryDirectory(prefix="peticao-pins-test-") as folder:
            target = pathlib.Path(folder) / "pins.json"
            target.write_text(json.dumps(pins))
            return subprocess.run(["/bin/bash", str(BOOTSTRAP), "--validate-pins", str(target)], text=True, capture_output=True)

    def test_bash_syntax(self):
        for script in (BOOTSTRAP, SMOKE):
            subprocess.run(["/bin/bash", "-n", str(script)], check=True)

    def test_explicit_opt_in_has_no_side_effects(self):
        for script in (BOOTSTRAP, SMOKE):
            for args in ([], ["--help"], ["--apply", "unexpected"]):
                result = subprocess.run(["/bin/bash", str(script), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 64)
                self.assertIn("Usage:", result.stderr)

    def test_valid_pins_and_exact_packages(self):
        result = self.validate(example_pins())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("NODE20_VERSION=20.19.2", result.stdout)
        self.assertIn("docker-ce=5:29.0.0-1~debian.13~trixie", result.stdout)
        self.assertIn("DOCKER_PACKAGES=(", result.stdout)

    def test_reject_unpinned_or_injected_values(self):
        cases = []
        for key, value in [("smoke_image", "alpine:latest"), ("smoke_image", "alpine:3@sha256:" + "d" * 64), ("playwright_version", "latest"), ("playwright_version", "1.56.1;touch /tmp/unsafe"), ("docker_gpg_sha256", "unknown")]:
            pins = example_pins()
            pins[key] = value
            cases.append(pins)
        for field, value in [("version", "20.19.3"), ("sha256", "B" * 64)]:
            pins = example_pins()
            pins["node20"][field] = value
            cases.append(pins)
        pins = example_pins()
        pins["node22"]["version"] = "24.1.0"
        cases.append(pins)
        for value in ["latest", "*", "5:29.0;id", "$(id)", "--allow-unauthenticated"]:
            pins = example_pins()
            pins["docker_packages"]["docker-ce"] = value
            cases.append(pins)
        pins = example_pins()
        del pins["docker_packages"]["containerd.io"]
        cases.append(pins)
        pins = example_pins()
        pins["docker_packages"]["unexpected"] = "1.0"
        cases.append(pins)
        for pins in cases:
            with self.subTest(pins=pins):
                self.assertNotEqual(self.validate(pins).returncode, 0)

    def test_guards_precede_first_installation(self):
        before_install = self.bootstrap.split("/usr/bin/apt-get update", 1)[0]
        for guard in ["$EUID == 0", '"$(/bin/hostname -s)" == peticao-azure-dev-01', '"$ID" == debian', '"$VERSION_ID" == 13', '"$(/usr/bin/dpkg --print-architecture)" == amd64', "sys.version_info[:2] == (3, 13)", "/usr/bin/id builder", 'validate_pins "$PINS"']:
            self.assertIn(guard, before_install)
        self.assertLess(before_install.index('"$1" == --apply'), before_install.index("$EUID == 0"))

    def test_installation_is_pinned_and_separated(self):
        self.assertIn('https://download.docker.com/linux/debian trixie stable', self.bootstrap)
        self.assertIn('"${DOCKER_PACKAGES[@]}"', self.bootstrap)
        self.assertIn("dpkg-query -W", self.bootstrap)
        self.assertEqual(self.bootstrap.count("sha256sum --check --strict"), 2)
        self.assertIn('install_node node20 "$NODE20_VERSION" "$NODE20_SHA"', self.bootstrap)
        self.assertIn('install_node node22 "$NODE22_VERSION" "$NODE22_SHA"', self.bootstrap)
        self.assertIn('"$BASE/node20/bin/node" /usr/local/bin/node', self.bootstrap)
        self.assertIn('"$BASE/node20/bin/npm" /usr/local/bin/npm', self.bootstrap)
        self.assertIn("exec /opt/peticao-toolchain/node22/bin/node", self.bootstrap)
        self.assertIn('install --save-exact --ignore-scripts --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION"', self.bootstrap)
        self.assertIn('PLAYWRIGHT_BROWSERS_PATH="$RUNTIME/ms-playwright"', self.bootstrap)
        self.assertIn("install-deps chromium", self.bootstrap)
        self.assertIn("root-equivalent", self.bootstrap)
        self.assertIn("usermod -aG docker builder", self.bootstrap)

    def test_no_out_of_scope_operations(self):
        executable_lines = "\n".join(line for line in self.bootstrap.splitlines() if not line.lstrip().startswith("#"))
        for forbidden in [r"\bapt(?:-get)?\s+(?:full-upgrade|dist-upgrade|upgrade)\b", r"\b(?:mkfs|wipefs|fdisk|parted|nvme)\b", r"/dev/(?:nvme|sd[a-z])", r"\b(?:crontab|rsync|scp|ssh)\b", r"/root/\.ssh", r"\.env", r"HASH_PEPPER", r"git\s+clone", r"npm\S*\s+.*(?:--global| -g\b)"]:
            self.assertNotRegex(executable_lines, forbidden)
        # There is no automatic smoke invocation in bootstrap.
        self.assertNotRegex(executable_lines, r"^/.*smoke\.sh",)
        self.assertIn("Smoke tests were not run", self.bootstrap)

    def test_smoke_is_builder_only_and_isolated(self):
        for required in ["$EUID != 0", '"$(/usr/bin/id -un)" == builder', "peticao-azure-dev-01", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65534:65534", "--pull=never", "chromiumSandbox: true", "route.abort()", "page.setContent(", "page.screenshot("]:
            self.assertIn(required, self.smoke)
        self.assertNotIn("--no-sandbox", self.smoke)
        self.assertNotIn("page.goto(", self.smoke)

    def test_all_task_temporary_and_cache_paths_are_project_bound(self):
        caller = (pathlib.Path(__file__).parent / "toolchain_operator.py").read_text()
        for source in [self.bootstrap, self.smoke, caller]:
            self.assertNotIn("/tmp/", source)
        for source in [self.bootstrap,self.smoke]:
            self.assertIn("/mnt/apps/peticao-final/.runtime/azure-dev-toolchain",source)
            self.assertIn('export TMPDIR=',source)
            self.assertIn('PLAYWRIGHT_BROWSERS_PATH="$RUNTIME/ms-playwright"',source)
        self.assertIn('npm_config_cache="$RUNTIME/npm-cache"',self.bootstrap)
        self.assertIn("('builder-work',0o700,user.pw_uid,user.pw_gid)",self.bootstrap)
        self.assertIn('mktemp -d "$TMPDIR/smoke.',self.smoke)


if __name__ == "__main__":
    unittest.main(verbosity=2)
