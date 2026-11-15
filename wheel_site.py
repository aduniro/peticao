"""Fixed public wheel -> NEW local data tree producer; never a Python installer.

Only local UID1000 is supported. No package import, pip, entrypoint execution,
network, root staging or runtime qualification. All vendor bytes are preserved,
including Playwright's bundled node, but EVERY output file has mode0600.
"""
import argparse
from contextlib import contextmanager, ExitStack
import base64
import csv
import email
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

PROJECT = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
FUTURE_SITE_ROOT = '/opt/peticao-dev-profile-tools-v1/python-wheels/site'
LOCAL_UID = 1000
MAX_WHEEL = 64 * 1024**2
MAX_FILES = 20000
MAX_FILE = 256 * 1024**2
MAX_TOTAL = 1024**3
FIXED_WHEELS = (
    {'name':'greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl','sha256':'975736b002ed080d124cf81a79cb7e05cb26d6b3f5c7a7b651c0fcce70353aa1','bytes':621404},
    {'name':'playwright-1.62.0-py3-none-manylinux1_x86_64.whl','sha256':'ba33bae6a13b3d9d354c751cb618af357d20fe1d57767cbcce52079bbef17ad3','bytes':47748926},
    {'name':'pyee-13.0.1-py3-none-any.whl','sha256':'af2f8fede4171ef667dfded53f96e2ed0d6e6bd7ee3bb46437f77e3b57689228','bytes':15659},
    {'name':'typing_extensions-4.16.0-py3-none-any.whl','sha256':'481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8','bytes':45571},
)


# Retain only this pinned greenlet wheel's original header scheme as OPAQUE
# DATA. No relocation to include/, no installer scheme or include-path setup.
OPAQUE_GREENLET_WHEEL = 'greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl'
OPAQUE_GREENLET_PATHS = {
    'greenlet-3.5.6.data': 'directory',
    'greenlet-3.5.6.data/headers': 'directory',
    'greenlet-3.5.6.data/headers/greenlet.h': 'file',
}
OPAQUE_GREENLET_HEADER_BYTES = 4755


def _opaque_wheel(pin):
    return any(row == pin and row['name'] == OPAQUE_GREENLET_WHEEL for row in FIXED_WHEELS)


