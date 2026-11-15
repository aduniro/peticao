#!/usr/bin/python3
"""Tailnet-only, allowlisted, read-only infrastructure status viewer."""
import datetime
import contextlib
import ipaddress
import json
from pathlib import Path
import re
import signal
import shutil
import socket
import sqlite3
import threading
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path('/srv/admin-v2-coordinator')
PORT = 8766
BIND = ('100.80.18.81', 'fd7a:115c:a1e0::3e2f:1252')
ALLOWED = {ipaddress.ip_address(ip) for ip in (
    '100.105.193.63', 'fd7a:115c:a1e0::e33b:c13f',
    '100.109.6.122', 'fd7a:115c:a1e0::8e2f:67b',
    *BIND, '100.74.222.59', 'fd7a:115c:a1e0::942f:de3c',
    '100.101.28.33', 'fd7a:115c:a1e0::6a2f:1c22',
    '100.65.166.58', 'fd7a:115c:a1e0::1c2f:a63b',
    '100.119.96.97', 'fd7a:115c:a1e0::152f:6062')}
STATES = {'queued', 'starting', 'running', 'completed', 'failed', 'interrupted', 'canceled'}
KINDS = {'fixture-pass', 'fixture-fail', 'typecheck', 'test', 'build'}
TIME = re.compile(r'^\d{4}-\d\d-\d\dT[0-9:.+Z-]{8,35}$')


def timestamp(value):
    return value if isinstance(value, str) and TIME.fullmatch(value) else None


def fixed_json(name):
    path = ROOT / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 128 * 1024:
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def vigia_summary():
    raw = fixed_json('vigia-summary.json')
    exported = timestamp(raw.get('exported_at'))
    if not exported or not isinstance(raw.get('tasks'), list):
        return {'available': False, 'stale': True, 'exported_at': None, 'tasks': []}
    try:
        age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(exported.replace('Z', '+00:00'))).total_seconds()
    except (ValueError, TypeError):
        return {'available': False, 'stale': True, 'exported_at': None, 'tasks': []}
    tasks = []
    for task in raw['tasks'][:100]:
        if not isinstance(task, dict):
            continue
        clean = {key: value[:limit] if isinstance(value := task.get(key), str) else '' for key, limit in (('id', 80), ('title', 200), ('state', 80), ('stage', 250), ('eta', 120))}
        progress = task.get('progress')
        clean['progress'] = progress if type(progress) in (int, float) and 0 <= progress <= 100 else progress[:40] if isinstance(progress, str) else None
        clean['updated_at'] = timestamp(task.get('updated_at'))
        tasks.append(clean)
    return {'available': True, 'stale': age > 120 or age < -60, 'age_seconds': max(0, int(age)), 'exported_at': exported, 'tasks': tasks}


