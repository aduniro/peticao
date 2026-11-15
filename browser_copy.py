"""Fixed public Chromium ZIP -> NEW local DATA tree, never a browser installer.

Local UID1000 only; no network, vendor imports, candidate execution or Root
staging. Mode0600 is a metadata projection, NOT absolute execution denial.
"""
import argparse
from contextlib import contextmanager, ExitStack
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

PROJECT=Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
FUTURE_CHROMIUM_ROOT='/opt/peticao-dev-profile-tools-v1/chromium'
LOCAL_UID=1000
ARCHIVE_SHA256='ae8736ac28bc69278551500f219fc749575648263c43ec5990749eff43b9fcf8'
ARCHIVE_BYTES=193282658
INPUTS_SHA256='5cf33c21f88fdfd207f37dc70d51750fbe277ffd99a320d006b20c16f947297a'
INPUTS_BYTES=141601
CHROME_SHA256='0b20b130e7edd9dd51873be867761295fe0cfad490c2b9a64f95bd3cfc08fa71'
CHROME_BYTES=290614600
EXPECTED_COUNTS={'members':308,'regular_files':303,'directories':5,'unpacked_bytes':406847046}
MAX_ARCHIVE=256*1024**2
MAX_METADATA=4*1024**2
MAX_FILE=512*1024**2
MAX_TOTAL=512*1024**2
MAX_MEMBERS=1000


class CopyRejected(ValueError):pass


def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def signature(i):return (i.st_dev,i.st_ino,i.st_mode,i.st_uid,i.st_gid,i.st_nlink,i.st_size,i.st_mtime_ns,i.st_ctime_ns)


def _scope(path):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts or not path.is_relative_to(PROJECT) or path==PROJECT:
        raise CopyRejected('absolute_project_data_path_required')
    return path


def _parent(path):
    path=_scope(path);fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            i=os.fstat(fd)
            if i.st_uid not in {0,LOCAL_UID} or i.st_mode&0o022:raise PermissionError('controlled_nonwritable_ancestors_required')
            next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=next_fd
        i=os.fstat(fd)
        if i.st_uid not in {0,LOCAL_UID} or i.st_mode&0o022:raise PermissionError('controlled_nonwritable_ancestors_required')
        return fd
    except BaseException:os.close(fd);raise


@contextmanager
def _input(path,sha,size,maximum):
    if type(size) is not int or not 0<size<=maximum or type(sha) is not str or not re.fullmatch('[a-f0-9]{64}',sha):
        raise CopyRejected('bounded_literal_input_pin_required')
    path=_scope(path);parent=_parent(path)
    try:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_uid!=LOCAL_UID or before.st_nlink!=1 or stat.S_IMODE(before.st_mode)!=0o600 or before.st_size!=size:
                raise PermissionError('private_uid1000_single_link_data_input_required')
            if hashlib.file_digest(stream,'sha256').hexdigest()!=sha or signature(os.fstat(stream.fileno()))!=signature(before):
                raise CopyRejected('input_hash_or_stat_mismatch')
            stream.seek(0)
            try:yield stream
            finally:
                if signature(os.fstat(stream.fileno()))!=signature(before) or signature(os.stat(path.name,dir_fd=parent,follow_symlinks=False))!=signature(before):
                    raise CopyRejected('source_changed_before_exit_no_completion')
    finally:os.close(parent)


def _relative(value,directory=False):
    if type(value) is not str:raise CopyRejected('canonical_relative_path_required')
    value=value[:-1] if directory and value.endswith('/') else value
    p=PurePosixPath(value)
    if not value or len(value.encode())>1024 or p.is_absolute() or str(p)!=value or '\\' in value or re.match(r'^[A-Za-z]:',value) or any(x in {'','.','..'} for x in value.split('/')) or any(ord(x)<32 or ord(x)==127 for x in value):
        raise CopyRejected('unsafe_browser_data_path')
    return value


def _member_name(value,directory=False):
    value=_relative(value,directory)
    if not value.startswith('chrome-linux64/') and not (directory and value=='chrome-linux64'):
        raise CopyRejected('fixed_chrome_linux64_prefix_required')
    return value


def _unique(rows):
    value={}
    for key,item in rows:
        if key in value:raise CopyRejected('duplicate_metadata_json_key')
        value[key]=item
    return value


