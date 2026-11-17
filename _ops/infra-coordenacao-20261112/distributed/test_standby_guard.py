import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('standby_guard', Path(__file__).with_name('standby_guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class StandbyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.authority = self.root / 'authority.json'
        self.authority.write_text(json.dumps({'role': 'standby', 'generation': 7, 'armed_boot_id': None}))
        self.queue = self.root / 'queue.sqlite'
        with sqlite3.connect(self.queue) as db:
            db.execute('CREATE TABLE jobs(id TEXT,state TEXT)')
            db.execute('CREATE TABLE events(id INTEGER)')
            db.execute("INSERT INTO jobs VALUES('fixture','interrupted')")
        p = patch.dict(os.environ, ADMIN_CLUSTER_DISPATCH='0', ADMIN_CLUSTER_KUBERNETES='0')
        p.start()
        self.addCleanup(p.stop)

    def test_valid_standby_preserves_queue_bytes(self):
        before = self.queue.read_bytes()
        self.assertTrue(guard.validate(self.root)['passive'])
        self.assertEqual(self.queue.read_bytes(), before)

    def test_primary_or_armed_authority_refused(self):
        for authority in [dict(role='primary', generation=7, armed_boot_id=None), dict(role='standby', generation=7, armed_boot_id='boot')]:
            self.authority.write_text(json.dumps(authority))
            with self.assertRaises(ValueError):
                guard.validate(self.root)

    def test_dispatch_or_kubernetes_enablement_refused(self):
        for key in ['ADMIN_CLUSTER_DISPATCH', 'ADMIN_CLUSTER_KUBERNETES']:
            with patch.dict(os.environ, {key: '1'}):
                with self.assertRaises(ValueError):
                    guard.validate(self.root)

    def test_missing_queue_not_created(self):
        self.queue.unlink()
        with self.assertRaises(ValueError):
            guard.validate(self.root)
        self.assertFalse(self.queue.exists())

    def test_symlink_authority_refused(self):
        original = self.root / 'real-authority'
        self.authority.rename(original)
        self.authority.symlink_to(original)
        with self.assertRaises(ValueError):
            guard.validate(self.root)

    def test_invalid_generation_refused(self):
        for generation in [0, -1, True, '7']:
            self.authority.write_text(json.dumps({'role': 'standby', 'generation': generation, 'armed_boot_id': None}))
            with self.assertRaises(ValueError):
                guard.validate(self.root)

    def test_other_database_not_accepted(self):
        self.queue.unlink()
        with sqlite3.connect(self.queue) as db:
            db.execute('CREATE TABLE unrelated(x)')
        with self.assertRaises(ValueError):
            guard.validate(self.root)


if __name__ == '__main__':
    unittest.main()