@contextlib.contextmanager
def readonly_queue(dbpath):
    # SQLite mode=ro may create WAL shared-memory auxiliaries. Keep originals
    # entirely read-only by reading a stable DB+WAL copy in the private temp area.
    paths = (dbpath, dbpath.with_name(dbpath.name + '-wal'))
    def signatures():
        values = []
        for path in paths:
            if path.is_symlink():
                raise OSError('queue_symlink')
            try:
                info = path.stat()
            except FileNotFoundError:
                values.append(None)
                continue
            if info.st_size > 64 * 1024 * 1024:
                raise OSError('queue_view_size_limit')
            values.append((info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
        return values
    with tempfile.TemporaryDirectory(prefix='admin-v2-dashboard-') as folder:
        copy = Path(folder) / 'queue.sqlite'
        stable = False
        for _ in range(3):
            before = signatures()
            try:
                for path, signature in zip(paths, before):
                    destination = Path(folder) / path.name
                    destination.unlink(missing_ok=True)
                    if signature is not None:
                        shutil.copyfile(path, destination)
                        destination.chmod(0o600)
                if before == signatures():
                    stable = True
                    break
            except FileNotFoundError:
                continue
        if not stable:
            raise OSError('queue_changed_during_view_capture')
        with sqlite3.connect(copy.as_uri() + '?mode=ro', uri=True, timeout=2) as db:
            db.execute('PRAGMA query_only=ON')
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise sqlite3.DatabaseError('queue_view_integrity_failed')
            yield db


def status():
    result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'Infraestrutura e fila; progresso do admin-v2 aguardando checkpoint do responsável.', 'admin_v2_progress': None, 'queue_view': 'best_effort_stable_copy', 'queue_snapshot_at': None, 'jobs': [], 'counts': {}, 'queue_available': False}
    authority = fixed_json('authority.json')
    heartbeat = fixed_json('heartbeat.json')
    replica = fixed_json('replication-out.json')
    result['authority'] = {'role': authority.get('role') if authority.get('role') in {'primary', 'standby', 'suspended'} else 'unknown', 'generation': authority.get('generation') if type(authority.get('generation')) is int else None}
    result['vigia'] = vigia_summary()
    if result['vigia']['available']:
        result['scope'] = 'Infraestrutura e fila; resumo do painel principal separado, informado pelo Vigia.'
    result['heartbeat_at'] = timestamp(heartbeat.get('at'))
    result['replication'] = {'state': replica.get('state') if replica.get('state') in {'replicated', 'unchanged', 'inactive', 'error'} else 'unknown', **{key: timestamp(replica.get(key)) for key in ('checked_at', 'last_success_at', 'destination_received_at', 'failed_at')}}
    dbpath = ROOT / 'queue.sqlite'
    if dbpath.is_symlink() or not dbpath.is_file():
        return result
    try:
        with readonly_queue(dbpath) as db:
            result['queue_snapshot_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            for state, count in db.execute('SELECT state,COUNT(*) FROM jobs GROUP BY state'):
                if state in STATES:
                    result['counts'][state] = count
            rows = db.execute('SELECT id,payload,state,generation,created_at,updated_at,finished_at,exit_code FROM jobs ORDER BY created_at DESC LIMIT 100').fetchall()
            for ident, payload, state, generation, created, updated, finished, code in rows:
                if not re.fullmatch(r'[a-f0-9]{32}', ident) or state not in STATES:
                    continue
                try:
                    payload = json.loads(payload)
                    kind, commit = payload.get('kind'), payload.get('source_commit')
                except (ValueError, AttributeError):
                    kind, commit = None, None
                result['jobs'].append({'id': ident, 'kind': kind if isinstance(kind, str) and kind in KINDS else 'other', 'commit': commit if isinstance(commit, str) and re.fullmatch(r'[a-f0-9]{40,64}', commit) else None, 'state': state, 'generation': generation if type(generation) is int else None, 'created_at': timestamp(created), 'updated_at': timestamp(updated), 'finished_at': timestamp(finished), 'exit_code': code if type(code) is int else None})
            result['queue_available'] = True
    except (sqlite3.Error, OSError):
        result['queue_available'] = False
        result['counts'], result['jobs'], result['queue_snapshot_at'] = {}, [], None
    return result


HTML = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fila privada de integração</title><style>body{font:16px system-ui;margin:24px;background:#f4f6f8;color:#162338}main{max-width:1100px;margin:auto}section{background:white;padding:18px;margin:16px 0;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}small{color:#526176}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>Acompanhamento privado</h1><p><strong>Infraestrutura e fila de integração.</strong> Isto não é o percentual de conclusão do painel admin-v2. O progresso do painel principal depende do resumo exportado pelo Vigia, exibido abaixo.</p><small>Somente leitura · atualização automática a cada 10 segundos · acesso pela Tailscale</small><section><h2>Painel principal — resumo do Vigia</h2><p id="vigia-status">Resumo indisponível.</p><div class="scroll"><table><thead><tr><th>Tarefa</th><th>Estado registrado</th><th>Etapa</th><th>Progresso informado</th><th>Estimativa informada</th><th>Atualização da tarefa</th></tr></thead><tbody id="vigia-tasks"></tbody></table></div></section><section><h2>Infraestrutura e fila</h2><pre id="state">Carregando…</pre></section><section><h2>Últimos 100 trabalhos</h2><div class="scroll"><table><thead><tr><th>Trabalho</th><th>Tipo</th><th>Commit</th><th>Estado</th><th>Resultado</th><th>Atualizado (UTC)</th></tr></thead><tbody id="jobs"></tbody></table></div></section></main><script>async function refresh(){try{let r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();let d=await r.json();document.getElementById('state').textContent=JSON.stringify({atualizado:d.at,fila_disponivel:d.queue_available,autoridade:d.authority,heartbeat:d.heartbeat_at,contagens:d.counts,replica:d.replication},null,2);let v=d.vigia;document.getElementById('vigia-status').textContent=!v||!v.available?'Resumo do Vigia indisponível.':(v.stale?'Resumo antigo: não comprova atividade atual. ':'Resumo recente exportado pelo Vigia. ')+'Última exportação: '+v.exported_at;let vb=document.getElementById('vigia-tasks');vb.replaceChildren();for(let t of (v&&v.available?v.tasks:[])){let tr=document.createElement('tr');for(let value of [t.title,t.state,t.stage,t.progress===null?'Não informado':typeof t.progress==='number'?t.progress+'%':t.progress,t.eta||'Não informada',t.updated_at||'Não informada']){let td=document.createElement('td');td.textContent=value;tr.append(td)}vb.append(tr)}let body=document.getElementById('jobs');body.replaceChildren();for(let j of d.jobs){let tr=document.createElement('tr');for(let v of [j.id.slice(0,12),j.kind,j.commit?j.commit.slice(0,12):'—',j.state,j.exit_code===null?'—':'exit '+j.exit_code,j.updated_at||'—']){let td=document.createElement('td');td.textContent=v;tr.append(td)}body.append(tr)}}catch(e){document.getElementById('vigia-status').textContent='Sem conexão: os estados abaixo não comprovam atividade atual.';document.getElementById('state').textContent='Conexão indisponível. Os dados desta página não confirmam atividade atual.'}}refresh();setInterval(refresh,10000);</script></html>'''.encode()


class Handler(BaseHTTPRequestHandler):
    server_version = 'PrivateStatus'
    sys_version = ''

    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def log_message(self, *args):
        pass  # Do not store client paths or headers.

    def send(self, code, body=b'', content_type='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header('Connection', 'close')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        self.close_connection = True

    def permitted(self):
        try:
            allowed = ipaddress.ip_address(self.client_address[0]) in ALLOWED
        except ValueError:
            allowed = False
        if not allowed:
            self.send(403, b'Forbidden')
        return allowed

    def do_GET(self):
        if not self.permitted():
            return
        if self.path == '/':
            self.send(200, HTML, 'text/html; charset=utf-8')
        elif self.path == '/api/status':
            self.send(200, json.dumps(status(), ensure_ascii=False).encode(), 'application/json; charset=utf-8')
        else:
            self.send(404, b'Not found')

    do_HEAD = do_GET

    def denied_method(self):
        if self.permitted():
            self.send(405, b'GET and HEAD only')

    def __getattr__(self, name):
        if name.startswith('do_'):
            return self.denied_method
        raise AttributeError(name)


class Server(ThreadingHTTPServer):
    daemon_threads = True


class Server6(Server):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def serve():
    servers = []
    started = []
    try:
        for host in BIND:
            server = (Server6 if ':' in host else Server)((host, PORT), Handler)
            servers.append(server)
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            started.append(server)
        stopped = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stopped.set())
        signal.signal(signal.SIGINT, lambda *_: stopped.set())
        stopped.wait()
    finally:
        for server in servers:
            if server in started:
                server.shutdown()
            server.server_close()


if __name__ == '__main__':
    serve()
