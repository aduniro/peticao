"""Offline qualification of the Azure runner; never invokes a host or cloud command."""
import io
import json
import os
from pathlib import Path
import shutil
import shlex
import socket
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import runner


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent, prefix='.offline-')
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_exact_azure_binding(self):
        self.assertEqual(runner.ROOT, Path('/mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1'))
        self.assertEqual(runner.UNIT, 'peticao-azure-qualified-build-20261114-attempt1.service')

    def host_validate(self, hostname='peticao-azure-dev-01', ips=None, backend='Running', arch='x86_64', policy=None):
        replies = {('tailscale', 'status', '--json'): json.dumps({'BackendState': backend, 'Self': {'TailscaleIPs': ips if ips is not None else ['100.76.178.21']}}), ('hostname', '--short'): hostname, ('uname', '-m'): arch}
        with patch.object(runner, 'ROOT', self.root), patch.object(runner.os, 'geteuid', return_value=0), patch.object(runner, 'run', side_effect=lambda args: replies[tuple(args)]):
            runner.validate_inputs(policy or {'inputs': {}})

    def test_host_and_tailnet_are_both_required(self):
        self.host_validate()
        for values in ({'hostname': 'other-node'}, {'ips': ['100.122.224.82']}, {'backend': 'Stopped'}, {'arch': 'aarch64'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.host_validate(**values)

    def test_frozen_hash_and_filename_boundaries(self):
        (self.root / 'inputs').mkdir()
        p = self.root / 'inputs/source.tar.gz'
        p.write_bytes(b'frozen-public-fixture')
        policy = {'inputs': {'source.tar.gz': {'sha256': runner.digest(p)}}}
        self.host_validate(policy=policy)
        p.write_bytes(b'drift')
        with self.assertRaisesRegex(ValueError, 'drift'):
            self.host_validate(policy=policy)
        with self.assertRaises(ValueError):
            self.host_validate(policy={'inputs': {'../outside': {'sha256': 'x'}}})
        p.unlink()
        p.symlink_to(self.root / 'outside')
        with self.assertRaises(ValueError):
            self.host_validate(policy=policy)

    def test_replayed_prepare_is_rejected_before_mutation(self):
        (self.root / 'STATE.json').write_text('{"phase":"prepared"}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner, 'journal') as journal, patch.object(runner, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Attempt already exists'):
                runner.prepare({})
            journal.assert_not_called()
            run.assert_not_called()

    def test_build_submission_is_single_use_and_sandboxed(self):
        (self.root / 'STATE.json').write_text('{"phase":"prepared"}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner, 'run', return_value='') as run, redirect_stdout(io.StringIO()):
            runner.start_build({})
            args = run.call_args.args[0]
            for item in ['Type=oneshot', 'RemainAfterExit=yes', 'User=builder', 'Group=builder', 'MemoryMax=8G', 'CPUQuota=400%', 'TasksMax=256', 'TimeoutStartSec=1800', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=tmpfs', 'PrivateNetwork=yes', 'PrivateDevices=yes', 'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes', 'ProtectProc=invisible', 'TemporaryFileSystem=/tmp:ro /var/tmp:ro']:
                self.assertIn('--property=' + item, args)
            self.assertIn('--property=ReadWritePaths=' + str(self.root), args)
            self.assertIn('--property=ReadOnlyPaths=' + ' '.join(str(self.root / x) for x in ['deps', 'tools', 'inputs']), args)
            self.assertIn('--property=BindReadOnlyPaths=' + str(self.root / 'tools/node20') + ':/usr/local/bin/node', args)
            self.assertIn('--property=InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale', args)
            self.assertEqual(args[args.index('/usr/bin/env') + 1], '-i')
            self.assertEqual(json.loads((self.root / 'STATE.json').read_text())['phase'], 'build-submitted')
            with self.assertRaises(ValueError):
                runner.start_build({})
            self.assertEqual(run.call_count, 1)

    def test_failed_submission_cannot_be_blindly_retried(self):
        (self.root / 'STATE.json').write_text('{"phase":"prepared"}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner, 'run', side_effect=RuntimeError('systemd rejected')) as run:
            with self.assertRaises(RuntimeError):
                runner.start_build({})
            self.assertEqual(json.loads((self.root / 'STATE.json').read_text())['phase'], 'build-submitting')
            with self.assertRaises(ValueError):
                runner.start_build({})
            self.assertEqual(run.call_count, 1)

    def test_source_tar_boundaries(self):
        for name, kind in [('../credentials', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('.', tarfile.REGTYPE), ('site/link', tarfile.SYMTYPE), ('site/hard', tarfile.LNKTYPE), ('site/fifo', tarfile.FIFOTYPE), ('site/device', tarfile.CHRTYPE)]:
            member = tarfile.TarInfo(name)
            member.type = kind
            with self.subTest(name=name), self.assertRaises(ValueError):
                list(runner.safe_members([member]))
        self.assertEqual(len(list(runner.safe_members([tarfile.TarInfo('site/package.json')]))), 1)
        with self.assertRaises(ValueError):
            list(runner.safe_members([tarfile.TarInfo('credentials.env')], True))

    def extract_dependency_link(self, kind, target):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as archive:
            member = tarfile.TarInfo('node_modules/pkg/main.js')
            member.size = 2
            archive.addfile(member, io.BytesIO(b'ok'))
            link = tarfile.TarInfo('node_modules/bin')
            link.type, link.linkname = kind, target
            archive.addfile(link)
        data.seek(0)
        with tarfile.open(fileobj=data) as archive:
            archive.extractall(self.root, members=runner.safe_members(archive, True), filter='data')

    def test_dependency_links_cannot_escape_data_filter(self):
        for kind, target in [(tarfile.SYMTYPE, '/home/builder'), (tarfile.SYMTYPE, '../../outside'), (tarfile.LNKTYPE, '../outside')]:
            with self.subTest(target=target), self.assertRaises(tarfile.FilterError):
                self.extract_dependency_link(kind, target)

    def test_internal_dependency_links_are_usable(self):
        self.extract_dependency_link(tarfile.SYMTYPE, 'pkg/main.js')
        self.assertEqual((self.root / 'node_modules/bin').read_bytes(), b'ok')

    def test_prepare_keeps_export_child_nonexistent_and_protects_inputs(self):
        inputs = self.root / 'inputs'
        inputs.mkdir()
        lock, node = b'public-lock', b'node20-fixture'
        with tarfile.open(inputs / 'dependencies.tar.gz', 'w:gz') as archive:
            for name, contents in [('node', node), ('package-lock.json', lock), ('package.tgz', b'public-pdfjs')]:
                member = tarfile.TarInfo(name)
                member.size = len(contents)
                archive.addfile(member, io.BytesIO(contents))
        with tarfile.open(inputs / 'source.tar.gz', 'w:gz') as archive:
            member = tarfile.TarInfo('site/package-lock.json')
            member.size = len(lock)
            archive.addfile(member, io.BytesIO(lock))
        for name in ['guard.mjs', 'qualified-build.mjs', 'export.py']:
            (inputs / name).write_text('# public fixture')
        import hashlib
        policy = {'source_commit': 'c472-fixture', 'lock_sha256': hashlib.sha256(lock).hexdigest(), 'node_sha256': hashlib.sha256(node).hexdigest()}
        account = SimpleNamespace(pw_uid=12345, pw_gid=12345)
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner.shutil, 'disk_usage', return_value=SimpleNamespace(free=40 * 1024**3)), patch.object(runner.pwd, 'getpwnam', return_value=account), patch.object(runner.os, 'chown') as chown, patch.object(runner, 'run', return_value='v20.19.2'), redirect_stdout(io.StringIO()):
            runner.prepare(policy)
        self.assertTrue((self.root / 'exports').is_dir())
        self.assertFalse((self.root / 'exports/build-1').exists())
        self.assertFalse((self.root / 'export').exists())
        self.assertEqual((self.root / 'exports').stat().st_mode & 0o777, 0o700)
        self.assertIn(unittest.mock.call(self.root / 'exports', 12345, 12345), chown.call_args_list)
        self.assertIn(unittest.mock.call(str(self.root / 'inputs'), 0, 12345), chown.call_args_list)
        self.assertIn(unittest.mock.call(str(self.root / 'tools'), 0, 12345), chown.call_args_list)
        self.assertIn(unittest.mock.call(str(self.root / 'deps'), 0, 12345), chown.call_args_list)
        entry = (self.root / 'tools/build.sh').read_text()
        self.assertIn('export --out "$base/exports/build-1" > "$base/exports/export-result.json"', entry)
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'run', return_value='ActiveState=inactive'), redirect_stdout(io.StringIO()) as output:
            runner.status()
        self.assertFalse(json.loads(output.getvalue())['export_report_present'])
        (self.root / 'exports/build-1').mkdir()
        (self.root / 'exports/build-1/export-report.json').write_text('{}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'run', return_value='ActiveState=inactive'), redirect_stdout(io.StringIO()) as output:
            runner.status()
        self.assertTrue(json.loads(output.getvalue())['export_report_present'])

    def test_offline_build_and_dummy_environment(self):
        entry = runner.build_entry()
        for value in ['v20.19.2', 'test ! -e /home/builder/.ssh', 'test ! -w /run/docker.sock', shlex.quote(runner.SOCKET_CHECK_JS), '--offline', 'MAIL_PROVIDER=dev', 'MAIL_PROVIDERS=dev', '127.0.0.1:1/build_only', 'APP_URL=https://fixture.invalid', 'ADMIN_URL=https://admin.fixture.invalid', 'WHATSAPP_ENABLED=0', 'TMPDIR="$run/tmp"', 'TMP="$run/tmp" TEMP="$run/tmp"', 'source-before.sha256', 'source-after.sha256', 'cmp ', 'export.py" export', 'AZURE_CANONICAL_BUILD_AND_EXPORT_PASS']:
            self.assertIn(value, entry)
        self.assertLess(entry.index('DOCKER_SOCKET_UNEXPECTED_ACCESS'), entry.index('prepare-pdfjs-assets'))
        self.assertNotIn('civo', entry.lower())
        self.assertNotIn('/tmp/', entry)

    def socket_preflight(self, mode):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Local Node is required to execute the socket preflight itself')
        self.root.chmod(0o777)
        server = socket.socket(socket.AF_UNIX)
        original = Path.cwd()
        try:
            os.chdir(self.root)
            server.bind('s')
            server.listen(1)
            (self.root / 's').chmod(mode)
            self.assertTrue((self.root / 's').is_socket())
            def drop_root():
                os.setgroups([])
                os.setgid(65534)
                os.setuid(65534)
            return subprocess.run([node, '-e', runner.SOCKET_CHECK_JS, 's'], cwd=self.root, capture_output=True, text=True, timeout=5, preexec_fn=drop_root if os.geteuid() == 0 else None)
        finally:
            os.chdir(original)
            server.close()

    def test_mode000_socket_passes_only_when_connection_denied(self):
        result = self.socket_preflight(0)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accessible_socket_is_rejected(self):
        result = self.socket_preflight(0o666)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('DOCKER_SOCKET_UNEXPECTED_ACCESS', result.stderr)


if __name__ == '__main__':
    unittest.main()
