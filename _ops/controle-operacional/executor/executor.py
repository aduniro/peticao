#!/usr/bin/python3
"""Authenticated inbound spool and fixture-only bridge to existing sessions.

No SMTP, shell, app-server startup, thread resume or live Codex submission.
"""
from __future__ import annotations
import argparse
import contextlib
import dataclasses
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import unicodedata
import uuid

OWNER = 'operator-1608598f41@example.invalid'
MAX_BODY = 128 * 1024
MAX_INSTRUCTION = 8192
ALIASES = {'ADMIN', 'PAGINA', 'APOIO', 'GERAL', 'STATUS', 'LISTAR'}
STATES = {'received', 'authenticated', 'queued', 'submitted', 'waiting', 'completed', 'rejected', 'failed', 'uncertain'}
REASONS = {
    'queued': 'Pedido autenticado e registrado na fila.',
    'bridge_unqualified': 'A ponte para a sessão existente ainda não foi qualificada. O pedido permanece na fila.',
    'session_unavailable': 'A máquina, sessão ou IA está indisponível. O pedido permanece na fila.',
    'session_busy': 'A sessão está ocupada; não foi iniciada outra execução.',
    'session_paused': 'A sessão está pausada. A pausa foi preservada.',
    'safety_blocked': 'A sessão possui um bloqueio de segurança. O pedido não será encaminhado por outro caminho.',
    'limits_exhausted': 'A sessão está sem capacidade disponível. Nenhum limite será contornado.',
    'provider_model_mismatch': 'A configuração de provedor/modelo não corresponde à sessão qualificada.',
    'submission_uncertain': 'Não foi possível confirmar o encaminhamento. Não haverá repetição automática; é necessária reconciliação.',
    'submitted': 'Encaminhamento aceito pela ponte; aguardando resultado correlacionado.',
    'failed': 'A operação falhou de forma confirmada. Consulte este mesmo identificador.',
    'rejected': 'O pedido foi recusado pela validação ou pelas permissões existentes.',
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def alias(value):
    if not isinstance(value, str):
        raise ValueError('invalid_alias')
    normalized = ''.join(c for c in unicodedata.normalize('NFD', value.upper()) if unicodedata.category(c) != 'Mn')
    normalized = {'ADMIN-V2':'ADMIN','HOMEPAGE':'PAGINA'}.get(normalized,normalized)
    if normalized not in ALIASES:
        raise ValueError('invalid_alias')
    return normalized


def routing_metadata(chosen):
    return {'global_scope': chosen == 'GERAL', 'coordinator_alias': 'ADMIN' if chosen == 'GERAL' else chosen, 'children_implemented': False}


def token(value, name):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,128}', value):
        raise ValueError('invalid_' + name)
    return value


def owner_envelope(data):
    return {k: data[k] for k in ('owner_account_id', 'owner_key_id', 'from', 'recipient', 'request_id', 'alias', 'instruction', 'issued_at', 'owner_nonce')}


def owner_signature(key, data):
    return hmac.new(key, b'owner-v1\n' + canonical(owner_envelope(data)), hashlib.sha256).hexdigest()


def webhook_signature(key, provider, timestamp, nonce, body):
    prefix = f'webhook-v1\n{provider}\n{timestamp}\n{nonce}\n'.encode()
    return hmac.new(key, prefix + body, hashlib.sha256).hexdigest()


@dataclasses.dataclass(frozen=True)
class Config:
    provider_id: str
    provider_account_id: str
    provider_key: bytes
    owner_account_id: str
    owner_key_id: str
    owner_key: bytes
    mailbox: str
    threads: dict
    expected_provider: str
    expected_model: str
    approval_key: bytes | None = None

    def __post_init__(self):
        if min(len(self.provider_key), len(self.owner_key)) < 32:
            raise ValueError('keys_require_256_bits')
        if self.provider_key == self.owner_key:
            raise ValueError('independent_keys_required')
        if self.approval_key is not None and (len(self.approval_key) < 32 or self.approval_key in {self.provider_key, self.owner_key}):
            raise ValueError('independent_approval_key_required')
        if set(self.threads) != {'ADMIN', 'PAGINA', 'APOIO'}:
            raise ValueError('fixed_thread_aliases_required')
        for thread in self.threads.values():
            uuid.UUID(thread)
        if not self.expected_provider or not self.expected_model or '@' not in self.mailbox:
            raise ValueError('missing_pairing_configuration')

    @classmethod
    def load(cls, filename):
        path = Path(filename)
        if not path.is_absolute() or path.is_symlink() or path.stat().st_mode & 0o077:
            raise PermissionError('private_absolute_configuration_required')
        value = json.loads(path.read_text())
        if value.pop('owner_email', OWNER) != OWNER:
            raise ValueError('owner_recipient_is_fixed')
        for name in ('provider_key', 'owner_key', 'approval_key'):
            if value.get(name) is not None:
                value[name] = bytes.fromhex(value[name])
        return cls(**value)


