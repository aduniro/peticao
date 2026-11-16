import importlib.util
import io
import pathlib
import sys
import time
import unittest
import urllib.error

PATH = pathlib.Path(__file__).resolve().parents[1] / "infra/owner_mail_transport.py"
spec = importlib.util.spec_from_file_location("owner_mail_transport", PATH)
mail = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mail
spec.loader.exec_module(mail)


class FakeResponse:
    status = 202
    headers = {"x-message-id": "provider-123"}
    def __enter__(self): return self
    def __exit__(self, *args): pass


class FakeOpener:
    def __init__(self, result=None):
        self.result = result or FakeResponse()
        self.requests = []
    def open(self, request, timeout):
        self.requests.append(request)
        if isinstance(self.result, Exception): raise self.result
        return self.result


class Source:
    def __init__(self, message):
        self.message = message
        self.reserved = False
        self.results = []
        self.fail_record = False
    def outbox_claim(self):
        if self.reserved: return None
        self.reserved = True
        return self.message
    def outbox_result(self, *args):
        if self.fail_record: raise OSError("fixture_disk_failure")
        self.results.append(args)


def notice():
    return {"id": "message-123", "recipient": mail.OWNER, "kind": "waiting", "body": "<script>fixture</script>", "request_ref": "request-123"}


class TransportTests(unittest.TestCase):
    def test_fixed_recipient_and_escaped_html(self):
        result = mail.render(notice())
        self.assertEqual(result["to"], [{"email": mail.OWNER}])
        self.assertNotIn("<script>", result["html"])
        altered = notice() | {"recipient": "attacker@example.invalid"}
        opener = FakeOpener()
        self.assertEqual(mail.Transport("fixture", opener).send(altered).state, "rejected")
        self.assertEqual(opener.requests, [])

    def test_uncertain_send_is_not_retried(self):
        opener = FakeOpener(TimeoutError())
        source = Source(notice())
        transport = mail.Transport("fixture", opener)
        self.assertEqual(mail.deliver_once(source, transport, "executor")["state"], "uncertain")
        self.assertIsNone(mail.deliver_once(source, transport, "executor"))
        self.assertEqual(len(opener.requests), 1)

    def test_provider_accepted_requires_receipt(self):
        opener = FakeOpener()
        self.assertEqual(mail.Transport("fixture", opener).send(notice()), mail.Result("accepted", "provider-123"))
        opener.result.headers = {}
        self.assertEqual(mail.Transport("fixture", opener).send(notice()).state, "uncertain")
        opener.result.headers = {"x-message-id": "provider-123"}

    def test_recording_failure_does_not_repeat_external_effect(self):
        source = Source(notice())
        source.fail_record = True
        opener = FakeOpener()
        with self.assertRaises(OSError):
            mail.deliver_once(source, mail.Transport("fixture", opener), "executor")
        self.assertIsNone(mail.deliver_once(source, mail.Transport("fixture", opener), "executor"))
        self.assertEqual(len(opener.requests), 1)

    def test_deploy_otp_contains_exact_scope_and_expired_is_not_sent(self):
        message = {"id": "message-123", "recipient": mail.OWNER, "kind": "owner_otp", "delivery_token": "fixture-token", "expires_at": time.time() + 500, "payload": {"otp": "01234567", "purpose": "deploy", "release_id": "r0001", "manifest_hash": "a" * 64, "destination": "sp-production"}}
        rendered = mail.render(message)
        for expected in ["01234567", "r0001", "a" * 64, "sp-production"]:
            self.assertIn(expected, rendered["text"])
        message["expires_at"] = 1
        opener = FakeOpener()
        self.assertEqual(mail.Transport("fixture", opener).send(message).state, "rejected")
        self.assertEqual(opener.requests, [])

    def test_no_redirect_or_server_error_can_report_delivery(self):
        for code, state in [(302, "uncertain"), (403, "rejected"), (429, "rejected"), (500, "uncertain")]:
            opener = FakeOpener(urllib.error.HTTPError(mail.ENDPOINT, code, "fixture", {}, io.BytesIO()))
            self.assertEqual(mail.Transport("fixture", opener).send(notice()).state, state)


if __name__ == "__main__": unittest.main()
