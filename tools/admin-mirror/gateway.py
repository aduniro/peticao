"""Private password gate. Next listens only on loopback inside the same container."""
import hashlib, hmac, html, http.client, os, secrets, sqlite3, time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

BASE = Path(os.environ.get('ADMIN_MIRROR_AUTH_DIR', '/state/auth'))
AUTH = BASE / 'access.sqlite'
TAIL_ORIGIN = os.environ.get('ADMIN_MIRROR_ORIGIN', 'https://dell3576-zorin.tail1a6d71.ts.net:9443')
ORIGINS = {urlsplit(TAIL_ORIGIN).netloc: TAIL_ORIGIN,
           '127.0.0.1:3031': 'http://127.0.0.1:3031', 'localhost:3031': 'http://localhost:3031'}
TTL = 43200
UPSTREAM_PORT = int(os.environ.get('ADMIN_MIRROR_UPSTREAM_PORT', '3032'))

def connect():
    return sqlite3.connect(AUTH, timeout=10)

def initialize(password):
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    salt = secrets.token_bytes(32)
    value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    with connect() as db:
        db.executescript('CREATE TABLE IF NOT EXISTS credentials(id INTEGER PRIMARY KEY CHECK(id=1),salt BLOB NOT NULL,digest BLOB NOT NULL); CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,origin TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS attempts(at REAL NOT NULL);')
        if db.execute('SELECT 1 FROM credentials').fetchone():
            raise RuntimeError('Existing password preserved')
        db.execute('INSERT INTO credentials VALUES(1,?,?)', (salt, value))
    AUTH.chmod(0o600)

def login(password, origin):
    now = time.time()
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM attempts WHERE at<?', (now-900,))
        if db.execute('SELECT count(*) FROM attempts').fetchone()[0] >= 10:
            return None, 429
        db.execute('INSERT INTO attempts VALUES(?)', (now,))
        if len(password) > 256:
            return None, 401
        salt, expected = db.execute('SELECT salt,digest FROM credentials WHERE id=1').fetchone()
        value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
        if not hmac.compare_digest(value, expected):
            return None, 401
        token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires<?', (now,))
        db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), origin, int(now)+TTL))
        db.execute('DELETE FROM attempts')
        return token, 303

def valid(token, origin):
    if len(token) > 256:
        return False
    with connect() as db:
        return bool(db.execute('SELECT 1 FROM sessions WHERE digest=? AND origin=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), origin, time.time())).fetchone())

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=b'', headers=None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        for name, value in {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow', **(headers or {})}.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def page(self, status=200, error=''):
        page = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia com dados da produção — somente leitura</title><style>body{font-family:system-ui;background:#f3f6f5;color:#18332b;margin:0;padding:24px}main{max-width:420px;margin:10vh auto;background:white;padding:28px;border-radius:16px}h1{font-size:22px}input,button{box-sizing:border-box;width:100%;padding:14px;font:inherit;margin-top:12px;border-radius:8px;border:1px solid #91aba0}button{background:#006c49;color:white;font-weight:600}p[role=alert]{color:#b00020}</style><main><h1>Prévia com dados da produção — somente leitura</h1><form method="post" action="/login"><label for="password">Senha de acesso</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="256"><button>Entrar</button></form><p role="alert">'''+html.escape(error)+'</p></main></html>'
        self.send(status, page.encode(), {'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"})

    def dispatch(self):
        origin = ORIGINS.get(self.headers.get('Host', ''))
        if not origin:
            return self.send(403)
        path = urlsplit(self.path)
        if self.command == 'POST' and self.headers.get('Origin') != origin:
            return self.send(403)
        if self.command in ('GET','HEAD') and path.path == '/login':
            return self.page()
        cookie = '__Host-admin_mirror' if origin.startswith('https:') else 'admin_mirror_local'
        if self.command == 'POST' and path.path == '/login':
            try:
                size = int(self.headers.get('Content-Length','0'))
                if size < 1 or size > 2048:
                    return self.send(413)
                password = parse_qs(self.rfile.read(size).decode('utf-8')).get('password',[''])[0]
            except (ValueError,UnicodeError):
                return self.send(400)
            token, status = login(password, origin)
            if token:
                secure = '; Secure' if origin.startswith('https:') else ''
                return self.send(303, headers={'Location':'/admin','Set-Cookie':f'{cookie}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={TTL}{secure}'})
            return self.page(status, 'Muitas tentativas. Aguarde 15 minutos.' if status == 429 else 'Senha incorreta.')
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie',''))
            authorized = cookie in jar and valid(jar[cookie].value, origin)
        except Exception:
            authorized = False
        if not authorized:
            return self.send(303, headers={'Location':'/login'})
        if self.command == 'POST' and path.path == '/api/admin/sair':
            with connect() as db:
                db.execute('DELETE FROM sessions WHERE digest=? AND origin=?', (hashlib.sha256(jar[cookie].value.encode()).hexdigest(), origin))
            secure = '; Secure' if origin.startswith('https:') else ''
            return self.send(303, headers={'Location':'/login','Set-Cookie':f'{cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}'})
        if self.command not in ('GET','HEAD'):
            return self.send(403)
        if self.headers.get('Content-Length') not in (None, '0') or self.headers.get('Transfer-Encoding'):
            return self.send(400)
        headers = {k:v for k,v in self.headers.items() if k.lower() in ('accept','accept-language','rsc','next-router-state-tree','next-router-prefetch','next-url','range','if-none-match')}
        headers.update({'Host':self.headers['Host'], 'X-Forwarded-Host':self.headers['Host'], 'X-Forwarded-Proto':urlsplit(origin).scheme})
        upstream = http.client.HTTPConnection('127.0.0.1', UPSTREAM_PORT, timeout=60)
        try:
            upstream.request(self.command, self.path, headers=headers)
            response = upstream.getresponse()
            result = response.read()
            allowed = {'content-type','content-disposition','content-security-policy','content-encoding','location','vary','etag','accept-ranges','content-range'}
            forwarded = {k:v for k,v in response.getheaders() if k.lower() in allowed}
            # Do not let an upstream redirect bypass this gate or leave the private origin.
            location = next((v for k,v in forwarded.items() if k.lower()=='location'), '')
            if location and (not location.startswith('/') or location.startswith('//')):
                return self.send(502)
            self.send(response.status, result, forwarded)
        except (OSError,http.client.HTTPException):
            self.send(503)
        finally:
            upstream.close()

    do_GET = dispatch
    do_HEAD = dispatch
    do_POST = dispatch
    do_PUT = dispatch
    do_PATCH = dispatch
    do_DELETE = dispatch

if __name__ == '__main__':
    os.umask(0o077)
    if not AUTH.exists():
        raise SystemExit('Missing local authentication database')
    ThreadingHTTPServer(('0.0.0.0',3031),Handler).serve_forever()
