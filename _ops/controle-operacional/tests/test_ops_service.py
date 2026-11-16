import importlib.util
import json
import pathlib
import tempfile
import unittest
import hashlib
import hmac
import dataclasses

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ops_composition_test", ROOT / "infra/ops_service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class CompositionTests(unittest.TestCase):
    def test_signed_ingress_to_persistent_owner_review_without_dispatch(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            root = pathlib.Path(folder)
            catalog = root / "console"
            service.console.initialize(catalog, "https://fixture.tailnet.invalid:9443")
            cfg = service.executor.Config("fixture-provider", "fixture-account", b"p" * 32, "fixture-owner", "fixture-owner-key", b"o" * 32, "executor@exec.sancionaintegral.org", {"ADMIN": "00000000-0000-4000-8000-000000000001", "PAGINA": "00000000-0000-4000-8000-000000000002", "APOIO": "00000000-0000-4000-8000-000000000002"}, "fixture", "fixture", b"a" * 32)
            values = dataclasses.asdict(cfg)
            for key in ["provider_key", "owner_key", "approval_key"]: values[key] = values[key].hex()
            path = root / "executor.json"
            path.write_text(json.dumps(values)); path.chmod(0o600)
            secret = root / "provider-secret"
            secret.write_bytes(b"fixture-secret-unrelated-to-owner"); secret.chmod(0o600)
            ingress_config = {"spool_root": str(root / "spool"), "secret_file": str(secret), "inbound_id": "fixture-route", "recipients": [cfg.mailbox]}
            ingress = service.load("ops_integration_ingress", "infra/mailersend_ingress.py")
            endpoint = ingress.Ingress(ingress.Config(**ingress_config))
            event = {"type": "inbound.message", "inbound_id": "fixture-route", "created_at": "2026-11-10T19:00:00Z", "data": {"object": "message", "id": "fixture-event-123", "recipients": {"rcptTo": [{"email": cfg.mailbox}]}, "from": {"email": service.mail.OWNER}, "subject": "[homepage] fixture", "text": "Instrução fictícia explícita.\n> Texto citado não encaminhável."}}
            raw = json.dumps(event).encode()
            signature = hmac.new(secret.read_bytes(), raw, hashlib.sha256).hexdigest()
            endpoint.accept(raw, signature)
            for _ in range(2):
                app, queue, server, worker, stopped = service.compose(catalog, path, root / "queue.sqlite", port=0, ingress_config=ingress_config)
                try:
                    worker.run(max_cycles=1)
                    staged = queue.list_staged()
                    self.assertEqual(len(staged), 1)
                    self.assertEqual(staged[0]["state"], "pending_owner_confirmation")
                    self.assertEqual(queue.list_status(), [])
                    self.assertEqual(queue.adapter.mode, "live-disabled")
                finally: server.server_close()

    def test_private_composition_restarts_without_live_execution(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            root = pathlib.Path(folder)
            catalog = root / "console"
            service.console.initialize(catalog, "https://fixture.tailnet.invalid:9443")
            config = root / "executor.json"
            config.write_text(json.dumps({"provider_id": "fixture-provider", "provider_account_id": "fixture-account", "provider_key": "11" * 32, "owner_account_id": "fixture-owner", "owner_key_id": "fixture-owner-key", "owner_key": "22" * 32, "approval_key": "33" * 32, "mailbox": "executor@exec.sancionaintegral.org", "threads": {"ADMIN": "00000000-0000-4000-8000-000000000001", "PAGINA": "00000000-0000-4000-8000-000000000002", "APOIO": "00000000-0000-4000-8000-000000000002"}, "expected_provider": "fixture", "expected_model": "fixture"}))
            config.chmod(0o600)
            for _ in range(2):
                app, queue, server, worker, stopped = service.compose(catalog, config, root / "queue.sqlite", port=0)
                try:
                    self.assertFalse(app.config["production_enabled"])
                    self.assertEqual(queue.adapter.mode, "live-disabled")
                    self.assertIn(("POST", "/api/mail/approve"), server.extensions)
                    result = worker.run(max_cycles=1)
                    self.assertEqual(result["state"], "stopped")
                    status = json.loads((catalog / "executor-status.json").read_text())
                    self.assertFalse(status["mail_transport_configured"])
                    self.assertEqual(status["bridge_mode"], "live-disabled")
                    self.assertNotIn("provider_key", (catalog / "executor-status.json").read_text())
                finally:
                    server.server_close()

    def test_status_does_not_follow_a_symlink(self):
        with tempfile.TemporaryDirectory(dir="/dev/shm") as folder:
            root = pathlib.Path(folder)
            original = root / "original"
            original.write_text("preserved")
            link = root / "status"
            link.symlink_to(original)
            with self.assertRaises(PermissionError): service.atomic_status(link, {"state": "fixture"})
            self.assertEqual(original.read_text(), "preserved")


if __name__ == "__main__": unittest.main()
