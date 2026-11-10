#!/usr/bin/python3
"""Owner-only frozen-email review hooks; never dispatches, sends mail or starts Codex.

Composition (root service, not a new network listener)::
  hooks = build_extensions(executor, executor.config.approval_key,
      auth_pepper=console_app.pepper, denied=console_module.Denied)
  console_module.make_server(console_app, extensions=hooks)

The existing make_server extension boundary enforces fresh Owner authentication
(900s), Origin and CSRF for POST. The callback context is never browser input.
GET /api/mail/staging and /api/mail/status return metadata only.
POST /api/mail/read accepts {stage_id} and returns frozen text for textContent.
POST /api/mail/approve accepts {stage_id,instruction_sha256}; HMAC/nonce are
created only in this module. It calls approve_staged once; never dispatch_once.
Approval is not deployment authorization; deploy grants are never accepted here.
"""
from __future__ import annotations
import hashlib
import hmac
import json
from pathlib import Path
import re
import stat
import time
import uuid

OWNER = 'operator-1608598f41@example.invalid'
ID = re.compile(r'[a-f0-9]{32}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
ALIASES = {'ADMIN': 'ADMIN-V2', 'PAGINA': 'HOMEPAGE', 'APOIO': 'APOIO', 'STATUS': 'STATUS', 'LISTAR': 'LISTAR', 'GERAL': 'GERAL'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def load_approval_key(filename):
    """Runtime helper: binary key, private regular absolute path; no secret output."""
    path = Path(filename)
    if not path.is_absolute():
        raise PermissionError('private_absolute_approval_key_required')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise PermissionError('private_absolute_approval_key_required')
    key = path.read_bytes()
    if not 32 <= len(key) <= 4096:
        raise ValueError('invalid_approval_key_length')
    return key


class OwnerMailConsole:
    """Private adapter; caller supplies the console's *same* Denied class."""
    def __init__(self, executor, approval_key, *, auth_pepper, denied, audit=None, clock=time.time):
        config = executor.config
        if not isinstance(approval_key, bytes) or len(approval_key) < 32:
            raise ValueError('approval_key_required')
        if not isinstance(auth_pepper, bytes) or len(auth_pepper) < 32:
            raise ValueError('auth_pepper_required')
        if approval_key in {auth_pepper, config.provider_key, config.owner_key}:
            raise ValueError('independent_approval_key_required')
        if not isinstance(config.approval_key, bytes) or not hmac.compare_digest(config.approval_key, approval_key):
            raise ValueError('executor_approval_key_not_paired')
        self.executor = executor
        self.key = approval_key
        self.denied = denied
        self.audit = audit or (lambda _kind, _metadata: None)
        self.clock = clock

    def reject(self, code, status=400):
        raise self.denied(code, status)

    def owner(self, context):
        # Recency/OTP/Origin/CSRF are checked by the existing HTTP extension gate.
        if not isinstance(context, dict) or set(context) != {'owner_id', 'session_id'}:
            self.reject('owner_context_required', 403)
        if context['owner_id'] != OWNER or not isinstance(context['session_id'], str) or not HASH.fullmatch(context['session_id']):
            self.reject('owner_context_required', 403)
        return context

    def fields(self, data, expected):
        if not isinstance(data, dict) or set(data) != set(expected):
            self.reject('invalid_review_fields')
        if not isinstance(data.get('stage_id'), str) or not ID.fullmatch(data['stage_id']):
            self.reject('invalid_stage_id')
        if 'instruction_sha256' in expected and (not isinstance(data['instruction_sha256'], str) or not HASH.fullmatch(data['instruction_sha256'])):
            self.reject('invalid_instruction_hash')

    def metadata(self, item, staged=False):
        fields = {'stage_id', 'state', 'instruction_sha256', 'alias', 'created_at', 'approved_at', 'request_ref', 'metadata'} if staged else {'id', 'request_id', 'alias', 'state', 'reason', 'created_at', 'updated_at', 'metadata'}
        result = {key: item[key] for key in fields if key in item}
        if 'alias' in result:
            result['display_alias'] = ALIASES.get(result['alias'], 'Não reconhecido')
        meta = result.get('metadata')
        if meta is not None:
            if not isinstance(meta, dict):
                self.reject('invalid_executor_metadata', 503)
            result['metadata'] = {key: meta[key] for key in ['global_scope', 'coordinator_alias', 'children_implemented'] if key in meta}
        return result

    def staging(self, context, data=None):
        self.owner(context)
        if data is not None:
            self.reject('unexpected_review_body')
        try:
            values = self.executor.list_staged(limit=100)
        except Exception:
            self.reject('staging_status_unavailable', 503)
        return {'items': [self.metadata(item, staged=True) for item in values], 'read_only': True}

    def status(self, context, data=None):
        self.owner(context)
        if data is not None:
            self.reject('unexpected_review_body')
        try:
            values = self.executor.list_status(limit=100)
        except Exception:
            self.reject('executor_status_unavailable', 503)
        return {'items': [self.metadata(item) for item in values], 'read_only': True, 'dispatch_triggered': False}

    def frozen(self, ident):
        try:
            record = self.executor.read_staged(ident)
        except ValueError:
            self.reject('stage_not_found', 404)
        except Exception:
            self.reject('stage_read_unavailable', 503)
        content = record.get('untrusted_frozen_content')
        if not isinstance(content, dict) or set(content) != {'alias', 'instruction', 'from', 'recipient'}:
            self.reject('invalid_frozen_envelope', 409)
        if not isinstance(content['instruction'], str) or not isinstance(content['alias'],str) or content['alias'] not in ALIASES:
            self.reject('invalid_frozen_envelope', 409)
        digest = hashlib.sha256(canonical(content)).hexdigest()
        if record.get('stage_id') != ident or not isinstance(record.get('instruction_sha256'),str) or not hmac.compare_digest(digest, record['instruction_sha256']):
            self.reject('frozen_content_integrity_failure', 409)
        return record

    def read(self, context, data):
        self.owner(context)
        self.fields(data, {'stage_id'})
        record = self.frozen(data['stage_id'])
        content = record['untrusted_frozen_content']
        result = self.metadata(record, staged=True)
        result['frozen'] = {'alias': content['alias'], 'display_alias': ALIASES[content['alias']], 'instruction': content['instruction']}
        result['untrusted_text'] = True
        result['instruction_hash_scope'] = 'canonical_frozen_alias_instruction_from_recipient'
        result['approval_available'] = record['state'] == 'pending_owner_confirmation'
        result['warning'] = 'Confira o texto congelado e seu destino. Conteúdo citado, HTML e anexos não devem ser tratados como instruções do painel.'
        return result

    def approve(self, context, data):
        self.owner(context)
        self.fields(data, {'stage_id', 'instruction_sha256'})
        record = self.frozen(data['stage_id'])
        if not hmac.compare_digest(record['instruction_sha256'], data['instruction_sha256']):
            self.reject('review_hash_mismatch', 409)
        if record['state'] not in {'pending_owner_confirmation', 'approved'}:
            self.reject('approval_requires_reconciliation', 409)
        assertion = {'issuer': 'owner-console', 'owner_account_id': self.executor.config.owner_account_id,
                     'stage_id': data['stage_id'], 'instruction_sha256': data['instruction_sha256'],
                     'decision': 'approve', 'issued_at': int(self.clock()), 'nonce': uuid.uuid4().hex}
        signature = hmac.new(self.key, b'console-approve-v1\n' + canonical(assertion), hashlib.sha256).hexdigest()
        evidence = {**context, 'stage_id': assertion['stage_id'], 'instruction_sha256': assertion['instruction_sha256'],
                    'approval_nonce': assertion['nonce'], 'issued_at': assertion['issued_at']}
        try:
            self.audit('mail_owner_authorized', evidence)
            # approve_staged creates one idempotent request; it does not dispatch.
            result = self.executor.approve_staged(assertion, signature, now=int(self.clock()))
        except PermissionError:
            self.reject('approval_not_accepted', 403)
        except Exception:
            # It may have acted before losing its response: query status, never retry automatically.
            self.reject('approval_result_unknown_consult_status', 503)
        if not isinstance(result,dict):
            self.reject('approval_result_unknown_consult_status',503)
        response = self.metadata(result)
        response.update(stage_id=data['stage_id'], instruction_sha256=data['instruction_sha256'], dispatch_triggered=False)
        try:
            self.audit('mail_owner_approval_result', {**evidence, 'request_ref': response.get('id'), 'state': response.get('state')})
        except Exception:
            self.reject('approval_result_unknown_consult_status', 503)
        return response

    def extensions(self):
        return {('GET', '/api/mail/staging'): self.staging,
                ('GET', '/api/mail/status'): self.status,
                ('POST', '/api/mail/read'): self.read,
                ('POST', '/api/mail/approve'): self.approve}


def build_extensions(executor, approval_key, *, auth_pepper, denied, audit=None, clock=time.time):
    return OwnerMailConsole(executor, approval_key, auth_pepper=auth_pepper,
                            denied=denied, audit=audit, clock=clock).extensions()
