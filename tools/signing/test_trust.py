from pathlib import Path
import tempfile
import unittest
from datetime import timedelta
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from unittest.mock import patch
from asn1crypto import x509 as asn1_x509
from cryptography.hazmat.primitives import serialization

from test_validation import ValidationTests
from trust import prepare_certificate_trust, fetch_crl, TrustUnavailable


class TrustTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ValidationTests.setUpClass()
        cls.fixture = ValidationTests()

    def test_trusted_certificate_fetches_signed_distribution_point(self):
        _, certificate = self.fixture.certificate(crl_url="https://public.example.test/issuer.crl")
        cert = asn1_x509.Certificate.load(certificate.public_bytes(serialization.Encoding.DER))
        calls = []
        def fetch(url):
            calls.append(url)
            return self.fixture.revocations()[0]
        with tempfile.TemporaryDirectory() as tmp:
            result = prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=fetch)
            self.assertEqual(calls, ["https://public.example.test/issuer.crl"])
            self.assertEqual(len(result["crlPaths"]), 1)
            self.assertEqual(Path(result["crlPaths"][0]).stat().st_mode & 0o777, 0o600)

    def test_no_network_before_path_trusted(self):
        _, certificate = self.fixture.certificate(crl_url="https://public.example.test/issuer.crl")
        cert = asn1_x509.Certificate.load(certificate.public_bytes(serialization.Encoding.DER))
        with tempfile.TemporaryDirectory() as tmp, patch("trust.fetch_crl") as fetch:
            with self.assertRaises(Exception):
                prepare_certificate_trust(cert, [], b"", Path(tmp), fetcher=fetch)
            fetch.assert_not_called()

    def test_private_dns_and_unsupported_schemes_rejected_before_connect(self):
        with patch("trust.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 80))]), patch("trust.socket.create_connection") as connect:
            with self.assertRaises(TrustUnavailable): fetch_crl("http://public.example.test/crl")
            connect.assert_not_called()
        for url in ["file:///etc/passwd", "http://user:secret@example.test/crl", "http://example.test:22/crl"]:
            with self.assertRaises(TrustUnavailable): fetch_crl(url)

    def test_revoked_certificate_never_activates(self):
        _, certificate = self.fixture.certificate(crl_url="https://public.example.test/issuer.crl")
        cert = asn1_x509.Certificate.load(certificate.public_bytes(serialization.Encoding.DER))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(Exception):
                prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=lambda _: self.fixture.revocations(certificate)[0])

    def test_failed_refresh_never_overwrites_active_crl_snapshot(self):
        _, certificate = self.fixture.certificate(crl_url="https://public.example.test/issuer.crl")
        cert = asn1_x509.Certificate.load(certificate.public_bytes(serialization.Encoding.DER))
        with tempfile.TemporaryDirectory() as tmp:
            prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=lambda _: self.fixture.revocations()[0])
            before = {p.name: p.read_bytes() for p in Path(tmp).iterdir()}
            with self.assertRaises(Exception):
                prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=lambda _: self.fixture.revocations(certificate)[0], force_refresh=True)
            self.assertEqual(before, {p.name: p.read_bytes() for p in Path(tmp).iterdir()})

    def test_fresh_cache_and_near_expiry_refresh_keep_old_content_address(self):
        _, certificate = self.fixture.certificate(crl_url="https://public.example.test/issuer.crl")
        cert = asn1_x509.Certificate.load(certificate.public_bytes(serialization.Encoding.DER))
        near = (x509.CertificateRevocationListBuilder().issuer_name(self.fixture.root_name)
                .last_update(self.fixture.now-timedelta(minutes=2)).next_update(self.fixture.now+timedelta(minutes=1))
                .sign(self.fixture.root_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER))
        with tempfile.TemporaryDirectory() as tmp:
            first = prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=lambda _: near)
            old = Path(first['crlPaths'][0]).read_bytes()
            second = prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=lambda _: self.fixture.revocations()[0])
            self.assertNotEqual(first['crlPaths'], second['crlPaths'])
            self.assertEqual(Path(first['crlPaths'][0]).read_bytes(), old)
            def no_fetch(_): raise AssertionError('fresh CRL must be reused')
            third = prepare_certificate_trust(cert, [], self.fixture.roots, Path(tmp), fetcher=no_fetch)
            self.assertEqual(second['crlPaths'], third['crlPaths'])


if __name__ == "__main__": unittest.main()
