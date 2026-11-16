#!/usr/bin/python3
"""Private console + persistent queue composition. Live AI/deploy disabled.

No timer for periodic reports, provisioning or arbitrary command execution.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import threading
import tempfile
import types

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


console = load("ops_private_console", "console/console.py")
package = types.ModuleType("ops_runtime")
package.__path__ = [str(ROOT / "executor")]
sys.modules["ops_runtime"] = package
executor = load("ops_runtime.executor", "executor/executor.py")
worker = load("ops_runtime.worker", "executor/worker.py")
review = load("ops_private_review", "infra/owner_mail_console.py")
mail = load("ops_private_transport", "infra/owner_mail_transport.py")
processor = load("ops_private_processor", "infra/inbound_processor.py")


def atomic_status(path, value):
    path = Path(path)
    if path.is_symlink():
        raise PermissionError("status_symlink_refused")
    fd, name = tempfile.mkstemp(prefix=".ops-status-", dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if temp.exists(): temp.unlink()


def compose(console_root, executor_config, database, *, token=None, host="127.0.0.1", port=8767, stop=None, ingress_config=None):
    stop = stop or threading.Event()
    app = console.Console(console_root)
    queue = executor.Executor(Path(database), executor.Config.load(executor_config))
    # Runtime composition intentionally does not accept a live adapter from JSON.
    if queue.adapter.mode != "live-disabled":
        raise ValueError("qualified_bridge_required")
    hooks = review.build_extensions(queue, queue.config.approval_key, auth_pepper=app.pepper, denied=console.Denied)
    drain = None
    if ingress_config is not None:
        ingress = load("ops_private_ingress_verifier", "infra/mailersend_ingress.py")
        verifier = ingress.Ingress(ingress.Config(**ingress_config))
        drain = processor.SpoolProcessor(verifier.config.spool_root, Path(database).parent / "inbound-journal.sqlite", queue, executor, verifier.verify)
        hooks[("GET", "/api/mail/ingress-status")] = lambda context, data: drain.status()
    server = console.make_server(app, host=host, port=port, extensions=hooks)
    transport = mail.Transport(token) if token else None

    def send(message):
        result = transport.send(message)
        return {"state": result.state, "provider_id": result.receipt}

    def pulse(value):
        # No prompt, e-mail content, OTP, receipt token or credentials in status.
        atomic_status(Path(console_root) / "executor-status.json", value)
        if drain is not None:
            drain.step()
        if transport is not None:
            mail.deliver_once(app, transport, "console")

    daemon = worker.Worker(queue, deliver=send if transport else None, stop_event=stop, heartbeat=pulse)
    return app, queue, server, daemon, stop


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--console-root", required=True)
    parser.add_argument("--executor-config", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--mail-token-file")
    parser.add_argument("--ingress-config")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    for value in [args.console_root, args.executor_config, args.database]:
        if not Path(value).is_absolute(): raise ValueError("absolute_runtime_paths_required")
    os.umask(0o077)
    token = mail.load_api_token(args.mail_token_file) if args.mail_token_file else None
    ingress_config = None
    if args.ingress_config:
        data = processor.SpoolProcessor.read_regular(Path(args.ingress_config), 16384)
        info = Path(args.ingress_config).stat()
        if not Path(args.ingress_config).is_absolute() or info.st_mode & 0o077:
            raise PermissionError("private_ingress_config_required")
        ingress_config = json.loads(data)
    app, queue, server, daemon, stop = compose(args.console_root, args.executor_config, args.database, token=token, port=args.port, ingress_config=ingress_config)
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    http = threading.Thread(target=server.serve_forever, daemon=True, name="private-console")
    http.start()
    try:
        result = daemon.run()
        if result["state"] == "failed": raise RuntimeError("worker_failed")
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
        http.join(timeout=10)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exception detail may contain runtime data; disclose only its class.
        print(json.dumps({"state": "failed", "error": type(error).__name__}), flush=True)
        raise SystemExit(1)
