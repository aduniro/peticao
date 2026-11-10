"""Normalize a verified provider event into a frozen Owner-review request.

Only explicit plain-text author content is eligible; HTML/attachments/quoted
messages are never instructions. Sender matching alone never authorizes a turn.
"""
from __future__ import annotations
import hashlib
import contextlib
import json
import re
import secrets
import os
from pathlib import Path
import sqlite3
import stat
import time

OWNER = "operator-1608598f41@example.invalid"
PREFIX = re.compile(r"^\s*(?:\[(ADMIN-V2|ADMIN|HOMEPAGE|PAGINA|PÁGINA|APOIO|GERAL|STATUS|LISTAR)\]|(ADMIN-V2|ADMIN|HOMEPAGE|PAGINA|PÁGINA|APOIO|GERAL|STATUS|LISTAR)\s*:)\s*", re.I)
QUOTED = re.compile(r"^\s*(?:>|_{5,}\s*$|-{2,}\s*(?:Original Message|Mensagem original|Forwarded message|Mensagem encaminhada)|(?:On .+ wrote:|Em .+ escreveu:))", re.I)


class Rejected(ValueError):
    pass


def author_text(value):
    if not isinstance(value, str) or len(value.encode()) > 65536:
        raise Rejected("plain_text_required")
    lines = []
    source_lines = value.splitlines()
    for index, line in enumerate(source_lines):
        if QUOTED.match(line): break
        if re.match(r"^\s*(?:De|From):\s*", line, re.I):
            following = source_lines[index + 1:index + 9]
            sent = any(re.match(r"^\s*(?:Enviado|Enviada|Sent|Data|Date):", item, re.I) for item in following)
            subject = any(re.match(r"^\s*(?:Assunto|Subject):", item, re.I) for item in following)
            if sent and subject: break
        lines.append(line)
    text = "\n".join(lines).strip()
    if not text or len(text.encode()) > 8192:
        raise Rejected("authored_text_limit")
    return text


def normalize(event, queue, alias_resolver):
    """Caller MUST verify original signature/account/recipient before this call."""
    if event.get("type") != "inbound.message":
        raise Rejected("inbound_message_required")
    data = event.get("data")
    if not isinstance(data, dict): raise Rejected("message_object_required")
    sender = data.get("from", {})
    if not isinstance(sender, dict) or not isinstance(sender.get("email"), str) or sender["email"].lower() != OWNER:
        raise Rejected("owner_sender_required_for_review")
    subject = data.get("subject")
    match = PREFIX.match(subject) if isinstance(subject, str) else None
    if not match: raise Rejected("explicit_routing_prefix_required")
    try: route = alias_resolver(match.group(1) or match.group(2))
    except ValueError: raise Rejected("unrecognized_alias") from None
    text = author_text(data.get("text"))
    event_id = data.get("id")
    inbound = event.get("inbound_id")
    if not isinstance(event_id, str) or not event_id or not isinstance(inbound, str) or not inbound:
        raise Rejected("provider_event_identity_required")
    # Stable event ID binds the provider route and ID; new nonce allows a safe
    # duplicate receipt to consult the original staged record, never dispatch.
    identity = hashlib.sha256((inbound + "\0" + event_id).encode()).hexdigest()
    return {"provider_id": queue.config.provider_id, "provider_account_id": queue.config.provider_account_id, "provider_event_id": "mailersend-" + identity, "from": OWNER, "recipient": queue.config.mailbox, "alias": route, "instruction": text}


def stage_verified(event, queue, executor_module):
    normalized = normalize(event, queue, executor_module.alias)
    raw = executor_module.canonical(normalized)
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(24)
    headers = {"X-Executor-Provider": queue.config.provider_id, "X-Executor-Timestamp": stamp, "X-Executor-Nonce": nonce, "X-Executor-Signature": executor_module.webhook_signature(queue.config.provider_key, queue.config.provider_id, stamp, nonce, raw)}
    return queue.stage(raw, headers)


class SpoolProcessor:
    """Drain signed durable receipts; originals stay intact for provider dedup.

    A crash after stage but before journal commit repeats only idempotent stage,
    never an AI submit. Verification outages leave the receipt pending.
    """
    def __init__(self, spool_root, journal, queue, executor_module, verify):
        self.spool = Path(spool_root) / "inbound"
        self.journal = Path(journal)
        self.queue, self.module, self.verify = queue, executor_module, verify
        if not self.journal.is_absolute() or self.journal.is_symlink():
            raise PermissionError("private_absolute_journal_required")
        self.journal.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS processed(receipt TEXT PRIMARY KEY, body_hash TEXT, state TEXT, reference TEXT, reason TEXT, at INTEGER)")
        self.journal.chmod(0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.journal, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def read_regular(path, limit, *, dir_fd=None):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise Rejected("invalid_spool_file")
            value = source.read(limit + 1)
        if len(value) > limit: raise Rejected("spool_body_limit")
        return value

    def step(self):
        if not self.spool.exists(): return None
        if self.spool.is_symlink(): raise PermissionError("spool_symlink_refused")
        for folder in sorted(self.spool.iterdir()):
            if not re.fullmatch(r"[a-f0-9]{64}", folder.name) or folder.is_symlink() or not folder.is_dir(): continue
            with self.db() as db:
                if db.execute("SELECT 1 FROM processed WHERE receipt=?", (folder.name,)).fetchone(): continue
            bucket_fd = os.open(self.spool, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                folder_fd = os.open(folder.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=bucket_fd)
                try:
                    raw = self.read_regular("body.bin", 262144, dir_fd=folder_fd)
                    signature = self.read_regular("signature.txt", 256, dir_fd=folder_fd).decode().strip()
                finally:
                    os.close(folder_fd)
            finally:
                os.close(bucket_fd)
            # No exception is converted to success. A key/pairing outage remains
            # pending and makes the supervised worker report a failure.
            self.verify(raw, signature)
            try:
                event = json.loads(raw)
                result = stage_verified(event, self.queue, self.module)
                state, reference, reason = result["state"], result["stage_id"], None
            except Rejected as error:
                state, reference, reason = "rejected", None, str(error)
                data = event.get("data") if isinstance(event, dict) else None
                sender = data.get("from") if isinstance(data, dict) else None
                if isinstance(sender, dict) and isinstance(sender.get("email"), str) and sender["email"].lower() == OWNER:
                    with self.queue.db() as db:
                        self.queue.reply(db, "ingress-" + folder.name, "ingress_rejected", "Mensagem recebida, mas o formato não permite criar o pedido. Motivo: " + reason + ". Use um prefixo no assunto: [Admin-v2], [homepage], [GERAL], [STATUS] ou [LISTAR]. Nenhuma ação foi executada.")
            with self.db() as db:
                db.execute("INSERT INTO processed VALUES(?,?,?,?,?,?)", (folder.name, hashlib.sha256(raw).hexdigest(), state, reference, reason, int(time.time())))
            return {"receipt": folder.name, "state": state, "stage_id": reference, "reason": reason}
        return None

    def status(self):
        with self.db() as db:
            return {"counts": dict(db.execute("SELECT state,COUNT(*) FROM processed GROUP BY state").fetchall()), "recent": [dict(row) for row in db.execute("SELECT receipt,state,reference,reason,at FROM processed ORDER BY at DESC LIMIT 50")]}
