"""Private transport tests; fake workers never load a certificate or contact network."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import stat
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import service
from worker import digest

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="a1-socket-",dir=os.environ["A1_TEST_PRIVATE_ROOT"])
        self.root=Path(self.tmp.name)
        self.worker=self.root/"fake-worker.py"
        self.worker.write_text('import json,sys\nq=json.load(sys.stdin)\nprint(json.dumps({"version":1,"ok":True,"jobId":q["jobId"]}))\n')
        self.worker.chmod(0o600)
        self.worker_config=self.root/"worker-config.json"
        self.worker_config.write_text('{}');self.worker_config.chmod(0o600)
        self.cfg={"version":1,"socketPath":str(self.root/"worker.sock"),"pythonPath":os.path.realpath(os.sys.executable),"workerPath":str(self.worker),"workerConfigPath":str(self.worker_config),"maxConcurrent":1,"workerTimeoutSeconds":1}
        self.config=self.root/"service.json"
        self.config.write_text(json.dumps(self.cfg));self.config.chmod(0o600)
        pdf=b"%PDF-SYNTHETIC-TRANSPORT"
        self.req={"version":1,"jobId":"11111111-1111-4111-8111-111111111111","documentVersion":"a"*64,"inputArtifactVersionId":"22222222-2222-4222-8222-222222222222","inputSha256":digest(pdf),"credentialVersionId":"33333333-3333-4333-8333-333333333333","profileVersion":"pades-basic-unhomologated-v1","trustStoreVersion":"c"*64,"expectedCnpj":"15883671000115","certificateFingerprintSha256":"b"*64,"pdfBase64":base64.b64encode(pdf).decode()}
        self.raw=json.dumps(self.req).encode()

    def tearDown(self):self.tmp.cleanup()

    @contextlib.contextmanager
    def server(self):
        server=service.SigningServer(service.load_service_config(str(self.config)))
        thread=threading.Thread(target=server.serve_forever,kwargs={"poll_interval":0.01});thread.start()
        try:yield server
        finally:server.shutdown();server.server_close();thread.join(timeout=2)

    def call(self,raw=None,header=None):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.settimeout(4);client.connect(self.cfg["socketPath"])
            body=self.raw if raw is None else raw
            client.sendall((struct.pack("!I",len(body)) if header is None else header)+body)
            size=struct.unpack("!I",service.read_exact(client,4))[0]
            self.assertLessEqual(size,service.MAX_RESPONSE)
            return json.loads(service.read_exact(client,size))

    def test_refresh_failure_refuses_before_starting_signer(self):
        cfg={**self.cfg,'credentialSocketPath':str(self.root/'absent-credentials.sock')}
        with patch('service.subprocess.Popen')as process:
            self.assertFalse(json.loads(service.execute_worker(self.raw,cfg))['ok']);process.assert_not_called()

    def test_refresh_binding_mismatch_refuses_before_starting_signer(self):
        path=str(self.root/'refresh.sock');listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);listener.bind(path);listener.listen(1)
        calls=[]
        def broker():
            connection,_=listener.accept()
            with connection:
                size=struct.unpack('!I',service.read_exact(connection,4))[0];request=json.loads(service.read_exact(connection,size));calls.append(request)
                raw=json.dumps({'ok':True,'credentialVersionId':self.req['credentialVersionId'],'trustStoreVersion':'WRONG','certificateFingerprintSha256':self.req['certificateFingerprintSha256']}).encode();connection.sendall(struct.pack('!I',len(raw))+raw)
        thread=threading.Thread(target=broker);thread.start()
        try:
            with patch('service.subprocess.Popen')as process:
                self.assertFalse(json.loads(service.execute_worker(self.raw,{**self.cfg,'credentialSocketPath':path}))['ok']);process.assert_not_called()
            self.assertEqual(calls,[{'version':1,'operation':'refresh','credentialVersionId':self.req['credentialVersionId']}])
        finally:listener.close();thread.join(timeout=2)

    def test_unix_permissions_and_valid_single_job(self):
        with self.server():
            info=os.stat(self.cfg["socketPath"])
            self.assertTrue(stat.S_ISSOCK(info.st_mode));self.assertEqual(stat.S_IMODE(info.st_mode),0o660)
            self.assertEqual(info.st_gid,os.getgid())
            result=self.call();self.assertTrue(result["ok"]);self.assertEqual(result["jobId"],self.req["jobId"])
        self.assertFalse(Path(self.cfg["socketPath"]).exists())

    def test_invalid_request_never_starts_worker(self):
        with self.server(),patch.object(service,"execute_worker",side_effect=AssertionError("must not execute")):
            self.assertFalse(self.call(raw=json.dumps({**self.req,"pfxPath":"/NOT-ALLOWED"}).encode())["ok"])
            self.assertFalse(self.call(raw=json.dumps({**self.req,"inputSha256":"0"*64}).encode())["ok"])
            self.assertFalse(self.call(raw=b"",header=struct.pack("!I",service.MAX_REQUEST+1))["ok"])

    def test_timeout_failure_and_stdout_limit_are_not_success(self):
        cases=['import time; time.sleep(10)', 'import sys; sys.exit(2)', 'print("not JSON")', 'import sys; sys.stdout.write("x"*5000)']
        with patch.object(service,"MAX_RESPONSE",1024):
            for source in cases:
                self.worker.write_text(source)
                before=time.monotonic()
                self.assertEqual(service.execute_worker(self.raw,self.cfg),service.UNAVAILABLE)
                self.assertLess(time.monotonic()-before,3)

    def test_minimal_environment_and_no_stderr_echo(self):
        self.worker.write_text('import json,os,sys\njson.load(sys.stdin)\nsys.stderr.write("DO-NOT-LEAK")\nprint(json.dumps({"version":1,"ok":True,"inheritedSecret":"A1_QA_PARENT_SECRET" in os.environ,"keys":sorted(os.environ)}))')
        with patch.dict(os.environ,{"A1_QA_PARENT_SECRET":"DO-NOT-INHERIT"}):
            raw=service.execute_worker(self.raw,self.cfg)
        result=json.loads(raw)
        self.assertFalse(result["inheritedSecret"])
        self.assertNotIn(b"DO-NOT-LEAK",raw)
        self.assertNotIn("PATH",result["keys"])

    def test_concurrency_limit_does_not_spawn_extra_worker(self):
        entered=threading.Event();release=threading.Event()
        def fake(raw,cfg):
            entered.set();release.wait(2);return b'{"version":1,"ok":true}'
        results=[]
        with self.server(),patch.object(service,"execute_worker",side_effect=fake) as run:
            thread=threading.Thread(target=lambda:results.append(self.call()));thread.start()
            self.assertTrue(entered.wait(1))
            try:
                with self.assertRaises((EOFError,ConnectionResetError,BrokenPipeError)):
                    self.call()
            finally:release.set();thread.join(timeout=3)
            self.assertEqual(run.call_count,1)
            self.assertTrue(results[0]["ok"])

    def test_configuration_and_existing_socket_fail_closed(self):
        self.config.chmod(0o644)
        with self.assertRaises(Exception):service.load_service_config(str(self.config))
        self.config.chmod(0o600)
        Path(self.cfg["socketPath"]).write_text("preserve existing object")
        with self.assertRaises(ValueError):service.SigningServer(self.cfg)
        self.assertEqual(Path(self.cfg["socketPath"]).read_text(),"preserve existing object")

if __name__=="__main__":unittest.main()
