#!/usr/bin/env python3
"""Protected A1 credential broker. Unix-only framed JSON; no secret logging."""
import base64
import errno
import signal
import socket
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import socketserver
import stat
import struct
import threading
import uuid
from datetime import datetime, timezone

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.serialization import pkcs12, Encoding
from asn1crypto import x509 as asn1_x509
from worker import read_protected, require_certificate_current, certificate_cnpj, Refused

MAX_PFX = 2 * 1024 * 1024
MAX_REQUEST = 4 * ((MAX_PFX + 2) // 3) + 8192
MAX_RESPONSE = 16384
EXPECTED_CNPJ = '15883671000115'
PROFILE = 'pades-ad-rb-declared-unhomologated-v1'
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')

class CredentialError(Exception):
    pass

def fail(code):
    raise CredentialError(code)

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def atomic(path, value):
    path = Path(path)
    if path.is_symlink(): fail('storage_unavailable')
    data = value if isinstance(value,bytes) else json.dumps(value,separators=(',',':')).encode()
    temporary=path.parent/('.'+path.name+'.'+uuid.uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temporary,path)
        fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
    finally:
        if temporary.exists():temporary.unlink()

def protected_directory(path, create=False):
    p=Path(path)
    if not p.is_absolute():fail('configuration_unavailable')
    if create:p.mkdir(mode=0o700,parents=False,exist_ok=True)
    for part in [p,*p.parents]:
        info=part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid not in {0,os.geteuid()} or info.st_mode&0o022:fail('configuration_unavailable')
    if p.stat().st_mode&0o077:fail('configuration_unavailable')
    return p

def cleanup_stale_socket(path):
    """Remove only an owned, unchanged socket that explicitly refuses connect.

    Caller holds the service startup lock in its protected runtime directory.
    A live listener, unknown file, ownership mismatch or ambiguous probe fails.
    """
    path=Path(path)
    for part in path.parents:
        info=part.lstat()
        if stat.S_ISLNK(info.st_mode)or info.st_uid not in {0,os.geteuid()}or info.st_mode&0o022:fail('unsafe_socket_path')
    try:before=path.lstat()
    except FileNotFoundError:return False
    if not stat.S_ISSOCK(before.st_mode)or before.st_uid!=os.geteuid():fail('unsafe_socket_path')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as probe:
        probe.settimeout(0.25)
        try:probe.connect(str(path))
        except OSError as error:
            if error.errno!=errno.ECONNREFUSED:fail('socket_state_uncertain')
        else:fail('socket_already_active')
    after=path.lstat()
    if (after.st_dev,after.st_ino,after.st_uid,after.st_mode)!=(before.st_dev,before.st_ino,before.st_uid,before.st_mode):fail('socket_state_changed')
    path.unlink()
    return True

def load_config(path):
    cfg=json.loads(read_protected(path,16384))
    required={'version','socketPath','storageRoot','encryptionKeyPath','workerConfigPath','trustRootsPath','policyPath','crlPaths','environment'}
    if not isinstance(cfg,dict) or set(cfg)!=required or cfg['version']!=1 or cfg['environment']!='production':fail('configuration_unavailable')
    if not isinstance(cfg['crlPaths'],list) or len(cfg['crlPaths'])>32:fail('configuration_unavailable')
    for k in required-{'version','environment','crlPaths'}:
        if not isinstance(cfg[k],str) or not Path(cfg[k]).is_absolute():fail('configuration_unavailable')
    if len(cfg['socketPath'].encode())>100:fail('configuration_unavailable')
    protected_directory(cfg['storageRoot'])
    Fernet(read_protected(cfg['encryptionKeyPath'],128))
    read_protected(cfg['trustRootsPath'],4*1024*1024)
    return cfg

class Credentials:
    def __init__(self,cfg,trust_preparer=None):
        self.cfg=cfg;self.root=protected_directory(cfg['storageRoot']);self.secret=read_protected(cfg['encryptionKeyPath'],128);self.fernet=Fernet(self.secret)
        for name in ['certificates','passwords','receipts','crls']:protected_directory(self.root/name,create=True)
        self.trust_preparer=trust_preparer

    def receipt(self,rid):
        path=self.root/'receipts'/(rid+'.json')
        if not path.exists():return None
        return json.loads(read_protected(path,16384))

    def active(self):
        path=self.root/'active.json'
        if not path.exists():return None
        return json.loads(read_protected(path,16384))

    def get(self,rid=None):
        current=self.active();record=self.receipt(rid)if rid else current
        return {'ok':True,'credential':record['credential']if record else None,'currentCredentialVersionId':current['credential']['credentialVersionId']if current else None,'intent':{'requestId':rid,'state':'completed'if record else 'not_found'}if rid else None}

    def put(self,request):
        rid=request.get('requestId')
        if not isinstance(rid,str)or not UUID.fullmatch(rid):fail('invalid_request')
        existing=self.receipt(rid);replayed=existing is not None
        has_secret='pfxBase64'in request or 'password'in request
        if has_secret:
            if set(request)!={'version','operation','requestId','pfxBase64','password'}:fail('invalid_request')
            raw=request['pfxBase64'];password=request['password']
            if not isinstance(raw,str)or not isinstance(password,str)or not 1<=len(password.encode())<=4096:fail('invalid_request')
            try:pfx=base64.b64decode(raw,validate=True)
            except Exception:fail('invalid_certificate')
            if not 1<=len(pfx)<=MAX_PFX or base64.b64encode(pfx).decode()!=raw:fail('invalid_certificate')
            fingerprint=hmac.new(self.secret,pfx+b'\0'+password.encode(),hashlib.sha256).hexdigest()
            if existing and not hmac.compare_digest(existing['requestFingerprint'],fingerprint):fail('request_conflict')
        elif set(request)!={'version','operation','requestId'}:fail('invalid_request')
        elif not existing:fail('request_not_found')
        if not existing:
            try:key,cert,chain=pkcs12.load_key_and_certificates(pfx,password.encode())
            except Exception:fail('password_or_certificate_invalid')
            if key is None or cert is None:fail('invalid_certificate')
            try:require_certificate_current(cert)
            except Refused:fail('certificate_expired_or_not_yet_valid')
            cert_asn=asn1_x509.Certificate.load(cert.public_bytes(Encoding.DER))
            if certificate_cnpj(cert_asn)!=EXPECTED_CNPJ:fail('holder_mismatch')
            if key.public_key().public_bytes(Encoding.DER,__import__('cryptography.hazmat.primitives.serialization',fromlist=['PublicFormat']).PublicFormat.SubjectPublicKeyInfo)!=cert.public_key().public_bytes(Encoding.DER,__import__('cryptography.hazmat.primitives.serialization',fromlist=['PublicFormat']).PublicFormat.SubjectPublicKeyInfo):fail('key_mismatch')
            roots=read_protected(self.cfg['trustRootsPath'],4*1024*1024)
            if self.trust_preparer is None:
                from trust import prepare_certificate_trust
                preparer=prepare_certificate_trust
            else:preparer=self.trust_preparer
            try:trust=preparer(cert_asn,[asn1_x509.Certificate.load(c.public_bytes(Encoding.DER))for c in chain or []],roots,self.root/'crls')
            except Exception:fail('chain_or_revocation_unavailable')
            if trust.get('trustStoreVersion')!=hashlib.sha256(roots).hexdigest()or not isinstance(trust.get('crlPaths'),list)or not trust['crlPaths']:fail('chain_or_revocation_unavailable')
            sequence_path=self.root/'sequence.json'
            sequence=json.loads(read_protected(sequence_path,128))if sequence_path.exists()else 0
            if type(sequence)is not int or not 0<=sequence<2**53:fail('storage_unavailable')
            order=sequence+1;atomic(sequence_path,order)
            credential={'credentialVersionId':rid,'certificateFingerprintSha256':hashlib.sha256(cert.public_bytes(Encoding.DER)).hexdigest(),'cnpj':EXPECTED_CNPJ,'notBefore':cert.not_valid_before_utc.isoformat().replace('+00:00','Z'),'notAfter':cert.not_valid_after_utc.isoformat().replace('+00:00','Z'),'profileVersion':PROFILE,'trustStoreVersion':trust['trustStoreVersion'],'activatedAt':stamp()}
            pfx_path=self.root/'certificates'/(rid+'.pfx');password_path=self.root/'passwords'/(rid+'.fernet')
            atomic(pfx_path,pfx);atomic(password_path,self.fernet.encrypt(password.encode()))
            worker={'version':1,'credentialVersionId':rid,'pfxPath':str(pfx_path),'passwordPath':str(password_path),'passwordEncrypted':True,'passwordKeyPath':self.cfg['encryptionKeyPath'],'trustRootsPath':self.cfg['trustRootsPath'],'trustStoreVersion':trust['trustStoreVersion'],'profile':PROFILE,'policyPath':self.cfg['policyPath'],'environment':'production','crlPaths':trust['crlPaths']}
            existing={'order':order,'requestFingerprint':fingerprint,'credential':credential,'worker':worker}
            atomic(self.root/'receipts'/(rid+'.json'),existing)
        current=self.active()
        if current and(current.get('order',0)>existing.get('order',0)or current.get('order',0)==existing.get('order',0)and current['credential']['credentialVersionId']!=rid):fail('credential_superseded')
        atomic(self.cfg['workerConfigPath'],existing['worker']);atomic(self.root/'active.json',existing)
        return {**self.get(rid),'replayed':replayed}

    def handle(self,request):
        if not isinstance(request,dict)or request.get('version')!=1:fail('invalid_request')
        if request.get('operation')=='get':
            if set(request)-{'version','operation','requestId'}:fail('invalid_request')
            rid=request.get('requestId')
            if rid is not None and(not isinstance(rid,str)or not UUID.fullmatch(rid)):fail('invalid_request')
            return self.get(rid)
        if request.get('operation')=='put':return self.put(request)
        fail('invalid_request')

def read_frame(connection):
    def take(n):
        out=bytearray()
        while len(out)<n:
            chunk=connection.recv(n-len(out))
            if not chunk:fail('invalid_request')
            out.extend(chunk)
        return bytes(out)
    size=struct.unpack('!I',take(4))[0]
    if not 1<=size<=MAX_REQUEST:fail('invalid_request')
    return json.loads(take(size))

class Server(socketserver.UnixStreamServer):
    allow_reuse_address=False
    def __init__(self,path,credentials):
        self.credentials=credentials
        super().__init__(path,Handler)
        os.chmod(path,0o660)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(55)
        try:
            request=read_frame(self.request)
            with (self.server.credentials.root/'credential.lock').open('a')as lock:
                os.chmod(lock.name,0o600);fcntl.flock(lock,fcntl.LOCK_EX)
                response=self.server.credentials.handle(request)
        except CredentialError as e:response={'ok':False,'error':str(e)}
        except Exception:response={'ok':False,'error':'credential_service_unavailable'}
        raw=json.dumps(response,separators=(',',':')).encode()
        if len(raw)>MAX_RESPONSE:raw=b'{"ok":false,"error":"credential_service_unavailable"}'
        try:self.request.sendall(struct.pack('!I',len(raw))+raw)
        except OSError:pass

if __name__=='__main__':
    os.umask(0o077)
    try:
        cfg=load_config(os.environ.get('A1_CREDENTIAL_CONFIG','/etc/peticao-signing/credentials.json'))
        path=Path(cfg['socketPath'])
        with (path.parent/'.credentials-service.lock').open('a')as startup_lock:
            os.chmod(startup_lock.name,0o600);fcntl.flock(startup_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            cleanup_stale_socket(path)
            with Server(str(path),Credentials(cfg))as server:
                bound=path.lstat()
                def stop(*args):
                    # shutdown must run outside serve_forever's own thread.
                    threading.Thread(target=server.shutdown,daemon=True).start()
                signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
                try:server.serve_forever(poll_interval=0.25)
                finally:
                    server.server_close()
                    try:
                        current=path.lstat()
                        if (current.st_dev,current.st_ino,current.st_uid)==(bound.st_dev,bound.st_ino,os.geteuid()):path.unlink()
                    except FileNotFoundError:pass
    except Exception:raise SystemExit(1)
