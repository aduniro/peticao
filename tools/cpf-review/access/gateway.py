#!/usr/bin/env python3
"""Password gate for the existing loopback review server; no review DB writes."""
import hashlib, hmac, html, http.client, json, os, secrets, sqlite3, time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

BASE = Path(os.environ.get('CPF_REVIEW_DATA_DIR', '/mnt/apps/peticao-final/cpfs/revisao'))
AUTH = BASE / 'acesso.sqlite'
ORIGIN = os.environ.get('CPF_REVIEW_ORIGIN', 'https://dell3576-zorin.tail1a6d71.ts.net:8443')
HOST = urlsplit(ORIGIN).netloc
COOKIE = '__Host-review_access'

def connect():
    return sqlite3.connect(AUTH, timeout=15)

def initialize(password):
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    salt = secrets.token_bytes(32)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    with connect() as db:
        db.executescript('CREATE TABLE IF NOT EXISTS credentials(id INTEGER PRIMARY KEY CHECK(id=1), salt BLOB, digest BLOB); CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, expires INTEGER); CREATE TABLE IF NOT EXISTS attempts(at REAL);')
        if db.execute('SELECT 1 FROM credentials').fetchone():
            raise RuntimeError('A senha já existe; alteração não realizada')
        db.execute('INSERT INTO credentials VALUES(1,?,?)', (salt, digest))
    AUTH.chmod(0o600)

def login(password):
    now = time.time()
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM attempts WHERE at < ?', (now-900,))
        if db.execute('SELECT count(*) FROM attempts').fetchone()[0] >= 10:
            return None, 429
        db.execute('INSERT INTO attempts VALUES(?)', (now,))
        salt, expected = db.execute('SELECT salt,digest FROM credentials WHERE id=1').fetchone()
        actual = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
        if not hmac.compare_digest(actual, expected):
            return None, 401
        token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires < ?', (now,))
        db.execute('INSERT INTO sessions VALUES(?,?)', (hashlib.sha256(token.encode()).hexdigest(), int(now)+43200))
        db.execute('DELETE FROM attempts')
        return token, 303

def valid(token):
    with connect() as db:
        return bool(db.execute('SELECT 1 FROM sessions WHERE digest=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone())

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=b'', headers=None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        for name, value in {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'", **(headers or {})}.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def page(self, status=200, error=''):
        self.send(status, ('''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso à revisão</title><style>body{font-family:system-ui;background:#f3f6f5;color:#18332b;margin:0;padding:24px}main{max-width:380px;margin:12vh auto;background:white;padding:28px;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:14px;font:inherit;margin-top:12px;border-radius:8px;border:1px solid #91aba0}button{background:#006c49;color:white;font-weight:600}p[role=alert]{color:#b00020}</style><main><h1>Revisão de assinaturas</h1><p>Digite a senha enviada por e-mail.</p><form method="post" action="/login"><label for="password">Senha de acesso</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="256"><button>Entrar</button></form><p role="alert">''' + html.escape(error) + '</p></main></html>').encode())

    def authorized(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            return COOKIE in jar and valid(jar[COOKIE].value)
        except Exception:
            return False

    def dispatch(self):
        if self.headers.get('Host') != HOST:
            return self.send(403)
        path = urlsplit(self.path)
        if self.command == 'POST' and self.headers.get('Origin') != ORIGIN:
            return self.send(403)
        if self.command == 'GET' and path.path == '/login':
            return self.page()
        if self.command == 'POST' and path.path == '/login':
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 2048:
                return self.send(413)
            password = parse_qs(self.rfile.read(size).decode()).get('password', [''])[0]
            token, status = login(password)
            if token:
                return self.send(303, headers={'Location':'/', 'Set-Cookie':f'{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200'})
            return self.page(status, 'Muitas tentativas. Aguarde 15 minutos.' if status == 429 else 'Senha incorreta.')
        if not self.authorized():
            return self.send(303, headers={'Location':'/login'})
        if 'token' in parse_qs(path.query):
            return self.send(400)
        size = int(self.headers.get('Content-Length', '0'))
        if size < 0 or size > 16384:
            return self.send(413)
        body = self.rfile.read(size) if size else None
        # The original token stays inside this local process, never in browser output.
        token = (BASE / '.access-token').read_text()
        headers = {'Host':'127.0.0.1:8765', 'Cookie':f'review={token}', 'Origin':'http://127.0.0.1:8765', 'Content-Type':self.headers.get('Content-Type','application/json')}
        upstream = http.client.HTTPConnection('127.0.0.1', 8765, timeout=120)
        try:
            upstream.request(self.command, self.path, body, headers)
            response = upstream.getresponse()
            result = response.read()
            forwarded = {k:v for k,v in response.getheaders() if k.lower() in ('content-type','content-disposition','content-security-policy')}
            self.send(response.status, result, forwarded)
        except (OSError, http.client.HTTPException):
            self.send(502, b'Servico local temporariamente indisponivel.')
        finally:
            upstream.close()

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

if __name__ == '__main__':
    os.umask(0o077)
    if not AUTH.exists():
        raise SystemExit('Inicialize a senha antes de iniciar o serviço.')
    ThreadingHTTPServer(('127.0.0.1', 8766), Handler).serve_forever()
