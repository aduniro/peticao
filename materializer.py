"""Closed new-prefix publication primitives; no host effects on import.

Helpers act only on descriptors/directories owned by their actual process UID.
Operational Root/host/namespace/authority checks live in root_entry; there is no
fixture UID or path field in the wire protocol.
"""
import ctypes
import errno
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import stat
import tarfile

PREFIX='/opt/peticao-dev-profile-tools-v1'
HELPERS={'driver_contract.py','input_provider.py','artifact_policy.py','resource_plan.py','qa_adapter.py','process_runner.py','sealed_policy.py','runtime_steps.py'}
QA={'qa/'+n for n in ('common.mjs','node-owned.mjs','qa-driver.mjs','qa-runtime.mjs','fixture.ts','backend-smoke.mjs','http-regression.mjs','refresh-fixture-session.mjs','browser-bootstrap.py','browser40.py','maps2.py','network-guard.cjs','build-guard.mjs','python-runtime.json')}
INPUTS={'inputs/'+n for n in ('source.tar.gz','dependencies.normalized.tar.gz','normalization-receipt.json','full-integrity-proof.json','full-integrity-inventory.json')}
TOP=HELPERS|QA|INPUTS|{'driver.py','driver-policy.json','catalog.candidates.json'}
ROOTS={'python312','postgres','chromium','python-wheels','pdfjs'}
MAX_FILES=50000;MAX_TOTAL=2*1024**3;MAX_FILE=512*1024**2


def relative(name):
    if type(name)is not str or not name or len(name)>1024 or name.startswith('/')or name!=str(PurePosixPath(name))or'\\'in name or'\0'in name or any(x in {'','..','.'}for x in name.split('/')):raise ValueError('canonical_relative_file_name_required')
    return name


def sha(value):
    if type(value)is not str or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('canonical_sha256_required')
    return value


def validate_files(files,expected_total):
    if type(files)is not dict or not 1<=len(files)<=MAX_FILES or type(expected_total)is not int or not 1<=expected_total<=MAX_TOTAL:raise ValueError('bounded_nonempty_public_file_plan_required')
    if not (HELPERS|QA|INPUTS|{'driver.py','driver-policy.json','catalog.candidates.json','node20'})<=set(files):raise ValueError('complete_code_qa_and_inputs_required')
    total=0;dirs={'empty-config'}
    for name,row in files.items():
        relative(name)
        if not(name in TOP or name=='node20'or name.split('/')[0]in ROOTS):raise ValueError('fixed_public_toolchain_roots_only')
        if type(row)is not dict or set(row)!={'sha256','bytes','mode'}:raise ValueError('exact_file_pin_required')
        sha(row['sha256'])
        if type(row['bytes'])is not int or not 0<=row['bytes']<=MAX_FILE or type(row['mode'])is not int or row['mode']not in {0o644,0o755}:raise ValueError('closed_public_file_metadata_required')
        if name in TOP and row['mode']!=0o644:raise ValueError('public_code_is_data_for_fixed_python_not_free_exec')
        total+=row['bytes'];parts=name.split('/')
        for n in range(1,len(parts)):dirs.add('/'.join(parts[:n]))
    if total!=expected_total or total>MAX_TOTAL or dirs&set(files):raise ValueError('file_directory_collision_or_size_mismatch')
    if any(not any(name.startswith(root+'/')for name in files)for root in ROOTS):raise ValueError('all_five_toolchain_directory_roots_required')
    return dirs


def owned(info,mode=None):
    if info.st_uid!=os.geteuid()or info.st_mode&0o022:raise PermissionError('actual_process_owned_path_required')
    if mode is not None and stat.S_IMODE(info.st_mode)!=mode:raise PermissionError('exact_new_directory_mode_required')


