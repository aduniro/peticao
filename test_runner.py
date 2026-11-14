"""Offline runner tests; only local public fixtures and mocked host calls."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import runner


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent, prefix='.offline-')
        self.root = Path(self.tmp.name).resolve()
        self.retained = self.root / 'retained'
        self.next = self.retained / 'snapshot/site/.next'
        self.next.mkdir(parents=True)
        (self.next / 'BUILD_ID').write_text('public-fixture-build')
        (self.next / 'server.js').write_bytes(b'public fixture compiled bytes')
        self.expected = runner.custody(self.next)
        self.account = SimpleNamespace(pw_uid=12345, pw_gid=12345)
        self.patches = [patch.object(runner, 'ROOT', self.root), patch.object(runner, 'RETAINED', self.retained), patch.object(runner, 'EXPECTED', self.expected)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def state(self, phase):
        (self.root / 'STATE.json').write_text(json.dumps({'phase': phase}))

    def fixtures(self):
        (self.root / 'inputs').mkdir()
        (self.root / 'runner.py').write_text('# public runner')
        (self.root / 'inputs/exporter.py').write_text('# public exporter')
        policy = {'inputs': {'runner.py': {'sha256': runner.digest(self.root / 'runner.py')}, 'exporter.py': {'sha256': runner.digest(self.root / 'inputs/exporter.py')}}}
        (self.root / 'inputs/policy.json').write_text(json.dumps(policy))

    def validate(self, hostname='peticao-civo', ips=None, pid='0', uid=0):
        replies = {('tailscale', 'status', '--json'): json.dumps({'BackendState': 'Running', 'Self': {'TailscaleIPs': ips or ['100.122.224.82']}}), ('hostname', '--short'): hostname, ('uname', '-m'): 'x86_64', ('systemctl', 'show', runner.OLD_UNIT, '--property=MainPID', '--value'): pid}
        with patch.object(runner.os, 'geteuid', return_value=uid), patch.object(runner, 'run', side_effect=lambda args: replies[tuple(args)]):
            return runner.validate_inputs()

    def prepare(self):
        with patch.object(runner, 'validate_inputs'), patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner.os, 'chown') as chown, patch.object(runner, 'host_preflight'), redirect_stdout(io.StringIO()):
            runner.prepare()
        return chown

    def test_node_and_root_identity_and_frozen_input_binding(self):
        self.fixtures()
        self.validate()
        for options in [{'hostname': 'other'}, {'ips': ['100.76.178.21']}, {'pid': '23'}, {'uid': 12345}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.validate(**options)
        (self.root / 'inputs/exporter.py').write_text('drift')
        with self.assertRaisesRegex(ValueError, 'Frozen input drift'):
            self.validate()

    def test_custody_exact_infra_inventory_algorithm(self):
        import hashlib
        rows = [[str(p.relative_to(self.next)), p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()] for p in sorted(self.next.rglob('*')) if p.is_file()]
        expected = hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(runner.custody(self.next)['sha256'], expected)

    def test_custody_changes_on_bytes_or_path_and_rejects_links(self):
        self.assertEqual(runner.check_custody(), self.expected)
        original = (self.next / 'server.js').read_bytes()
        (self.next / 'server.js').write_bytes(original + b'changed')
        with self.assertRaises(ValueError):
            runner.check_custody()
        (self.next / 'server.js').write_bytes(original)
        (self.next / 'server.js').rename(self.next / 'renamed.js')
        with self.assertRaises(ValueError):
            runner.check_custody()
        (self.next / 'escape').symlink_to('/outside')
        with self.assertRaisesRegex(ValueError, 'link or special'):
            runner.custody(self.next)

    def test_prepare_has_new_output_and_root_owned_tools(self):
        self.fixtures()
        chown = self.prepare()
        self.assertTrue((self.root / 'outputs').is_dir())
        self.assertEqual((self.root / 'outputs').stat().st_mode & 0o777, 0o700)
        self.assertFalse((self.root / 'outputs/export-1').exists())
        self.assertEqual((self.root / 'tools').stat().st_mode & 0o777, 0o750)
        self.assertEqual((self.root / 'tools/exporter.py').read_bytes(), (self.root / 'inputs/exporter.py').read_bytes())
        self.assertIn(unittest.mock.call(self.root / 'tools/exporter.py', 0, 12345), chown.call_args_list)
        self.assertIn(unittest.mock.call(self.root / 'outputs', 12345, 12345), chown.call_args_list)
        with patch.object(runner, 'validate_inputs'), self.assertRaisesRegex(ValueError, 'Attempt already exists'):
            runner.prepare()

    def test_unit_exact_resources_only_new_work_outputs_writable(self):
        args = runner.unit_args()
        for item in ['User=civo', 'Group=civo', 'MemoryMax=8G', 'CPUQuota=400%', 'TasksMax=256', 'TimeoutStartSec=1800', 'ProtectHome=tmpfs', 'PrivateNetwork=yes', 'ProtectSystem=strict', 'NoNewPrivileges=yes', 'PrivateDevices=yes', 'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes', 'TemporaryFileSystem=/tmp:ro /var/tmp:ro']:
            self.assertIn('--property=' + item, args)
        self.assertIn('--property=ReadWritePaths=' + str(self.root / 'work') + ' ' + str(self.root / 'outputs'), args)
        self.assertIn('--property=ReadOnlyPaths=' + str(self.retained) + ' ' + str(self.root / 'tools') + ' ' + str(self.root / 'inputs'), args)
        self.assertIn('--property=InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale', args)
        self.assertEqual(args[-4:], ['/usr/bin/python3', '-B', str(self.root / 'tools/runner.py'), 'export'])
        self.assertIn('TMPDIR=' + str(self.root / 'work/tmp'), args)
        for arg in args:
            self.assertFalse(any(token in arg for token in ['npm ', 'next build', 'qualified-build', 'node20', '/bin/bash']))

    def test_start_single_use_even_after_submission_failure(self):
        self.state('prepared')
        (self.root / 'outputs').mkdir()
        with patch.object(runner, 'validate_inputs'), patch.object(runner, 'host_preflight'), patch.object(runner, 'run', side_effect=RuntimeError('denied')) as run:
            with self.assertRaises(RuntimeError):
                runner.start()
            self.assertEqual(json.loads((self.root / 'STATE.json').read_text())['phase'], 'export-submitting')
            with self.assertRaises(ValueError):
                runner.start()
            self.assertEqual(run.call_count, 1)

    def test_start_refuses_existing_output(self):
        self.state('prepared')
        (self.root / 'outputs/export-1').mkdir(parents=True)
        with patch.object(runner, 'validate_inputs'), patch.object(runner, 'run') as run, self.assertRaises(ValueError):
            runner.start()
        run.assert_not_called()

    def export_fixture(self, mutate=False, wrong_binding=False):
        self.fixtures()
        self.prepare()
        self.state('export-submitted')
        module = self.root / 'tools/exporter.py'
        module.write_text('from pathlib import Path\nBUILD = Path(' + repr(str(self.retained / ('wrong' if wrong_binding else 'snapshot'))) + ')\ndef export(build, out):\n    assert not out.exists()\n    out.mkdir()\n' + ('    (build / "site/.next/server.js").write_text("MUTATION")\n' if mutate else '') + '    (out / "export-report.json").write_text("{}")\n    return {"compiledBytesRewritten": False}\ndef verify(out):\n    assert (out / "export-report.json").is_file()\n    return {"verifiedFiles": 1}\n')

    def do_export(self):
        with patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner.os, 'geteuid', return_value=12345), patch.object(runner.os, 'getegid', return_value=12345), patch.object(runner, 'deny_socket'), patch.object(runner, 'namespace_preflight'), redirect_stdout(io.StringIO()):
            runner.export_only()

    def test_export_new_child_verifies_and_receipts_unchanged_custody(self):
        self.export_fixture()
        before = runner.custody(self.next)
        self.do_export()
        receipt = json.loads((self.root / 'work/receipt.json').read_text())
        self.assertEqual(receipt['compiled_custody_before'], before)
        self.assertEqual(receipt['compiled_custody_after'], before)
        self.assertFalse(receipt['operational_ready'])
        with self.assertRaises(ValueError):
            self.do_export()
        with patch.object(runner, 'run', return_value='ActiveState=inactive\nMainPID=0\nResult=success'), redirect_stdout(io.StringIO()) as output:
            runner.status()
        self.assertEqual(json.loads(output.getvalue())['phase'], 'export-verified')
        self.assertEqual(json.loads(output.getvalue())['MainPID'], '0')

    def test_export_rejects_compiled_mutation_and_never_receipts_success(self):
        self.export_fixture(mutate=True)
        with self.assertRaisesRegex(ValueError, 'custody changed'):
            self.do_export()
        self.assertFalse((self.root / 'work/receipt.json').exists())

    def test_export_binding_and_execution_uid_are_required(self):
        self.export_fixture(wrong_binding=True)
        with patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner.os, 'geteuid', return_value=0), self.assertRaisesRegex(ValueError, 'identity'):
            runner.export_only()
        with self.assertRaisesRegex(ValueError, 'build binding'):
            self.do_export()
        self.assertFalse((self.root / 'outputs/export-1').exists())

    def test_prepare_explicit_tools_mode_survives_umask077(self):
        self.fixtures()
        previous = os.umask(0o077)
        try:
            self.prepare()
        finally:
            os.umask(previous)
        self.assertEqual((self.root / 'tools').stat().st_mode & 0o777, 0o750)

    def test_actual_nonroot_readability_checks_all_paths(self):
        self.root.chmod(0o755)
        folders = [self.root / 'first', self.root / 'second']
        for folder in folders:
            folder.mkdir(mode=0o750)
            (folder / 'public').write_text('public fixture')
            (folder / 'public').chmod(0o640)
        uid = (Path(__file__).stat().st_uid or 65534) if os.geteuid() == 0 else os.geteuid()
        gid = (Path(__file__).stat().st_gid or 65534) if os.geteuid() == 0 else os.getegid()
        if os.geteuid() == 0:
            os.chown(self.root, 0, gid)
            for folder in folders:
                os.chown(folder, 0, gid)
                os.chown(folder / 'public', 0, gid)
        config = {'uid': uid, 'gid': gid, 'files': [str(p / 'public') for p in folders], 'directories': [str(p) for p in folders]}
        def drop_root():
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
        def invoke():
            return subprocess.run([sys.executable, '-B', '-c', runner.ACCESS_CHECK_CODE, json.dumps(config)], capture_output=True, text=True, timeout=5, preexec_fn=drop_root if os.geteuid() == 0 else None)
        result = invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        for folder in folders:
            folder.chmod(0o700 if os.geteuid() == 0 else 0o000)
        try:
            denied = invoke()
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn(str(folders[0]), denied.stderr)
            self.assertIn(str(folders[1]), denied.stderr)
        finally:
            for folder in folders:
                folder.chmod(0o750)
        result = invoke()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_preflight_before_start_and_namespace_before_export(self):
        import inspect
        body = inspect.getsource(runner.export_only)
        self.assertLess(body.index('namespace_preflight()'), body.index('write_json('))
        self.assertLess(body.index('namespace_preflight()'), body.index('module.export('))
        self.state('prepared')
        (self.root / 'outputs').mkdir()
        with patch.object(runner, 'validate_inputs'), patch.object(runner, 'host_preflight', side_effect=ValueError('nonroot read denied')), patch.object(runner, 'run') as run, self.assertRaises(ValueError):
            runner.start()
        run.assert_not_called()
        self.assertEqual(json.loads((self.root / 'STATE.json').read_text())['phase'], 'prepared')

    def test_namespace_checks_ro_and_canaries_before_export(self):
        for name in ['work', 'outputs']:
            (self.root / name).mkdir()
        with patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner.os, 'geteuid', return_value=12345), patch.object(runner.os, 'getegid', return_value=12345), patch.object(runner, 'run') as run, patch.object(runner.os, 'statvfs', return_value=SimpleNamespace(f_flag=os.ST_RDONLY)), patch.object(runner.os, 'access', return_value=False), patch.object(runner, 'deny_socket') as socket_check:
            runner.namespace_preflight()
        self.assertEqual(run.call_count, 1)
        socket_check.assert_called_once_with()
        self.assertTrue((self.root / 'work/namespace-preflight.json').is_file())
        self.assertFalse((self.root / 'work/.namespace-write-canary').exists())
        self.assertFalse((self.root / 'outputs/.namespace-write-canary').exists())
        (self.root / 'work/namespace-preflight.json').unlink()
        with patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner.os, 'geteuid', return_value=12345), patch.object(runner.os, 'getegid', return_value=12345), patch.object(runner, 'run'), patch.object(runner.os, 'statvfs', return_value=SimpleNamespace(f_flag=0)), patch.object(runner.os, 'access', return_value=False), patch.object(runner, 'deny_socket'), self.assertRaisesRegex(ValueError, 'filesystem is writable'):
            runner.namespace_preflight()
        self.assertFalse((self.root / 'work/namespace-preflight.json').exists())

    def test_host_preflight_keeps_complete_aggregate_diagnostic(self):
        diagnostic = '{"preflight_errors":["traverse:first","traverse:second"]}'
        failure = subprocess.CalledProcessError(1, ['runuser'], stderr=diagnostic)
        with patch.object(runner.pwd, 'getpwnam', return_value=self.account), patch.object(runner, 'run', side_effect=failure), self.assertRaisesRegex(ValueError, 'host-preflight.json'):
            runner.host_preflight()
        self.assertEqual(json.loads((self.root / 'host-preflight.json').read_text())['diagnostic'], diagnostic)

    def test_mode000_denied_and_accessible_socket(self):
        old = Path.cwd()
        server = socket.socket(socket.AF_UNIX)
        try:
            os.chdir(self.root)
            self.root.chmod(0o777)
            server.bind('s')
            server.listen(2)
            script = 'import sys;sys.path.insert(0,' + repr(str(Path(__file__).parent.resolve())) + ');import runner;runner.deny_socket("s")'
            def drop_root():
                os.setgroups([])
                os.setgid(Path(__file__).stat().st_gid or 65534)
                os.setuid(Path(__file__).stat().st_uid or 65534)
            for mode, expected in [(0, 0), (0o666, 1)]:
                Path('s').chmod(mode)
                result = subprocess.run([sys.executable, '-B', '-c', script], cwd=self.root, capture_output=True, text=True, timeout=5, preexec_fn=drop_root if os.geteuid() == 0 else None)
                self.assertEqual(result.returncode, expected, result.stderr)
        finally:
            os.chdir(old)
            server.close()


if __name__ == '__main__':
    unittest.main()
