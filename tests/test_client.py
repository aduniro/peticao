import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('passive_client',ROOT/'client.py')
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class ClientTests(unittest.TestCase):
    def test_migration_requires_exact_own_capability_before_any_network(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            cap=Path(tmp)/'cap';cap.write_text(json.dumps({'operator_session':'foreign','result':{}}));cap.chmod(0o600)
            with patch.object(client,'central') as call:
                with self.assertRaises(PermissionError):client.validate_lease(cap,3)
                call.assert_not_called()

    def test_expired_or_deploy_instead_of_migration_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            cap=Path(tmp)/'cap';cap.write_text(json.dumps({'operator_session':client.SESSION,'result':{'lease':'fictional','token':'fictional','fence':1,'seq':1}}));cap.chmod(0o600)
            for operation,expiry in [('deploy',99999999999),('migration',0)]:
                live={'id':'fictional','actor':'admin-recuperacao','operation':operation,'resources':[client.RESOURCE],'expires':expiry}
                with patch.object(client,'central',side_effect=[{}, {'leases':[live]}]):
                    with self.assertRaises(PermissionError):client.validate_lease(cap,3)

    def test_lost_ssh_response_is_recorded_uncertain_not_replayed(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            with patch.object(client,'STATE',Path(tmp)),patch.object(client,'ssh_argv',return_value=['ssh','fixture']),patch.object(client.subprocess,'run',side_effect=subprocess.TimeoutExpired(['ssh'],1)) as run:
                with self.assertRaises(subprocess.TimeoutExpired):client.remote({'role':'target','action':'restore'},'fixture')
                result=json.loads((Path(tmp)/'fixture.result.json').read_text());self.assertTrue(result['transport_uncertain'])
                with self.assertRaises(FileExistsError):client.remote({'role':'target','action':'restore'},'fixture')
                self.assertEqual(run.call_count,1)

    def test_cipher_roundtrip_is_real_and_plaintext_is_not_saved_locally(self):
        raw=b'fictional checkpoint transport, no production data\n'
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            state=Path(tmp);key=state/'fixture-unlock';key.write_text('fictional test passphrase only');key.chmod(0o600)
            (state/'capture.result.json').write_text(json.dumps({'ok':True,'result':{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}}))
            command=['/usr/bin/python3','-I','-B','-c','import sys;sys.stdout.buffer.write('+repr(raw)+')']
            with patch.object(client,'STATE',state),patch.object(client,'KEY',key),patch.object(client,'ssh_argv',return_value=command):
                result=client.encrypt_capture()
            self.assertTrue(result['roundtrip_verified']);self.assertFalse(result['plaintext_local_file_saved'])
            self.assertNotIn(raw,(state/'checkpoint.tar.gpg').read_bytes())
            self.assertFalse((state/'checkpoint.tar.gz').exists())

    def test_changed_or_missing_source_receipt_cannot_encrypt(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            p=Path(tmp);(p/'capture.result.json').write_text(json.dumps({'ok':False,'result':{'bytes':1}}))
            with patch.object(client,'STATE',p):
                with self.assertRaises(ValueError):client.capture_receipt()

if __name__=='__main__':unittest.main()
