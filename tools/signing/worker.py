#!/usr/bin/env python3
"""One-job, offline signing subprocess. Never a network listener or an ICP verdict."""
import base64
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import resource
import signal
import stat
import sys

MAX_PDF = 25 * 1024 * 1024
MAX_REQUEST = ((MAX_PDF + 2) // 3) * 4 + 4096
CONFIG_PATH = "/etc/peticao-signing/worker.json"
EXPECTED_CNPJ = "15883671000115"
DECLARED_PROFILE = "pades-ad-rb-declared-unhomologated-v1"
PROFILES = {"pades-basic-unhomologated-v1", DECLARED_PROFILE}
HASH = re.compile(r"^[a-f0-9]{64}$")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
KEYS = {"version", "jobId", "documentVersion", "inputArtifactVersionId", "inputSha256", "credentialVersionId", "profileVersion", "trustStoreVersion", "expectedCnpj", "certificateFingerprintSha256", "pdfBase64"}

class Refused(Exception):
    pass

def reject(code):
    raise Refused(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_protected(path, limit):
    """No links, writable parents or group/world-readable credential files."""
    p = Path(path)
    if not p.is_absolute():
        reject("configuration_unavailable")
    for parent in [p, *p.parents]:
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            reject("configuration_unavailable")
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > limit:
            reject("configuration_unavailable")
        data = os.read(fd, limit + 1)
        if len(data) > limit:
            reject("configuration_unavailable")
        return data
    finally:
        os.close(fd)

def parse_request(raw):
    if len(raw) > MAX_REQUEST:
        reject("request_too_large")
    try:
        req = json.loads(raw)
    except (ValueError, UnicodeError):
        reject("invalid_request")
    if not isinstance(req, dict) or set(req) != KEYS or type(req.get("version")) is not int or req["version"] != 1:
        reject("invalid_request")
    for key in ("jobId", "inputArtifactVersionId", "credentialVersionId"):
        if not isinstance(req[key], str) or not UUID.fullmatch(req[key]):
            reject("invalid_request")
    for key in ("documentVersion", "inputSha256", "trustStoreVersion", "certificateFingerprintSha256"):
        if not isinstance(req[key], str) or not HASH.fullmatch(req[key]):
            reject("invalid_request")
    if req["expectedCnpj"] != EXPECTED_CNPJ or req["profileVersion"] not in PROFILES:
        reject("invalid_request")
    try:
        encoded = req["pdfBase64"]
        if not isinstance(encoded, str) or len(encoded) > ((MAX_PDF + 2) // 3) * 4:
            reject("request_too_large")
        pdf = base64.b64decode(encoded, validate=True)
        if base64.b64encode(pdf).decode("ascii") != encoded:
            reject("invalid_request")
    except (ValueError, UnicodeError):
        reject("invalid_request")
    if not 0 < len(pdf) <= MAX_PDF or not pdf.startswith(b"%PDF-"):
        reject("invalid_pdf")
    if digest(pdf) != req["inputSha256"]:
        reject("input_hash_mismatch")
    return req, pdf

def load_config(path):
    try:
        cfg = json.loads(read_protected(path, 16384))
        required = {"version", "credentialVersionId", "pfxPath", "passwordPath", "trustRootsPath", "trustStoreVersion", "profile", "environment"}
        if isinstance(cfg, dict) and cfg.get("profile") == DECLARED_PROFILE: required.add("policyPath")
        if not isinstance(cfg, dict) or not required <= set(cfg) or set(cfg) - required - {"crlPaths"}:
            reject("configuration_unavailable")
        if type(cfg["version"]) is not int or cfg["version"] != 1 or not UUID.fullmatch(cfg["credentialVersionId"]):
            reject("configuration_unavailable")
        if cfg["profile"] not in PROFILES or cfg["environment"] not in {"synthetic-test", "production"}:
            reject("configuration_unavailable")
        if not HASH.fullmatch(cfg["trustStoreVersion"]):
            reject("configuration_unavailable")
        paths = [cfg["pfxPath"], cfg["passwordPath"], cfg["trustRootsPath"]]
        if cfg["profile"] == DECLARED_PROFILE: paths.append(cfg["policyPath"])
        if len(set(paths)) != len(paths) or Path(cfg["pfxPath"]).parent == Path(cfg["passwordPath"]).parent:
            reject("configuration_unavailable")
        if not isinstance(cfg.get("crlPaths", []), list) or len(cfg.get("crlPaths", [])) > 16:
            reject("configuration_unavailable")
        return cfg
    except Refused:
        raise
    except Exception:
        reject("configuration_unavailable")

def certificate_cnpj(cert):
    """ICP-Brasil CNPJ SAN otherName OID; never infer identity from CN/text."""
    from asn1crypto import core
    from cryptography import x509
    from cryptography.x509.oid import ExtensionOID, ObjectIdentifier
    public = x509.load_der_x509_certificate(cert.dump())
    try:
        san = public.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value
    except x509.ExtensionNotFound:
        return None
    values = []
    for other in san.get_values_for_type(x509.OtherName):
        if other.type_id != ObjectIdentifier("2.16.76.1.3.3"):
            continue
        try:
            value = core.Asn1Value.load(other.value, strict=True).native
            if isinstance(value, bytes):
                value = value.decode("ascii")
            if isinstance(value, str) and re.fullmatch(r"[0-9]{14}", value):
                values.append(value)
        except (ValueError, UnicodeError):
            continue
    return values[0] if len(values) == 1 else None

def execute(req, original, cfg):
    from asn1crypto import crl
    from pyhanko.keys import load_certs_from_pemder_data
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign import signers
    from pyhanko.sign.fields import SigSeedSubFilter
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext
    from importlib.metadata import version
    if version("pyHanko") != "0.31.0":
        reject("dependency_version_mismatch")
    if req["profileVersion"] != cfg["profile"] or req["trustStoreVersion"] != cfg["trustStoreVersion"]:
        reject("policy_version_mismatch")
    if req["credentialVersionId"] != cfg["credentialVersionId"]:
        reject("credential_version_mismatch")
    declared_policy = None
    if cfg["profile"] == DECLARED_PROFILE:
        try:
            from signature_policy import parse_policy, PINNED_POLICY_FILE_SHA256, PINNED_POLICY_HASH_SHA256
            declared_policy = parse_policy(read_protected(cfg["policyPath"], 1024*1024), PINNED_POLICY_FILE_SHA256)
            if declared_policy.policy_hash.hex() != PINNED_POLICY_HASH_SHA256: reject("signature_policy_unavailable")
        except Exception:
            reject("signature_policy_unavailable")
    from pyhanko.sign.ades.api import CAdESSignedAttrSpec
    cades_spec = CAdESSignedAttrSpec(signature_policy_identifier=declared_policy.identifier()) if declared_policy else None
    # Read all credential material through protected descriptors; pyHanko receives bytes.
    pfx = read_protected(cfg["pfxPath"], 4 * 1024 * 1024)
    password = read_protected(cfg["passwordPath"], 4096)
    roots_data = read_protected(cfg["trustRootsPath"], 4 * 1024 * 1024)
    if digest(roots_data) != cfg["trustStoreVersion"]:
        reject("trust_store_hash_mismatch")
    roots = list(load_certs_from_pemder_data(roots_data))
    if not roots or not password:
        reject("configuration_unavailable")
    from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PrivateFormat, NoEncryption
    from asn1crypto import keys, x509 as asn1_x509
    from pyhanko_certvalidator.registry import SimpleCertificateStore
    key, cert, chain = pkcs12.load_key_and_certificates(pfx, password)
    if not key or not cert:
        reject("credential_unavailable")
    store = SimpleCertificateStore()
    for item in chain or []:
        store.register(asn1_x509.Certificate.load(item.public_bytes(Encoding.DER)))
    signer = signers.SimpleSigner(
        signing_cert=asn1_x509.Certificate.load(cert.public_bytes(Encoding.DER)),
        signing_key=keys.PrivateKeyInfo.load(key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())),
        cert_registry=store,
    )
    if digest(signer.signing_cert.dump()) != req["certificateFingerprintSha256"]:
        reject("certificate_fingerprint_mismatch")
    if certificate_cnpj(signer.signing_cert) != EXPECTED_CNPJ:
        reject("holder_mismatch")
    crls = [crl.CertificateList.load(read_protected(path, 4 * 1024 * 1024)) for path in cfg.get("crlPaths", [])]
    synthetic = cfg["environment"] == "synthetic-test"
    from pyhanko_certvalidator.policy_decl import CertRevTrustPolicy, RevocationCheckingPolicy, RevocationCheckingRule
    if not synthetic and not crls:
        reject("revocation_evidence_unavailable")
    policy = None if synthetic else CertRevTrustPolicy(RevocationCheckingPolicy(
        RevocationCheckingRule.CRL_REQUIRED, RevocationCheckingRule.CRL_REQUIRED))
    context = ValidationContext(trust_roots=roots, allow_fetching=False, crls=crls,
        revocation_mode="soft-fail" if synthetic else "hard-fail", revinfo_policy=policy)
    reader = PdfFileReader(io.BytesIO(original), strict=True)
    if reader.encrypted or reader.embedded_signatures:
        reject("input_pdf_unsupported")
    output = signers.sign_pdf(
        IncrementalPdfFileWriter(io.BytesIO(original)),
        signature_meta=signers.PdfSignatureMetadata(field_name="A1_" + req["jobId"].replace("-", ""),
            md_algorithm="sha256", subfilter=SigSeedSubFilter.PADES, cades_signed_attr_spec=cades_spec),
        signer=signer,
    ).getvalue()
    if len(output) > MAX_PDF or not output.startswith(original):
        reject("output_pdf_invalid")
    signed = PdfFileReader(io.BytesIO(output), strict=True)
    if len(signed.embedded_signatures) != 1:
        reject("output_pdf_invalid")
    status = validate_pdf_signature(signed.embedded_signatures[0], signer_validation_context=context)
    coverage = getattr(status.coverage, "name", "UNKNOWN")
    if not (status.intact and status.valid and status.trusted and status.docmdp_ok and coverage == "ENTIRE_FILE"):
        reject("signature_validation_failed")
    result = {"version": 1, "ok": True, "jobId": req["jobId"], "documentVersion": req["documentVersion"],
        "inputArtifactVersionId": req["inputArtifactVersionId"], "credentialVersionId": req["credentialVersionId"],
        "profileVersion": req["profileVersion"], "trustStoreVersion": req["trustStoreVersion"], "expectedCnpj": EXPECTED_CNPJ, "certificateFingerprintSha256": req["certificateFingerprintSha256"],
        "inputSha256": digest(original), "outputSha256": digest(output), "pdfBase64": base64.b64encode(output).decode("ascii"),
        "report": {"version": 1, "engine": "pyHanko", "engineVersion": "0.31.0", "integrity": True,
            "chainTrusted": True, "holderCnpj": EXPECTED_CNPJ, "coverage": coverage, "docmdpOk": True,
            "fingerprintSha256": digest(signer.signing_cert.dump()), "trustStoreVersion": cfg["trustStoreVersion"],
            "profile": cfg["profile"], "environment": cfg["environment"],
            "revocation": "not-required-synthetic-test" if synthetic else "crl-required-validation-passed",
            "timestamp": "not-requested", "icpBrasilQualified": False, "homologated": False}}
    if declared_policy:
        attributes = [a for a in signed.embedded_signatures[0].signer_info["signed_attrs"] if a["type"].dotted == "1.2.840.113549.1.9.16.2.15"]
        if len(attributes) != 1 or len(attributes[0]["values"]) != 1 or attributes[0]["values"][0].dump() != declared_policy.identifier().dump():
            reject("signature_policy_declaration_mismatch")
        result["report"]["signaturePolicy"] = {"oid": declared_policy.oid,"hashSha256": declared_policy.policy_hash.hex(),"artifactSha256": declared_policy.file_sha256}
    return result

def main():
    logging.disable(logging.CRITICAL)
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: reject("worker_timeout"))
    signal.alarm(60)
    resource.setrlimit(resource.RLIMIT_CPU, (45, 50))
    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        req, original = parse_request(raw)
        cfg = load_config(os.environ.get("A1_WORKER_CONFIG", CONFIG_PATH))
        result = execute(req, original, cfg)
    except Refused as error:
        result = {"version": 1, "ok": False, "error": str(error)}
    except ImportError:
        result = {"version": 1, "ok": False, "error": "dependency_unavailable"}
    except Exception:
        # Never emit exception strings: libraries can include paths/credential context.
        result = {"version": 1, "ok": False, "error": "signing_unavailable"}
    finally:
        signal.alarm(0)
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0 if result["ok"] else 1

if __name__ == "__main__":
    sys.exit(main())
