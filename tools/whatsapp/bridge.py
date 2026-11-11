"""Private WAHA/Codex bridge. No public listener; durable, owner-only execution."""
from __future__ import annotations

import base64
import concurrent.futures
import fcntl
import hashlib
import json
import mimetypes
import os
import pathlib
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

CONFIG = pathlib.Path('/home/barre/.config/whatsapp-executor/config.json')
STATE = pathlib.Path('/mnt/dev/peticao/.cache/whatsapp-executor/state')
SOURCE = pathlib.Path(__file__).resolve().parent
CODEX = '/home/barre/.local/bin/codex'
REPORT = pathlib.Path('/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/latest-report.txt')
MONITOR = pathlib.Path('/mnt/apps/peticao-final/_externos/home/barre/.local/state/peticao-monitor/monitor.sqlite')


def log(event, **values):
    print(json.dumps({'at': time.time(), 'event': event, **values}, ensure_ascii=False), flush=True)


def config():
    return json.loads(CONFIG.read_text())


def db():
    connection = sqlite3.connect(STATE / 'bridge.sqlite', timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,session TEXT,body TEXT,state TEXT,at REAL,result TEXT);
        CREATE TABLE IF NOT EXISTS sends(id TEXT PRIMARY KEY,state TEXT,message_id TEXT,at REAL);
        ''')
        # Never automatically repeat a task whose tools might already have run.
        c.execute("UPDATE inbox SET state='interrupted' WHERE state='running'")
        c.execute("UPDATE sends SET state='uncertain' WHERE state='sending'")


def meta(key, default=None):
    with db() as c:
        row = c.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


def setmeta(key, value):
    with db() as c:
        c.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (key, str(value)))


def request(path, data=None):
    cfg = config()
    req = urllib.request.Request(cfg['api_url'] + path,
        headers={'X-Api-Key': cfg['api_key'], 'Content-Type': 'application/json'},
        data=json.dumps(data).encode() if data is not None else None)
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)


def message_id(value):
    if isinstance(value, dict):
        return value.get('_serialized') or value.get('id')
    return value


def send_once(receipt, session, text=None, file=None):
    cfg = config()
    if not cfg.get('owner_chat'):
        return False
    with db() as c:
        if not c.execute('INSERT OR IGNORE INTO sends VALUES(?,?,?,?)',
                         (receipt, 'sending', None, time.time())).rowcount:
            return False
    try:
        body = {'session': session, 'chatId': cfg['owner_chat']}
        if file:
            body['file'] = {'mimetype': mimetypes.guess_type(file.name)[0] or 'application/octet-stream',
                            'filename': file.name, 'data': base64.b64encode(file.read_bytes()).decode()}
            result = request('/api/sendFile', body)
        else:
            body['text'] = text
            result = request('/api/sendText', body)
        mid = message_id(result.get('id'))
        with db() as c:
            c.execute('UPDATE sends SET state=?,message_id=? WHERE id=?', ('submitted', mid, receipt))
        log('send_submitted', role='executor' if session == cfg['executor'] else 'vigia', receipt=receipt)
        return True
    except Exception as error:
        with db() as c:
            c.execute("UPDATE sends SET state='uncertain' WHERE id=?", (receipt,))
        log('send_uncertain', error=type(error).__name__, receipt=receipt)
        return False


def respond(receipt, text):
    for offset in range(0, len(text), 3500):
        send_once(receipt + ':' + str(offset), config()['executor'], text[offset:offset + 3500])


def authorized(message, cfg):
    aliases = set(cfg.get('owner_aliases', [])) | {cfg.get('owner_chat', '')}
    return (message.get('fromMe') is False and message.get('from') in aliases
            and not message.get('participant') and bool(message_id(message.get('id')))
            and float(message.get('timestamp') or 0) >= cfg['enabled_at'])


def accept(message, session):
    cfg = config()
    if session != cfg['executor'] or not authorized(message, cfg):
        return False
    identifier = message_id(message['id'])
    with db() as c:
        return bool(c.execute('INSERT OR IGNORE INTO inbox VALUES(?,?,?,?,?,NULL)',
                    (identifier, session, json.dumps(message), 'queued', time.time())).rowcount)


def download_media(message, folder):
    media = message.get('media') or {}
    if not message.get('hasMedia') or not media.get('url'):
        return None, None
    url = urllib.parse.urlsplit(media['url'])
    cfg = config()
    # Media URLs come from WAHA; never send its key to an external hostname.
    if url.hostname not in ('localhost', '127.0.0.1', '100.115.154.25'):
        raise ValueError('untrusted_media_origin')
    if not url.path.startswith('/api/files/'):
        raise ValueError('untrusted_media_path')
    mime = media.get('mimetype', '').split(';')[0]
    if not mime.startswith(('image/', 'audio/')):
        raise ValueError('unsupported_media_type')
    suffix = mimetypes.guess_extension(mime) or '.bin'
    dest = folder / ('attachment' + suffix)
    req = urllib.request.Request(cfg['api_url'] + url.path + ('?' + url.query if url.query else ''),
                                 headers={'X-Api-Key': cfg['api_key']})
    # urllib redirects are prohibited so keys never follow an untrusted redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as r:
        content = r.read(25 * 1024 * 1024 + 1)
    if len(content) > 25 * 1024 * 1024:
        raise ValueError('attachment_too_large')
    dest.write_bytes(content)
    return dest, mime


class Executor:
    def __init__(self):
        self.process = None
        self.lock = threading.Lock()

    def cancel(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGTERM)
                return True
        return False

    def run(self, row):
        rid = row['id']
        with db() as c:
            changed = c.execute("UPDATE inbox SET state='running' WHERE id=? AND state='queued'", (rid,)).rowcount
        if not changed:
            return
        folder = STATE / 'jobs' / uuid.uuid4().hex
        folder.mkdir(parents=True, mode=0o700)
        message = json.loads(row['body'])
        try:
            text = message.get('body') or ''
            attachment, mime = download_media(message, folder)
            images = []
            if mime and mime.startswith('audio/'):
                respond(rid + ':audio', 'Recebi seu áudio e estou transcrevendo localmente.')
                trans = subprocess.run([config()['speech_python'], str(SOURCE / 'transcribe.py'), str(attachment)],
                                       capture_output=True, text=True, timeout=600, check=True)
                text += '\n[Áudio transcrito]\n' + trans.stdout
            elif mime and mime.startswith('image/'):
                images = ['--image', str(attachment)]
            if not text.strip() and not images:
                raise ValueError('message_without_text_or_supported_media')
            respond(rid + ':received', 'Recebi seu pedido. Vou executar e retornar o resultado. Use /status para consultar ou /parar para interromper a execução atual.')
            thread = meta('codex_thread')
            output = folder / 'answer.txt'
            args = [CODEX, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-o', str(output)]
            if thread:
                args += ['resume', *images, thread, '-']
            else:
                args += ['-C', '/mnt/apps/peticao-final', '--skip-git-repo-check', *images, '-']
            prompt = (SOURCE / 'EXECUTOR.md').read_text() + '\n\nPEDIDO DO DONO:\n' + text
            with (folder / 'events.jsonl').open('w') as events, (folder / 'stderr.log').open('w') as errors:
                with self.lock:
                    self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=events, stderr=errors,
                                                    cwd='/mnt/apps/peticao-final', start_new_session=True, text=True)
                self.process.communicate(prompt)
                code = self.process.returncode
            for line in (folder / 'events.jsonl').read_text().splitlines():
                try:
                    event = json.loads(line)
                    if event.get('type') == 'thread.started':
                        setmeta('codex_thread', event['thread_id'])
                except (ValueError, KeyError):
                    continue
            answer = output.read_text() if output.exists() else ''
            state = 'completed' if code == 0 and answer.strip() else 'interrupted' if code < 0 else 'failed'
            with db() as c:
                c.execute('UPDATE inbox SET state=?,result=? WHERE id=?', (state, str(folder), rid))
            respond(rid + ':answer', answer or 'A execução foi interrompida ou falhou. O checkpoint foi preservado em ' + str(folder) + '. Não repeti comandos automaticamente.')
            log('job_finished', state=state, job=folder.name)
        except Exception as error:
            with db() as c:
                c.execute("UPDATE inbox SET state='failed',result=? WHERE id=?", (str(folder), rid))
            log('job_failed', error=type(error).__name__, job=folder.name)
            respond(rid + ':failed', 'Não consegui concluir o pedido (' + type(error).__name__ + '). Preservei o registro em ' + str(folder) + '.')
        finally:
            with self.lock:
                self.process = None


def mirror_reports():
    cfg = config()
    if not cfg.get('reports_enabled'):
        return
    if REPORT.exists() and REPORT.stat().st_mtime >= cfg['enabled_at']:
        body = REPORT.read_text()
        digest = hashlib.sha256(body.encode()).hexdigest()
        if digest != meta('last_report'):
            send_once('report:' + digest, cfg['vigia'], 'VIGIA — relatório de andamento. Segue o relatório completo também utilizado no fluxo de e-mail.')
            send_once('report-file:' + digest, cfg['vigia'], file=REPORT)
            html = REPORT.with_suffix('.html')
            if html.exists():
                send_once('report-html:' + digest, cfg['vigia'], file=html)
            setmeta('last_report', digest)
    if MONITOR.exists():
        with sqlite3.connect('file:' + str(MONITOR) + '?mode=ro', uri=True, timeout=2) as c:
            rows = c.execute("SELECT id,at,subject,body FROM outbox WHERE state='accepted' AND at>? ORDER BY at LIMIT 100",
                             (time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(cfg['enabled_at'])),)).fetchall()
        for identifier, at, subject, body in rows:
            text = 'VIGIA — ' + subject + '\n\n' + body
            if len(text) <= 3500:
                send_once('mail:' + identifier, cfg['vigia'], text)
            else:
                file = STATE / ('notice-' + hashlib.sha256(identifier.encode()).hexdigest()[:20] + '.txt')
                file.write_text(text)
                send_once('mail:' + identifier, cfg['vigia'], file=file)


def run():
    os.umask(0o077)
    initialize()
    lockfile = (STATE / 'bridge.lock').open('w')
    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    executor = Executor()
    signal.signal(signal.SIGTERM, lambda *_: (executor.cancel(), exit(0)))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    report_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = None
    report_future = None
    report_checked = 0
    health = None
    while True:
        try:
            cfg = config()
            if not cfg.get('owner_chat'):
                state = 'waiting_owner'
            else:
                session = request('/api/sessions/' + cfg['executor'])
                state = session.get('status')
                if state == 'WORKING':
                    chat = urllib.parse.quote(cfg['owner_chat'], safe='')
                    path = '/api/' + cfg['executor'] + '/chats/' + chat + '/messages?limit=100&downloadMedia=true&filter.fromMe=false&filter.timestamp.gte=' + str(int(cfg['enabled_at']))
                    messages = request(path)
                    if not isinstance(messages, list):
                        raise ValueError('invalid_messages_response')
                    for msg in sorted(messages, key=lambda m: m.get('timestamp') or 0):
                        if not accept(msg, cfg['executor']):
                            continue
                        identifier = message_id(msg['id'])
                        command = (msg.get('body') or '').strip().lower()
                        if command in ('/status', '/parar', '/ajuda'):
                            if command == '/parar':
                                answer = 'Interrupção solicitada à execução atual.' if executor.cancel() else 'Não há execução em andamento.'
                            elif command == '/status':
                                with db() as c:
                                    counts = {r[0]: r[1] for r in c.execute('SELECT state,count(*) FROM inbox GROUP BY state')}
                                answer = 'EXECUTOR ativo. Estado das tarefas: ' + json.dumps(counts, ensure_ascii=False)
                            else:
                                answer = 'Envie texto, áudio ou imagem com seu pedido. /status consulta a fila; /parar interrompe a execução atual. Apenas seu número pode dar comandos.'
                            with db() as c:
                                c.execute("UPDATE inbox SET state='completed' WHERE id=?", (identifier,))
                            respond(identifier, answer)
                    if future is None or future.done():
                        with db() as c:
                            row = c.execute("SELECT * FROM inbox WHERE state='queued' ORDER BY at LIMIT 1").fetchone()
                        if row:
                            future = pool.submit(executor.run, dict(row))
                if time.monotonic() - report_checked > 30 and (report_future is None or report_future.done()):
                    if report_future is not None and report_future.exception():
                        log('report_error', error=type(report_future.exception()).__name__)
                    report_future = report_pool.submit(mirror_reports)
                    report_checked = time.monotonic()
            if state != health:
                log('health', state=state)
                health = state
            setmeta('health', json.dumps({'state': state, 'at': time.time()}))
        except Exception as error:
            log('poll_error', error=type(error).__name__)
            setmeta('health', json.dumps({'state': 'transport_error', 'error': type(error).__name__, 'at': time.time()}))
        time.sleep(4)


if __name__ == '__main__':
    run()
