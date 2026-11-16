"""Create a synthetic DEV certificate; preserve historical fixture and all services."""
import datetime,json,os,re,secrets
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID,ObjectIdentifier
os.umask(0o077)
source=Path('/mnt/apps/peticao-final/_ops/a1-habilitacao-20261112/credential-e2e-fixture.private.json')
old=json.loads(source.read_text());assert old['syntheticOnly']is True and old['notIcpHomologation']is True
_,oldcert,_=pkcs12.load_key_and_certificates(Path(old['pfxPath']).read_bytes(),Path(old['passwordPath']).read_bytes().strip())
assert oldcert.fingerprint(hashes.SHA256()).hex()==old['certificateFingerprintSha256'].replace(':','').lower()
names=[x for x in oldcert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value if isinstance(x,x509.OtherName)and x.type_id==ObjectIdentifier('2.16.76.1.3.3')]
assert len(names)==1 and re.search(rb'[0-9]{14}$',names[0].value)
now=datetime.datetime.now(datetime.timezone.utc);end=now+datetime.timedelta(days=30)
home=Path.home()/'.config/peticao/development-certificates'/('a1-synthetic-'+now.strftime('%Y%m%dT%H%M%SZ'));home.mkdir(mode=0o700,parents=True)
ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC DEVELOPMENT ROOT - NOT ICP BRASIL')])
ca=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(hours=1)).not_valid_after(end+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=1),True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).sign(ca_key,hashes.SHA256())
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
cert=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC DEVELOPMENT ORGANIZATION - TEST ONLY')])).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(hours=1)).not_valid_after(end).add_extension(x509.BasicConstraints(ca=False,path_length=None),True).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True).add_extension(x509.SubjectAlternativeName(names),False).sign(ca_key,hashes.SHA256())
crl=x509.CertificateRevocationListBuilder().issuer_name(name).last_update(now-datetime.timedelta(minutes=5)).next_update(end).sign(ca_key,hashes.SHA256())
password=secrets.token_urlsafe(32).encode();pfx=pkcs12.serialize_key_and_certificates(b'DEV-ONLY',key,cert,[ca],serialization.BestAvailableEncryption(password))
for filename,data in [('certificate.pfx',pfx),('certificate-password',password+b'\n'),('roots.pem',ca.public_bytes(serialization.Encoding.PEM)),('issuer.crl',crl.public_bytes(serialization.Encoding.DER))]:
 p=home/filename;fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data)
readkey,readcert,chain=pkcs12.load_key_and_certificates(pfx,password)
assert readkey.public_key().public_numbers()==readcert.public_key().public_numbers()and len(chain)==1
ca.public_key().verify(cert.signature,cert.tbs_certificate_bytes,padding.PKCS1v15(),cert.signature_hash_algorithm)
ca.public_key().verify(crl.signature,crl.tbs_certlist_bytes,padding.PKCS1v15(),crl.signature_hash_algorithm)
assert cert.not_valid_after>now.replace(tzinfo=None)
metadata={'syntheticOnly':True,'notIcpHomologation':True,'sourceFixture':str(source),'sourceGeneratorReference':'peticao-release/tools/signing/test_worker.py','fixtureRoot':str(home),'pfxPath':str(home/'certificate.pfx'),'passwordPath':str(home/'certificate-password'),'rootsPath':str(home/'roots.pem'),'crlPath':str(home/'issuer.crl'),'certificateFingerprintSha256':cert.fingerprint(hashes.SHA256()).hex(),'expiresAt':end.isoformat(),'originalPreserved':True,'servicesActivated':False,'validation':['PKCS12 roundtrip','private key matches leaf','synthetic CA verifies leaf signature','synthetic CA verifies CRL signature','certificate valid now']}
p=Path(__file__).parent/'DEV-FIXTURE-METADATA.json';p.write_text(json.dumps(metadata,indent=2));p.chmod(0o600)
print(json.dumps({'status':'PASS','synthetic_only':True,'expires_at':end.isoformat(),'metadata_file':str(p),'original_preserved':True,'services_activated':False}))
