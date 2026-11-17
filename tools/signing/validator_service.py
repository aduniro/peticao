"""Authenticated loopback adapter for PDF uploads and A1 v2 proofs."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading

MAX_PDF = 25 * 1024 * 1024
HERE = Path(__file__).resolve().parent


def load_config(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("unsafe_validator_configuration")
    cfg = json.loads(path.read_text())
    if set(cfg) != {"version", "port", "rootsPath", "rootsSha256", "crlCache"} or cfg["version"] != 1 or type(cfg["port"]) is not int or not 1024 <= cfg["port"] <= 65535:
        raise ValueError("invalid_validator_configuration")
    roots = Path(cfg["rootsPath"])
    if not roots.is_absolute() or roots.is_symlink() or roots.stat().st_uid != 0 or roots.stat().st_mode & 0o022:
        raise ValueError("unsafe_trust_snapshot")
    import hashlib
    if hashlib.sha256(roots.read_bytes()).hexdigest() != cfg["rootsSha256"]:
        raise ValueError("trust_snapshot_mismatch")
    return cfg


def evaluate(pdf, policy, config_path):
    environment = {"PATH": "/usr/bin:/bin", "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "A1_VALIDATOR_CONFIG": str(config_path)}
    try:
        result = subprocess.run([sys.executable, str(HERE / "validation_job.py"), *(["policy"] if policy else [])], input=pdf,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment, timeout=27, check=False)
        if result.returncode != 0 or len(result.stdout) > 16384:
            raise ValueError("validation_failed")
        parsed = json.loads(result.stdout)
        if not isinstance(parsed, dict) or type(parsed.get("valid")) is not bool:
            raise ValueError("invalid_result")
        return parsed
    except Exception:
        return {"valid": False, "reason": "validation_unavailable"}


def handler(token, config_path, evaluator=evaluate):
    slots = threading.BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        server_version = "PeticaoValidation/1"

        def log_message(self, *_):
            pass

        def answer(self, status, value):
            raw = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == "/health":
                self.answer(200, {"ok": True, "adapter": "peticao-a1-validation-v2"})
            else:
                self.answer(404, {"valid": False})

        def do_POST(self):
            self.connection.settimeout(30)
            if self.path not in ("/validate", "/validate/manual"):
                return self.answer(404, {"valid": False})
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                return self.answer(401, {"valid": False})
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/pdf" or self.headers.get("Transfer-Encoding"):
                return self.answer(415, {"valid": False})
            lengths = self.headers.get_all("Content-Length", [])
            try:
                size = int(lengths[0]) if len(lengths) == 1 else -1
            except ValueError:
                size = -1
            if not 5 < size <= MAX_PDF:
                return self.answer(413, {"valid": False})
            if not slots.acquire(blocking=False):
                return self.answer(503, {"valid": False, "reason": "validator_busy"})
            try:
                pdf = self.rfile.read(size)
                if len(pdf) != size or not pdf.startswith(b"%PDF-"):
                    return self.answer(400, {"valid": False})
                self.answer(200, evaluator(pdf, self.path == "/validate", config_path))
            except Exception:
                self.close_connection = True
            finally:
                slots.release()

    return Handler


def main():
    config_path = Path(os.environ.get("A1_VALIDATOR_CONFIG", "/etc/peticao-validation/service.json"))
    cfg = load_config(config_path)
    token = (Path(os.environ["CREDENTIALS_DIRECTORY"]) / "api-token").read_text()
    if len(token) < 32 or any(c.isspace() for c in token):
        raise ValueError("invalid_validator_credential")
    ThreadingHTTPServer(("127.0.0.1", cfg["port"]), handler(token, config_path)).serve_forever()


if __name__ == "__main__":
    main()
