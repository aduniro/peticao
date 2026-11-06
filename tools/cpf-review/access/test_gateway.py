import importlib.util, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('gateway.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
class AccessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); g.BASE = Path(self.temp.name); g.AUTH = g.BASE/'auth.sqlite'
        g.initialize('test-password-only')
    def tearDown(self): self.temp.cleanup()
    def test_hash_and_session(self):
        self.assertNotIn(b'test-password-only', g.AUTH.read_bytes())
        self.assertEqual(g.login('wrong'), (None,401))
        token,status = g.login('test-password-only')
        self.assertEqual(status,303); self.assertTrue(g.valid(token)); self.assertFalse(g.valid('forged'))
        self.assertNotIn(token.encode(), g.AUTH.read_bytes())
        with g.connect() as db: db.execute('UPDATE sessions SET expires=0')
        self.assertFalse(g.valid(token))
    def test_rate_limit_and_no_overwrite(self):
        for _ in range(10): self.assertEqual(g.login('wrong')[1],401)
        self.assertEqual(g.login('test-password-only')[1],429)
        with self.assertRaises(RuntimeError): g.initialize('replacement')
if __name__ == '__main__': unittest.main()
