"""Cryptographic PDF validation against explicit roots and revocation evidence.

This module performs no network requests and never installs uploaded roots.
The service supplies an authenticated, immutable trust snapshot. PDF, signing
keys and passwords are never written by the validator.
"""
import hashlib
import io
from datetime import datetime, timezone

from asn1crypto import crl
from cryptography import x509
from pyhanko.keys import load_certs_from_pemder_data
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pyhanko_certvalidator.policy_decl import (
    CertRevTrustPolicy, RevocationCheckingPolicy, RevocationCheckingRule,
)

from worker import certificate_cnpj, require_certificate_current, Refused
from signature_policy import OID, PINNED_POLICY_HASH_SHA256

MAX_PDF = 25 * 1024 * 1024
EXPECTED_CNPJ = "15883671000115"
VALIDATOR_VERSION = "peticao-pyhanko-0.31.0-v1"
VALIDATED_PROFILE = "pades-ad-rb-cryptographic-v1"


def rejected(code):
    return {"valid": False, "reason": code}


def declared_policy_matches(signature):
    attrs = [a for a in signature.signer_info["signed_attrs"]
             if a["type"].dotted == "1.2.840.113549.1.9.16.2.15"]
    if len(attrs) != 1 or len(attrs[0]["values"]) != 1:
        return False
    value = attrs[0]["values"][0]
    if value.name != "signature_policy_id":
        return False
    policy = value.chosen
    return (policy["sig_policy_id"].dotted == OID
            and policy["sig_policy_hash"]["digest_algorithm"]["algorithm"].native == "sha256"
            and policy["sig_policy_hash"]["digest"].native.hex() == PINNED_POLICY_HASH_SHA256)


def validate(pdf, roots_bytes, crl_bytes, *, require_policy=False, now=None):
    """Return a positive verdict only after full live-time crypto validation.

    Revocation information must be present and fresh for both the leaf and its
    issuing CAs. Missing evidence is an unavailable/rejected result, never a
    reason to trust an uploaded certificate. A caller can test this pure
    function with an isolated synthetic root without changing service trust.
    """
    if not isinstance(pdf, bytes) or not 5 < len(pdf) <= MAX_PDF or not pdf.startswith(b"%PDF-"):
        return rejected("pdf_invalid")
    moment = now or datetime.now(timezone.utc)
    try:
        roots = list(load_certs_from_pemder_data(roots_bytes))
        if not roots:
            return rejected("trust_unavailable")
        revocations = [crl.CertificateList.load(value, strict=True) for value in crl_bytes]
        if not revocations:
            return rejected("revocation_unavailable")
        reader = PdfFileReader(io.BytesIO(pdf), strict=True)
        if reader.encrypted or not reader.embedded_signatures:
            return rejected("signature_missing")
        signature = reader.embedded_signatures[-1]
        cert = signature.signer_cert
        # An explicit leaf date check also rejects an expired certificate that
        # somebody accidentally configured as a trust anchor.
        require_certificate_current(x509.load_der_x509_certificate(cert.dump()), moment)
        if certificate_cnpj(cert) != EXPECTED_CNPJ:
            return rejected("holder_mismatch")
        if any(cert.dump() == root.dump() for root in roots):
            return rejected("leaf_is_trust_anchor")
        context = ValidationContext(
            trust_roots=roots, crls=revocations, allow_fetching=False,
            moment=moment, revocation_mode="hard-fail",
            revinfo_policy=CertRevTrustPolicy(RevocationCheckingPolicy(
                RevocationCheckingRule.CRL_OR_OCSP_REQUIRED,
                RevocationCheckingRule.CRL_OR_OCSP_REQUIRED,
            )),
        )
        status = validate_pdf_signature(signature, signer_validation_context=context)
        coverage = getattr(status.coverage, "name", "UNKNOWN")
        if not status.intact or not status.valid:
            return rejected("signature_invalid")
        if not status.trusted:
            return rejected("chain_or_revocation_invalid")
        if not status.docmdp_ok or coverage != "ENTIRE_FILE":
            return rejected("document_modified")
        if require_policy and not declared_policy_matches(signature):
            return rejected("signature_policy_mismatch")
        if not require_policy:
            return {"valid": True, "signer": "ADUNIR", "cnpj": EXPECTED_CNPJ}
        return {
            "protocol": "peticao-a1-validation", "version": 2, "valid": True,
            "sha256": hashlib.sha256(pdf).hexdigest(), "cnpj": EXPECTED_CNPJ,
            "certificateFingerprintSha256": hashlib.sha256(cert.dump()).hexdigest(),
            "integrity": True, "icpBrasilChainTrusted": True,
            "coverage": "entire-file", "modificationsAllowed": True,
            "revocation": "good", "profile": VALIDATED_PROFILE, "policyOid": OID,
            "validatedAt": moment.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "validatorVersion": VALIDATOR_VERSION,
        }
    except Refused:
        return rejected("certificate_invalid")
    except Exception:
        # Parsing/cryptographic exceptions can contain subject data and paths.
        # They are intentionally not returned or logged.
        return rejected("validation_unavailable")
