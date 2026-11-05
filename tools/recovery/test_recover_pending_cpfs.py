"""Synthetic checks for the isolated pending-signature recovery."""
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import sqlite3
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pending_recovery', Path(__file__).with_name('recover_pending_cpfs.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class PendingRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.directory.chmod(0o700)
        self.output = self.directory / 'pendentes.sqlite'
        self.key = b'fictional-test-secret-not-for-production-0123456789'
        self.env = self.directory / 'app.env'
        self.env.write_text("HASH_PEPPER='" + self.key.decode() + "'\nDATABASE_URL='postgres://user:fake@127.0.0.1:5432/peticao'\n")
        self.row = dict(id=7, name='Pessoa Fictícia', category='apoiador',
                        cpf_hash=hmac.new(self.key, recovery.cpf_from_base(1), hashlib.sha256).hexdigest(),
                        cpf_name_check='match', created_at='2026-11-01T01:02:03.000Z',
                        consent_at='2026-11-01T01:02:02.000Z', confirmed_at=None)

    def run_worker(self):
        real_stat = Path.stat

        def private_root_stat(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if path == self.directory:
                return types.SimpleNamespace(st_uid=0, st_mode=result.st_mode)
            return result

        args = ['pending', '--env-file', str(self.env), '--output', str(self.output), '--max-candidates', '1']
        with patch.object(recovery.os, 'geteuid', return_value=0), \
             patch.object(recovery.os, 'nice'), \
             patch.object(recovery.resource, 'setrlimit'), \
             patch.object(Path, 'stat', private_root_stat), \
             patch.object(recovery, 'snapshot', return_value=[self.row]), \
             patch('sys.argv', args), contextlib.redirect_stdout(io.StringIO()):
            recovery.main()

    def test_snapshot_scope_includes_pending_even_if_name_checked(self):
        result = types.SimpleNamespace(returncode=0, stdout=json.dumps([self.row]))
        with patch.object(recovery.subprocess, 'run', return_value=result) as run:
            self.assertEqual(recovery.snapshot('peticao', '5432'), [self.row])
        query = run.call_args.kwargs['input']
        self.assertIn("status = 'pending'", query)
        self.assertIn('READ ONLY', query)
        self.assertNotIn("status = 'confirmed'", query)
        self.assertNotIn("IS DISTINCT FROM 'match'", query)

    def test_separate_default_output(self):
        self.assertIn("/root/peticao-recovery/assinaturas-pendentes.sqlite", Path(recovery.__file__).read_text())

    def test_resume_preserves_unconfirmed_state_and_timestamps(self):
        self.run_worker()
        with sqlite3.connect(self.output) as conn:
            self.assertEqual(conn.execute('SELECT cpf FROM signatures').fetchone()[0], None)
        self.run_worker()
        with sqlite3.connect(self.output) as conn:
            row = conn.execute('SELECT cpf,original_created_at,original_consent_at,original_confirmed_at,original_cpf_name_check FROM signatures').fetchone()
            self.assertEqual(row, ('00000000191', self.row['created_at'], self.row['consent_at'], None, 'match'))
            meta = dict(conn.execute('SELECT key,value FROM metadata'))
            self.assertEqual(meta['source_status'], 'pending')
            self.assertEqual(meta['state'], 'complete')
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)

    def test_refuses_confirmed_cohort_without_altering_it(self):
        with sqlite3.connect(self.output) as conn:
            conn.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)')
            conn.execute('INSERT INTO metadata VALUES(?,?)', ('selection', 'status=confirmed'))
        before = self.output.read_bytes()
        with self.assertRaises(RuntimeError):
            self.run_worker()
        self.assertEqual(before, self.output.read_bytes())


if __name__ == '__main__':
    unittest.main()
