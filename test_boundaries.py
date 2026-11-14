import argparse
import io
from contextlib import redirect_stdout
import json
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

import caller
import runner

WORK = Path(__file__).parent / 'test-work'


class Boundaries(unittest.TestCase):
    def setUp(self):
        WORK.mkdir(exist_ok=True, mode=0o700)
        self.tmp = tempfile.TemporaryDirectory(dir=WORK)
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_source_path_traversal_rejected(self):
        member = tarfile.TarInfo('../credentials')
        with self.assertRaises(ValueError): list(runner.safe_members([member]))

    def test_source_symlinks_rejected(self):
        member = tarfile.TarInfo('site/link')
        member.type = tarfile.SYMTYPE
        member.linkname = '/home/civo'
        with self.assertRaises(ValueError): list(runner.safe_members([member]))

    def test_cache_rejects_top_level_credentials(self):
        with self.assertRaises(ValueError):
            list(runner.safe_members([tarfile.TarInfo('keys.env')], True))

    def test_dependency_absolute_link_cannot_escape_data_filter(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            member = tarfile.TarInfo('node_modules/escape')
            member.type = tarfile.SYMTYPE
            member.linkname = '/home/civo'
            archive.addfile(member)
        stream.seek(0)
        with tarfile.open(fileobj=stream) as archive:
            with self.assertRaises(tarfile.FilterError):
                archive.extractall(self.root, members=runner.safe_members(archive, True), filter='data')

    def test_internal_dependency_links_remain_usable(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            member = tarfile.TarInfo('node_modules/pkg/bin.js')
            member.size = 3
            archive.addfile(member, io.BytesIO(b'abc'))
            member = tarfile.TarInfo('node_modules/.bin/pkg')
            member.type = tarfile.SYMTYPE
            member.linkname = '../pkg/bin.js'
            archive.addfile(member)
        stream.seek(0)
        with tarfile.open(fileobj=stream) as archive:
            archive.extractall(self.root, members=runner.safe_members(archive, True), filter='data')
        self.assertEqual((self.root / 'node_modules/.bin/pkg').read_bytes(), b'abc')

    def test_submission_is_nonroot_bounded_and_hides_credentials(self):
        (self.root / 'STATE.json').write_text('{"phase":"prepared"}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner, 'run', return_value='') as execute:
            with redirect_stdout(io.StringIO()): runner.start_build({})
            args = execute.call_args.args[0]
            for property_ in ['User=civo', 'MemoryMax=8G', 'CPUQuota=400%', 'TasksMax=256', 'ProtectHome=tmpfs', 'PrivateNetwork=yes', 'ProtectSystem=strict', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=']:
                self.assertIn('--property=' + property_, args)
            self.assertTrue(any(a.startswith('--property=InaccessiblePaths=') and '/run/docker.sock' in a for a in args))
            self.assertTrue(any(a.startswith('--property=BindReadOnlyPaths=') and a.endswith(':/usr/local/bin/node') for a in args))
            self.assertNotIn('HOME=', ' '.join(args))
            self.assertEqual(json.loads((self.root / 'STATE.json').read_text())['phase'], 'build-submitted')

    def test_second_build_submission_is_rejected(self):
        (self.root / 'STATE.json').write_text('{"phase":"build-submitted"}')
        with patch.object(runner, 'ROOT', self.root), patch.object(runner, 'validate_inputs'), patch.object(runner, 'run') as execute:
            with self.assertRaises(ValueError): runner.start_build({})
            execute.assert_not_called()

    def test_frozen_test_gate_requires_actual_peer_ack_event(self):
        (self.root / 'cap.json').write_text(json.dumps({'result': {'lease': 'own-test-lease', 'token': 'fictional-test-token', 'fence': 1, 'seq': 12}}))
        args = argparse.Namespace(lease_file=str(self.root / 'cap.json'), manifest_event=10)
        def fake(argv):
            if argv[0] == 'check': return {}
            if argv[0] == 'status': return {'leases': [{'id': 'own-test-lease', 'operation': 'test', 'resources': ['coord:civo-c472-worker-qualification'], 'expires': time.time() + 1000}]}
            if argv[2] == '9': return [{'seq': 10, 'kind': 'notice', 'data': {'manifest': {'commit': 'a' * 40}, 'file_sha256': {}}}]
            if argv[2] == '11': return [{'data': {'manifest_event': 10}}]
            return [{'kind': 'ack', 'actor': 'apoio', 'data': {'event_seq': 10}}]
        with patch.object(caller, 'BASE', self.root), patch.object(caller, 'cli', side_effect=fake), patch.object(caller.subprocess, 'check_output', return_value='a' * 40):
            self.assertEqual(caller.gate(args)['manifest']['commit'], 'a' * 40)
        def no_ack(argv):
            return [] if argv[0] == 'history' and argv[2] == '10' else fake(argv)
        with patch.object(caller, 'BASE', self.root), patch.object(caller, 'cli', side_effect=no_ack), patch.object(caller.subprocess, 'check_output', return_value='a' * 40):
            with self.assertRaises(ValueError): caller.gate(args)


if __name__ == '__main__': unittest.main()