class DerivationRejected(ValueError):
    pass


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _scope(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or not path.is_relative_to(PROJECT) or path == PROJECT:
        raise DerivationRejected('absolute_project_scoped_path_required')
    return path


def _parent(path):
    path = _scope(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            info = os.fstat(fd)
            if info.st_uid not in {0, LOCAL_UID} or info.st_mode & 0o022:
                raise PermissionError('owner_controlled_nonwritable_ancestors_required')
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = next_fd
        info = os.fstat(fd)
        if info.st_uid not in {0, LOCAL_UID} or info.st_mode & 0o022:
            raise PermissionError('owner_controlled_nonwritable_ancestors_required')
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def _wheel(path, pin):
    if set(pin) != {'name','sha256','bytes'} or not re.fullmatch('[a-f0-9]{64}', str(pin['sha256'])) or type(pin['bytes']) is not int or not 0 < pin['bytes'] <= MAX_WHEEL:
        raise DerivationRejected('fixed_wheel_pin_required')
    parent = _parent(path)
    try:
        fd = os.open(Path(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != LOCAL_UID or before.st_nlink != 1
                    or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size != pin['bytes']):
                raise PermissionError('local_uid1000_private_single_link_input_required')
            if hashlib.file_digest(stream,'sha256').hexdigest() != pin['sha256'] or signature(os.fstat(stream.fileno())) != signature(before):
                raise DerivationRejected('wheel_hash_or_stat_mismatch')
            stream.seek(0)
            try:
                yield stream
            finally:
                if (signature(os.fstat(stream.fileno())) != signature(before)
                        or signature(os.stat(Path(path).name,dir_fd=parent,follow_symlinks=False)) != signature(before)):
                    raise DerivationRejected('wheel_changed_before_exit_no_completed_receipt')
    finally:
        os.close(parent)


def _name(value, directory=False, *, opaque_data=False):
    if type(value) is not str:
        raise DerivationRejected('canonical_zip_path_required')
    value = value[:-1] if directory and value.endswith('/') else value
    path = PurePosixPath(value)
    if (not value or len(value.encode()) > 1024 or path.is_absolute() or str(path) != value or '\\' in value
            or re.match(r'^[A-Za-z]:',value) or any(part in {'','.','..'} for part in value.split('/'))
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise DerivationRejected('unsafe_zip_path')
    lower = [part.lower() for part in path.parts]
    if (any(part in {'__pycache__','.ssh','.aws','.gnupg','.git','.codex','secrets','credentials'} or part.startswith('.env') for part in lower)
            or path.suffix.lower() in {'.pth','.pyc'}):
        raise DerivationRejected('pth_bytecode_cache_dotenv_or_credentials_forbidden')
    if any(part.endswith('.data') for part in lower):
        expected = 'directory' if directory else 'file'
        if not opaque_data or OPAQUE_GREENLET_PATHS.get(value) != expected:
            raise DerivationRejected('wheel_data_scheme_needs_separate_review')
    return value


def _stream_pin(stream, size, capture=False):
    digest = hashlib.sha256(); count = 0; captured = bytearray()
    for block in iter(lambda: stream.read(1024**2),b''):
        count += len(block)
        if count > size:
            raise DerivationRejected('oversized_zip_member')
        digest.update(block)
        if capture:
            captured.extend(block)
            if len(captured) > 8 * 1024**2:
                raise DerivationRejected('bounded_wheel_metadata_required')
    if count != size:
        raise DerivationRejected('truncated_zip_member')
    return digest.hexdigest(), bytes(captured)


def inventory(stream, pin):
    """Read complete ZIP/CRC/RECORD metadata and content hashes, never import."""
    stream.seek(0); rows=[]; seen=set(); total=0; record=[]; metadata=[]; wheel=[]
    try:
        with zipfile.ZipFile(stream) as archive:
            if len(archive.infolist()) > MAX_FILES:
                raise DerivationRejected('zip_member_count_exceeded')
            for item in archive.infolist():
                name = _name(item.filename,item.is_dir(),opaque_data=_opaque_wheel(pin))
                if name == 'greenlet-3.5.6.data/headers/greenlet.h' and item.file_size != OPAQUE_GREENLET_HEADER_BYTES:
                    raise DerivationRejected('fixed_opaque_greenlet_header_size_required')
                if name in seen:
                    raise DerivationRejected('duplicate_zip_path')
                seen.add(name)
                if item.flag_bits & 1 or item.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED} or not 0 <= item.file_size <= MAX_FILE:
                    raise DerivationRejected('encrypted_unsupported_or_unbounded_zip_member')
                mode = item.external_attr >> 16; kind = stat.S_IFMT(mode)
                if stat.S_ISLNK(mode) or kind not in {0,stat.S_IFREG,stat.S_IFDIR}:
                    raise DerivationRejected('zip_links_or_special_members_forbidden')
                if item.is_dir() != (kind == stat.S_IFDIR) and kind != 0:
                    raise DerivationRejected('zip_directory_type_mismatch')
                total += item.file_size
                if total > MAX_TOTAL:
                    raise DerivationRejected('zip_unpacked_byte_limit_exceeded')
                row={'name':name,'zip_name':item.filename,'directory':item.is_dir(),'bytes':item.file_size,
                     'zip_crc32':item.CRC,'compression':item.compress_type,'source_mode':mode,'sha256':None}
                if item.is_dir():
                    if item.file_size:
                        raise DerivationRejected('directory_payload_forbidden')
                else:
                    capture = name.endswith(('/RECORD','/METADATA','/WHEEL'))
                    with archive.open(item) as member:
                        row['sha256'], raw = _stream_pin(member,item.file_size,capture)
                    if name.endswith('/RECORD'): record.append((name,raw))
                    if name.endswith('/METADATA'): metadata.append(email.message_from_bytes(raw))
                    if name.endswith('/WHEEL'): wheel.append(email.message_from_bytes(raw))
                rows.append(row)
    except (zipfile.BadZipFile,EOFError,UnicodeError) as error:
        raise DerivationRejected('malformed_zip_or_crc') from error
    finally:
        stream.seek(0)
    if len(record)!=1 or len(metadata)!=1 or len(wheel)!=1:
        raise DerivationRejected('single_record_metadata_and_wheel_required')
    package,version=pin['name'].split('-',2)[:2]
    normalize=lambda value:re.sub('[-_.]+','-',value.lower())
    if normalize(metadata[0].get('Name',''))!=normalize(package) or metadata[0].get('Version')!=version or wheel[0].get('Wheel-Version')!='1.0':
        raise DerivationRejected('fixed_distribution_metadata_required')
    files={row['name']:row for row in rows if not row['directory']};record_name,record_raw=record[0];listed=set()
    try:
        for columns in csv.reader(io.StringIO(record_raw.decode('utf-8'))):
            if len(columns)!=3:
                raise DerivationRejected('three_column_record_required')
            name,digest,size=columns;_name(name,opaque_data=_opaque_wheel(pin))
            if name in listed or name not in files:
                raise DerivationRejected('unique_complete_record_paths_required')
            listed.add(name);row=files[name]
            if digest:
                algorithm,value=digest.split('=',1)
                actual=base64.urlsafe_b64encode(bytes.fromhex(row['sha256'])).rstrip(b'=').decode()
                if algorithm!='sha256' or value!=actual or not size or not size.isdecimal() or int(size)!=row['bytes']:
                    raise DerivationRejected('record_hash_or_size_mismatch')
            elif name!=record_name or size!='':
                raise DerivationRejected('only_record_itself_may_be_unhashed')
    except (UnicodeError,ValueError) as error:
        if isinstance(error,DerivationRejected): raise
        raise DerivationRejected('invalid_record_encoding') from error
    if listed!=set(files):
        raise DerivationRejected('complete_record_required')
    opaque={row['name'] for row in rows if any(part.endswith('.data') for part in PurePosixPath(row['name']).parts)}
    if opaque and (not _opaque_wheel(pin) or opaque != set(OPAQUE_GREENLET_PATHS)):
        raise DerivationRejected('complete_closed_opaque_greenlet_header_scheme_required')
    return {'name':pin['name'],'entries':rows,'total_bytes':total,'files':len(files),
            'opaque_data_retained_paths':sorted(opaque)}


def _new_json(fd,name,value):
    data=canonical(value)
    if len(data)>8*1024**2:
        raise DerivationRejected('bounded_output_json_required')
    out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    with os.fdopen(out,'wb') as stream:
        os.fchmod(stream.fileno(),0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.fsync(fd)
    return {'sha256':sha(data),'bytes':len(data)}


def _directory(parent,name,create=False):
    if create:
        try:os.mkdir(name,0o700,dir_fd=parent);os.fsync(parent)
        except FileExistsError:pass
    fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    info=os.fstat(fd)
    if info.st_uid!=LOCAL_UID or stat.S_IMODE(info.st_mode)!=0o700:
        os.close(fd);raise PermissionError('private_uid1000_output_directories_required')
    return fd


def _member_parent(root,name,directory=False):
    parts=_name(name,directory,opaque_data=True).split('/');fd=os.dup(root)
    try:
        for part in parts[:-1]:
            next_fd=_directory(fd,part,True);os.close(fd);fd=next_fd
        return fd,parts[-1]
    except BaseException:
        os.close(fd);raise


def _copy(stream,rows,site):
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive:
        info={item.filename:item for item in archive.infolist()}
        if len(info)!=len(rows) or set(info)!={row['zip_name'] for row in rows}:
            raise DerivationRejected('zip_inventory_changed')
        for row in rows:
            item=info[row['zip_name']]
            if (item.file_size!=row['bytes'] or item.CRC!=row['zip_crc32'] or item.compress_type!=row['compression']
                    or item.external_attr>>16!=row['source_mode']):
                raise DerivationRejected('zip_inventory_changed')
            parent,leaf=_member_parent(site,row['name'],row['directory'])
            try:
                if row['directory']:
                    child=_directory(parent,leaf,True);os.fsync(child);os.close(child)
                    continue
                out=os.open(leaf,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
                h=hashlib.sha256();count=0
                with os.fdopen(out,'wb') as target,archive.open(item) as source:
                    os.fchmod(target.fileno(),0o600)
                    for block in iter(lambda:source.read(1024**2),b''):
                        count+=len(block)
                        if count>row['bytes']:raise DerivationRejected('copy_member_size_changed')
                        h.update(block);target.write(block)
                    target.flush();os.fsync(target.fileno())
                if count!=row['bytes'] or h.hexdigest()!=row['sha256']:
                    raise DerivationRejected('copy_member_hash_changed')
                os.fsync(parent)
            finally:os.close(parent)
    stream.seek(0)


def _verify_site(fd,expected,prefix=''):
    actual={}
    for name in sorted(os.listdir(fd)):
        info=os.stat(name,dir_fd=fd,follow_symlinks=False)
        relative=_name(prefix+name,stat.S_ISDIR(info.st_mode),opaque_data=True)
        if stat.S_ISDIR(info.st_mode):
            child=_directory(fd,name)
            try:actual.update(_verify_site(child,expected,relative+'/'));os.fsync(child)
            finally:os.close(child)
        else:
            if (relative not in expected or not stat.S_ISREG(info.st_mode) or info.st_uid!=LOCAL_UID
                    or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600):
                raise DerivationRejected('exact_private_data_regular_site_required')
            child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
            with os.fdopen(child,'rb') as stream:
                before=os.fstat(stream.fileno());h=hashlib.file_digest(stream,'sha256').hexdigest()
                if signature(before)!=signature(os.fstat(stream.fileno())) or signature(before)!=signature(os.stat(name,dir_fd=fd,follow_symlinks=False)):
                    raise DerivationRejected('site_file_changed_during_verification')
            row={'sha256':h,'bytes':before.st_size}
            if row!=expected[relative]:raise DerivationRejected('materialized_site_pin_mismatch')
            actual[relative]=row
    return actual



def _directory_identity(fd):
    info=os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0,LOCAL_UID} or info.st_mode&0o022:
        raise DerivationRejected('output_directory_identity_changed')
    return {'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid,
            'gid':info.st_gid,'mode':info.st_mode}


def _assert_output_anchor(output,parent,root,site,anchor):
    """Reopen the lexical path; held fds must still name that SAME tree.

    Writes always use the original directory fds. A replacement is only read
    for identity checks, never initialized, changed or removed by this helper.
    """
    reopened_parent=reopened_root=reopened_site=None
    try:
        if any(_directory_identity(fd)!=anchor[key] for key,fd in
               (('parent',parent),('root',root),('sites',site))):
            raise DerivationRejected('output_directory_identity_changed')
        reopened_parent=_parent(output)
        if _directory_identity(reopened_parent)!=anchor['parent']:
            raise DerivationRejected('output_directory_identity_changed')
        entry=os.stat(output.name,dir_fd=reopened_parent,follow_symlinks=False)
        if not stat.S_ISDIR(entry.st_mode) or (entry.st_dev,entry.st_ino)!=(anchor['root']['device'],anchor['root']['inode']):
            raise DerivationRejected('output_directory_identity_changed')
        reopened_root=_directory(reopened_parent,output.name)
        if _directory_identity(reopened_root)!=anchor['root']:
            raise DerivationRejected('output_directory_identity_changed')
        entry=os.stat('sites',dir_fd=reopened_root,follow_symlinks=False)
        if not stat.S_ISDIR(entry.st_mode) or (entry.st_dev,entry.st_ino)!=(anchor['sites']['device'],anchor['sites']['inode']):
            raise DerivationRejected('output_directory_identity_changed')
        reopened_site=_directory(reopened_root,'sites')
        if _directory_identity(reopened_site)!=anchor['sites']:
            raise DerivationRejected('output_directory_identity_changed')
    except OSError as error:
        raise DerivationRejected('output_directory_identity_changed') from error
    finally:
        for fd in (reopened_site,reopened_root,reopened_parent):
            if fd is not None:os.close(fd)


def derive(wheels_dir,output):
    """Single local UID1000 attempt; no owner, pin or execute override API."""
    if os.geteuid()!=LOCAL_UID:
        raise PermissionError('local_uid1000_data_producer_only_no_root_seam')
    wheels_dir,output=_scope(wheels_dir),_scope(output)
    if output.name!='python-wheel-site-1':raise DerivationRejected('fixed_new_output_basename_required')
    if os.path.lexists(output):raise FileExistsError('existing_output_never_replayed')
    if len(FIXED_WHEELS)!=4 or len({pin['name'] for pin in FIXED_WHEELS})!=4:
        raise DerivationRejected('exact_four_fixed_wheels_required')
    parent=root=site=None;old_mask=os.umask(0o077)
    try:
        expected={};paths={};inventories=[];holders=[]
        with ExitStack() as inputs:
            for pin in FIXED_WHEELS:
                _name(pin['name'])
                stream=inputs.enter_context(_wheel(wheels_dir/pin['name'],pin));holders.append(stream)
                inv=inventory(stream,pin);inventories.append(inv)
                for row in inv['entries']:
                    name=row['name']
                    if name in paths:raise DerivationRejected('duplicate_paths_between_fixed_wheels')
                    paths[name]=row
                    if not row['directory']:expected[name]={'sha256':row['sha256'],'bytes':row['bytes']}
            if not 1<=len(expected)<=MAX_FILES or sum(row['bytes'] for row in expected.values())>MAX_TOTAL:
                raise DerivationRejected('bounded_complete_site_required')
            for name in paths:
                parts=PurePosixPath(name).parents
                if any(str(part) in paths and not paths[str(part)]['directory'] for part in parts if str(part)!='.'):
                    raise DerivationRejected('member_beneath_nondirectory')
            parent=_parent(output);os.mkdir(output.name,0o700,dir_fd=parent);os.fsync(parent)
            root=_directory(parent,output.name)
            intent={'version':1,'state':'EXCLUSIVE_DATA_DERIVATION_INTENT','local_uid':LOCAL_UID,'source_wheels':list(FIXED_WHEELS),'site_subdirectory':'sites','future_site_root':FUTURE_SITE_ROOT,'no_replay':True,'qualified':False}
            intent_pin=_new_json(root,'INTENT.json',intent)
            os.mkdir('sites',0o700,dir_fd=root);os.fsync(root);site=_directory(root,'sites')
            anchor={key:_directory_identity(fd) for key,fd in (('parent',parent),('root',root),('sites',site))}
            _assert_output_anchor(output,parent,root,site,anchor)
            for stream,inv in zip(holders,inventories):_copy(stream,inv['entries'],site)
            if _verify_site(site,expected)!=expected:raise DerivationRejected('complete_site_inventory_mismatch')
            os.fsync(site);os.fsync(root)
        # Every source fd's EXIT stat validation has now succeeded. A partial
        # tree has no manifest/receipt and is preserved; no in-place retry.
        if _verify_site(site,expected)!=expected:raise DerivationRejected('site_changed_after_input_exit')
        runtime={'version':1,'site_root':FUTURE_SITE_ROOT,'source_wheels':list(FIXED_WHEELS),'files':dict(sorted(expected.items()))}
        _assert_output_anchor(output,parent,root,site,anchor)
        manifest_pin=_new_json(root,'python-runtime.json',runtime)
        own=Path(__file__);own_bytes=own.read_bytes()
        bundled=[{'path':name,**row,'local_mode':'0o600','local_mode_execute_bits':False,'absolute_execution_prevention_claimed':False} for name,row in expected.items() if name.split('/')[-1] in {'node','node.exe'}]
        receipt={'version':1,'state':'DERIVED_PUBLIC_WHEEL_SITE_DATA_ONLY','local_uid':LOCAL_UID,
                 'producer_code_sha256':sha(own_bytes),'code_hash_is_source_reference_not_native_attestation':True,
                 'local_source_wheels_dir':str(wheels_dir),'intent':intent_pin,'runtime_manifest':manifest_pin,
                 'files':len(expected),'bytes':sum(row['bytes'] for row in expected.values()),
                 'source_wheels':list(FIXED_WHEELS),'same_fd_held_preflight_through_copy':True,
                 'source_exit_stat_validated_before_manifest_and_receipt':True,
                 'output_directory_identities':anchor,'lexical_output_identity_rechecked_before_publication':True,
                 'directory_mode':'0o700','file_mode':'0o600','bundled_node':bundled,
                 'mode0600_is_not_absolute_execution_denial':True,
                 'source_wheel_and_RECORD_bytes_preserved':True,'projection_or_exclusions':[],
                 'opaque_data_retention':{
                     'source_wheel':OPAQUE_GREENLET_WHEEL,
                     'paths':[{'path':row['name'],'zip_path':row['zip_name'],
                               'type':'directory' if row['directory'] else 'file','bytes':row['bytes'],
                               'sha256':row['sha256']} for inv in inventories if inv['name']==OPAQUE_GREENLET_WHEEL
                              for row in inv['entries'] if row['name'] in OPAQUE_GREENLET_PATHS],
                     'scheme':'original wheel member paths retained as opaque DATA only',
                     'relocated':False,'installed':False,'include_paths_configured':False,
                     'all_other_data_schemes_rejected':True},
                 'tree_is_derived_data_not_an_installed_wheel_environment':True,
                 'metadata_transforms':{'directories':'0o700','regular_files':'0o600','owner':'local UID1000','timestamps':'new local data creation; not preserved'},
                 'future_site_root':FUTURE_SITE_ROOT,'actual_local_site':str(output/'sites'),
                 'root_public_staging_performed':False,'native_proof_playwright_node_override':False,
                 'required_future_native_override':'PLAYWRIGHT_NODEJS_PATH=/opt/peticao-dev-profile-tools-v1/node20',
                 'qualified':False,'operationalReady':False,'cache_integrity_verified':False,
                 'package_import_pip_install_entrypoint_or_vendor_elf_execution':False}
        _assert_output_anchor(output,parent,root,site,anchor)
        _new_json(root,'DERIVATION-RECEIPT.json',receipt);os.fsync(root);os.fsync(parent)
        _assert_output_anchor(output,parent,root,site,anchor)
        return receipt
    finally:
        for fd in (site,root,parent):
            if fd is not None:os.close(fd)
        os.umask(old_mask)


def main():
    parser=argparse.ArgumentParser(description='Derive fixed public wheel site as local data only',allow_abbrev=False)
    parser.add_argument('action',choices=['derive']);parser.add_argument('--wheels-dir',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();result=derive(args.wheels_dir,args.output)
    print(json.dumps({'state':result['state'],'files':result['files'],'runtime_manifest':result['runtime_manifest'],'qualified':False},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
