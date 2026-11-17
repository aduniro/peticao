#!/usr/bin/env python3
"""Private Unix socket broker. One uint32-BE frame in, one frame out; no TCP."""
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import threading
import time

from worker import MAX_REQUEST, Refused, parse_request, read_protected

MAX_RESPONSE = MAX_REQUEST + 16384
SERVICE_CONFIG = "/etc/peticao-signing/service.json"
UNAVAILABLE = b'{"version":1,"ok":false,"error":"signing_unavailable"}'


def checked_code(path):
    p = Path(path)
    if not p.is_absolute():
        raise ValueError("invalid_service_configuration")
    # Resolve the trusted venv interpreter symlink, never a request-supplied path.
    configured = p
    resolved = p.resolve(strict=True)
    # Check original parent directories as well: a protected target does not make
    # a venv symlink safe when its containing directory is writable by the web.
    for parent in p.parents:
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            raise ValueError("invalid_service_configuration")
    p = resolved
    for part in [p, *p.parents]:
        info = part.lstat()
        if info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            raise ValueError("invalid_service_configuration")
    if not stat.S_ISREG(p.stat().st_mode):
        raise ValueError("invalid_service_configuration")
    # Preserve the venv executable spelling; resolving it for exec loses sys.prefix.
    return str(configured)


def load_service_config(path):
    cfg = json.loads(read_protected(path, 16384))
    required = {"version", "socketPath", "pythonPath", "workerPath", "workerConfigPath", "maxConcurrent", "workerTimeoutSeconds"}
    if not isinstance(cfg, dict) or (not required <= set(cfg) or set(cfg) - required - {"credentialSocketPath"}) or type(cfg["version"]) is not int or cfg["version"] != 1:
        raise ValueError("invalid_service_configuration")
    if type(cfg["maxConcurrent"]) is not int or not 1 <= cfg["maxConcurrent"] <= 4:
        raise ValueError("invalid_service_configuration")
    if type(cfg["workerTimeoutSeconds"]) is not int or not 1 <= cfg["workerTimeoutSeconds"] <= 60:
        raise ValueError("invalid_service_configuration")
    if "credentialSocketPath" in cfg:
        credential_socket=cfg["credentialSocketPath"]
        if not isinstance(credential_socket,str)or not credential_socket.startswith("/")or len(credential_socket.encode())>100 or any(ord(c)<32 for c in credential_socket):
            raise ValueError("invalid_service_configuration")
    socket_path = Path(cfg["socketPath"])
    if not socket_path.is_absolute() or len(str(socket_path).encode()) > 100:
        raise ValueError("invalid_service_configuration")
    parent = socket_path.parent
    for part in [parent, *parent.parents]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            raise ValueError("invalid_service_configuration")
    if parent.stat().st_uid != os.geteuid():
        raise ValueError("invalid_service_configuration")
    cfg["pythonPath"] = checked_code(cfg["pythonPath"])
    cfg["workerPath"] = checked_code(cfg["workerPath"])
    # Fail startup if worker configuration is not protected. Do not retain its contents.
    read_protected(cfg["workerConfigPath"], 16384)
    return cfg


def refresh_credential(raw, cfg):
    if "credentialSocketPath"not in cfg:return True
    try:
        request=json.loads(raw)
        body=json.dumps({"version":1,"operation":"refresh","credentialVersionId":request["credentialVersionId"]},separators=(",",":")).encode()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as client:
            client.settimeout(25);client.connect(cfg["credentialSocketPath"]);client.sendall(struct.pack("!I",len(body))+body)
            size=struct.unpack("!I",read_exact(client,4))[0]
            if not 1<=size<=16384:return False
            result=json.loads(read_exact(client,size))
        return result.get("ok")is True and all(result.get(key)==request.get(key)for key in ["credentialVersionId","trustStoreVersion","certificateFingerprintSha256"])
    except Exception:return False

def execute_worker(raw, cfg):
    """Drain stdout with a hard cap; never collect or publish child stderr."""
    if not refresh_credential(raw,cfg):return UNAVAILABLE
    process = subprocess.Popen([cfg["pythonPath"], cfg["workerPath"]],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={"A1_WORKER_CONFIG": cfg["workerConfigPath"], "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "LANG": "C.UTF-8"},
        close_fds=True, start_new_session=True, cwd="/")
    def write_input():
        try:
            process.stdin.write(raw)
            process.stdin.close()
        except (BrokenPipeError, OSError, ValueError):
            pass
    writer = threading.Thread(target=write_input, daemon=True)
    writer.start()
    output = bytearray()
    deadline = time.monotonic() + cfg["workerTimeoutSeconds"]
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return UNAVAILABLE
                if not selector.select(remaining):
                    return UNAVAILABLE
                chunk = os.read(process.stdout.fileno(), min(65536, MAX_RESPONSE - len(output) + 1))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > MAX_RESPONSE:
                    return UNAVAILABLE
        if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
            return UNAVAILABLE
        parsed = json.loads(output)
        if not isinstance(parsed, dict) or parsed.get("version") != 1 or parsed.get("ok") is not True:
            return UNAVAILABLE
        return bytes(output)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return UNAVAILABLE
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        writer.join(timeout=1)
        if not process.stdin.closed:
            process.stdin.close()
        process.stdout.close()


def read_exact(connection, size):
    result = bytearray()
    while len(result) < size:
        chunk = connection.recv(min(65536, size - len(result)))
        if not chunk:
            raise EOFError()
        result.extend(chunk)
    return bytes(result)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(15)
        result = UNAVAILABLE
        try:
            length = struct.unpack("!I", read_exact(self.request, 4))[0]
            if not 0 < length <= MAX_REQUEST:
                raise ValueError("invalid_frame")
            raw = read_exact(self.request, length)
            # Reject path injection, hash/size errors before creating a signing process.
            parse_request(raw)
            result = execute_worker(raw, self.server.config)
        except (OSError, ValueError, EOFError, Refused):
            pass
        try:
            self.request.sendall(struct.pack("!I", len(result)) + result)
        except OSError:
            pass


class SigningServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = False
    block_on_close = True
    request_queue_size = 4
    def __init__(self, cfg):
        self.config = cfg
        self.slots = threading.BoundedSemaphore(cfg["maxConcurrent"])
        path = cfg["socketPath"]
        # Never unlink an unknown or active existing socket. RuntimeDirectory cleanup
        # handles restart; manual stale-socket removal requires operator inspection.
        if os.path.lexists(path):
            raise ValueError("socket_already_exists")
        previous = os.umask(0o117)
        try:
            super().__init__(path, Handler)
            os.chmod(path, 0o660)
            self.socket_inode = os.lstat(path).st_ino
        finally:
            os.umask(previous)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Do not log request bodies, exception strings or child context.
        pass

    def server_close(self):
        super().server_close()
        path = self.config["socketPath"]
        try:
            info = os.lstat(path)
            if stat.S_ISSOCK(info.st_mode) and info.st_uid == os.geteuid() and info.st_ino == self.socket_inode:
                os.unlink(path)
        except FileNotFoundError:
            pass


def main():
    os.umask(0o077)
    try:
        cfg = load_service_config(os.environ.get("A1_SERVICE_CONFIG", SERVICE_CONFIG))
        with SigningServer(cfg) as server:
            # No TCP fallback. Supervisor owns lifecycle and kills all children.
            def stop(*_):
                threading.Thread(target=server.shutdown, daemon=True).start()
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
            server.serve_forever(poll_interval=0.2)
    except Exception:
        # Startup diagnostics intentionally contain no paths or configuration values.
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