class IngressError(Exception):
    def __init__(self, code, trace_id=None):
        self.code, self.trace_id = code, trace_id or uuid.uuid4().hex
        super().__init__(code)


class DisabledLiveAdapter:
    """Intentionally no transport: attaching to the existing instance is unproven."""
    mode = 'live-disabled'

    def probe(self, thread_id):
        return {'ready': False, 'reason': 'bridge_unqualified'}

    def submit(self, *args, **kwargs):
        raise RuntimeError('live_bridge_disabled')

    def poll(self, *args, **kwargs):
        raise RuntimeError('live_bridge_disabled')


class FixtureAdapter:
    """Deterministic fake interface, not a live Codex transport."""
    mode = 'fixture'

    def __init__(self, provider='fixture-provider', model='fixture-model', condition='ready', outcome='accepted'):
        self.provider, self.model = provider, model
        self.condition, self.outcome = condition, outcome
        self.submissions = []
        self.submission_metadata = []

    def probe(self, thread_id):
        return {'ready': self.condition == 'ready', 'reason': self.condition if self.condition != 'ready' else None, 'existing_session': True, 'exclusive': True, 'state': 'idle', 'provider': self.provider, 'model': self.model, 'global_scope_supported': True}

    def submit(self, thread_id, request_id, instruction, metadata=None):
        self.submissions.append((thread_id, request_id, instruction))
        self.submission_metadata.append(metadata or {})
        if self.outcome == 'transport-error':
            raise TimeoutError('fixture_loss_after_write')
        return {'state': self.outcome, 'receipt': 'fixture:' + request_id}

    def poll(self, receipt):
        return {'state': 'completed', 'receipt': receipt, 'answer': 'Resultado fictício correlacionado; nenhuma sessão real foi acionada.'}


