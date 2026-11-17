import io
import unittest
from datetime import datetime, timedelta, timezone

from asn1crypto import core, x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ObjectIdentifier
from pyhanko.pdf_utils.writer import PdfFileWriter
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.generic import DictionaryObject, ArrayObject, NumberObject, pdf_name
from pyhanko.sign import signers
from pyhanko.sign.ades.api import CAdESSignedAttrSpec
from pyhanko_certvalidator.registry import SimpleCertificateStore
from pathlib import Path
from signature_policy import parse_policy, PINNED_POLICY_FILE_SHA256

import validation


class ValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.now = datetime.now(timezone.utc)
        cls.root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.root_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PRIVATE QA ROOT")])
        cls.root = (x509.CertificateBuilder().subject_name(cls.root_name).issuer_name(cls.root_name)
                    .public_key(cls.root_key.public_key()).serial_number(1)
                    .not_valid_before(cls.now - timedelta(days=1)).not_valid_after(cls.now + timedelta(days=30))
                    .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
                    .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
                    .sign(cls.root_key, hashes.SHA256()))
        cls.roots = cls.root.public_bytes(serialization.Encoding.PEM)
        cls.serial = 20

    def certificate(self, cnpj=validation.EXPECTED_CNPJ, expired=False, crl_url=None):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        type(self).serial += 1
        end = self.now - timedelta(minutes=1) if expired else self.now + timedelta(days=2)
        builder = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PRIVATE QA HOLDER")]))
                .issuer_name(self.root_name).public_key(key.public_key()).serial_number(self.serial)
                .not_valid_before(self.now - timedelta(days=2)).not_valid_after(end)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier("2.16.76.1.3.3"), core.UTF8String(cnpj).dump())]), critical=False))
        if crl_url:
            builder = builder.add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(full_name=[x509.UniformResourceIdentifier(crl_url)], relative_name=None, reasons=None, crl_issuer=None)]), critical=False)
        cert = builder.sign(self.root_key, hashes.SHA256())
        return key, cert

    def revocations(self, revoked=None, stale=False):
        end = self.now - timedelta(minutes=1) if stale else self.now + timedelta(days=1)
        builder = x509.CertificateRevocationListBuilder().issuer_name(self.root_name).last_update(self.now - timedelta(hours=2)).next_update(end)
        if revoked:
            builder = builder.add_revoked_certificate(x509.RevokedCertificateBuilder().serial_number(revoked.serial_number).revocation_date(self.now - timedelta(hours=1)).build())
        return [builder.sign(self.root_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)]

    def signed(self, key, cert, declare_policy=False):
        writer = PdfFileWriter()
        writer.insert_page(DictionaryObject({pdf_name("/Type"): pdf_name("/Page"), pdf_name("/MediaBox"): ArrayObject([NumberObject(0), NumberObject(0), NumberObject(300), NumberObject(300)]), pdf_name("/Resources"): DictionaryObject()}))
        stream = io.BytesIO(); writer.write(stream)
        store = SimpleCertificateStore(); store.register(asn1_x509.Certificate.load(self.root.public_bytes(serialization.Encoding.DER)))
        signer = signers.SimpleSigner(signing_cert=asn1_x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER)), signing_key=__import__('asn1crypto.keys', fromlist=['PrivateKeyInfo']).PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())), cert_registry=store)
        policy = parse_policy((Path(__file__).parent / 'fixtures/ad-rb-v1.3.der').read_bytes(), PINNED_POLICY_FILE_SHA256) if declare_policy else None
        spec = CAdESSignedAttrSpec(signature_policy_identifier=policy.identifier()) if policy else None
        return signers.sign_pdf(IncrementalPdfFileWriter(io.BytesIO(stream.getvalue())), signers.PdfSignatureMetadata(field_name="QA", md_algorithm="sha256", cades_signed_attr_spec=spec), signer=signer).getvalue()

    def test_valid_real_signature_and_fresh_crl(self):
        key, cert = self.certificate()
        self.assertTrue(validation.validate(self.signed(key, cert), self.roots, self.revocations())["valid"])

    def test_v2_proof_binds_real_pdf_certificate_and_signed_policy(self):
        key, cert = self.certificate(); pdf = self.signed(key, cert, declare_policy=True)
        result = validation.validate(pdf, self.roots, self.revocations(), require_policy=True)
        self.assertTrue(result['valid'], result)
        self.assertEqual(result['protocol'], 'peticao-a1-validation')
        self.assertEqual(result['policyOid'], '2.16.76.1.7.1.11.1.3')
        self.assertEqual(result['profile'], validation.VALIDATED_PROFILE)
        self.assertEqual(result['sha256'], __import__('hashlib').sha256(pdf).hexdigest())

    def test_revoked_certificate_rejected(self):
        key, cert = self.certificate()
        self.assertFalse(validation.validate(self.signed(key, cert), self.roots, self.revocations(cert))["valid"])

    def test_expired_certificate_rejected(self):
        key, cert = self.certificate(expired=True)
        self.assertFalse(validation.validate(self.signed(key, cert), self.roots, self.revocations())["valid"])

    def test_missing_and_stale_revocation_are_not_success(self):
        key, cert = self.certificate(); pdf = self.signed(key, cert)
        self.assertFalse(validation.validate(pdf, self.roots, [])["valid"])
        self.assertFalse(validation.validate(pdf, self.roots, self.revocations(stale=True))["valid"])

    def test_holder_mismatch_rejected(self):
        key, cert = self.certificate(cnpj="00000000000000")
        self.assertEqual(validation.validate(self.signed(key, cert), self.roots, self.revocations())["reason"], "holder_mismatch")

    def test_untrusted_root_is_not_installed_from_pdf(self):
        key, cert = self.certificate()
        self.assertFalse(validation.validate(self.signed(key, cert), b"", self.revocations())["valid"])

    def test_appended_modification_and_missing_policy_rejected(self):
        key, cert = self.certificate(); pdf = self.signed(key, cert)
        self.assertFalse(validation.validate(pdf + b"\nmodified", self.roots, self.revocations())["valid"])
        self.assertEqual(validation.validate(pdf, self.roots, self.revocations(), require_policy=True)["reason"], "signature_policy_mismatch")


if __name__ == "__main__":
    unittest.main()
