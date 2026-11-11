import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', pathlib.Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/dev/shm')
        self.addCleanup(self.tmp.cleanup)
        state = pathlib.Path(self.tmp.name)
        self.cfg = {'executor': 'exec-test', 'vigia': 'vigia-test', 'owner_chat': 'test@c.us',
                    'owner_aliases': ['test@lid'], 'enabled_at': 100, 'reports_enabled': False}
        self.p1 = patch.object(bridge, 'STATE', state)
        self.p2 = patch.object(bridge, 'config', return_value=self.cfg)
        self.p1.start()
        self.p2.start()
        self.addCleanup(self.p1.stop)
        self.addCleanup(self.p2.stop)
        bridge.initialize()
        self.message = {'id': 'm1', 'from': 'test@lid', 'fromMe': False, 'timestamp': 101, 'body': 'status'}

    def test_owner_only(self):
        for fields in [{'from': 'stranger@c.us'}, {'fromMe': True}, {'fromMe': None}, {'participant': 'member@c.us'},
                       {'timestamp': 99}, {'id': None}]:
            self.assertFalse(bridge.accept({**self.message, **fields}, 'exec-test'))
        self.assertFalse(bridge.accept(self.message, 'vigia-test'))
        self.assertTrue(bridge.accept(self.message, 'exec-test'))

    def test_duplicate_receipt_does_not_execute_twice(self):
        self.assertTrue(bridge.accept(self.message, 'exec-test'))
        self.assertFalse(bridge.accept(self.message, 'exec-test'))
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM inbox').fetchone()[0], 1)

    def test_restart_preserves_uncertain_effects(self):
        bridge.accept(self.message, 'exec-test')
        with bridge.db() as c:
            c.execute("UPDATE inbox SET state='running'")
            c.execute("INSERT INTO sends VALUES('s','sending',NULL,1)")
        bridge.initialize()
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT state FROM inbox').fetchone()[0], 'interrupted')
            self.assertEqual(c.execute('SELECT state FROM sends').fetchone()[0], 'uncertain')

    def test_uncertain_send_is_not_retried(self):
        with patch.object(bridge, 'request', side_effect=TimeoutError) as req:
            self.assertFalse(bridge.send_once('send-test', 'exec-test', 'hello'))
            self.assertFalse(bridge.send_once('send-test', 'exec-test', 'hello'))
            self.assertEqual(req.call_count, 1)

    def test_credentials_never_follow_external_media(self):
        msg = {'hasMedia': True, 'media': {'url': 'https://attacker.invalid/api/files/a', 'mimetype': 'image/png'}}
        with self.assertRaisesRegex(ValueError, 'untrusted_media_origin'):
            bridge.download_media(msg, pathlib.Path(self.tmp.name))

    def test_path_not_trusted_even_on_localhost(self):
        msg = {'hasMedia': True, 'media': {'url': 'http://localhost/admin', 'mimetype': 'audio/ogg'}}
        with self.assertRaisesRegex(ValueError, 'untrusted_media_path'):
            bridge.download_media(msg, pathlib.Path(self.tmp.name))

    def test_message_id_object(self):
        self.assertEqual(bridge.message_id({'_serialized': 'serialized', 'id': 'inner'}), 'serialized')


if __name__ == '__main__':
    unittest.main()
