"""Revocation cache populated only after an offline trusted-path check.

Download targets come from signed certificates in the verified path. Each DNS
answer is checked and the connection is pinned to that public address. No
proxy, private network, redirect, upload-provided root or implicit OS trust.
"""
import asyncio
import hashlib
import http.client
import ipaddress
import os
from pathlib import Path
import socket
import ssl
import tempfile
from urllib.parse import urlsplit

from asn1crypto import crl
from pyhanko.keys import load_certs_from_pemder_data
from pyhanko_certvalidator import CertificateValidator, ValidationContext
from pyhanko_certvalidator.policy_decl import CertRevTrustPolicy, RevocationCheckingPolicy, RevocationCheckingRule

MAX_CRL = 4 * 1024 * 1024


class TrustUnavailable(Exception):
    pass


def fetch_crl(url, timeout=5):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 for c in url):
        raise TrustUnavailable("revocation_url_invalid")
    u = urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.fragment:
        raise TrustUnavailable("revocation_url_invalid")
    port = u.port or (443 if u.scheme == "https" else 80)
    if port not in (80, 443):
        raise TrustUnavailable("revocation_url_invalid")
    addresses = socket.getaddrinfo(u.hostname, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise TrustUnavailable("revocation_destination_rejected")
    # Pin the actual socket to a checked address; do not re-resolve on connect.
    conn = http.client.HTTPConnection(u.hostname, port, timeout=timeout)
    conn.sock = socket.create_connection((addresses[0][4][0], port), timeout)
    if u.scheme == "https":
        conn.sock = ssl.create_default_context().wrap_socket(conn.sock, server_hostname=u.hostname)
    try:
        conn.request("GET", (u.path or "/") + ("?" + u.query if u.query else ""), headers={"Accept": "application/pkix-crl,application/octet-stream", "User-Agent": "Peticao-Revocation/1"})
        response = conn.getresponse()
        # Redirects are deliberately rejected. A different host must have its
        # own authenticated distribution point, not a redirect chain.
        if response.status != 200:
            raise TrustUnavailable("revocation_download_failed")
        raw = response.read(MAX_CRL + 1)
        if not raw or len(raw) > MAX_CRL:
            raise TrustUnavailable("revocation_size_invalid")
        crl.CertificateList.load(raw, strict=True)
        return raw
    finally:
        conn.close()


def _write(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".crl-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(value); out.flush(); os.fsync(out.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _urls(cert):
    result = []
    for point in cert.crl_distribution_points:
        name = point["distribution_point"]
        if name.name != "full_name":
            continue
        for general in name.chosen:
            if general.name == "uniform_resource_identifier":
                result.append(general.native)
    return list(dict.fromkeys(result))[:4]


def prepare_certificate_trust(cert, intermediates, roots_bytes, cache_directory, *, fetcher=fetch_crl):
    roots = list(load_certs_from_pemder_data(roots_bytes))
    if not roots or any(cert.dump() == r.dump() for r in roots):
        raise TrustUnavailable("untrusted_certificate")
    # No network is permitted until the entire path is anchored to the pinned
    # root snapshot. This preliminary pass does not constitute final approval.
    preliminary = ValidationContext(trust_roots=roots, allow_fetching=False, revocation_mode="soft-fail")
    path = asyncio.run(CertificateValidator(cert, intermediate_certs=intermediates, validation_context=preliminary).async_validate_usage(set()))
    chain = list(path.iter_certs(include_root=False))
    if not chain or len(chain) > 8:
        raise TrustUnavailable("certificate_chain_invalid")
    cache_directory = Path(cache_directory)
    cache_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if cache_directory.is_symlink() or cache_directory.stat().st_mode & 0o077:
        raise TrustUnavailable("unsafe_revocation_cache")
    evidence = []; paths = []
    for item in chain:
        urls = _urls(item)
        if not urls:
            raise TrustUnavailable("revocation_distribution_missing")
        obtained = False
        for url in urls:
            destination = cache_directory / (hashlib.sha256(url.encode()).hexdigest() + ".crl")
            try:
                data = fetcher(url)
                parsed = crl.CertificateList.load(data, strict=True)
                # The final path validation checks issuer, signature, freshness,
                # revoked serials and critical CRL extensions for every cert.
                evidence.append(parsed); paths.append(str(destination))
                _write(destination, data)
                obtained = True
                break
            except Exception:
                continue
        if not obtained:
            raise TrustUnavailable("revocation_unavailable")
    strict = ValidationContext(trust_roots=roots, allow_fetching=False, crls=evidence,
        revocation_mode="hard-fail", revinfo_policy=CertRevTrustPolicy(RevocationCheckingPolicy(
            RevocationCheckingRule.CRL_REQUIRED, RevocationCheckingRule.CRL_REQUIRED)))
    asyncio.run(CertificateValidator(cert, intermediate_certs=intermediates, validation_context=strict).async_validate_usage(set()))
    return {"trustStoreVersion": hashlib.sha256(roots_bytes).hexdigest(), "crlPaths": list(dict.fromkeys(paths))}
