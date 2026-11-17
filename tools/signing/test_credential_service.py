import base64
import hashlib
import importlib
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
from datetime import datetime,timedelta,timezone
from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID,ObjectIdentifier
from asn1crypto import core
import credential_service as broker

class CredentialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.now=datetime.now(timezone.utc);cls.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cls.name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'PRIVATE QA ONLY')])
    def setUp(self):
        private=Path(os.environ['A1_TEST_PRIVATE_ROOT']);private.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=private);self.root=Path(self.tmp.name)
        self.store=self.root/'store';self.store.mkdir(mode=0o700);self.config=self.root/'config';self.config.mkdir(mode=0o700)
        self.key_path=self.config/'password.key';self.key_path.write_bytes(Fernet.generate_key());self.key_path.chmod(0o600)
        self.roots=self.config/'roots.pem';self.roots.write_bytes(b'PRIVATE QA TRUST SNAPSHOT');self.roots.chmod(0o600)
        self.cfg={'version':1,'socketPath':str(self.root/'credentials.sock'),'storageRoot':str(self.store),'encryptionKeyPath':str(self.key_path),'workerConfigPath':str(self.config/'worker.json'),'trustRootsPath':str(self.roots),'policyPath':str(self.config/'policy.der'),'crlPaths':[],'environment':'production'}
        self.calls=0
        def trust(cert,chain,roots,cache):
            self.calls+=1
            return {'trustStoreVersion':hashlib.sha256(roots).hexdigest(),'crlPaths':[str(cache/'qa.crl')]}
        self.preparer=trust;self.c=broker.Credentials(self.cfg,trust)
    def tearDown(self):self.tmp.cleanup()
    def pfx(self,cnpj=broker.EXPECTED_CNPJ,expired=False):
        end=self.now-timedelta(days=1)if expired else self.now+timedelta(days=1)
        cert=x509.CertificateBuilder().subject_name(self.name).issuer_name(self.name).public_key(self.key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(self.now-timedelta(days=2)).not_valid_after(end).add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier('2.16.76.1.3.3'),core.UTF8String(cnpj).dump())]),critical=False).sign(self.key,hashes.SHA256())
        return pkcs12.serialize_key_and_certificates(b'PRIVATE QA',self.key,cert,None,serialization.BestAvailableEncryption(b'qa-only-password'))
    def request(self,**kwargs):return {'version':1,'operation':'put','requestId':str(uuid.uuid4()),'pfxBase64':base64.b64encode(self.pfx(**kwargs)).decode(),'password':'qa-only-password'}
    def test_refresh_preserves_credential_and_policy_metadata_and_failure_keeps_config(self):
        request=self.request();initial=self.c.handle(request);before=(self.store/'active.json').read_bytes()
        refresh={'version':1,'operation':'refresh','credentialVersionId':request['requestId']}
        result=self.c.handle(refresh);self.assertTrue(result['ok']);self.assertEqual(result['credentialVersionId'],request['requestId']);self.assertEqual(before,(self.store/'active.json').read_bytes())
        config=Path(self.cfg['workerConfigPath']);current=config.read_bytes()
        def unavailable(*args):raise ValueError('CRL expired or revoked')
        self.c.trust_preparer=unavailable
        with self.assertRaisesRegex(broker.CredentialError,'chain_or_revocation_unavailable'):self.c.handle(refresh)
        self.assertEqual(config.read_bytes(),current);self.assertEqual(before,(self.store/'active.json').read_bytes())
        with self.assertRaisesRegex(broker.CredentialError,'credential_superseded'):self.c.handle({**refresh,'credentialVersionId':str(uuid.uuid4())})

    def test_global_deadline_bounds_operation_and_cancels_alarm(self):
        with self.assertRaisesRegex(broker.CredentialError,'credential_operation_timeout'):
            with broker.operation_deadline(.05):time.sleep(1)
        self.assertEqual(__import__('signal').getitimer(__import__('signal').ITIMER_REAL),(0.0,0.0))

    def test_stale_socket_recovered_active_socket_and_unknown_file_preserved(self):
        path=self.root/'probe.sock'
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as active:
            active.bind(str(path));active.listen(1)
            with self.assertRaisesRegex(broker.CredentialError,'socket_already_active'):broker.cleanup_stale_socket(path)
            self.assertTrue(path.exists())
        self.assertTrue(broker.cleanup_stale_socket(path));self.assertFalse(path.exists())
        path.write_bytes(b'unknown')
        with self.assertRaisesRegex(broker.CredentialError,'unsafe_socket_path'):broker.cleanup_stale_socket(path)
        self.assertEqual(path.read_bytes(),b'unknown')

    def test_service_starts_without_certificate_and_sigterm_cleans_owned_socket(self):
        path=self.root/'service.json';path.write_text(json.dumps(self.cfg));path.chmod(0o600)
        process=subprocess.Popen([sys.executable,str(Path(broker.__file__))],env={**os.environ,'A1_CREDENTIAL_CONFIG':str(path)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+10
            while not Path(self.cfg['socketPath']).exists()and process.poll()is None and time.monotonic()<deadline:time.sleep(.05)
            self.assertIsNone(process.poll());self.assertTrue(Path(self.cfg['socketPath']).exists())
            process.terminate();self.assertEqual(process.wait(timeout=10),0);self.assertFalse(Path(self.cfg['socketPath']).exists())
        finally:
            if process.poll()is None:process.kill();process.wait()

    def test_storage_encryption_and_idempotent_recovery(self):
        request=self.request();first=self.c.handle(request);self.assertTrue(first['ok']);self.assertFalse(first['replayed']);self.assertEqual(self.calls,1)
        self.assertEqual(self.c.handle(request)['credential'],first['credential']);self.assertEqual(self.calls,1)
        replay=self.c.handle({'version':1,'operation':'put','requestId':request['requestId']});self.assertTrue(replay['replayed'])
        plain=b'qa-only-password'
        for f in self.store.rglob('*'):
            if f.is_file():self.assertEqual(f.stat().st_mode&0o777,0o600);self.assertNotIn(plain,f.read_bytes())
        cfg=json.loads(Path(self.cfg['workerConfigPath']).read_text());self.assertTrue(cfg['passwordEncrypted']);self.assertNotEqual(Path(cfg['pfxPath']).parent,Path(cfg['passwordPath']).parent)
        self.assertEqual(Fernet(self.key_path.read_bytes()).decrypt(Path(cfg['passwordPath']).read_bytes()),plain)
        self.assertNotIn('pfxBase64',json.dumps(first));self.assertNotIn('password',json.dumps(first))
    def test_wrong_password_wrong_holder_and_expired_rejected_before_storage(self):
        for kind in ['password','holder','expired']:
            request=self.request(cnpj='00000000000000')if kind=='holder'else self.request(expired=kind=='expired')
            if kind=='password':request['password']='WRONG'
            with self.assertRaises(broker.CredentialError):self.c.handle(request)
        self.assertEqual(list((self.store/'receipts').iterdir()),[]);self.assertEqual(self.calls,0)
    def test_same_request_id_different_secret_is_conflict(self):
        request=self.request();self.c.handle(request);request['password']='changed'
        with self.assertRaisesRegex(broker.CredentialError,'request_conflict'):self.c.handle(request)
    def test_old_intent_cannot_replace_new_credential(self):
        one=self.request();two=self.request()
        with patch.object(broker,'stamp',return_value='2026-11-12T10:00:00.000Z'):
            self.c.handle(one);self.c.handle(two)
        with self.assertRaisesRegex(broker.CredentialError,'credential_superseded'):self.c.handle({'version':1,'operation':'put','requestId':one['requestId']})
        self.assertEqual(self.c.get()['currentCredentialVersionId'],two['requestId'])
    def test_get_is_readonly_and_restart_recovers_no_secrets(self):
        request=self.request();self.c.handle(request);before={str(p):p.read_bytes()for p in self.store.rglob('*')if p.is_file()};restarted=broker.Credentials(self.cfg,self.preparer)
        result=restarted.handle({'version':1,'operation':'get','requestId':request['requestId']});self.assertEqual(result['intent']['state'],'completed');self.assertEqual(before,{str(p):p.read_bytes()for p in self.store.rglob('*')if p.is_file()})
    def test_request_fields_and_missing_recovery_are_rejected(self):
        with self.assertRaisesRegex(broker.CredentialError,'request_not_found'):self.c.handle({'version':1,'operation':'put','requestId':str(uuid.uuid4())})
        request=self.request();request['pfxPath']='/etc/passwd'
        with self.assertRaisesRegex(broker.CredentialError,'invalid_request'):self.c.handle(request)
    def test_trust_failure_does_not_publish_or_store_credential(self):
        def broken(*args):raise ValueError('PRIVATE QA ERROR PATH NEVER RETURN')
        self.c.trust_preparer=broken
        with self.assertRaisesRegex(broker.CredentialError,'chain_or_revocation_unavailable'):self.c.handle(self.request())
        self.assertIsNone(self.c.get()['credential']);self.assertEqual(list((self.store/'receipts').iterdir()),[])

if __name__=='__main__':unittest.main()
