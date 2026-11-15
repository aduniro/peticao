"""Fixed-plan Python projection as DATA, not an installed/executable interpreter."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

BASE = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
PLAN = BASE/'metadata/python/STDLIB-PLAN-v2.json'
PLAN_SHA = '83a03a9ba1d31c2fd1d8647d5cf8e80db51dc5b0afe61f4618706d6b19fb0300'
ORIGINAL_PLAN = BASE/'metadata/python/STDLIB-PLAN.json'
ORIGINAL_PLAN_SHA = '9880a9f09a17eb9e9b59b47504e5835a22a33476b5cf89dff9eb002c62518468'
CANONICAL_TARGET = '/opt/peticao-dev-profile-tools-v1/python312'
OUTPUT = BASE/'python-stdlib-data-1'
VERSION = '3.12.3-1ubuntu0.17'
PACKAGES = frozenset({'python3.12-minimal','libpython3.12-minimal:amd64','libpython3.12-stdlib:amd64'})
BIN_SHA = 'e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f'
ALIAS_SOURCE = '/usr/lib/python3.12/_sysconfigdata__linux_x86_64-linux-gnu.py'
ALIAS_TARGET = '/usr/lib/python3.12/_sysconfigdata__x86_64-linux-gnu.py'
ALIAS_SHA = 'ee5bb5493fa4575f7788e1b0e8a067b9c463f9705dcb36f5eb571d1c0812ea82'
CHUNK = 65536
MAX_FILE = 16*1024**2
PINNED_TEST_SELECTION_SHA = 'bdb0b8d571fc420e276ba982c7770871e99ef7216bff3f0bc4c8a23ecc95e7c6'
_TEST_SUFFIXES = '''__init__.py __main__.py
libregrtest/__init__.py libregrtest/cmdline.py libregrtest/filter.py libregrtest/findtests.py
libregrtest/logger.py libregrtest/main.py libregrtest/mypy.ini libregrtest/pgo.py libregrtest/refleak.py
libregrtest/result.py libregrtest/results.py libregrtest/run_workers.py libregrtest/runtests.py
libregrtest/save_env.py libregrtest/setup.py libregrtest/single.py libregrtest/testresult.py libregrtest/tsan.py
libregrtest/utils.py libregrtest/win_utils.py libregrtest/worker.py regrtest.py support/__init__.py
support/_hypothesis_stubs/__init__.py support/_hypothesis_stubs/_helpers.py support/_hypothesis_stubs/strategies.py
support/ast_helper.py support/asynchat.py support/asyncore.py support/bytecode_helper.py
support/hashlib_helper.py support/hypothesis_helper.py support/import_helper.py support/interpreters.py
support/logging_helper.py support/os_helper.py support/pty_helper.py support/script_helper.py support/smtpd.py
support/socket_helper.py support/testcase.py support/threading_helper.py support/warnings_helper.py test_support.py
typinganndata/__init__.py typinganndata/_typed_dict_helper.py typinganndata/ann_module.py
typinganndata/ann_module2.py typinganndata/ann_module3.py typinganndata/ann_module4.py
typinganndata/ann_module5.py typinganndata/ann_module6.py typinganndata/ann_module7.py
typinganndata/ann_module8.py typinganndata/ann_module9.py typinganndata/mod_generics_cache.py'''.split()
_TEST_MEMBERS = frozenset('lib/python3.12/test/'+name for name in _TEST_SUFFIXES)
_TEST_PATHS = _TEST_MEMBERS | frozenset(str(p) for name in _TEST_MEMBERS for p in PurePosixPath(name).parents)


class CopyRefused(ValueError): pass


def require(condition, code):
    if not condition: raise CopyRefused(code)


def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def sha(value): return hashlib.sha256(value).hexdigest()


def signature(info):
    return {k:getattr(info,k)for k in ('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')}


def _path(value):
    require(type(value)is str and value.startswith('/') and str(PurePosixPath(value))==value
        and '..'not in PurePosixPath(value).parts and '\\'not in value and '\0'not in value,'canonical_absolute_path_required')
    return PurePosixPath(value)


def _relative(value):
    require(type(value)is str and 0<len(value)<=1024 and not value.startswith('/') and str(PurePosixPath(value))==value
        and '\\'not in value and not any(ord(c)<32 for c in value) and not any(x in ('','.','..')for x in value.split('/')),
        'canonical_relative_projection_required')
    parts=PurePosixPath(value).parts
    require(not any(p in {'__pycache__','site-packages','dist-packages','tests'}for p in parts)
        and ('test'not in parts or value in _TEST_PATHS)
        and PurePosixPath(value).suffix not in {'.pyc','.pyo','.pth'}
        and parts[-1]not in {'sitecustomize.py','usercustomize.py'},'excluded_startup_cache_or_test_path')
    return parts


def _root_directory(info):
    require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and bool(info.st_mode&0o001),
        'public_root_controlled_source_ancestor_required')


def _parent(path,root_source=False):
    parts=_path(str(path)).parts
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        if root_source:_root_directory(os.fstat(fd))
        for part in parts[1:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
            if root_source:_root_directory(os.fstat(fd))
        return fd
    except BaseException:os.close(fd);raise


def _file_root(info,size):
    require(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and not info.st_mode&0o022
        and info.st_mode&0o004 and info.st_size==size and size<=MAX_FILE,'pinned_public_root_regular_required')


def _hash(fp):
    fp.seek(0);h=hashlib.sha256()
    for block in iter(lambda:fp.read(CHUNK),b''):h.update(block)
    return h.hexdigest()


def _read_metadata(path,expected):
    parent=_parent(path)
    try:
        fd=os.open(Path(path).name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb')as fp:
            before=os.fstat(fp.fileno());require(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<=2*1024**2,'bounded_metadata_regular_required')
            raw=fp.read(2*1024**2+1);require(len(raw)==before.st_size and sha(raw)==expected,'metadata_pin_mismatch')
            require(signature(before)==signature(os.fstat(fp.fileno()))==signature(os.stat(Path(path).name,dir_fd=parent,follow_symlinks=False)),
                'metadata_stat_changed')
            return raw
    finally:os.close(parent)


def _json(raw):
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'duplicate_metadata_key');value[key]=item
        return value
    def nonfinite(_):raise CopyRefused('nonfinite_metadata')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=nonfinite)


def load_plan(): return _json(_read_metadata(PLAN,PLAN_SHA))


def prepare_selection(plan):
    require(plan['requested_projection_prefix']==CANONICAL_TARGET and plan['existing_driver_python_prefix']==CANONICAL_TARGET,
        'canonical_future_python_prefix_required')
    correction=plan.get('prefix_correction_provenance')
    require(type(correction)is dict and correction.get('original_plan_path')==str(ORIGINAL_PLAN)
        and correction.get('original_plan_sha256')==ORIGINAL_PLAN_SHA and correction.get('original_plan_preserved')is True
        and correction.get('canonical_future_target_prefix')==CANONICAL_TARGET
        and correction.get('corrected_target_fields')==625 and correction.get('sources_hashes_packages_selection_unchanged')is True
        and correction.get('copy_performed')is False and correction.get('qualified')is False,'original_plan_correction_provenance_required')
    require(plan['source_root']=='/usr/lib/python3.12'and len(plan['regular_files'])==623,'fixed_stdlib_selection_required')
    require({r['name']for r in plan['requested_packages']}==PACKAGES and len(plan['requested_packages'])==3,'exact_three_packages_required')
    for row in plan['requested_packages']:
        require(row['version']==VERSION and row['source_version']==VERSION and row['source_package']=='python3.12'
            and row['architecture']=='amd64'and row['status']=='installed','fixed_package_version_metadata_required')
    require(plan['qualified']is False and plan['native_qualified']is False and plan['operationalReady']is False,'source_plan_unqualified_required')
    rows=[];seen=set()
    for row in plan['regular_files']:
        parts=_relative(row['relative']);require(parts[:2]==('lib','python3.12'),'fixed_stdlib_output_prefix_required')
        suffix='/'.join(parts[2:])
        require(row['source']=='/usr/lib/python3.12/'+suffix and row['target']==CANONICAL_TARGET+'/'+row['relative']
            and row['projection_type']=='new_regular','fixed_source_to_relative_projection_required')
        require(row['relative']not in seen and row['packages']and set(row['packages'])<=PACKAGES,'unique_selected_package_member_required')
        require(type(row['bytes'])is int and 0<=row['bytes']<=MAX_FILE and type(row['sha256'])is str and re.fullmatch('[a-f0-9]{64}',row['sha256']),
            'exact_source_size_sha_required')
        seen.add(row['relative']);rows.append({k:deepcopy(row[k])for k in ('source','relative','sha256','bytes','packages')})
    require(sum(r['bytes']for r in rows)==14072966,'fixed_stdlib_total_required')
    selected_tests=sorted([r for r in rows if r['relative']in _TEST_MEMBERS],key=lambda r:r['relative'])
    require(len(selected_tests)==58 and sha(canonical(selected_tests).encode())==PINNED_TEST_SELECTION_SHA,
        'exact_58_stdlib_owned_test_support_members_required')
    binary=plan['executable']
    require(binary=={'source':'/usr/bin/python3.12','target':CANONICAL_TARGET+'/bin/python3.12','sha256':BIN_SHA,'bytes':8020928,'projection_type':'new_regular'},
        'fixed_civo_identical_binary_required')
    rows.append({'source':binary['source'],'relative':'bin/python3.12','sha256':BIN_SHA,'bytes':8020928,'packages':['python3.12-minimal']})
    alias=plan['blocked_internal_alias']
    require(alias['source_symlink']==ALIAS_SOURCE and alias['regular_target_already_inventoried']==ALIAS_TARGET
        and alias['sha256']==ALIAS_SHA and alias['bytes']==49505 and alias['same_package']is False
        and alias['materialization_approved']is False and alias['within_three_requested_package_family']is True
        and alias['symlink_packages']==['libpython3.12-stdlib'] and alias['target_packages']==['libpython3.12-minimal:amd64'],
        'only_reviewed_cross_package_alias_override_required')
    targets=[r for r in rows if r['source']==ALIAS_TARGET]
    require(len(targets)==1 and targets[0]['sha256']==ALIAS_SHA and targets[0]['bytes']==49505,'selected_alias_target_pin_required')
    rows.append({'source':ALIAS_TARGET,'relative':'lib/python3.12/'+Path(ALIAS_SOURCE).name,'sha256':ALIAS_SHA,'bytes':49505,
        'packages':['libpython3.12-minimal:amd64'],'materialization':{'source_alias':ALIAS_SOURCE,'regular_target':ALIAS_TARGET,
        'alias_packages':['libpython3.12-stdlib'],'target_packages':['libpython3.12-minimal:amd64'],'version':VERSION,
        'same_package':False,'plan_materialization_approved':False,'specific_infra_override_required':True,
        'target_sha256':ALIAS_SHA,'target_bytes':49505,'new_regular_sha256':ALIAS_SHA}})
    require(len(rows)==625 and len({r['relative']for r in rows})==625,'exact_final_projection_members_required')
    return sorted(rows,key=lambda r:r['relative'])


@contextmanager
def _source(row):
    parent=_parent(row['source'],True)
    try:
        fd=os.open(Path(row['source']).name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb')as fp:
            before=os.fstat(fp.fileno());_file_root(before,row['bytes'])
            require(_hash(fp)==row['sha256'],'source_sha_before_copy_mismatch');fp.seek(0)
            yield fp,signature(before)
            require(_hash(fp)==row['sha256'],'source_sha_after_copy_mismatch')
            require(signature(before)==signature(os.fstat(fp.fileno()))==signature(os.stat(Path(row['source']).name,dir_fd=parent,follow_symlinks=False)),
                'source_exit_stat_or_named_identity_changed')
    finally:os.close(parent)


def _alias_identity():
    parent=_parent(ALIAS_SOURCE,True)
    try:
        info=os.stat(Path(ALIAS_SOURCE).name,dir_fd=parent,follow_symlinks=False)
        require(stat.S_ISLNK(info.st_mode)and info.st_uid==0,'known_root_alias_metadata_required')
        target=os.readlink(Path(ALIAS_SOURCE).name,dir_fd=parent)
        require(target in {Path(ALIAS_TARGET).name,ALIAS_TARGET},'known_alias_literal_target_required')
        return {'stat':signature(info),'link_target':target}
    finally:os.close(parent)


def _private_directory(info):
    require(stat.S_ISDIR(info.st_mode)and info.st_uid==1000 and stat.S_IMODE(info.st_mode)==0o700,'owned_private_output_directory_required')


def _destination_parent(tree,relative):
    parts=_relative(relative);fd=os.dup(tree)
    try:
        for part in parts[:-1]:
            try:os.mkdir(part,0o700,dir_fd=fd);os.fsync(fd)
            except FileExistsError:pass
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;_private_directory(os.fstat(fd))
        return fd,parts[-1]
    except BaseException:os.close(fd);raise


def _json_out(directory,name,value):
    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'wb')as fp:fp.write((canonical(value)+'\n').encode());fp.flush();os.fsync(fp.fileno())
    os.fsync(directory)


def _copy_one(tree,row):
    parent,name=_destination_parent(tree,row['relative'])
    try:
        with _source(row)as(source,source_stat):
            fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
            os.fchmod(fd,0o600)
            digest=hashlib.sha256();count=0
            try:
                for block in iter(lambda:source.read(CHUNK),b''):
                    count+=len(block);require(count<=row['bytes'],'source_grew_during_copy');digest.update(block)
                    view=memoryview(block)
                    while view:
                        n=os.write(fd,view);require(n>0,'short_destination_write');view=view[n:]
                require(count==row['bytes']and digest.hexdigest()==row['sha256'],'copied_bytes_pin_mismatch')
                os.fsync(fd);os.fsync(parent)
                info=os.fstat(fd)
                require(stat.S_ISREG(info.st_mode)and info.st_uid==1000 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,
                    'new_private_regular_data_required')
            finally:os.close(fd)
        # Record SourceExit only after the source context's final hash/stat.
        return {**deepcopy(row),'source_fd_stat':source_stat,'source_exit_verified':True,'output_mode':'0o600',
            'output_sha256':digest.hexdigest(),'output_bytes':count,'package_version_snapshot':VERSION}
    finally:os.close(parent)


def hash_whole_tree(tree,expected):
    found={};directories=[]
    def walk(fd,prefix,depth):
        require(depth<=32,'output_tree_depth_bound');_private_directory(os.fstat(fd))
        directories.append(prefix or '.')
        with os.scandir(fd)as entries:
            for entry in entries:
                name=(prefix+'/'if prefix else'')+entry.name;_relative(name)
                info=os.stat(entry.name,dir_fd=fd,follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                    try:walk(child,name,depth+1)
                    finally:os.close(child)
                else:
                    require(name in expected and stat.S_ISREG(info.st_mode)and info.st_uid==1000 and info.st_nlink==1
                        and stat.S_IMODE(info.st_mode)==0o600 and info.st_size==expected[name]['bytes'],'unexpected_or_nonprivate_projection_file')
                    child=os.open(entry.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
                    with os.fdopen(child,'rb')as fp:
                        before=os.fstat(fp.fileno());digest=_hash(fp)
                        require(digest==expected[name]['sha256']and signature(before)==signature(info)==signature(os.fstat(fp.fileno()))
                            ==signature(os.stat(entry.name,dir_fd=fd,follow_symlinks=False)),'output_tree_hash_or_identity_changed')
                    found[name]={'sha256':digest,'bytes':info.st_size,'mode':'0o600'}
    walk(tree,'',0)
    require(set(found)==set(expected),'exact_output_file_set_required')
    expected_directories={'.'}|{str(parent)for name in expected for parent in PurePosixPath(name).parents}
    require(set(directories)==expected_directories,'exact_output_directory_set_required')
    inventory={'files':dict(sorted(found.items())),'directories':[{'path':p,'mode':'0o700'}for p in sorted(directories)]}
    return {'inventory':inventory,'sha256':sha(canonical(inventory).encode()),'regular_files':len(found),
        'bytes':sum(r['bytes']for r in found.values()),'source_exit_before_tree_verification':True}


def _produce(rows,provenance,authorization):
    require(os.geteuid()==1000,'offline_data_producer_uid_1000_required')
    parent=_parent(str(BASE/'anchor'));_private_directory(os.fstat(parent))
    out=-1;tree=-1
    try:
        os.mkdir(OUTPUT.name,0o700,dir_fd=parent)
        out=os.open(OUTPUT.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);before=os.fstat(out);_private_directory(before)
        _json_out(out,'INTENT.json',{'version':1,'classification':'DATA_COPY_INTENT_NO_REPLAY','authorization':authorization,
            'plan_sha256':PLAN_SHA,'expected_regular_files':len(rows),'expected_bytes':sum(r['bytes']for r in rows)})
        os.mkdir('python312',0o700,dir_fd=out);os.fsync(out)
        tree=os.open('python312',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=out)
        base_before=os.fstat(parent);tree_before=os.fstat(tree)
        def identity(info):return(info.st_dev,info.st_ino,info.st_uid,stat.S_IMODE(info.st_mode))
        def lineage():
            require(identity(base_before)==identity(os.stat(BASE,follow_symlinks=False))
                and identity(before)==identity(os.stat(OUTPUT.name,dir_fd=parent,follow_symlinks=False))
                ==identity(os.stat(OUTPUT,follow_symlinks=False))
                and identity(tree_before)==identity(os.stat('python312',dir_fd=out,follow_symlinks=False))
                ==identity(os.stat(OUTPUT/'python312',follow_symlinks=False)),'output_lineage_replaced_preserve_partial')
        alias_before=_alias_identity()
        copied=[_copy_one(tree,row)for row in rows]
        require(alias_before==_alias_identity(),'known_alias_metadata_changed')
        verified=hash_whole_tree(tree,{r['relative']:r for r in rows})
        os.fsync(tree);os.fsync(out);os.fsync(parent)
        lineage()
        manifest={'version':1,'classification':'PYTHON_REGULAR_DATASET_NOT_INTERPRETER_INSTALL','plan_sha256':PLAN_SHA,
            'provenance':provenance,'authorization':authorization,'known_alias_metadata':alias_before,
            'files':copied,'hashWholeTree':verified,'source_exit_all_verified':all(r['source_exit_verified']for r in copied),
            'candidate_executed_or_imported':False,'vendor_signature_verified':False,'civo_stdlib_identity_proven':False,
            'RootFullClosure':False,'native_qualified':False,'qualified':False,'operationalReady':False}
        _json_out(out,'MANIFEST.json',manifest)
        lineage()
        receipt={'version':1,'classification':'DATA_COPY_COMPLETE_NOT_INSTALLED_NOT_QUALIFIED','output':str(OUTPUT/'python312'),
            'manifest_sha256':sha((canonical(manifest)+'\n').encode()),'hashWholeTree':verified['sha256'],
            'regular_files':len(copied),'bytes':verified['bytes'],'qualified':False,'operationalReady':False,'root_review_required':True}
        _json_out(out,'RECEIPT.json',receipt)
        lineage()
        return receipt
    finally:
        if tree>=0:os.close(tree)
        if out>=0:os.close(out)
        os.close(parent)


def produce(authorization):
    require(type(authorization)is dict and set(authorization)=={'kind','release_event','plan_sha256','producer_sha256','output'},'exact_review_authorization_required')
    require(authorization['kind']=='INFRA_AUTHORIZED_OFFLINE_PUBLIC_DATA_COPY'and type(authorization['release_event'])is int
        and authorization['release_event']>0 and authorization['plan_sha256']==PLAN_SHA and authorization['output']==str(OUTPUT),
        'fixed_infra_authorized_data_copy_authorization_required')
    code=Path(__file__).absolute()
    require(type(authorization['producer_sha256'])is str and re.fullmatch('[a-f0-9]{64}',authorization['producer_sha256']), 'reviewed_producer_digest_required')
    _read_metadata(code,authorization['producer_sha256'])
    plan=load_plan();rows=prepare_selection(plan)
    return _produce(rows,{'plan':str(PLAN),'plan_sha256':PLAN_SHA,'packages':deepcopy(plan['requested_packages']),
        'canonical_future_installation_prefix_not_installed':CANONICAL_TARGET,
        'prefix_correction_provenance':deepcopy(plan['prefix_correction_provenance']),
        'package_metadata_is_snapshot_not_vendor_signature':True,'binary_only_matches_civo_ro719':True,
        'selected_stdlib_test_support_files':58,'selected_stdlib_test_support_metadata_sha256':PINNED_TEST_SELECTION_SHA,
        'selected_test_support_copied_as_data_never_executed_or_imported':True,
        'alias_override_is_specific_not_same_package_claim':True},deepcopy(authorization))