def _load_inventory(stream):
    try:value=json.loads(stream.read(MAX_METADATA+1),object_pairs_hook=_unique)
    except (ValueError,UnicodeError) as error:
        if isinstance(error,CopyRejected):raise
        raise CopyRejected('valid_pinned_source_inventory_required') from error
    if (type(value) is not dict or value.get('qualified') is not False or value.get('operationalReady') is not False
            or value.get('archive',{}).get('sha256')!=ARCHIVE_SHA256 or value['archive'].get('bytes')!=ARCHIVE_BYTES
            or type(value.get('inventory')) is not list or len(value['inventory'])!=EXPECTED_COUNTS['members']
            or type(value.get('counts')) is not dict or any(type(value['counts'].get(k)) is not int or value['counts'][k]!=n for k,n in EXPECTED_COUNTS.items())):
        raise CopyRejected('fixed_browser_source_inventory_required')
    classifications=value.get('classifications')
    if type(classifications) is not dict or any(classifications.get(k)!=[] for k in ('unsafe_paths','duplicate_paths','symlinks','special_or_type_conflicts','privileged_modes_require_review')):
        raise CopyRejected('source_inventory_must_have_no_unsafe_member_classes')
    seen={};total=0;files=directories=0
    for row in value['inventory']:
        if type(row) is not dict or row.get('kind') not in {'file','directory'}:raise CopyRejected('regular_or_directory_inventory_only')
        directory=row['kind']=='directory';name=_member_name(row.get('path'),directory)
        if row.get('canonical_path')!=name or row.get('path_safe') is not True or name in seen:raise CopyRejected('unique_expected_browser_paths_required')
        size=row.get('bytes')
        if type(size) is not int or not 0<=size<=MAX_FILE:raise CopyRejected('bounded_expected_member_size_required')
        if type(row.get('compressed_bytes')) is not int or not 0<=row['compressed_bytes']<=MAX_ARCHIVE:raise CopyRejected('bounded_expected_compressed_member_required')
        if type(row.get('crc32_expected_hex')) is not str or not re.fullmatch('[a-f0-9]{8}',row['crc32_expected_hex']):raise CopyRejected('expected_crc_required')
        try:mode=int(row['unix_mode_octal'],8)
        except (KeyError,TypeError,ValueError) as error:raise CopyRejected('expected_unix_member_mode_required') from error
        if stat.S_IFMT(mode)!=(stat.S_IFDIR if directory else stat.S_IFREG) or mode&0o7000:raise CopyRejected('source_member_type_or_privilege_forbidden')
        if directory:
            if size!=0 or row.get('sha256') is not None:raise CopyRejected('directory_payload_forbidden')
            directories+=1
        else:
            if type(row.get('sha256')) is not str or not re.fullmatch('[a-f0-9]{64}',row['sha256']):raise CopyRejected('expected_file_sha256_required')
            files+=1
        total+=size
        if total>MAX_TOTAL:raise CopyRejected('browser_unpacked_budget_exceeded')
        seen[name]=row
    if files!=EXPECTED_COUNTS['regular_files'] or directories!=EXPECTED_COUNTS['directories'] or total!=EXPECTED_COUNTS['unpacked_bytes']:raise CopyRejected('expected_inventory_totals_mismatch')
    for name in seen:
        if any(str(parent) in seen and seen[str(parent)]['kind']!='directory' for parent in PurePosixPath(name).parents if str(parent)!='.'):
            raise CopyRejected('member_beneath_file_forbidden')
    main=seen.get('chrome-linux64/chrome')
    if not main or main['sha256']!=CHROME_SHA256 or main['bytes']!=CHROME_BYTES:raise CopyRejected('fixed_main_chrome_pin_required')
    return value,seen


