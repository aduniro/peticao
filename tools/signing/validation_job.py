"""One bounded validation request per child; never persist the PDF."""
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import signal
import sys

from pyhanko.pdf_utils.reader import PdfFileReader
from trust import prepare_certificate_trust
from validation import MAX_PDF, validate


def execute(pdf, cfg, require_policy):
    roots = Path(cfg["rootsPath"]).read_bytes()
    if hashlib.sha256(roots).hexdigest() != cfg["rootsSha256"]:
        return {"valid": False, "reason": "trust_unavailable"}
    reader = PdfFileReader(io.BytesIO(pdf), strict=True)
    if reader.encrypted or not reader.embedded_signatures:
        return {"valid": False, "reason": "signature_missing"}
    signature = reader.embedded_signatures[-1]
    certs = [item.chosen for item in signature.signed_data["certificates"] if item.name == "certificate"]
    trust = prepare_certificate_trust(signature.signer_cert, certs, roots, Path(cfg["crlCache"]))
    return validate(pdf, roots, [Path(p).read_bytes() for p in trust["crlPaths"]], require_policy=require_policy)


def main():
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(25)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 22))
    try:
        cfg = json.loads(Path(os.environ["A1_VALIDATOR_CONFIG"]).read_text())
        pdf = sys.stdin.buffer.read(MAX_PDF + 1)
        if len(pdf) > MAX_PDF or not pdf.startswith(b"%PDF-"):
            result = {"valid": False, "reason": "pdf_invalid"}
        else:
            result = execute(pdf, cfg, sys.argv[1:] == ["policy"])
    except Exception:
        result = {"valid": False, "reason": "validation_unavailable"}
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
