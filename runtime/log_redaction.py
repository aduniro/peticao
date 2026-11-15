"""Mask known credential spans in a bounded FULL log before byte slicing.

This is pattern redaction, not a proof that arbitrary text contains no secrets.
The caller must enforce private job ownership/access and the whole-file budget.
Byte-length-preserving masks prevent offset-inside-token/chunk-boundary leaks.
"""
import re

MAX_LOG=10*1024*1024
PATTERNS=(
    (re.compile(rb'(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s,;]+)'),(2,)),
    (re.compile(rb'(?i)(?<![A-Z_])((?:[A-Z_]*TOKEN|[A-Z_]*PASSWORD|[A-Z_]*SECRET|[A-Z_]*API_KEY|DATABASE_URL)\s*[:=]\s*)([^\s,;]+)'),(2,)),
    (re.compile(rb'(https?://)([^/@\s:]+):([^/@\s]+)@'),(2,3)),
)


def slice_log(raw,offset,limit=32768):
    if not isinstance(raw,bytes) or len(raw)>MAX_LOG or type(offset) is not int or not 0<=offset<=MAX_LOG or type(limit) is not int or not 0<limit<=32768:
        raise ValueError('bounded_whole_log_and_raw_byte_offset_required')
    masked=bytearray(raw)
    for pattern,groups in PATTERNS:
        for found in pattern.finditer(raw):
            for group in groups:
                start,end=found.span(group);masked[start:end]=b'*'*(end-start)
    chunk=bytes(masked[offset:offset+limit])
    return {'offset':offset+len(chunk),'output':chunk.decode(errors='replace')}