def _zip_preflight(stream,expected):
    stream.seek(0);seen=set();total=0
    try:
        with zipfile.ZipFile(stream) as archive:
            infos=archive.infolist()
            if len(infos)!=len(expected) or len(infos)>MAX_MEMBERS:raise CopyRejected('exact_bounded_zip_member_count_required')
            for info in infos:
                name=_member_name(info.filename,info.is_dir())
                row=expected.get(name)
                if name in seen or row is None:raise CopyRejected('unexpected_or_duplicate_zip_path')
                seen.add(name);mode=info.external_attr>>16
                if (info.flag_bits&1 or info.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}
                        or info.file_size!=row['bytes'] or info.compress_size!=row['compressed_bytes'] or info.CRC!=int(row['crc32_expected_hex'],16)
                        or info.create_system!=row['create_system'] or mode!=int(row['unix_mode_octal'],8)
                        or info.is_dir()!=(row['kind']=='directory') or stat.S_ISLNK(mode)
                        or stat.S_IFMT(mode) not in {stat.S_IFREG,stat.S_IFDIR} or mode&0o7000):
                    raise CopyRejected('zip_member_metadata_differs_from_approved_inventory')
                total+=info.file_size
                if total>MAX_TOTAL:raise CopyRejected('zip_total_budget_exceeded')
                if info.is_dir():continue
                with archive.open(info) as source:
                    h=hashlib.sha256();count=0
                    for block in iter(lambda:source.read(1024**2),b''):
                        count+=len(block)
                        if count>row['bytes']:raise CopyRejected('zip_member_overflow')
                        h.update(block)
                if count!=row['bytes'] or h.hexdigest()!=row['sha256']:raise CopyRejected('zip_member_hash_or_size_mismatch')
    except (zipfile.BadZipFile,EOFError) as error:raise CopyRejected('malformed_zip_or_crc') from error
    finally:stream.seek(0)
    if seen!=set(expected):raise CopyRejected('complete_zip_inventory_required')


def _directory(parent,name,create=False):
    if create:
        try:os.mkdir(name,0o700,dir_fd=parent);os.fsync(parent)
        except FileExistsError:pass
    fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);i=os.fstat(fd)
    if i.st_uid!=LOCAL_UID or stat.S_IMODE(i.st_mode)!=0o700:os.close(fd);raise PermissionError('private_local_data_directory_required')
    return fd


def _dir_identity(fd):
    i=os.fstat(fd)
    if not stat.S_ISDIR(i.st_mode) or i.st_uid not in {0,LOCAL_UID} or i.st_mode&0o022:raise CopyRejected('output_lineage_changed')
    return {'device':i.st_dev,'inode':i.st_ino,'uid':i.st_uid,'gid':i.st_gid,'mode':i.st_mode}


def _anchor(output,fds,anchor):
    reopened=[]
    try:
        if any(_dir_identity(fd)!=anchor[key] for key,fd in fds.items()):raise CopyRejected('output_lineage_changed')
        parent=_parent(output);reopened.append(parent)
        if _dir_identity(parent)!=anchor['parent']:raise CopyRejected('output_lineage_changed')
        current=parent
        for key,name in (('root',output.name),('chromium','chromium'),('chrome','chrome-linux64')):
            entry=os.stat(name,dir_fd=current,follow_symlinks=False)
            if not stat.S_ISDIR(entry.st_mode) or (entry.st_dev,entry.st_ino)!=(anchor[key]['device'],anchor[key]['inode']):raise CopyRejected('output_lineage_changed')
            current=_directory(current,name);reopened.append(current)
            if _dir_identity(current)!=anchor[key]:raise CopyRejected('output_lineage_changed')
    except OSError as error:raise CopyRejected('output_lineage_changed') from error
    finally:
        for fd in reversed(reopened):os.close(fd)


def _new_json(fd,name,value):
    raw=canonical(value)
    if len(raw)>MAX_METADATA:raise CopyRejected('bounded_output_metadata_required')
    child=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    with os.fdopen(child,'wb') as out:os.fchmod(out.fileno(),0o600);out.write(raw);out.flush();os.fsync(out.fileno())
    os.fsync(fd);return {'sha256':digest(raw),'bytes':len(raw)}


def _member_parent(root,name):
    parts=_relative(name).split('/');fd=os.dup(root)
    try:
        for part in parts[:-1]:
            child=_directory(fd,part,True);os.close(fd);fd=child
        return fd,parts[-1]
    except BaseException:os.close(fd);raise


