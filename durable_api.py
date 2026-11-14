"""Private Civo API and crash-safe mutation journal. No automatic retries.

This module is inert when imported. API writes need the caller's live gate.
The gate must implement the deployment lease or an explicitly delegated,
reviewed runtime cleanup authority; an expired lease is never acceptable.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def atomic(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.'+path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('API redirect refused; credentials remain at pinned origin')


class Api:
    def __init__(self, token_file, log_directory, expected_token_sha256):
        path = Path(token_file)
        mode = path.stat().st_mode
        if path.is_symlink() or not stat.S_ISREG(mode) or mode & 0o077:
            raise ValueError('API credential must be a private regular file')
        self.token = path.read_text().strip()
        if not self.token or '\n' in self.token:
            raise ValueError('Unexpected token envelope')
        if hashlib.sha256(self.token.encode()).hexdigest() != expected_token_sha256:
            raise ValueError('Credential identity differs from reviewed account binding')
        self.logs = Path(log_directory)
        self.logs.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, *, query=None, payload=None):
        if method not in {'GET', 'POST', 'PUT', 'DELETE'} or not re.fullmatch(r'/v2/[a-zA-Z0-9_/-]+', path):
            raise ValueError('Unsupported API request')
        url = 'https://api.civo.com' + path
        if query: url += '?' + urllib.parse.urlencode(query)
        body = None if payload is None else urllib.parse.urlencode(payload, doseq=True).encode()
        req = urllib.request.Request(url, data=body, method=method,
                  headers={'Authorization':'Bearer '+self.token,
                           'Content-Type':'application/x-www-form-urlencoded'})
        try:
            with self.opener.open(req, timeout=25) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as exc:
            status, raw = exc.code, exc.read()
        except Exception:
            raise RuntimeError('Civo transport failed; mutation outcome may be uncertain') from None
        label = str(time.time_ns())+'-'+hashlib.sha256((method+url).encode()).hexdigest()[:20]
        # Responses may include initial passwords: persist privately, never stdout.
        atomic(self.logs/(label+'.private.json'),
               {'method':method, 'path':path, 'status':status,
                'response':raw.decode('utf-8', errors='replace')})
        if status == 404: return {'_not_found':True}
        if not 200 <= status < 300:
            raise RuntimeError('Civo API rejected request; see private request log '+label)
        try: return json.loads(raw)
        except Exception:
            raise RuntimeError('Unexpected API response; do not repeat mutation') from None


class Journal:
    def __init__(self, directory, gate):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.gate = gate

    def perform(self, key, request, call, validate):
        """The caller must hold the exclusive lifecycle lock for this allocation.

        A pending record is intentionally not recoverable by name or timestamp.
        Reconciliation needs the provider's operation evidence and separate review.
        """
        if not re.fullmatch(r'[a-z0-9-]{1,80}', key): raise ValueError('Invalid journal key')
        path = self.directory/(key+'.json')
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        if path.exists():
            entry = json.loads(path.read_text())
            if entry.get('request_sha256') != digest: raise RuntimeError('Journal request drift')
            if entry.get('state') != 'completed': raise RuntimeError('Uncertain mutation; no blind retry')
            validate(entry['response'])
            return entry['response']
        self.gate()
        atomic(path, {'state':'pending', 'request_sha256':digest, 'request':request})
        self.gate()
        response = call()
        validate(response)
        atomic(path, {'state':'completed', 'request_sha256':digest,
                      'request':request, 'response':response})
        return response


class LifecycleLock:
    def __init__(self, path): self.path = path
    def __enter__(self):
        self.handle = open(self.path, 'a')
        try: fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.handle.close()
            raise
        return self
    def __exit__(self, *args): self.handle.close()
