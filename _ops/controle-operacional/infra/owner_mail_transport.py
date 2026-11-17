"""Functional Owner mail transport; never a periodic report scheduler.

Claims are durably reserved by their owning outbox before this module sends.
No retry is performed here, including after ambiguous provider responses.
"""
from __future__ import annotations

import dataclasses
import html
import json
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.request

OWNER = "operator-1608598f41@example.invalid"
ENDPOINT = "https://api.mailersend.com/v1/email"
SENDER = "executor@envia.sancionaintegral.org"
REPLY = "executor@exec.sancionaintegral.org"


def load_api_token(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("absolute_credential_path_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise PermissionError("private_regular_credential_required")
        token = stream.read(4097).strip()
    if not 20 <= len(token) <= 4096 or any(c.isspace() for c in token):
        raise ValueError("invalid_credential")
    return token


@dataclasses.dataclass(frozen=True)
class Result:
    state: str
    receipt: str | None = None


def render(message, now=None):
    if message.get("recipient") != OWNER:
        raise ValueError("fixed_owner_required")
    if message.get("kind") == "owner_otp":
        if message.get("expires_at", 0) <= (time.time() if now is None else now):
            raise ValueError("expired_message")
        payload = message["payload"]
        code = payload.get("otp", "")
        if not isinstance(code, str) or not re.fullmatch(r"[0-9]{8}", code):
            raise ValueError("invalid_otp")
        purpose = payload.get("purpose")
        if purpose == "login":
            subject = "Acesso à Central privada — código de confirmação"
            text = "Código de acesso: " + code + "\nVálido por até 10 minutos."
        elif purpose == "deploy":
            subject = "Autorizar publicação — confirmação da versão"
            fields = [payload.get(k) for k in ("release_id", "manifest_hash", "destination")]
            if not all(isinstance(x, str) and 0 < len(x) <= 256 for x in fields):
                raise ValueError("missing_deploy_scope")
            text = "Código: " + code + "\nVersão: " + fields[0] + "\nHash: " + fields[1] + "\nDestino: " + fields[2] + "\nVálido por até 10 minutos. Confira a versão e o destino antes de autorizar."
        else:
            raise ValueError("invalid_otp_purpose")
    else:
        subject = "Executor — andamento do pedido"
        text = message.get("body")
        if not isinstance(text, str) or not 0 < len(text.encode()) <= 65536:
            raise ValueError("invalid_owner_notice")
        text = "Referência: " + str(message.get("request_ref", message.get("id", "")))[:128] + "\n\n" + text
    markup = '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;background:#f3f5f8;padding:24px"><main style="max-width:640px;margin:auto;background:white;padding:28px;border-top:5px solid #174b64"><h1 style="font-size:22px">' + html.escape(subject) + '</h1><div style="white-space:pre-wrap;line-height:1.6">' + html.escape(text) + '</div></main></body></html>'
    return {"from": {"email": SENDER, "name": "ADUNIR · Central privada"}, "to": [{"email": OWNER}], "reply_to": {"email": REPLY}, "subject": subject, "text": text, "html": markup}


class Transport:
    def __init__(self, api_token, opener=None):
        self._token = api_token
        self._opener = opener or urllib.request.build_opener(NoRedirect())

    def send(self, message):
        try:
            body = render(message)
        except (ValueError, KeyError, TypeError):
            return Result("rejected")
        request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + self._token, "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        try:
            with self._opener.open(request, timeout=15) as response:
                receipt = response.headers.get("x-message-id")
                if response.status == 202 and isinstance(receipt, str) and re.fullmatch(r"[A-Za-z0-9_.:/=-]{1,256}", receipt):
                    return Result("accepted", receipt)
                return Result("uncertain")
        except urllib.error.HTTPError as error:
            # A successful submission may precede a server-side failure.
            return Result("rejected" if 400 <= error.code < 500 else "uncertain")
        except (OSError, TimeoutError, urllib.error.URLError):
            return Result("uncertain")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def deliver_once(source, transport, kind):
    """No outer retry: failure to record the result leaves the claim reserved."""
    if kind not in {"console", "executor"}:
        raise ValueError("invalid_outbox_kind")
    message = source.outbox_claim()
    if message is None:
        return None
    result = transport.send(message)
    if kind == "console":
        source.outbox_result(message["id"], message["delivery_token"], result.state, result.receipt)
    else:
        source.outbox_result(message["id"], result.state, result.receipt)
    return {"id": message["id"], "state": result.state}