def _copy(stream,expected,chrome):
    """All writes stay under the ORIGINAL held chrome fd, never its alias."""
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive:
        infos=archive.infolist()
        if len(infos)!=len(expected):raise CopyRejected('zip_changed_after_preflight')
        seen=set()
        for info in infos:
            name=_member_name(info.filename,info.is_dir());row=expected.get(name)
            if row is None or name in seen or info.file_size!=row['bytes'] or info.CRC!=int(row['crc32_expected_hex'],16) or info.external_attr>>16!=int(row['unix_mode_octal'],8):raise CopyRejected('zip_changed_after_preflight')
            seen.add(name)
            if name=='chrome-linux64':continue
            relative=name.removeprefix('chrome-linux64/');parent,leaf=_member_parent(chrome,relative)
            try:
                if row['kind']=='directory':
                    child=_directory(parent,leaf,True);os.fsync(child);os.close(child);continue
                child=os.open(leaf,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
                h=hashlib.sha256();count=0
                with os.fdopen(child,'wb') as out,archive.open(info) as source:
                    os.fchmod(out.fileno(),0o600)
                    for block in iter(lambda:source.read(1024**2),b''):
                        count+=len(block)
                        if count>row['bytes']:raise CopyRejected('copy_size_changed')
                        h.update(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                if count!=row['bytes'] or h.hexdigest()!=row['sha256']:raise CopyRejected('copy_content_changed')
                os.fsync(parent)
            finally:os.close(parent)
    stream.seek(0)


def _verify_tree(fd,files,directories,prefix='',seen_directories=None):
    top=seen_directories is None
    if top:seen_directories=set()
    actual={}
    for name in sorted(os.listdir(fd)):
        relative=_relative(prefix+name);i=os.stat(name,dir_fd=fd,follow_symlinks=False)
        if stat.S_ISDIR(i.st_mode):
            if relative not in directories:raise CopyRejected('unexpected_output_directory')
            child=_directory(fd,name);seen_directories.add(relative)
            try:actual.update(_verify_tree(child,files,directories,relative+'/',seen_directories));os.fsync(child)
            finally:os.close(child)
        else:
            if relative not in files or not stat.S_ISREG(i.st_mode) or i.st_uid!=LOCAL_UID or i.st_nlink!=1 or stat.S_IMODE(i.st_mode)!=0o600:raise CopyRejected('private_regular_data_files_required')
            child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
            with os.fdopen(child,'rb') as stream:
                before=os.fstat(stream.fileno());h=hashlib.file_digest(stream,'sha256').hexdigest()
                if signature(before)!=signature(os.fstat(stream.fileno())) or signature(before)!=signature(os.stat(name,dir_fd=fd,follow_symlinks=False)):raise CopyRejected('output_file_changed')
            row={'sha256':h,'bytes':before.st_size}
            if row!=files[relative]:raise CopyRejected('output_file_pin_mismatch')
            actual[relative]=row
    if top and seen_directories!=directories:raise CopyRejected('complete_output_directory_inventory_required')
    return actual


def derive(archive_path,inventory_path,output):
    if os.geteuid()!=LOCAL_UID:raise PermissionError('local_uid1000_data_producer_only')
    archive_path,inventory_path,output=map(_scope,(archive_path,inventory_path,output))
    if output.name!='browser-data-1':raise CopyRejected('fixed_new_browser_data_basename_required')
    if os.path.lexists(output):raise FileExistsError('prior_output_no_overwrite_or_replay')
    fds={};old_mask=os.umask(0o077)
    try:
        with ExitStack() as inputs:
            meta_fp=inputs.enter_context(_input(inventory_path,INPUTS_SHA256,INPUTS_BYTES,MAX_METADATA))
            source,expected=_load_inventory(meta_fp)
            zip_fp=inputs.enter_context(_input(archive_path,ARCHIVE_SHA256,ARCHIVE_BYTES,MAX_ARCHIVE))
            _zip_preflight(zip_fp,expected)
            files={name.removeprefix('chrome-linux64/'): {k:row[k] for k in ('sha256','bytes')} for name,row in expected.items() if row['kind']=='file'}
            directories=set()
            for name,row in expected.items():
                if name=='chrome-linux64':continue
                relative=PurePosixPath(name.removeprefix('chrome-linux64/'))
                if row['kind']=='directory':directories.add(str(relative))
                directories.update(str(parent) for parent in relative.parents if str(parent)!='.')
            fds['parent']=_parent(output);os.mkdir(output.name,0o700,dir_fd=fds['parent']);os.fsync(fds['parent'])
            fds['root']=_directory(fds['parent'],output.name)
            intent={'version':1,'state':'EXCLUSIVE_BROWSER_DATA_INTENT','archive_sha256':ARCHIVE_SHA256,'inventory_sha256':INPUTS_SHA256,'no_replay':True,'qualified':False}
            intent_pin=_new_json(fds['root'],'INTENT.json',intent)
            os.mkdir('chromium',0o700,dir_fd=fds['root']);fds['chromium']=_directory(fds['root'],'chromium')
            os.mkdir('chrome-linux64',0o700,dir_fd=fds['chromium']);fds['chrome']=_directory(fds['chromium'],'chrome-linux64')
            anchor={key:_dir_identity(fd) for key,fd in fds.items()};_anchor(output,fds,anchor)
            _copy(zip_fp,expected,fds['chrome'])
            if _verify_tree(fds['chrome'],files,directories)!=files:raise CopyRejected('complete_data_tree_inventory_required')
            for fd in fds.values():os.fsync(fd)
        # All original held input fd/path exit-stat checks precede publication.
        if _verify_tree(fds['chrome'],files,directories)!=files:raise CopyRejected('data_tree_changed_after_source_exit')
        _anchor(output,fds,anchor)
        output_files={'chrome-linux64/'+name:row for name,row in sorted(files.items())}
        manifest={'version':1,'future_chromium_root':FUTURE_CHROMIUM_ROOT,'archive':{'sha256':ARCHIVE_SHA256,'bytes':ARCHIVE_BYTES},'source_inventory':{'sha256':INPUTS_SHA256,'bytes':INPUTS_BYTES},'files':output_files,'directories':['chrome-linux64']+['chrome-linux64/'+name for name in sorted(directories)],'metadata_projection':{'directory_mode':'0700','file_mode':'0600','uid':LOCAL_UID,'timestamps':'new local creation, not preserved'},'vendor_content_projection_or_exclusions':[],'root_installation':False,'native_browser_qualified':False}
        manifest_pin=_new_json(fds['root'],'BROWSER-DATA-MANIFEST.json',manifest)
        receipt={'version':1,'state':'DERIVED_PUBLIC_BROWSER_DATA_ONLY','local_uid':LOCAL_UID,'producer_code_sha256':digest(Path(__file__).read_bytes()),'code_hash_is_source_reference_not_native_proof':True,'source_archive':{'path':str(archive_path),'sha256':ARCHIVE_SHA256,'bytes':ARCHIVE_BYTES},'source_inventory':{'path':str(inventory_path),'sha256':INPUTS_SHA256,'bytes':INPUTS_BYTES},'intent':intent_pin,'manifest':manifest_pin,'source_archive_counts':EXPECTED_COUNTS,'materialized_regular_files':len(files),'materialized_bytes':sum(row['bytes'] for row in files.values()),'actual_data_root':str(output/'chromium'),'future_chromium_root':FUTURE_CHROMIUM_ROOT,'main_chrome':{'relative_path':'chrome-linux64/chrome','sha256':CHROME_SHA256,'bytes':CHROME_BYTES},'source_same_fd_hash_crc_and_member_verification':True,'input_exit_stat_before_publication':True,'output_directory_identities':anchor,'vendor_bytes_retained':True,'vendor_content_projection_or_exclusions':[],'directory_mode':'0700','file_mode':'0600','mode0600_is_not_absolute_execution_denial':True,'bytes_can_be_copied_or_loaded_by_other_means':True,'library_symlink_aliases_created':False,'package_import_execution_or_browser_launch':False,'variables_or_frozen_QA_modified':False,'Root_installation':False,'Chrome_Native':False,'qualified':False,'operationalReady':False}
        _anchor(output,fds,anchor);_new_json(fds['root'],'DERIVATION-RECEIPT.json',receipt)
        for fd in fds.values():os.fsync(fd)
        _anchor(output,fds,anchor)
        return receipt
    finally:
        for fd in reversed(list(fds.values())):os.close(fd)
        os.umask(old_mask)


def main():
    parser=argparse.ArgumentParser(description='Copy fixed public browser as local data only',allow_abbrev=False)
    parser.add_argument('action',choices=['derive']);parser.add_argument('--archive',required=True);parser.add_argument('--inventory',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();value=derive(args.archive,args.inventory,args.output)
    print(json.dumps({'state':value['state'],'manifest':value['manifest'],'qualified':False},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
