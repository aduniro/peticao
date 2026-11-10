import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'infra' / 'takeover_sp.py'
spec = importlib.util.spec_from_file_location('takeover_sp', SCRIPT)
takeover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(takeover)


class TakeoverEnvironmentTest(unittest.TestCase):
    def run_mock(self, files, content, environment=''):
        def systemctl(command, **kwargs):
            value = files if '--property=EnvironmentFiles' in command else environment
            return subprocess.CompletedProcess(command, 0, stdout=value, stderr='')
        with patch.object(takeover.subprocess, 'run', side_effect=systemctl), patch.object(Path, 'read_text', return_value=content), patch.object(Path, 'is_symlink', return_value=False):
            takeover.validate_service_environment()

    def test_real_sp_environment_file_layout(self):
        self.run_mock('/etc/admin-v2-cluster.env (ignore_errors=no)', 'ADMIN_CLUSTER_ROOT=/srv/admin-v2-coordinator-standby\nADMIN_WORKER_ROOT=/srv/admin-v2-coordinator-standby/recovered-worker\nADMIN_CLUSTER_DISPATCH=0\n')

    def test_extra_environment_file_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_mock('/etc/admin-v2-cluster.env (ignore_errors=no) /tmp/other.env (ignore_errors=no)', '')

    def test_file_overrides_inline_environment(self):
        self.run_mock('/etc/admin-v2-cluster.env (ignore_errors=no)', 'ADMIN_WORKER_ROOT="/srv/admin-v2-coordinator-standby/recovered-worker"\nADMIN_CLUSTER_DISPATCH=0\n', 'ADMIN_CLUSTER_DISPATCH=1')

    def test_enabled_dispatch_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_mock('/etc/admin-v2-cluster.env (ignore_errors=no)', 'ADMIN_WORKER_ROOT=/srv/admin-v2-coordinator-standby/recovered-worker\nADMIN_CLUSTER_DISPATCH=1\n')


if __name__ == '__main__':
    unittest.main()
