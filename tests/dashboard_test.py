import hashlib
import datetime
import http.client
import importlib.util
import ipaddress
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dashboard', Path(__file__).resolve().parents[1] / 'infra' / 'dashboard.py')
dashboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dashboard)


class DashboardTests(unittest.TestCase):
    def test_vigia_absent_recent_and_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(dashboard, 'ROOT', root):
                self.assertFalse(dashboard.vigia_summary()['available'])
                path = root / 'vigia-summary.json'
                current = datetime.datetime.now(datetime.timezone.utc)
                raw = {'exported_at':current.isoformat(), 'tasks':[{'id':'t1','title':'Painel admin-v2','state':'em execução','stage':'Revisão','progress':12.5,'eta':'não informada','updated_at':current.isoformat(),'private':'never show'}], 'secret':'never show'}
                path.write_text(json.dumps(raw))
                recent = dashboard.vigia_summary()
                self.assertTrue(recent['available'])
                self.assertFalse(recent['stale'])
                self.assertNotIn('never show',json.dumps(recent))
                raw['exported_at'] = (current-datetime.timedelta(minutes=10)).isoformat()
                path.write_text(json.dumps(raw))
                self.assertTrue(dashboard.vigia_summary()['stale'])

    def test_wal_copy_includes_committed_rows_without_changing_originals(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'queue.sqlite'
            db = sqlite3.connect(path)
            try:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE jobs(id,payload,state,generation,created_at,updated_at,finished_at,exit_code)')
                db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)', ('b'*32,'{"kind":"test"}','queued',1,None,None,None,None))
                db.commit()
                originals = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}
                with patch.object(dashboard,'ROOT',root):
                    result = dashboard.status()
                self.assertEqual(result['counts'], {'queued':1})
                self.assertEqual(originals,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()})
                self.assertIsNotNone(result['queue_snapshot_at'])
            finally:
                db.close()

    def test_read_only_and_redacted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dbpath = root / 'queue.sqlite'
            with sqlite3.connect(dbpath) as db:
                db.execute('CREATE TABLE jobs(id,payload,state,generation,created_at,updated_at,finished_at,exit_code)')
                db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)', ('a'*32, json.dumps({'kind':'build','source_commit':'b'*40,'email':'private@example.org','secret':'do-not-show'}), 'completed',1,'2026-11-10T12:00:00+00:00','2026-11-10T12:00:00+00:00',None,0))
            before = hashlib.sha256(dbpath.read_bytes()).hexdigest()
            (root / 'replication-out.json').write_text(json.dumps({'state':'error','error':'private@example.org'}))
            with patch.object(dashboard, 'ROOT', root):
                value = dashboard.status()
            self.assertTrue(value['queue_available'])
            self.assertEqual(value['counts']['completed'], 1)
            self.assertNotIn('private@example.org', json.dumps(value))
            self.assertNotIn('do-not-show', json.dumps(value))
            self.assertEqual(hashlib.sha256(dbpath.read_bytes()).hexdigest(), before)

    def test_allowlist_routes_and_methods(self):
        server = dashboard.Server(('127.0.0.1',0), dashboard.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        def request(method, path):
            c = http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            c.request(method,path)
            response = c.getresponse()
            result = response.status, response.read()
            c.close()
            return result
        try:
            self.assertEqual(request('GET','/')[0],403)
            with patch.object(dashboard, 'ALLOWED', {ipaddress.ip_address('127.0.0.1')}):
                self.assertEqual(request('GET','/')[0],200)
                self.assertEqual(request('HEAD','/'),(200,b''))
                self.assertEqual(request('POST','/api/status')[0],405)
                self.assertEqual(request('DELETE','/')[0],405)
                self.assertEqual(request('GET','/../../etc/passwd')[0],404)
                self.assertEqual(request('GET','/api/status?path=/etc/passwd')[0],404)
        finally:
            server.shutdown()
            server.server_close()

    def test_private_bind_and_devices(self):
        self.assertEqual(dashboard.BIND, ('100.80.18.81','fd7a:115c:a1e0::3e2f:1252'))
        self.assertEqual(dashboard.PORT,8766)
        self.assertNotIn(ipaddress.ip_address('127.0.0.1'),dashboard.ALLOWED)
        for ip in ('100.74.222.59','100.101.28.33','100.65.166.58','100.119.96.97'):
            self.assertIn(ipaddress.ip_address(ip),dashboard.ALLOWED)


if __name__ == '__main__':
    unittest.main()
