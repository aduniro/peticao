"""Synthetic-data tests. Run: python3 -m unittest discover -s tools/recovery -p 'test_*.py'."""
import contextlib
import fcntl
import hashlib
import importlib.util
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('watch_recovery', Path(__file__).with_name('watch_recovery.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'resultado privado.sqlite'
        with sqlite3.connect(self.path) as conn:
            conn.executescript('''
              CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
              INSERT INTO metadata VALUES('next_base','100000'),('state','paused');
              CREATE TABLE signatures(signature_id INTEGER,name TEXT,cpf TEXT,recovered_at TEXT);
              INSERT INTO signatures VALUES(1,'Pessoa Fictícia','52998224725','2026-01-01');
              INSERT INTO signatures VALUES(2,'Outra Pessoa',NULL,NULL);
            ''')

    def test_read_only_and_default_privacy(self):
        before = hashlib.sha256(self.path.read_bytes()).digest()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            monitor.watch(self.path, 2, False)
        self.assertIn('Restantes: 1', out.getvalue())
        self.assertIn('Hashes correspondidos: 1/2', out.getvalue())
        self.assertNotIn('Pessoa Fictícia', out.getvalue())
        self.assertNotIn('529', out.getvalue())
        self.assertEqual(before, hashlib.sha256(self.path.read_bytes()).digest())

    def test_live_new_rows_printed_once(self):
        def recover_next(_):
            with sqlite3.connect(self.path) as conn:
                conn.execute("UPDATE signatures SET cpf='00000000191',recovered_at='2026-01-02' WHERE signature_id=2")
        out = io.StringIO()
        with patch.object(monitor, 'worker_active', side_effect=[True, False]), \
             patch.object(monitor.time, 'sleep', side_effect=recover_next), \
             contextlib.redirect_stdout(out):
            monitor.watch(self.path, 2, True)
        self.assertEqual(out.getvalue().count('Nome=Pessoa Fictícia'), 1)
        self.assertIn('CPF=529.982.247-25', out.getvalue())
        self.assertIn('CPF=000.000.001-91', out.getvalue())
        self.assertIn('Restantes: 0', out.getvalue())

    def test_real_lock_detection(self):
        self.assertFalse(monitor.worker_active(self.path))
        with open(str(self.path) + '.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertTrue(monitor.worker_active(self.path))
        self.assertFalse(monitor.worker_active(self.path))

    def test_terminal_injection_removed(self):
        text = monitor.terminal_text('Pessoa\nFalsa\x1b[2J\r\x85Nome\u2028')
        self.assertNotIn('\n', text)
        self.assertNotIn('\x1b', text)
        self.assertNotIn('\r', text)
        self.assertNotIn('\x85', text)
        self.assertNotIn('\u2028', text)

    def test_details_refuse_redirected_stdout(self):
        with patch('sys.argv', ['watch', '--show-personal-data']), \
             patch.object(monitor.os, 'geteuid', return_value=0), \
             patch.object(monitor.sys.stdout, 'isatty', return_value=False):
            with self.assertRaises(RuntimeError):
                monitor.main()


if __name__ == '__main__':
    unittest.main()
