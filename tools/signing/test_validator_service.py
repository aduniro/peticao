import http.client
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer
from validator_service import handler


class ValidatorHttpTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def evaluate(pdf, policy, config):
            self.calls.append((pdf, policy))
            return {"valid": True}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler("QA-TOKEN", Path("/not-read"), evaluate))
        self.thread = threading.Thread(target=self.server.serve_forever); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.thread.join(); self.server.server_close()

    def request(self, path="/validate", token="QA-TOKEN", body=b"%PDF-test", content="application/pdf"):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1])
        conn.request("POST", path, body, {"Authorization": "Bearer " + token, "Content-Type": content})
        response = conn.getresponse(); response.read(); conn.close(); return response.status

    def test_auth_and_type_rejected_without_crypto(self):
        self.assertEqual(self.request(token="wrong"), 401)
        self.assertEqual(self.request(content="application/json"), 415)
        self.assertEqual(self.calls, [])

    def test_manual_and_v2_are_explicit_separate_contracts(self):
        self.assertEqual(self.request(), 200)
        self.assertEqual(self.request(path="/validate/manual"), 200)
        self.assertEqual([x[1] for x in self.calls], [True, False])

    def test_bad_pdf_and_path_never_start_crypto(self):
        self.assertEqual(self.request(body=b"invalid!"), 400)
        self.assertEqual(self.request(path="/unrecognized"), 404)
        self.assertEqual(self.calls, [])


if __name__ == "__main__": unittest.main()
