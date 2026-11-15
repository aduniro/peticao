"""UID1000 offline DATA custody; no effects on import and no package execution."""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat

UID=1000
CHUNK=1048576


def role():
    if os.getuid()!=UID or os.geteuid()!=UID:raise PermissionError('offline_uid1000_required')


def signature(i):
    return tuple(getattr(i,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))


def identity(i):return i.st_dev,i.st_ino,i.st_mode,i.st_uid,i.st_gid


def regular(i):
    if not stat.S_ISREG(i.st_mode) or i.st_uid!=UID or i.st_nlink!=1 or i.st_mode&0o022:
        raise PermissionError('owned_singlelink_regular_no022_required')


def walk(path,public_data=False):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts or str(path)!=os.path.normpath(str(path)):
        raise ValueError('canonical_absolute_path_required')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);lineage=[]
    try:
        for part in [None,*path.parts[1:]]:
            if part is not None:
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
            info=os.fstat(fd)
            if info.st_uid not in {0,UID} or not public_data and info.st_mode&0o022:raise PermissionError('controlled_lexical_ancestry_required')
            lineage.append(identity(info))
        return fd,tuple(lineage)
    except BaseException:os.close(fd);raise


class Directory:
    def __init__(self,path,private=False,public_data=False):
        self.path=Path(path);self.public_data=public_data;self.fd,self.lineage=walk(path,public_data);self.private=private
        try:self.check()
        except BaseException:self.close();raise
    def check(self):
        fd,lineage=walk(self.path,self.public_data)
        try:
            info=os.fstat(self.fd)
            if lineage!=self.lineage or identity(info)!=lineage[-1]:raise PermissionError('directory_lineage_changed')
            if self.private and (info.st_uid!=UID or stat.S_IMODE(info.st_mode)!=0o700):raise PermissionError('private_output_directory_required')
        finally:os.close(fd)
    def close(self):
        if self.fd>=0:os.close(self.fd);self.fd=-1
    def __enter__(self):return self
    def __exit__(self,*_):
        try:self.check()
        finally:self.close()


def sri512(text):
    if type(text) is not str or not text.startswith('sha512-'):raise ValueError('single_sha512_sri_required')
    try:raw=base64.b64decode(text[7:],validate=True)
    except (ValueError,TypeError):raise ValueError('canonical_sha512_sri_required') from None
    if len(raw)!=64 or 'sha512-'+base64.b64encode(raw).decode()!=text:raise ValueError('canonical_sha512_sri_required')
    return raw


class Pinned:
    def __init__(self,path,sha256,size,sri=None,public_data=False):
        self.sha256=sha256;self.size=size;self.sri=sri512(sri) if sri is not None else None
        self.path=Path(path);self.parent=Directory(self.path.parent,public_data=public_data);self.fp=None
        try:
            fd=os.open(self.path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=self.parent.fd)
            self.fp=os.fdopen(fd,'rb');self.before=os.fstat(fd);regular(self.before)
            if type(size) is not int or size<1 or self.before.st_size!=size:raise ValueError('input_size_mismatch')
            self.check(rehash=True)
        except BaseException:self.close();raise
    def check(self,rehash=False):
        self.parent.check();info=os.fstat(self.fp.fileno());regular(info)
        named=os.stat(self.path.name,dir_fd=self.parent.fd,follow_symlinks=False)
        if signature(info)!=signature(self.before) or signature(named)!=signature(self.before):raise PermissionError('samefd_input_changed')
        if rehash:
            self.fp.seek(0);h=hashlib.sha256();s=hashlib.sha512();count=0
            while chunk:=self.fp.read(CHUNK):
                h.update(chunk);s.update(chunk);count+=len(chunk)
                if count>self.size:raise ValueError('input_grew')
            if count!=self.size or h.hexdigest()!=self.sha256 or self.sri is not None and s.digest()!=self.sri:
                raise ValueError('input_sha256_or_sri_mismatch')
            self.fp.seek(0);self.check()
    def read(self,limit):
        self.fp.seek(0);raw=self.fp.read(limit+1)
        if len(raw)>limit:raise ValueError('bounded_control_required')
        self.check();return raw
    def close(self):
        if self.fp is not None:self.fp.close();self.fp=None
        self.parent.close()
    def __enter__(self):return self
    def __exit__(self,*_):
        try:self.check(rehash=True)
        finally:self.close()


def control(path,limit=65536):
    path=Path(path)
    with Directory(path.parent) as parent:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent.fd)
        with os.fdopen(fd,'rb') as fp:
            before=os.fstat(fp.fileno());regular(before);raw=fp.read(limit+1)
            if len(raw)>limit or len(raw)!=before.st_size or signature(before)!=signature(os.fstat(fp.fileno())) or signature(before)!=signature(os.stat(path.name,dir_fd=parent.fd,follow_symlinks=False)):
                raise PermissionError('control_changed_or_oversized')
        return raw


def new_output(path):
    role();path=Path(path)
    with Directory(path.parent) as parent:
        parent.check();os.mkdir(path.name,0o700,dir_fd=parent.fd)
        created=os.stat(path.name,dir_fd=parent.fd,follow_symlinks=False)
        stage=Directory(path,private=True)
        if identity(os.fstat(stage.fd))!=identity(created):stage.close();raise PermissionError('new_output_replaced')
        try:os.fsync(parent.fd);parent.check()
        except BaseException:stage.close();raise
        return stage


def write_json(stage,name,value):
    if name not in {'PROOF-INTENT.json','SRI-PROOF.json','PROOF-RECEIPT.json'}:raise ValueError('fixed_reserved_output_name_required')
    stage.check();raw=canonical(value)+b'\n'
    if len(raw)>64*1024**2:raise ValueError('proof_output_size_limit')
    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=stage.fd)
    with os.fdopen(fd,'wb') as out:
        out.write(raw);out.flush();os.fsync(out.fileno());info=os.fstat(out.fileno());regular(info)
        if stat.S_IMODE(info.st_mode)!=0o600:raise PermissionError('private_output_file_required')
    stage.check();os.fsync(stage.fd)
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=stage.fd)
    with os.fdopen(fd,'rb') as fp:
        before=os.fstat(fp.fileno());regular(before)
        if fp.read(len(raw)+1)!=raw or signature(before)!=signature(os.fstat(fp.fileno())) or signature(before)!=signature(os.stat(name,dir_fd=stage.fd,follow_symlinks=False)):
            raise PermissionError('proof_readback_mismatch')
    stage.check();return hashlib.sha256(raw).hexdigest()


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def parse(raw):
    def unique(pairs):
        out={}
        for k,v in pairs:
            if k in out:raise ValueError('duplicate_json_key')
            out[k]=v
        return out
    def bad(_):raise ValueError('nonfinite_json')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=bad)
