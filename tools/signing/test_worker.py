"""Real cryptography with temporary, fictitious PKCS#12; never production ICP."""
import base64
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID, ObjectIdentifier
from pyhanko.pdf_utils.writer import PdfFileWriter
from pyhanko.pdf_utils.generic import DictionaryObject, ArrayObject, NumberObject, pdf_name

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("a1_worker", HERE / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Protected ancestor requirement intentionally excludes shared /tmp.
        cls.tmp = tempfile.TemporaryDirectory(prefix="a1-synthetic-", dir=os.environ["A1_TEST_PRIVATE_ROOT"])
        cls.root = Path(cls.tmp.name)
        (cls.root / "certificates").mkdir(mode=0o700)
        (cls.root / "credentials").mkdir(mode=0o700)
        now = datetime.now(timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC QA ROOT - NOT ICP BRASIL")])
        ca = x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key()).serial_number(1).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True,path_length=1),critical=True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True).sign(ca_key,hashes.SHA256())
        def pfx(cnpj):
            key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
            cert = x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,"SYNTHETIC QA ORGANIZATION")])).issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(hours=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),critical=True).add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier("2.16.76.1.3.3"), b"\x0c\x0e"+cnpj.encode())]),critical=False).sign(ca_key,hashes.SHA256())
            return pkcs12.serialize_key_and_certificates(b"QA", key, cert, [ca], serialization.BestAvailableEncryption(b"synthetic-password"))
        cls.pfx = pfx(worker.EXPECTED_CNPJ)
        cls.wrong_pfx = pfx("00000000000000")
        _,leaf,_=pkcs12.load_key_and_certificates(cls.pfx,b"synthetic-password")
        revoked=x509.RevokedCertificateBuilder().serial_number(leaf.serial_number).revocation_date(now-timedelta(minutes=5)).build()
        revoked_crl=x509.CertificateRevocationListBuilder().issuer_name(ca_name).last_update(now-timedelta(minutes=1)).next_update(now+timedelta(days=1)).add_revoked_certificate(revoked).sign(ca_key,hashes.SHA256()).public_bytes(serialization.Encoding.DER)
        cls.revoked_crl_path=cls.root/"certificates"/"revoked.crl"
        cls.revoked_crl_path.write_bytes(revoked_crl);cls.revoked_crl_path.chmod(0o600)
        valid_crl=x509.CertificateRevocationListBuilder().issuer_name(ca_name).last_update(now-timedelta(hours=1)).next_update(now+timedelta(days=1)).sign(ca_key,hashes.SHA256()).public_bytes(serialization.Encoding.DER)
        cls.crl_path=cls.root/"certificates"/"qa.crl"
        cls.crl_path.write_bytes(valid_crl);cls.crl_path.chmod(0o600)
        roots = ca.public_bytes(serialization.Encoding.PEM)
        for path,data in [(cls.root/"certificates"/"qa.pfx",cls.pfx),(cls.root/"credentials"/"password",b"synthetic-password"),(cls.root/"certificates"/"roots.pem",roots)]:
            path.write_bytes(data); path.chmod(0o600)
        cls.cfg = {"version":1,"credentialVersionId":"33333333-3333-4333-8333-333333333333","pfxPath":str(cls.root/"certificates"/"qa.pfx"),"passwordPath":str(cls.root/"credentials"/"password"),"trustRootsPath":str(cls.root/"certificates"/"roots.pem"),"trustStoreVersion":worker.digest(roots),"profile":"pades-basic-unhomologated-v1","environment":"synthetic-test"}
        cls.config_path = cls.root/"config.json"
        cls.config_path.write_text(json.dumps(cls.cfg)); cls.config_path.chmod(0o600)
        writer = PdfFileWriter()
        writer.insert_page(DictionaryObject({pdf_name("/Type"):pdf_name("/Page"),pdf_name("/MediaBox"):ArrayObject([NumberObject(n) for n in [0,0,300,300]]),pdf_name("/Resources"):DictionaryObject()}))
        out=io.BytesIO();writer.write(out);cls.pdf=out.getvalue()
        cls.req = {"version":1,"jobId":"11111111-1111-4111-8111-111111111111","documentVersion":"a"*64,"inputArtifactVersionId":"22222222-2222-4222-8222-222222222222","inputSha256":worker.digest(cls.pdf),"credentialVersionId":cls.cfg["credentialVersionId"],"pdfBase64":base64.b64encode(cls.pdf).decode(),"profileVersion":cls.cfg["profile"],"trustStoreVersion":cls.cfg["trustStoreVersion"],"expectedCnpj":worker.EXPECTED_CNPJ,"certificateFingerprintSha256":worker.digest(leaf.public_bytes(serialization.Encoding.DER))}

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def test_real_synthetic_signature_and_byte_tampering(self):
        result=worker.execute(self.req,self.pdf,self.cfg)
        self.assertTrue(result["ok"])
        self.assertFalse(result["report"]["icpBrasilQualified"])
        self.assertFalse(result["report"]["homologated"])
        signed=base64.b64decode(result["pdfBase64"])
        self.assertTrue(signed.startswith(self.pdf))
        self.assertEqual(result["outputSha256"],worker.digest(signed))
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import validate_pdf_signature
        from pyhanko.keys import load_certs_from_pemder_data
        from pyhanko_certvalidator import ValidationContext
        tampered=signed.replace(b"/MediaBox",b"/MediaB0x",1)
        reader=PdfFileReader(io.BytesIO(tampered))
        context=ValidationContext(trust_roots=list(load_certs_from_pemder_data(Path(self.cfg["trustRootsPath"]).read_bytes())),allow_fetching=False,revocation_mode="soft-fail")
        self.assertFalse(validate_pdf_signature(reader.embedded_signatures[0],signer_validation_context=context).intact)

    def test_holder_and_trust_store_mismatch_rejected(self):
        p=Path(self.cfg["pfxPath"])
        try:
            p.write_bytes(self.wrong_pfx)
            _,wrong_cert,_=pkcs12.load_key_and_certificates(self.wrong_pfx,b"synthetic-password")
            with self.assertRaisesRegex(worker.Refused,"holder_mismatch"):worker.execute({**self.req,"certificateFingerprintSha256":worker.digest(wrong_cert.public_bytes(serialization.Encoding.DER))},self.pdf,self.cfg)
        finally:p.write_bytes(self.pfx)
        with self.assertRaisesRegex(worker.Refused,"trust_store_hash_mismatch"):worker.execute({**self.req,"trustStoreVersion":"0"*64},self.pdf,{**self.cfg,"trustStoreVersion":"0"*64})

    def test_request_and_permissions_fail_closed(self):
        with self.assertRaisesRegex(worker.Refused,"input_hash_mismatch"):worker.parse_request(json.dumps({**self.req,"inputSha256":"0"*64}).encode())
        with self.assertRaisesRegex(worker.Refused,"invalid_request"):worker.parse_request(json.dumps({**self.req,"pfxPath":"/arbitrary"}).encode())
        with self.assertRaisesRegex(worker.Refused,"configuration_unavailable"):worker.load_config(str(self.root/"missing"))
        self.config_path.chmod(0o644)
        try:
            with self.assertRaisesRegex(worker.Refused,"configuration_unavailable"):worker.load_config(str(self.config_path))
        finally:self.config_path.chmod(0o600)

    def test_production_without_revocation_evidence_is_not_success(self):
        path=self.root/"production.json"
        path.write_text(json.dumps({**self.cfg,"environment":"production"}));path.chmod(0o600)
        run=subprocess.run([os.sys.executable,str(HERE/"worker.py")],input=json.dumps(self.req),text=True,capture_output=True,env={**os.environ,"A1_WORKER_CONFIG":str(path)},timeout=60)
        self.assertNotEqual(run.returncode,0)
        self.assertFalse(json.loads(run.stdout)["ok"])
        self.assertNotIn("pdfBase64",json.loads(run.stdout))

    def test_explicit_crl_validation_still_never_qualifies_icp(self):
        result=worker.execute(self.req,self.pdf,{**self.cfg,"environment":"production","crlPaths":[str(self.crl_path)]})
        self.assertTrue(result["ok"])
        self.assertEqual(result["report"]["revocation"],"crl-required-validation-passed")
        self.assertFalse(result["report"]["icpBrasilQualified"])

    def test_revoked_certificate_is_not_a_success(self):
        path=self.root/"revoked-config.json"
        path.write_text(json.dumps({**self.cfg,"environment":"production","crlPaths":[str(self.revoked_crl_path)]}));path.chmod(0o600)
        run=subprocess.run([os.sys.executable,str(HERE/"worker.py")],input=json.dumps(self.req),text=True,capture_output=True,env={**os.environ,"A1_WORKER_CONFIG":str(path)},timeout=60)
        self.assertNotEqual(run.returncode,0)
        self.assertFalse(json.loads(run.stdout)["ok"])
        self.assertNotIn("pdfBase64",json.loads(run.stdout))

    def test_signed_input_is_refused_and_identity_binding_is_strict(self):
        signed=base64.b64decode(worker.execute(self.req,self.pdf,self.cfg)["pdfBase64"])
        request={**self.req,"inputSha256":worker.digest(signed)}
        with self.assertRaisesRegex(worker.Refused,"input_pdf_unsupported"):worker.execute(request,signed,self.cfg)
        with self.assertRaisesRegex(worker.Refused,"credential_version_mismatch"):worker.execute({**self.req,"credentialVersionId":"44444444-4444-4444-8444-444444444444"},self.pdf,self.cfg)

    def test_subprocess_protocol_no_private_material(self):
        run=subprocess.run([os.sys.executable,str(HERE/"worker.py")],input=json.dumps(self.req),text=True,capture_output=True,env={**os.environ,"A1_WORKER_CONFIG":str(self.config_path)},timeout=60)
        self.assertEqual(run.returncode,0,run.stdout+run.stderr)
        result=json.loads(run.stdout);self.assertTrue(result["ok"])
        self.assertEqual(run.stderr,"")
        self.assertNotIn("synthetic-password",run.stdout)
        self.assertNotIn(str(self.root),run.stdout)

    def test_declared_ad_rb_policy_uses_internal_hash_and_never_qualifies(self):
        from signature_policy import PINNED_POLICY_FILE_SHA256, PINNED_POLICY_HASH_SHA256
        policy_path=self.root/"certificates"/"policy.der"
        policy_path.write_bytes((HERE/"fixtures"/"ad-rb-v1.3.der").read_bytes());policy_path.chmod(0o600)
        cfg={**self.cfg,"profile":worker.DECLARED_PROFILE,"policyPath":str(policy_path)}
        req={**self.req,"profileVersion":worker.DECLARED_PROFILE}
        worker.parse_request(json.dumps(req))
        result=worker.execute(req,self.pdf,cfg)
        self.assertEqual(result["report"]["signaturePolicy"],{"oid":"2.16.76.1.7.1.11.1.3","hashSha256":PINNED_POLICY_HASH_SHA256,"artifactSha256":PINNED_POLICY_FILE_SHA256})
        self.assertFalse(result["report"]["homologated"]);self.assertFalse(result["report"]["icpBrasilQualified"])
        with self.assertRaisesRegex(worker.Refused,"revocation_evidence_unavailable"):worker.execute(req,self.pdf,{**cfg,"environment":"production","crlPaths":[]})
        self.assertTrue(base64.b64decode(result["pdfBase64"]).startswith(self.pdf))
        if os.environ.get("QA_A1_POLICY_RESULT_DIR"):
            out=Path(os.environ["QA_A1_POLICY_RESULT_DIR"])
            for name,data in [("request.json",json.dumps(req).encode()),("response.json",json.dumps(result).encode()),("original.pdf",self.pdf)]:
                with (out/name).open("xb") as f:f.write(data)
                (out/name).chmod(0o600)
        try:
            policy_path.write_bytes(b"not the pinned policy")
            with self.assertRaisesRegex(worker.Refused,"signature_policy_unavailable"):worker.execute(req,self.pdf,cfg)
        finally:policy_path.unlink()

    def test_bad_policy_is_rejected_before_credential_material_is_read(self):
        path=self.root/"certificates"/"bad-policy.der";path.write_bytes(b"bad policy");path.chmod(0o600)
        cfg={**self.cfg,"profile":worker.DECLARED_PROFILE,"policyPath":str(path)};req={**self.req,"profileVersion":worker.DECLARED_PROFILE}
        try:
            with mock.patch.object(worker,"read_protected",wraps=worker.read_protected) as reader:
                with self.assertRaisesRegex(worker.Refused,"signature_policy_unavailable"):worker.execute(req,self.pdf,cfg)
                self.assertEqual([call.args[0] for call in reader.call_args_list],[str(path)])
        finally:path.unlink()

    def test_policy_config_is_required_only_for_declared_profile(self):
        original=self.config_path.read_bytes()
        try:
            for cfg in [{**self.cfg,"profile":worker.DECLARED_PROFILE},{**self.cfg,"policyPath":str(self.root/"policy.der")},{**self.cfg,"profile":"unrecognized"}]:
                self.config_path.write_text(json.dumps(cfg))
                with self.assertRaisesRegex(worker.Refused,"configuration_unavailable"):worker.load_config(self.config_path)
            cfg={**self.cfg,"profile":worker.DECLARED_PROFILE,"policyPath":str(self.root/"policy.der")}
            self.config_path.write_text(json.dumps(cfg));self.assertEqual(worker.load_config(self.config_path),cfg)
        finally:self.config_path.write_bytes(original)

if __name__ == "__main__": unittest.main()
