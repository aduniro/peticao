#!/usr/bin/python3
"""Private HTTPS capability gateway; uses existing queue/claims, never dispatches."""
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import sqlite3
import ssl
import threading

import kubernetes_backend as kube

MAX_BODY = 48 * 1024 * 1024


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, backend, certificate, key):
        self.backend = backend
        self.slots = threading.BoundedSemaphore(2)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certificate, key)
        super().__init__(address, Handler)
        self.socket = context.wrap_socket(self.socket, server_side=True, do_handshake_on_connect=False)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(15)
        return request, address

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        # No request bodies, Authorization headers, capabilities or tracebacks in logs.
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'PeticaoClaims/1'
    sys_version = ''

    def log_message(self, *_):
        pass

    def reply(self, code, value):
        body = (json.dumps(value, separators=(',', ':')) + '\n').encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        self.reply(405, {'error': 'use_fixed_authenticated_POST_endpoint'})

    def do_POST(self):
        if self.path not in ('/v1/start', '/v1/finish', '/v1/receipt'):
            self.reply(404, {'error': 'unknown_endpoint'})
            return
        authorization = self.headers.get_all('Authorization', [])
        if len(authorization) != 1 or not re.fullmatch('Bearer [a-f0-9]{64}', authorization[0]):
            self.reply(401, {'error': 'per_job_capability_required'})
            return
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch('[0-9]{1,9}', lengths[0]):
            self.reply(400, {'error': 'fixed_content_length_required'})
            return
        length = int(lengths[0])
        if length > (MAX_BODY if self.path == '/v1/finish' else 4096):
            self.reply(413, {'error': 'request_size_limit'})
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            self.reply(415, {'error': 'json_required'})
            return
        token = authorization[0][7:]
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('incomplete_body')
            body = json.loads(raw)
            common = {'id', 'pod_name', 'pod_uid'}
            allowed = common | ({'exit_code', 'technical_result', 'artifacts'} if self.path == '/v1/finish' else set())
            if not isinstance(body, dict) or set(body) != allowed:
                raise ValueError('fixed_request_contract_required')
            if not re.fullmatch('[a-f0-9]{32}', str(body['id'])) or not re.fullmatch('[a-z0-9][a-z0-9.-]{0,252}', str(body['pod_name'])) or not isinstance(body['pod_uid'], str) or not 1 <= len(body['pod_uid']) <= 128:
                raise ValueError('invalid_execution_identity')
            backend = self.server.backend
            if self.path == '/v1/start':
                accepted = backend.authorize_start(body['id'], body['pod_name'], body['pod_uid'], token)
                self.reply(200 if accepted else 409, {'id': body['id'], 'execution_authorized': accepted})
            elif self.path == '/v1/finish':
                receipt = backend.complete_execution(body['id'], body['pod_name'], body['pod_uid'], token,
                                                     body['exit_code'], body['technical_result'], body['artifacts'])
                self.reply(200, receipt)
            else:
                self.reply(200, backend.execution_receipt(body['id'], body['pod_uid'], token))
        except PermissionError:
            self.reply(403, {'error': 'execution_identity_denied'})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {'error': 'invalid_request_or_conflicting_receipt'})
        except (kube.Unavailable, OSError, sqlite3.Error):
            self.reply(503, {'error': 'observation_or_storage_unavailable', 'automatic_execution_retry': False})
        except Exception:
            self.reply(500, {'error': 'execution_state_unknown', 'automatic_execution_retry': False})


def main():
    os.umask(0o007)
    import coordinator as core
    if os.environ.get('ADMIN_CLUSTER_KUBERNETES') != '1':
        raise PermissionError('backend_not_enabled')
    core.initialize()
    backend = core.kubernetes()
    certificate = Path('/etc/admin-v2-kubernetes/claims-server.crt')
    key = Path('/etc/admin-v2-kubernetes/claims-server.key')
    info = key.lstat()
    if key.is_symlink() or not key.is_file() or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o037:
        raise PermissionError('private_root_owned_tls_key_required')
    server = Server(('100.80.18.81', 9444), backend, certificate, key)
    try:
        server.serve_forever(poll_interval=.5)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