class Tree:
    def __init__(self,path):
        self.path=os.path.abspath(path);self.fd=os.open(self.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);self.ident=os.fstat(self.fd)
        try:owned(self.ident)
        except BaseException:os.close(self.fd);raise
        self.directories={"":(self.ident.st_dev,self.ident.st_ino)}
    def check(self):
        a=os.fstat(self.fd);b=os.stat(self.path,follow_symlinks=False)
        if not stat.S_ISDIR(b.st_mode)or(a.st_dev,a.st_ino,a.st_uid,a.st_mode)!=(b.st_dev,b.st_ino,b.st_uid,b.st_mode):raise PermissionError('owned_tree_replaced_preserve_partial')
        owned(a)
    def directory(self,name,create=False):
        self.check();parts=[]if name==''else relative(name).split('/');fd=os.dup(self.fd);walked=[]
        try:
            for part in parts:
                created=False
                if create:
                    try:os.mkdir(part,0o755,dir_fd=fd);created=True
                    except FileExistsError:pass
                nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=nxt;info=os.fstat(fd);owned(info)
                if created:os.fchmod(fd,0o755);os.fsync(fd);info=os.fstat(fd)
                owned(info,0o755)
                walked.append(part);key='/'.join(walked);ident=(info.st_dev,info.st_ino)
                if key in self.directories and self.directories[key]!=ident:raise PermissionError('nested_directory_replaced_preserve_partial')
                self.directories[key]=ident
            return fd
        except BaseException:os.close(fd);raise
    def create_file(self,name,row,stream):
        parts=relative(name).split('/');parent=self.directory('/'.join(parts[:-1]),create=True)
        try:
            fd=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
            with os.fdopen(fd,'wb')as out:
                digest=hashlib.sha256();count=0
                while block:=stream.read(min(1048576,row['bytes']+1-count)):
                    count+=len(block)
                    if count>row['bytes']:raise ValueError('member_grew_preserve_partial')
                    out.write(block);digest.update(block)
                if count!=row['bytes']or digest.hexdigest()!=row['sha256']:raise ValueError('member_preimage_mismatch_preserve_partial')
                out.flush();os.fchmod(out.fileno(),row['mode']);os.fsync(out.fileno())
            os.fsync(parent);self.check()
        finally:os.close(parent)
    def verify(self,files):
        self.check();found=set();seen_dirs=set();expected_dirs={'empty-config'}
        for name in files:
            parts=name.split('/')
            for n in range(1,len(parts)):expected_dirs.add('/'.join(parts[:n]))
        for directory,names,leaves in os.walk(self.path,followlinks=False):
            folder=os.path.relpath(directory,self.path);fd=self.directory(''if folder=='.'else folder)
            try:
                for name in names:
                    relative_dir=name if folder=='.'else folder+'/'+name
                    if relative_dir not in expected_dirs:raise ValueError('unexpected_published_directory')
                    seen_dirs.add(relative_dir)
                    i=os.stat(name,dir_fd=fd,follow_symlinks=False)
                    if not stat.S_ISDIR(i.st_mode):raise PermissionError('directory_alias_or_link_refused')
                    owned(i,0o755)
                for leaf in leaves:
                    name=relative(leaf if folder=='.'else folder+'/'+leaf)
                    if name not in files:raise ValueError('unexpected_published_member')
                    row=files[name];f=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
                    try:
                        a=os.fstat(f);owned(a)
                        if not stat.S_ISREG(a.st_mode)or a.st_nlink!=1 or a.st_size!=row['bytes']or stat.S_IMODE(a.st_mode)!=row['mode']:raise PermissionError('exact_regular_published_file_required')
                        h=hashlib.sha256()
                        while block:=os.read(f,1048576):h.update(block)
                        b=os.fstat(f);c=os.stat(leaf,dir_fd=fd,follow_symlinks=False)
                        fields=('st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_nlink','st_mtime_ns','st_ctime_ns')
                        if h.hexdigest()!=row['sha256']or any(getattr(a,k)!=getattr(b,k)or getattr(a,k)!=getattr(c,k)for k in fields):raise ValueError('published_file_changed')
                    finally:os.close(f)
                    found.add(name)
            finally:os.close(fd)
        self.check()
        if found!=set(files)or seen_dirs!=expected_dirs:raise ValueError('incomplete_public_tree')
        return True
    def close(self):os.close(self.fd)


def archive_members(fp,files):
    fp.seek(0);seen=set()
    with tarfile.open(fileobj=fp,mode='r:gz')as archive:
        for item in archive:
            name=relative(item.name)
            if name in seen or name not in files:raise ValueError('duplicate_or_unplanned_tar_member')
            row=files[name]
            if item.type not in {tarfile.REGTYPE,tarfile.AREGTYPE}or item.sparse or item.linkname or item.pax_headers or item.uid!=0 or item.gid!=0 or item.size!=row['bytes']or item.mode!=row['mode']:raise ValueError('only_exact_regular_tar_members')
            seen.add(name)
    if seen!=set(files):raise ValueError('incomplete_tar_file_set')
    fp.seek(0)


def extract(fp,tree,files):
    archive_members(fp,files)
    with tarfile.open(fileobj=fp,mode='r:gz')as archive:
        for item in archive:
            with archive.extractfile(item)as stream:tree.create_file(item.name,files[item.name],stream)
    d=tree.directory('empty-config',create=True);os.close(d)
    tree.verify(files)


def rename_noreplace(source,destination):
    libc=ctypes.CDLL(None,use_errno=True);function=libc.renameat2;function.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];function.restype=ctypes.c_int
    if function(-100,os.fsencode(source),-100,os.fsencode(destination),1)!=0:
        code=ctypes.get_errno();raise OSError(code,'atomic_no_replace_failed')
