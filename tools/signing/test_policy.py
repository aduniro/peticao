import unittest,hashlib,dataclasses
from pathlib import Path
from datetime import datetime,timezone
from asn1crypto import core,algos
from signature_policy import parse_policy,OID

ROOT=Path(__file__).resolve().parent
RAW=(ROOT/'fixtures'/'ad-rb-v1.3.der').read_bytes()
FILE_HASH='23da544aef71f7a75dc85fa6e17a83875741e4baef41ec178258a5c86ace54dd'
POLICY_HASH='23e4be4b9b362172e4ebb0e72b86a133ece5aad843d8651c6e38a0ba3f08fc60'
NOW=datetime(2026,11,9,tzinfo=timezone.utc)
def sequence(parts):
 raw=b''.join(parts);size=len(raw);n=(size.bit_length()+7)//8
 length=bytes([size]) if size<128 else bytes([128+n])+size.to_bytes(n,'big')
 return b'\x30'+length+raw

def modified(oid=None,algorithm=None,declared_hash=None,extra=False):
 s=core.Sequence.load(RAW,strict=True);info=core.Sequence.load(s[1].dump())
 parts=[info[i].dump() for i in range(len(info))]
 if oid:parts[0]=core.ObjectIdentifier(oid).dump()
 body=sequence(parts);alg=algos.DigestAlgorithm({'algorithm':algorithm}).dump() if algorithm else s[0].dump()
 result=declared_hash or hashlib.sha256(alg+body).digest()
 fields=[alg,body,core.OctetString(result).dump()]
 if extra:fields.append(core.Null().dump())
 return sequence(fields)

class PolicyTests(unittest.TestCase):
 def reject(self,raw,expected=None,now=NOW):
  with self.assertRaisesRegex(ValueError,'^invalid_signature_policy$'):parse_policy(raw,expected or hashlib.sha256(raw).hexdigest(),now)
 def test_hashes_have_distinct_roles_and_attribute_uses_internal_value(self):
  self.assertEqual(hashlib.sha256(RAW).hexdigest(),FILE_HASH)
  p=parse_policy(RAW,FILE_HASH,NOW);self.assertEqual(p.oid,OID);self.assertEqual(p.policy_hash.hex(),POLICY_HASH);self.assertNotEqual(p.policy_hash.hex(),p.file_sha256)
  identifier=p.identifier();self.assertEqual(identifier.name,'signature_policy_id');self.assertEqual(identifier.chosen['sig_policy_id'].native,OID);self.assertEqual(identifier.chosen['sig_policy_hash']['digest'].native,p.policy_hash)
  self.assertEqual(identifier.chosen['sig_policy_hash']['digest_algorithm']['algorithm'].native,'sha256')
 def test_file_pin_cannot_be_replaced_by_the_attribute_hash(self):
  self.reject(RAW,POLICY_HASH);self.reject(RAW,'0'*64);self.reject(RAW,FILE_HASH.upper())
 def test_self_consistent_unknown_oid_and_algorithm_are_refused(self):
  self.reject(modified(oid='1.2.3.4.5'));self.reject(modified(algorithm='sha512'))
 def test_pinned_tamper_still_needs_internal_hash_match(self):
  raw=bytearray(RAW);raw[200]^=1;self.reject(bytes(raw));self.reject(modified(declared_hash=bytes.fromhex(FILE_HASH)));self.reject(modified(declared_hash=b'\0'*32))
 def test_validity_window_and_clock_require_aware_current_time(self):
  self.reject(RAW,now=datetime(2024,1,1,tzinfo=timezone.utc));self.reject(RAW,now=datetime(2040,1,1,tzinfo=timezone.utc));self.reject(RAW,now=datetime(2026,11,9))
 def test_malformed_trailing_oversize_and_extra_fields_fail_closed(self):
  for raw in [RAW[:-1],RAW+b'junk',b'\x30\x80'+RAW[4:]+b'\0\0',b'\x30\x81\x01\x00',modified(extra=True),b'A'*(1024*1024+1)]:self.reject(raw)
 def test_metadata_is_frozen_and_identifier_instances_do_not_mutate_it(self):
  p=parse_policy(RAW,FILE_HASH,NOW)
  with self.assertRaises(dataclasses.FrozenInstanceError):p.oid='1.2.3'
  a=p.identifier();a.chosen['sig_policy_id']='1.2.3.4';self.assertEqual(p.identifier().chosen['sig_policy_id'].native,OID)

if __name__=='__main__':unittest.main()
