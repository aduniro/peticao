import importlib.util, sqlite3, tempfile, unittest
import http.client, threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlencode
from pathlib import Path

spec=importlib.util.spec_from_file_location('mirror_gateway',Path(__file__).with_name('gateway.py'))
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        gate.BASE=Path(self.temp.name);gate.AUTH=gate.BASE/'access.sqlite'
        gate.initialize('fictitious-test-password')
    def tearDown(self):self.temp.cleanup()
    def test_hash_only_and_no_password_replacement(self):
        self.assertNotIn(b'fictitious-test-password',gate.AUTH.read_bytes())
        with self.assertRaises(RuntimeError):gate.initialize('replacement')
    def test_session_requires_password_and_correct_origin(self):
        self.assertEqual(gate.login('wrong','http://localhost:3031'),(None,401))
        token,status=gate.login('fictitious-test-password','http://localhost:3031')
        self.assertEqual(status,303)
        self.assertTrue(gate.valid(token,'http://localhost:3031'))
        self.assertFalse(gate.valid(token,'http://127.0.0.1:3031'))
        self.assertFalse(gate.valid('forged','http://localhost:3031'))
        self.assertNotIn(token.encode(),gate.AUTH.read_bytes())
        with gate.connect() as db:db.execute('UPDATE sessions SET expires=0')
        self.assertFalse(gate.valid(token,'http://localhost:3031'))
    def test_rate_limit(self):
        for _ in range(10):self.assertEqual(gate.login('wrong','http://localhost:3031')[1],401)
        self.assertEqual(gate.login('fictitious-test-password','http://localhost:3031'),(None,429))
    def test_http_authentication_host_origin_and_mutation_guards(self):
        calls=[]
        class Backend(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                calls.append(self.path);self.send_response(200);self.end_headers();self.wfile.write(b'fixture')
        backend=ThreadingHTTPServer(('127.0.0.1',0),Backend)
        gate.UPSTREAM_PORT=backend.server_port
        server=ThreadingHTTPServer(('127.0.0.1',0),gate.Handler)
        for s in [backend,server]:threading.Thread(target=s.serve_forever,daemon=True).start()
        def request(method,path,body=None,headers=None):
            c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            c.request(method,path,body,{'Host':'localhost:3031',**(headers or {})});r=c.getresponse();result=(r.status,dict(r.getheaders()),r.read());c.close();return result
        try:
            self.assertEqual(request('GET','/admin')[0],303);self.assertEqual(calls,[])
            self.assertEqual(request('GET','/admin',headers={'Host':'attacker.test'})[0],403)
            body=urlencode({'password':'fictitious-test-password'})
            self.assertEqual(request('POST','/login',body,{'Origin':'https://attacker.test'})[0],403)
            result=request('POST','/login',body,{'Origin':'http://localhost:3031'})
            self.assertEqual(result[0],303)
            cookie=result[1]['Set-Cookie'].split(';')[0]
            authenticated=request('GET','/api/admin/dashboard',headers={'Cookie':cookie})
            self.assertEqual(authenticated[0],200);self.assertEqual(authenticated[2],b'fixture')
            self.assertEqual(request('POST','/api/admin/emails/sincronizar','{}',{'Cookie':cookie,'Origin':'http://localhost:3031'})[0],403)
            self.assertEqual(calls,['/api/admin/dashboard'])
        finally:
            for s in [server,backend]:s.shutdown();s.server_close()

if __name__=='__main__':unittest.main()
