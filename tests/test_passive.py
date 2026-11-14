import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('standby_guard', ROOT/'runtime/standby_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class PassiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'test-work')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.authority = self.root/'authority.json'
        self.authority.write_text(json.dumps({'role':'standby','generation':1,'armed_boot_id':None}))
        with sqlite3.connect(self.root/'queue.sqlite') as db:
            db.executescript('CREATE TABLE jobs(id TEXT,state TEXT); CREATE TABLE events(seq INTEGER); INSERT INTO jobs VALUES("fictional","completed");')
        p = patch.dict(os.environ, {'ADMIN_CLUSTER_DISPATCH':'0','ADMIN_CLUSTER_KUBERNETES':'0'})
        p.start(); self.addCleanup(p.stop)

    def test_guard_is_read_only(self):
        before={p.name:p.read_bytes() for p in self.root.iterdir()}
        result=guard.validate(self.root)
        self.assertTrue(result['passive'])
        self.assertEqual(before, {p.name:p.read_bytes() for p in self.root.iterdir()})

    def test_missing_queue_never_initializes_it(self):
        (self.root/'queue.sqlite').unlink()
        with self.assertRaises(ValueError):guard.validate(self.root)
        self.assertFalse((self.root/'queue.sqlite').exists())

    def test_primary_or_armed_authority_refused(self):
        for role,boot in [('primary',None),('standby','fictional-boot'),('suspended',None)]:
            self.authority.write_text(json.dumps({'role':role,'generation':1,'armed_boot_id':boot}))
            with self.assertRaises(ValueError):guard.validate(self.root)

    def test_dispatch_or_kubernetes_enabled_refused(self):
        for key in ['ADMIN_CLUSTER_DISPATCH','ADMIN_CLUSTER_KUBERNETES']:
            with patch.dict(os.environ,{key:'1'}):
                with self.assertRaises(ValueError):guard.validate(self.root)

    def test_linked_queue_refused(self):
        queue=self.root/'queue.sqlite';saved=self.root/'saved';queue.rename(saved);queue.symlink_to(saved)
        with self.assertRaises(ValueError):guard.validate(self.root)

    def test_missing_schema_or_invalid_generation_refused(self):
        with sqlite3.connect(self.root/'queue.sqlite') as db:db.execute('DROP TABLE events')
        with self.assertRaises(ValueError):guard.validate(self.root)
        self.authority.write_text(json.dumps({'role':'standby','generation':True,'armed_boot_id':None}))
        with self.assertRaises(ValueError):guard.validate(self.root)


if __name__=='__main__':unittest.main()
