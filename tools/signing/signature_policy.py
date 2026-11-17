"""Parse a pinned AD-RB policy and build its CMS declaration. Does not authenticate ITI or qualify a signature."""
from dataclasses import dataclass
from datetime import datetime,timezone
import hashlib,hmac,re
from asn1crypto import core,algos
from pyhanko.sign.ades.cades_asn1 import SignaturePolicyIdentifier

OID="2.16.76.1.7.1.11.1.3"
PINNED_POLICY_FILE_SHA256="23da544aef71f7a75dc85fa6e17a83875741e4baef41ec178258a5c86ace54dd"
PINNED_POLICY_HASH_SHA256="23e4be4b9b362172e4ebb0e72b86a133ece5aad843d8651c6e38a0ba3f08fc60"
@dataclass(frozen=True)
class Policy:
    oid:str
    file_sha256:str
    policy_hash:bytes
    not_before:datetime
    not_after:datetime

    def identifier(self):
        return SignaturePolicyIdentifier(name="signature_policy_id",value={"sig_policy_id":self.oid,"sig_policy_hash":{"digest_algorithm":{"algorithm":"sha256"},"digest":self.policy_hash}})

def _check_header(data,tag):
    if len(data)<2 or data[0]!=tag:raise ValueError("invalid_policy_der")
    size=data[1]
    if size<128:offset=2
    else:
        count=size&127
        if not 1<=count<=4 or len(data)<2+count or data[2]==0:raise ValueError("invalid_policy_der")
        size=int.from_bytes(data[2:2+count],"big");offset=2+count
        if size<128:raise ValueError("invalid_policy_der")
    if offset+size!=len(data):raise ValueError("invalid_policy_der")

def parse_policy(blob,expected_file_sha256,now=None):
    """Expected file hash is trusted deployment configuration, never a request field."""
    try:
        if not isinstance(blob,bytes) or not 128<=len(blob)<=1024*1024 or not isinstance(expected_file_sha256,str) or not re.fullmatch('[a-f0-9]{64}',expected_file_sha256):raise ValueError()
        actual=hashlib.sha256(blob).hexdigest()
        if not hmac.compare_digest(actual,expected_file_sha256):raise ValueError()
        _check_header(blob,0x30)
        value=core.Sequence.load(blob,strict=True)
        if len(value)!=3:raise ValueError()
        algorithm=algos.DigestAlgorithm.load(value[0].dump(),strict=True)
        if algorithm['algorithm'].native!='sha256' or algorithm['parameters'].native is not None:raise ValueError()
        info=core.Sequence.load(value[1].dump(),strict=True)
        if len(info)!=5 or not isinstance(info[0],core.ObjectIdentifier) or info[0].dotted!=OID:raise ValueError()
        if not isinstance(info[1],core.GeneralizedTime) or not isinstance(info[3],core.UTF8String):raise ValueError()
        if not isinstance(value[2],core.OctetString) or len(value[2].native)!=32:raise ValueError()
        # Policy's own hash covers the two DER elements concatenated; neither a new wrapper nor the file hash.
        computed=hashlib.sha256(value[0].dump()+value[1].dump()).digest()
        if not hmac.compare_digest(computed,value[2].native):raise ValueError()
        rules=core.Sequence.load(info[4].dump(),strict=True)
        period=core.Sequence.load(rules[0].dump(),strict=True)
        if len(period)!=2 or not all(isinstance(period[i],core.GeneralizedTime) for i in range(2)):raise ValueError()
        start,end=period[0].native,period[1].native
        current=now or datetime.now(timezone.utc)
        if current.tzinfo is None or not start<=current<=end or not start<end or info[1].native>current:raise ValueError()
        return Policy(OID,actual,computed,start,end)
    except Exception:raise ValueError("invalid_signature_policy") from None