class Executor:
    def __init__(self, database, config, adapter=None):
        self.path, self.config = Path(database), config
        self.adapter = adapter or DisabledLiveAdapter()
        if self.path.is_symlink():
            raise ValueError('database_symlink_refused')
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS requests(
              id TEXT PRIMARY KEY,request_id TEXT UNIQUE,digest TEXT,alias TEXT,
              thread_id TEXT,instruction TEXT,state TEXT NOT NULL,reason TEXT,
              receipt TEXT,created_at INTEGER,updated_at INTEGER);
            CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
              request_ref TEXT,at INTEGER,state TEXT,reason TEXT);
            CREATE TABLE IF NOT EXISTS provider_nonces(provider TEXT,nonce TEXT,
              at INTEGER,PRIMARY KEY(provider,nonce));
            CREATE TABLE IF NOT EXISTS owner_nonces(nonce TEXT PRIMARY KEY,request_id TEXT);
            CREATE TABLE IF NOT EXISTS inbound_events(event_id TEXT PRIMARY KEY,request_ref TEXT);
            CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,dedup TEXT UNIQUE,
              request_ref TEXT,recipient TEXT,kind TEXT,body TEXT,state TEXT,
              provider_id TEXT,created_at INTEGER,updated_at INTEGER);
            CREATE TABLE IF NOT EXISTS staged(id TEXT PRIMARY KEY,event_id TEXT UNIQUE,
              frozen TEXT,digest TEXT,state TEXT,request_ref TEXT,approved_at INTEGER,
              created_at INTEGER);
            CREATE TABLE IF NOT EXISTS approval_nonces(nonce TEXT PRIMARY KEY,stage_id TEXT);
            ''')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def transition(self, db, ref, state, reason=None):
        if state not in STATES:
            raise ValueError('invalid_state')
        now = int(time.time())
        db.execute('UPDATE requests SET state=?,reason=?,updated_at=? WHERE id=?', (state, reason, now, ref))
        db.execute('INSERT INTO events(request_ref,at,state,reason) VALUES(?,?,?,?)', (ref, now, state, reason))

    def reply(self, db, ref, kind, text):
        now = int(time.time())
        message = f'Pedido {ref}\nEstado: {kind}\n\n{text[:16000]}'
        db.execute('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?,?,?,?,?)', (uuid.uuid4().hex, ref + ':' + kind, ref, OWNER, kind, message, 'pending', None, now, now))

    def verify_provider(self, body, headers, now):
        if not isinstance(body, bytes) or len(body) > MAX_BODY:
            raise IngressError('body_limit')
        headers = {str(k).lower(): str(v) for k, v in headers.items()}
        try:
            provider = headers['x-executor-provider']
            stamp = headers['x-executor-timestamp']
            nonce = token(headers['x-executor-nonce'], 'provider_nonce')
            if provider != self.config.provider_id or abs(now - int(stamp)) > 300:
                raise ValueError('provider_identity_or_time')
            expected = webhook_signature(self.config.provider_key, provider, stamp, nonce, body)
            if not hmac.compare_digest(expected, headers['x-executor-signature']):
                raise ValueError('webhook_signature')
        except (KeyError, ValueError, TypeError):
            raise IngressError('webhook_authentication_failed') from None
        try:
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError('object_required')
        except (ValueError, UnicodeError):
            raise IngressError('invalid_json') from None
        return data, provider, nonce

    def stage(self, body, headers, now=None):
        """Provider-authenticated plain text is DATA until frozen Owner approval."""
        now = int(time.time()) if now is None else now
        data, provider, nonce = self.verify_provider(body, headers, now)
        try:
            event = token(data['provider_event_id'], 'provider_event_id')
            if data['provider_id'] != provider or data['provider_account_id'] != self.config.provider_account_id or data['recipient'] != self.config.mailbox or data['from'] != OWNER:
                raise ValueError('staging_identity_mismatch')
            instruction = data['instruction']
            if not isinstance(instruction, str) or not instruction.strip() or len(instruction.encode()) > MAX_INSTRUCTION:
                raise ValueError('invalid_instruction')
            frozen = {'alias': alias(data['alias']), 'instruction': instruction, 'from': OWNER, 'recipient': self.config.mailbox}
        except (ValueError, KeyError, TypeError):
            raise IngressError('staging_envelope_rejected') from None
        digest = hashlib.sha256(canonical(frozen)).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                db.execute('INSERT INTO provider_nonces VALUES(?,?,?)', (provider, nonce, now))
            except sqlite3.IntegrityError:
                raise IngressError('provider_nonce_replay') from None
            old = db.execute('SELECT id,digest,state FROM staged WHERE event_id=?', (event,)).fetchone()
            if old:
                if old['digest'] != digest:
                    raise IngressError('staging_event_conflict')
                return {'stage_id': old['id'], 'state': old['state'], 'instruction_sha256': digest, 'duplicate': True}
            ident = uuid.uuid4().hex
            db.execute('INSERT INTO staged VALUES(?,?,?,?,?,?,?,?)', (ident, event, canonical(frozen).decode(), digest, 'pending_owner_confirmation', None, None, now))
            self.reply(db, ident, 'pending_owner_confirmation', 'E-mail recebido, mas ainda não autenticado como instrução. Confirme o conteúdo congelado na sessão Owner do console. Nada foi encaminhado. SHA256: ' + digest)
            return {'stage_id': ident, 'state': 'pending_owner_confirmation', 'instruction_sha256': digest}

    def read_staged(self, ident):
        """Internal API only: caller must authorize Owner before displaying DATA."""
        with self.db() as db:
            row = db.execute('SELECT * FROM staged WHERE id=?', (ident,)).fetchone()
            if not row:
                raise ValueError('unknown_stage')
            frozen=json.loads(row['frozen'])
            return {'stage_id': ident, 'state': row['state'], 'instruction_sha256': row['digest'], 'untrusted_frozen_content': frozen, 'metadata':routing_metadata(frozen['alias'])}

    def list_staged(self, limit=100):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('list_limit')
        with self.db() as db:
            rows=db.execute('SELECT * FROM staged ORDER BY created_at DESC,id LIMIT ?',(limit,)).fetchall()
        result=[]
        for row in rows:
            chosen=json.loads(row['frozen'])['alias']
            result.append({'stage_id':row['id'],'state':row['state'],'instruction_sha256':row['digest'],'alias':chosen,'created_at':row['created_at'],'approved_at':row['approved_at'],'request_ref':row['request_ref'],'metadata':routing_metadata(chosen)})
        return result

    def list_status(self, limit=100):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('list_limit')
        with self.db() as db:
            return [self.public(db,row['id']) for row in db.execute('SELECT id FROM requests ORDER BY updated_at DESC,id LIMIT ?',(limit,)).fetchall()]

    def approve_staged(self, assertion, signature, now=None):
        now = int(time.time()) if now is None else now
        if self.config.approval_key is None:
            raise PermissionError('owner_console_approval_not_paired')
        fields = {'issuer', 'owner_account_id', 'stage_id', 'instruction_sha256', 'decision', 'issued_at', 'nonce'}
        if not isinstance(assertion, dict) or set(assertion) != fields:
            raise PermissionError('invalid_approval_assertion')
        expected = hmac.new(self.config.approval_key, b'console-approve-v1\n' + canonical(assertion), hashlib.sha256).hexdigest()
        if not isinstance(signature, str) or not hmac.compare_digest(expected, signature):
            raise PermissionError('invalid_owner_console_signature')
        if assertion['issuer'] != 'owner-console' or assertion['owner_account_id'] != self.config.owner_account_id or assertion['decision'] != 'approve' or type(assertion['issued_at']) is not int or abs(now - assertion['issued_at']) > 120:
            raise PermissionError('approval_identity_or_time')
        approval_nonce = token(assertion['nonce'], 'approval_nonce')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM staged WHERE id=?', (assertion['stage_id'],)).fetchone()
            if not row or row['digest'] != assertion['instruction_sha256']:
                raise PermissionError('approval_frozen_content_mismatch')
            if row['state'] == 'approved':
                return self.public(db, row['request_ref'])
            prior = db.execute('SELECT id FROM requests WHERE request_id=?', ('approved:' + row['id'],)).fetchone()
            if row['state'] == 'confirming' and prior:
                db.execute("UPDATE staged SET state='approved',request_ref=? WHERE id=?", (prior['id'], row['id']))
                return self.public(db, prior['id'])
            try:
                db.execute('INSERT INTO approval_nonces VALUES(?,?)', (approval_nonce, row['id']))
            except sqlite3.IntegrityError:
                raise PermissionError('approval_nonce_replay') from None
            issued_at = row['approved_at'] or now
            db.execute("UPDATE staged SET state='confirming',approved_at=? WHERE id=?", (issued_at, row['id']))
            frozen = json.loads(row['frozen'])
        # Idempotent envelope survives a process crash between ingestion and linking.
        data = {**frozen, 'request_id': 'approved:' + row['id'], 'owner_nonce': 'approved:' + row['id'], 'issued_at': issued_at, 'owner_account_id': self.config.owner_account_id, 'owner_key_id': self.config.owner_key_id, 'provider_id': self.config.provider_id, 'provider_account_id': self.config.provider_account_id, 'provider_event_id': 'approved:' + row['id']}
        data['owner_signature'] = owner_signature(self.config.owner_key, data)
        body = canonical(data)
        nonce = uuid.uuid4().hex
        headers = {'x-executor-provider': self.config.provider_id, 'x-executor-timestamp': str(now), 'x-executor-nonce': nonce, 'x-executor-signature': webhook_signature(self.config.provider_key, self.config.provider_id, str(now), nonce, body)}
        result = self.ingest(body, headers, now=now)
        with self.db() as db:
            db.execute('UPDATE staged SET state=?,request_ref=? WHERE id=?', ('approved' if result['state'] != 'rejected' else 'confirmation_failed', result['id'], row['id']))
        return result

    def public(self, db, ref):
        row = db.execute('SELECT id,request_id,alias,state,reason,created_at,updated_at FROM requests WHERE id=?', (ref,)).fetchone()
        return {**dict(row),'metadata':routing_metadata(row['alias'])} if row else None

    def ingest(self, body, headers, now=None):
        now = int(time.time()) if now is None else now
        data, provider, nonce = self.verify_provider(body, headers, now)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                db.execute('INSERT INTO provider_nonces VALUES(?,?,?)', (provider, nonce, now))
            except sqlite3.IntegrityError:
                raise IngressError('provider_nonce_replay') from None
            ref = uuid.uuid4().hex
            try:
                request_id = token(data['request_id'], 'request_id')
                owner_nonce = token(data['owner_nonce'], 'owner_nonce')
                event_id = token(data['provider_event_id'], 'provider_event_id')
                chosen = alias(data['alias'])
                instruction = data['instruction']
                if not isinstance(instruction, str) or len(instruction.encode()) > MAX_INSTRUCTION:
                    raise ValueError('instruction_limit')
                if data['provider_id'] != provider or data['provider_account_id'] != self.config.provider_account_id or data['recipient'] != self.config.mailbox:
                    raise ValueError('provider_account_or_mailbox')
                if data['owner_account_id'] != self.config.owner_account_id or data['owner_key_id'] != self.config.owner_key_id or data['from'] != OWNER:
                    raise ValueError('owner_pairing')
                if type(data['issued_at']) is not int or abs(now - data['issued_at']) > 300:
                    raise ValueError('owner_proof_expired')
                if not hmac.compare_digest(owner_signature(self.config.owner_key, data), data['owner_signature']):
                    raise ValueError('owner_signature')
                digest = hashlib.sha256(canonical(owner_envelope(data))).hexdigest()
                previous = db.execute('SELECT id,digest FROM requests WHERE request_id=?', (request_id,)).fetchone()
                if previous:
                    if previous['digest'] != digest:
                        raise ValueError('request_id_conflict')
                    db.execute('INSERT OR IGNORE INTO inbound_events VALUES(?,?)', (event_id, previous['id']))
                    return {**self.public(db, previous['id']), 'duplicate': True}
                if db.execute('SELECT 1 FROM owner_nonces WHERE nonce=?', (owner_nonce,)).fetchone():
                    raise ValueError('owner_nonce_replay')
                if db.execute('SELECT 1 FROM inbound_events WHERE event_id=?', (event_id,)).fetchone():
                    raise ValueError('provider_event_conflict')
            except (KeyError, ValueError, TypeError):
                # Never store unauthenticated message bodies or execute their text.
                db.execute('INSERT INTO requests(id,state,created_at,updated_at) VALUES(?,?,?,?)', (ref, 'received', now, now))
                self.transition(db, ref, 'received')
                self.transition(db, ref, 'rejected', 'authentication_or_envelope_rejected')
                self.reply(db, ref, 'rejected', REASONS['rejected'])
                return self.public(db, ref)
            thread = self.config.threads.get('ADMIN' if chosen=='GERAL' else chosen)
            db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?)', (ref, request_id, digest, chosen, thread, instruction, 'received', None, None, now, now))
            self.transition(db, ref, 'received')
            self.transition(db, ref, 'authenticated')
            db.execute('INSERT INTO owner_nonces VALUES(?,?)', (owner_nonce, request_id))
            db.execute('INSERT INTO inbound_events VALUES(?,?)', (event_id, ref))
            self.transition(db, ref, 'queued')
            self.reply(db, ref, 'queued', REASONS['queued'])
            return self.public(db, ref)

    def recover(self):
        """Run only at exclusive process startup, never while a dispatcher runs."""
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute("SELECT id FROM requests WHERE state='submitted'").fetchall():
                self.transition(db, row['id'], 'uncertain', 'submission_uncertain')
                self.reply(db, row['id'], 'uncertain', REASONS['submission_uncertain'])
            db.execute("UPDATE outbox SET state='uncertain',updated_at=? WHERE state='submitting'", (int(time.time()),))

    def wait(self, ref, reason):
        reason = reason if reason in REASONS else 'session_unavailable'
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT state FROM requests WHERE id=?', (ref,)).fetchone()
            if not current or current['state'] not in {'queued', 'waiting'}:
                return self.public(db, ref)
            self.transition(db, ref, 'waiting', reason)
            self.reply(db, ref, 'waiting:' + reason, REASONS[reason])
            return self.public(db, ref)

    def dispatch_once(self):
        with self.db() as db:
            row = db.execute("SELECT * FROM requests WHERE state IN ('queued','waiting') AND receipt IS NULL ORDER BY CASE WHEN alias IN ('STATUS','LISTAR') THEN 0 ELSE 1 END,updated_at,id LIMIT 1").fetchone()
        if row is None:
            return None
        ref = row['id']
        if row['alias'] in {'STATUS', 'LISTAR'}:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT state FROM requests WHERE id=?', (ref,)).fetchone()
                if current['state'] not in {'queued', 'waiting'}:
                    return self.public(db, ref)
                if row['alias'] == 'LISTAR':
                    answer = 'Aliases disponíveis: ADMIN (Admin-v2), PAGINA (homepage), APOIO, GERAL, STATUS e LISTAR. GERAL é um único pedido coordenado pelo ADMIN; distribuição a filhos ainda não implementada.'
                else:
                    answer = json.dumps([dict(x) for x in db.execute('SELECT id,alias,state,reason,updated_at FROM requests ORDER BY updated_at DESC LIMIT 30')], ensure_ascii=False)
                self.transition(db, ref, 'completed')
                self.reply(db, ref, 'completed', answer)
                return self.public(db, ref)
        # Probe must be read-only. No resume/steer/start or parallel app-server.
        try:
            health = self.adapter.probe(row['thread_id'])
        except Exception:
            return self.wait(ref, 'session_unavailable')
        reason = health.get('reason')
        if reason in {'session_paused', 'safety_blocked', 'limits_exhausted'}:
            return self.wait(ref, reason)
        if not health.get('ready'):
            return self.wait(ref, reason or 'session_unavailable')
        if health.get('provider') != self.config.expected_provider or health.get('model') != self.config.expected_model:
            return self.wait(ref, 'provider_model_mismatch')
        if health.get('state') != 'idle' or not health.get('existing_session') or not health.get('exclusive'):
            return self.wait(ref, 'session_busy')
        if row['alias']=='GERAL' and health.get('global_scope_supported') is not True:
            return self.wait(ref,'bridge_unqualified')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT state,receipt FROM requests WHERE id=?', (ref,)).fetchone()
            if current['state'] not in {'queued', 'waiting'} or current['receipt']:
                return self.public(db, ref)
            busy = db.execute("SELECT 1 FROM requests WHERE thread_id=? AND id<>? AND state IN ('submitted','uncertain')", (row['thread_id'], ref)).fetchone()
            accepted = db.execute("SELECT 1 FROM requests WHERE thread_id=? AND id<>? AND state='waiting' AND receipt IS NOT NULL", (row['thread_id'], ref)).fetchone()
            if busy or accepted:
                self.transition(db, ref, 'waiting', 'session_busy')
                self.reply(db, ref, 'waiting:session_busy', REASONS['session_busy'])
                return self.public(db, ref)
            self.transition(db, ref, 'submitted', 'submission_intent_persisted')
        try:
            if row['alias']=='GERAL':
                response = self.adapter.submit(row['thread_id'], row['request_id'], row['instruction'],metadata=routing_metadata('GERAL'))
            else:
                response = self.adapter.submit(row['thread_id'], row['request_id'], row['instruction'])
        except Exception:
            response = {'state': 'uncertain'}
        state = response.get('state')
        with self.db() as db:
            if state == 'accepted' and isinstance(response.get('receipt'), str) and 0 < len(response['receipt']) <= 200:
                db.execute('UPDATE requests SET receipt=? WHERE id=?', (response['receipt'], ref))
                self.transition(db, ref, 'waiting', 'submitted')
                self.reply(db, ref, 'submitted', REASONS['submitted'])
            elif state in {'rejected', 'failed'}:
                self.transition(db, ref, state, state)
                self.reply(db, ref, state, REASONS[state])
            else:
                self.transition(db, ref, 'uncertain', 'submission_uncertain')
                self.reply(db, ref, 'uncertain', REASONS['submission_uncertain'])
            return self.public(db, ref)

    def poll_once(self):
        with self.db() as db:
            row = db.execute("SELECT * FROM requests WHERE state='waiting' AND receipt IS NOT NULL ORDER BY created_at LIMIT 1").fetchone()
        if not row:
            return None
        try:
            result = self.adapter.poll(row['receipt'])
        except Exception:
            # A read failure does not justify replaying a previously accepted turn.
            return self.wait(row['id'], 'session_unavailable')
        if result.get('receipt') != row['receipt']:
            with self.db() as db:
                self.transition(db, row['id'], 'uncertain', 'result_correlation_mismatch')
                self.reply(db, row['id'], 'uncertain', REASONS['submission_uncertain'])
                return self.public(db, row['id'])
        if result.get('state') not in {'completed', 'failed', 'rejected'}:
            return self.wait(row['id'], 'submitted')
        with self.db() as db:
            state = result['state']
            self.transition(db, row['id'], state)
            text = result.get('answer') if state == 'completed' else REASONS[state]
            self.reply(db, row['id'], state, text if isinstance(text, str) else 'Resultado concluído sem texto disponível.')
            return self.public(db, row['id'])

    def outbox_claim(self):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM outbox WHERE state='pending' ORDER BY created_at,id LIMIT 1").fetchone()
            if not row:
                return None
            if row['recipient'] != OWNER:
                raise ValueError('outbox_recipient_integrity')
            db.execute("UPDATE outbox SET state='submitting',updated_at=? WHERE id=?", (int(time.time()), row['id']))
            return {k: row[k] for k in ('id', 'request_ref', 'recipient', 'kind', 'body')}

    def outbox_result(self, ident, state, provider_id=None):
        if state not in {'accepted', 'rejected', 'uncertain'}:
            raise ValueError('invalid_delivery_outcome')
        if provider_id is not None and (not isinstance(provider_id, str) or len(provider_id) > 256):
            raise ValueError('invalid_provider_receipt')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT state FROM outbox WHERE id=?', (ident,)).fetchone()
            if not row:
                raise ValueError('unknown_outbox_id')
            if row['state'] != 'submitting':
                if row['state'] == state:
                    return {'id': ident, 'state': state}
                raise ValueError('delivery_already_terminal_or_not_claimed')
            db.execute('UPDATE outbox SET state=?,provider_id=?,updated_at=? WHERE id=?', (state, provider_id, int(time.time()), ident))
            return {'id': ident, 'state': state, 'delivery_confirmed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('action', choices=['ingest', 'stage', 'read-staged', 'list-staged', 'approve-staged', 'tick', 'recover', 'outbox-claim', 'outbox-result', 'status'])
    args = parser.parse_args()
    os.umask(0o077)
    if not Path(args.database).is_absolute():
        raise ValueError('absolute_database_required')
    executor = Executor(args.database, Config.load(args.config))
    if args.action in {'ingest', 'stage', 'read-staged', 'approve-staged', 'outbox-result'}:
        raw = sys.stdin.buffer.read(MAX_BODY * 2 + 1)
        if len(raw) > MAX_BODY * 2:
            raise ValueError('cli_input_limit')
        value = json.loads(raw)
    if args.action in {'ingest', 'stage'}:
        import base64
        method = executor.ingest if args.action == 'ingest' else executor.stage
        result = method(base64.b64decode(value['body_base64'], validate=True), value['headers'])
    elif args.action == 'read-staged':
        result = executor.read_staged(value['stage_id'])
    elif args.action == 'list-staged':
        result = executor.list_staged()
    elif args.action == 'approve-staged':
        result = executor.approve_staged(value['assertion'], value['signature'])
    elif args.action == 'tick':
        with executor.path.with_suffix('.worker.lock').open('a') as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = {'dispatch': executor.dispatch_once(), 'poll': executor.poll_once(), 'bridge_mode': executor.adapter.mode}
    elif args.action == 'recover':
        with executor.path.with_suffix('.worker.lock').open('a') as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            executor.recover()
        result = {'recovered': True}
    elif args.action == 'outbox-claim':
        result = executor.outbox_claim()
    elif args.action == 'outbox-result':
        result = executor.outbox_result(value['id'], value['state'], value.get('provider_id'))
    else:
        result = executor.list_status()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except IngressError as error:
        print(json.dumps({'error': error.code, 'trace_id': error.trace_id}))
        raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'error': type(error).__name__, 'trace_id': uuid.uuid4().hex}))
        raise SystemExit(1)
