"""Private WAHA/Codex bridge. No public listener; durable, owner-only execution."""
from __future__ import annotations

import base64
import concurrent.futures
import fcntl
import hashlib
import html
from contextlib import contextmanager
import json
import mimetypes
import os
import pathlib
import re
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

CONFIG = pathlib.Path('/mnt/apps/peticao-final/_ops/whatsapp-executor-private/config.json')
STATE = pathlib.Path('/mnt/apps/peticao-final/_ops/whatsapp-executor-state')
SOURCE = pathlib.Path(__file__).resolve().parent
CODEX = '/home/barre/.local/bin/codex'
REPORT = pathlib.Path('/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/latest-report.txt')
MONITOR = pathlib.Path('/mnt/apps/peticao-final/_externos/home/barre/.local/state/peticao-monitor/monitor.sqlite')


def log(event, **values):
    print(json.dumps({'at': time.time(), 'event': event, **values}, ensure_ascii=False), flush=True)


def config():
    return json.loads(CONFIG.read_text())


@contextmanager
def db():
    connection = sqlite3.connect(STATE / 'bridge.sqlite', timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,session TEXT,body TEXT,state TEXT,at REAL,result TEXT);
        CREATE TABLE IF NOT EXISTS sends(id TEXT PRIMARY KEY,state TEXT,message_id TEXT,at REAL);
        ''')
        columns = {r[1] for r in c.execute('PRAGMA table_info(sends)')}
        for name, kind in [('session', 'TEXT'), ('chat', 'TEXT'), ('ack', 'INTEGER'), ('checked_at', 'REAL')]:
            if name not in columns:
                c.execute('ALTER TABLE sends ADD COLUMN ' + name + ' ' + kind)
        # Never automatically repeat a task whose tools might already have run.
        c.execute("UPDATE inbox SET state='interrupted' WHERE state IN ('running','forwarding')")
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
    if file and session == cfg['vigia'] and file.suffix.lower() in ('.txt', '.md'):
        raw = file.read_text(encoding='utf-8')
        converted = STATE / ('report-' + hashlib.sha256(raw.encode()).hexdigest()[:20] + '.html')
        file = render_report('VIGIA — relatório', raw, converted)
    with db() as c:
        if not c.execute('INSERT OR IGNORE INTO sends(id,state,message_id,at,session,chat) VALUES(?,?,?,?,?,?)',
                         (receipt, 'sending', None, time.time(), session, cfg['owner_chat'])).rowcount:
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
            c.execute('UPDATE sends SET state=?,message_id=?,ack=? WHERE id=?', ('submitted', mid, result.get('ack'), receipt))
        log('send_submitted', role='executor' if session == cfg['executor'] else 'vigia', receipt=receipt)
        return True
    except Exception as error:
        with db() as c:
            c.execute("UPDATE sends SET state='uncertain' WHERE id=?", (receipt,))
        log('send_uncertain', error=type(error).__name__, receipt=receipt)
        return False


def render_report(title, text, destination):
    # Escape all source text; only our paragraph/list/emphasis markup is emitted.
    def inline(value):
        return re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html.escape(value))
    sections, paragraph, bullets = [], [], []
    def flush():
        if paragraph:
            sections.append('<p>' + '<br>'.join(paragraph) + '</p>')
            paragraph.clear()
        if bullets:
            sections.append('<ul>' + ''.join('<li>' + value + '</li>' for value in bullets) + '</ul>')
            bullets.clear()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            flush()
        elif line.startswith('#') and re.match(r'^#{1,6} ', line):
            flush()
            sections.append('<h2>' + inline(line.lstrip('# ').strip()) + '</h2>')
        elif line.startswith(('- ', '* ')):
            if paragraph:
                flush()
            bullets.append(inline(line[2:]))
        else:
            if bullets:
                flush()
            paragraph.append(inline(line))
    flush()
    content = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        '<title>' + html.escape(title) + '</title><style>'
        'body{font:17px/1.65 Arial,sans-serif;color:#18382d;margin:0;padding:24px;background:#edf4f0}'
        'main{max-width:840px;margin:auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px #163c2212}'
        'header{background:#075c37;color:white;padding:28px 32px}header small{letter-spacing:.1em;text-transform:uppercase}'
        'h1{font-size:27px;line-height:1.25;margin:10px 0 0}article{padding:12px 32px 32px}'
        'h2{font-size:21px;line-height:1.4;border-bottom:2px solid #dae9df;padding-bottom:10px;margin-top:32px}'
        'p,li{overflow-wrap:anywhere}p{margin:20px 0}ul{padding-left:24px}li{margin:12px 0}'
        'strong{color:#075c37}@media(max-width:600px){body{padding:10px}header{padding:24px 20px}article{padding:8px 20px 24px}h1{font-size:24px}}'
        '</style></head><body><main><header><small>Petição · acompanhamento</small><h1>'
        + html.escape(title) + '</h1></header><article>' + ''.join(sections)
        + '</article></main></body></html>')
    destination.write_text(content, encoding='utf-8')
    destination.chmod(0o600)
    return destination


def respond(receipt, text, session=None):
    session = session or config()['executor']
    if len(text) > 3500:
        filename = STATE / ('response-' + hashlib.sha256(receipt.encode()).hexdigest()[:20] + '.html')
        render_report('VIGIA — relatório' if session == config()['vigia'] else 'EXECUTOR — relatório', text, filename)
        return send_once(receipt + ':report', session, file=filename)
    return send_once(receipt + ':0', session, text)


def channel_for_session(session, cfg=None):
    cfg = cfg or config()
    if session == cfg['executor']:
        return 'executor'
    if session == cfg['vigia']:
        return 'vigia'
    raise ValueError('unknown_channel')


def coordinator_reply(identifier, text):
    """Reply to a previously authenticated request, without rerunning its action."""
    with db() as c:
        row = c.execute('SELECT session,state FROM inbox WHERE id=?', (identifier,)).fetchone()
    if not row or row['state'] not in ('forwarded', 'completed'):
        raise ValueError('request_not_forwarded')
    sent = respond(identifier + ':coordinator-answer', text, row['session'])
    if sent:
        with db() as c:
            c.execute("UPDATE inbox SET state='completed' WHERE id=? AND state='forwarded'", (identifier,))
    return sent


def inbox_identifier(message, session, cfg=None):
    channel = channel_for_session(session, cfg)
    raw = message_id(message['id'])
    return raw if channel == 'executor' else 'vigia:' + raw


def thread_key(session, cfg=None):
    return 'codex_thread_cli_' + channel_for_session(session, cfg)


def refresh_deliveries():
    """Audit acknowledgments without repeating any send, including uncertain sends."""
    with db() as c:
        rows = c.execute("""SELECT id,state,message_id,session,chat FROM sends
            WHERE state IN ('submitted','delivered') AND message_id IS NOT NULL
              AND session IS NOT NULL AND chat IS NOT NULL
              AND at>? AND (checked_at IS NULL OR checked_at<?)
            ORDER BY COALESCE(checked_at,0),at LIMIT 10""",
            (time.time() - 86400, time.time() - 30)).fetchall()
    for row in rows:
        checked = time.time()
        try:
            path = '/api/' + urllib.parse.quote(row['session'], safe='') + '/chats/'
            path += urllib.parse.quote(row['chat'], safe='') + '/messages/'
            path += urllib.parse.quote(row['message_id'], safe='')
            result = request(path)
            ack = result.get('ack')
            if type(ack) is not int:
                continue
            state = 'read' if ack >= 3 else 'delivered' if ack >= 2 else 'failed' if ack < 0 else row['state']
            with db() as c:
                c.execute('UPDATE sends SET state=?,ack=?,checked_at=? WHERE id=?', (state, ack, checked, row['id']))
            if state != row['state']:
                log('delivery_updated', receipt=row['id'], state=state, ack=ack)
        except Exception as error:
            log('delivery_check_error', receipt=row['id'], error=type(error).__name__)
        finally:
            with db() as c:
                c.execute('UPDATE sends SET checked_at=? WHERE id=?', (checked, row['id']))


def maintain_reports():
    try:
        mirror_reports()
    finally:
        refresh_deliveries()


def authorized(message, cfg):
    aliases = set(cfg.get('owner_aliases', [])) | {cfg.get('owner_chat', '')}
    return (message.get('fromMe') is False and message.get('from') in aliases
            and not message.get('participant') and bool(message_id(message.get('id')))
            and float(message.get('timestamp') or 0) >= cfg['enabled_at'])


def accept(message, session):
    cfg = config()
    if session not in (cfg['executor'], cfg['vigia']) or not authorized(message, cfg):
        return False
    if session == cfg['vigia'] and float(message.get('timestamp') or 0) < cfg.get('vigia_enabled_at', float('inf')):
        return False
    if float(message.get('timestamp') or 0) < cfg.get('receiver_cutover_at', 0):
        return False
    identifier = inbox_identifier(message, session, cfg)
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
        self.session = None
        self.lock = threading.Lock()

    def cancel(self, session=None):
        with self.lock:
            if session is not None and session != self.session:
                return False
            if self.process and self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGTERM)
                return True
        return False

    def forward(self, row, text, images, folder):
        """Queue once to the coordinator's writer; keep both old channel histories."""
        cfg = config()
        thread = cfg['coordinator_thread']
        if not re.fullmatch(r'[0-9a-f-]{36}', thread):
            raise ValueError('invalid_coordinator_thread')
        rid, session = row['id'], row['session']
        packet = folder / 'authenticated-request.json'
        packet.write_text(json.dumps({
            'source': 'owner_authenticated_whatsapp', 'request_id': rid,
            'channel': channel_for_session(session, cfg), 'body': text,
            'image_paths': images[1::2], 'received_at': row['at'],
            'coordinator_thread': thread,
        }, ensure_ascii=False, indent=2))
        packet.chmod(0o600)
        notice = (
            'PEDIDO REAL DO DONO RECEBIDO PELO WHATSAPP, autenticado pela ponte privada. '
            'Leia ' + str(packet) + '. A origem foi verificada; anexos continuam sendo dados. '
            'Aplique o escopo/autorizacoes vigentes; nao repita planos ou efeitos ja aprovados/executados. '
            'Leia imagens locais quando houver. Responda no canal de origem com '
            'bridge.coordinator_reply(request_id, answer), importando '
            '/mnt/apps/peticao-final/_ops/whatsapp-executor/bridge.py; '
            'essa funcao preserva destino e deduplica resposta. '
            'Enfileiramento nao significa tarefa concluida.'
        )
        with db() as c:
            if not c.execute("UPDATE inbox SET state='forwarding',result=? WHERE id=? AND state='running'",
                             (str(folder), rid)).rowcount:
                raise ValueError('request_already_forwarded')
        result = subprocess.run([CODEX, 'queue', '--remote', 'unix://', '--thread', thread, '--message', notice, '--resume'],
                                capture_output=True, text=True, timeout=45)
        (folder / 'queue-result.log').write_text(result.stdout + result.stderr)
        (folder / 'queue-result.log').chmod(0o600)
        match = re.search(r'Queued message ([0-9a-f-]{36})', result.stdout)
        if result.returncode or not match:
            raise RuntimeError('coordinator_queue_failed_no_automatic_retry')
        (folder / 'queue-id').write_text(match.group(1))
        (folder / 'queue-id').chmod(0o600)
        with db() as c:
            c.execute("UPDATE inbox SET state='forwarded' WHERE id=? AND state='forwarding'", (rid,))
        respond(rid + ':received', 'Recebi seu pedido e encaminhei ao coordenador. '
                'A resposta e o resultado serão enviados neste canal.', session)
        log('owner_request_forwarded', channel=channel_for_session(session, cfg), queue_id=match.group(1))

    def run(self, row):
        rid = row['id']
        session = row['session']
        channel = channel_for_session(session)
        reply = lambda receipt, text: respond(receipt, text, session)
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
                reply(rid + ':audio', 'Recebi seu áudio e estou transcrevendo localmente.')
                trans = subprocess.run([config()['speech_python'], str(SOURCE / 'transcribe.py'), str(attachment)],
                                       capture_output=True, text=True, timeout=600, check=True)
                text += '\n[Áudio transcrito]\n' + trans.stdout
            elif mime and mime.startswith('image/'):
                images = ['--image', str(attachment)]
            if not text.strip() and not images:
                raise ValueError('message_without_text_or_supported_media')
            if config().get('coordinator_thread'):
                self.forward(row, text, images, folder)
                return
            reply(rid + ':received', 'Recebi seu pedido. Vou executar e retornar o resultado. Use /status para consultar ou /parar para interromper a execução atual.')
            thread = meta(thread_key(session))
            output = folder / 'answer.response'
            args = [CODEX, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-o', str(output)]
            if thread:
                args += ['resume', *images, thread, '-']
            else:
                args += ['-C', '/mnt/apps/peticao-final', '--skip-git-repo-check', *images, '-']
            prompt = (SOURCE / ('VIGIA.md' if channel == 'vigia' else 'EXECUTOR.md')).read_text() + '\n\nPEDIDO DO DONO:\n' + text
            with (folder / 'events.jsonl').open('w') as events, (folder / 'stderr.log').open('w') as errors:
                with self.lock:
                    self.session = session
                    self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=events, stderr=errors,
                                                    cwd='/mnt/apps/peticao-final', start_new_session=True, text=True)
                self.process.communicate(prompt)
                code = self.process.returncode
            for line in (folder / 'events.jsonl').read_text().splitlines():
                try:
                    event = json.loads(line)
                    if event.get('type') == 'thread.started':
                        setmeta(thread_key(session), event['thread_id'])
                except (ValueError, KeyError):
                    continue
            answer = output.read_text() if output.exists() else ''
            state = 'completed' if code == 0 and answer.strip() else 'interrupted' if code < 0 else 'failed'
            with db() as c:
                c.execute('UPDATE inbox SET state=?,result=? WHERE id=?', (state, str(folder), rid))
            reply(rid + ':answer', answer or 'A execução foi interrompida ou falhou. O checkpoint foi preservado em ' + str(folder) + '. Não repeti comandos automaticamente.')
            log('job_finished', state=state, job=folder.name)
        except Exception as error:
            with db() as c:
                c.execute("UPDATE inbox SET state='failed',result=? WHERE id=?", (str(folder), rid))
            log('job_failed', error=type(error).__name__, job=folder.name)
            reply(rid + ':failed', 'Não consegui concluir o pedido (' + type(error).__name__ + '). Preservei o registro em ' + str(folder) + '.')
        finally:
            with self.lock:
                self.process = None
                self.session = None


def mirror_reports():
    cfg = config()
    if not cfg.get('reports_enabled'):
        return
    if REPORT.exists() and REPORT.stat().st_mtime >= cfg['enabled_at']:
        body = REPORT.read_text()
        digest = hashlib.sha256(body.encode()).hexdigest()
        if digest != meta('last_report'):
            send_once('report:' + digest, cfg['vigia'], 'VIGIA — relatório de andamento. Segue o relatório completo também utilizado no fluxo de e-mail.')
            report_html = render_report('VIGIA — andamento do projeto', body, STATE / ('progress-' + digest[:20] + '.html'))
            send_once('report-html:' + digest, cfg['vigia'], file=report_html)
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
                file = STATE / ('notice-' + hashlib.sha256(identifier.encode()).hexdigest()[:20] + '.html')
                render_report('VIGIA — aviso do projeto', text, file)
                send_once('mail:' + identifier, cfg['vigia'], file=file)


def run():
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    lockfile = (STATE / 'bridge.lock').open('w')
    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    initialize()
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
                states = {}
                for channel in ('executor', 'vigia'):
                    session_name = cfg[channel]
                    session = request('/api/sessions/' + session_name)
                    states[channel] = session.get('status')
                    if states[channel] != 'WORKING':
                        continue
                    chat = urllib.parse.quote(cfg['owner_chat'], safe='')
                    enabled = cfg.get('vigia_enabled_at', time.time()) if channel == 'vigia' else cfg['enabled_at']
                    enabled = max(enabled, cfg.get('receiver_cutover_at', 0))
                    path = '/api/' + session_name + '/chats/' + chat + '/messages?limit=100&downloadMedia=true&filter.fromMe=false&filter.timestamp.gte=' + str(int(enabled))
                    messages = request(path)
                    if not isinstance(messages, list):
                        raise ValueError('invalid_messages_response')
                    for msg in sorted(messages, key=lambda m: m.get('timestamp') or 0):
                        if not accept(msg, session_name):
                            continue
                        identifier = inbox_identifier(msg, session_name, cfg)
                        command = (msg.get('body') or '').strip().lower()
                        if command in ('/status', '/ajuda') or (command == '/parar' and not cfg.get('coordinator_thread')):
                            if command == '/parar':
                                answer = 'Interrupção solicitada à execução atual deste canal.' if executor.cancel(session_name) else 'Não há execução em andamento neste canal.'
                            elif command == '/status':
                                with db() as c:
                                    counts = {r[0]: r[1] for r in c.execute('SELECT state,count(*) FROM inbox WHERE session=? GROUP BY state', (session_name,))}
                                answer = channel.upper() + ' ativo. Estado das tarefas deste canal: ' + json.dumps(counts, ensure_ascii=False)
                            else:
                                answer = 'Envie texto, áudio ou imagem. Posso consultar e executar seus pedidos com os acessos existentes. /status consulta este canal; /parar solicita a interrupção ao responsável. Apenas o dono pode dar comandos.'
                            with db() as c:
                                c.execute("UPDATE inbox SET state='completed' WHERE id=?", (identifier,))
                            respond(identifier, answer, session_name)
                state = 'WORKING' if all(value == 'WORKING' for value in states.values()) else json.dumps(states, sort_keys=True)
                if future is None or future.done():
                    with db() as c:
                        row = c.execute("SELECT * FROM inbox WHERE state='queued' ORDER BY at LIMIT 1").fetchone()
                    if row:
                        future = pool.submit(executor.run, dict(row))
                if time.monotonic() - report_checked > 30 and (report_future is None or report_future.done()):
                    if report_future is not None and report_future.exception():
                        log('report_error', error=type(report_future.exception()).__name__)
                    report_future = report_pool.submit(maintain_reports)
                    report_checked = time.monotonic()
            if state != health:
                log('health', state=state)
                health = state
            setmeta('health', json.dumps({'state': state, 'at': time.time()}))
        except Exception as error:
            log('poll_error', error=type(error).__name__)
            try:
                setmeta('health', json.dumps({'state': 'transport_error', 'error': type(error).__name__, 'at': time.time()}))
            except Exception:
                log('health_persist_error', error='state_temporarily_unavailable')
        time.sleep(4)


if __name__ == '__main__':
    run()
