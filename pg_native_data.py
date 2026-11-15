"""Closed UID1000 offline PG DATA projection. No import/CLI effects or execution.

No Root installer, extraction seam, symlink creation, child process or cleanup.
All failures preserve their exclusive intent/partial output for reconciliation.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import types

UID = 1000
BASE = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
SOURCE = BASE / 'pg-copy-source-v2'
POLICY = SOURCE / 'PG-POLICY.json'
EXEC_POLICY = BASE / 'PG-EXECUTION-POLICY-V2.json'
ARCHIVE = BASE / 'staging-1/dependencies.normalized.tar.gz'
RECEIPT = BASE / 'staging-1/NORMALIZATION-RECEIPT.json'
INVENTORY = SOURCE / 'INPUT-INVENTORY.json'
PROVIDER = BASE / 'producer-source/input_provider.py'
OUTPUT = BASE / 'pg-native-data-2'
PREFIX = 'node_modules/@embedded-postgres/linux-x64/native'
ARCHIVE_SHA = '4b2c828ffdd182a8eef3e7fab1dcc8e3a6784318cc2f0c727efd8f978933605f'
ARCHIVE_BYTES = 211388662
RECEIPT_SHA = '37b9cc44ecf3a5d822a1d498ceb953b9abc2e51ea0a64714690d8b3c2ebff14b'
RECEIPT_BYTES = 4697851
PROVIDER_SHA = '6e92cc0585365fc45e04344934bb2088a7d92dea57733601b7903453c36b17d4'
PROVIDER_BYTES = 18047
INVENTORY_SHA = '75772887b76a6b992c4694b1297461ddbdc7cb30e276d4267a8c9552fd3dc7cd'
INVENTORY_BYTES = 212816
ROLE = 'offline-public-pg-native-data'
BUFFER = 1048576
MAX_JSON = 16 * 1024**2


class Rejected(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Rejected('duplicate_json_key')
        value[key] = item
    return value


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(Rejected('nonfinite_json')))


def role():
    if os.getuid() != UID or os.geteuid() != UID:
        raise PermissionError('explicit_offline_uid1000_required')


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def dir_identity(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def _path(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or str(path) != os.path.normpath(str(path)):
        raise Rejected('canonical_absolute_path_required')
    return path


def _regular(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != UID or info.st_nlink != 1
            or info.st_mode & 0o022):
        raise PermissionError('uid1000_singlelink_regular_no022_required')


def _walk(path):
    """Retain descriptor and lexical identities; never follow any ancestor."""
    path = _path(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lineage = []
    try:
        for name in [None, *path.parts[1:]]:
            if name is not None:
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = child
            info = os.fstat(fd)
            if info.st_uid not in {0, UID} or info.st_mode & 0o022:
                raise PermissionError('controlled_lexical_directory_ancestry_required')
            lineage.append(dir_identity(info))
        return fd, tuple(lineage)
    except BaseException:
        os.close(fd)
        raise


class Directory:
    def __init__(self, path, private=False):
        self.path = _path(path)
        self.fd, self.lineage = _walk(self.path)
        self.private = private
        # Original descriptors of output subdirectories; never adopt replacements.
        self.anchors = {}
        try:
            self.check()
        except BaseException:
            self.close(); raise

    def check(self):
        if self.fd < 0:
            raise PermissionError('closed_directory')
        fd, lineage = _walk(self.path)
        try:
            info = os.fstat(self.fd)
            if lineage != self.lineage or dir_identity(info) != lineage[-1]:
                raise PermissionError('directory_lineage_changed')
            if self.private and (info.st_uid != UID or stat.S_IMODE(info.st_mode) != 0o700):
                raise PermissionError('private_uid1000_directory_required')
        finally:
            os.close(fd)
        for rel, (held, expected) in self.anchors.items():
            parts=PurePosixPath(rel).parts
            parent='/'.join(parts[:-1])
            parentfd=self.fd if not parent else self.anchors[parent][0]
            named=os.stat(parts[-1],dir_fd=parentfd,follow_symlinks=False)
            if dir_identity(os.fstat(held))!=expected or dir_identity(named)!=expected:
                raise PermissionError('anchored_output_directory_replaced')

    def close(self):
        for held, _ in self.anchors.values():
            os.close(held)
        self.anchors.clear()
        if self.fd >= 0:
            os.close(self.fd); self.fd = -1

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            self.check()
        finally:
            self.close()


def new_directory(path):
    role(); path = _path(path)
    with Directory(path.parent) as parent:
        parent.check()
        os.mkdir(path.name, 0o700, dir_fd=parent.fd)
        os.fsync(parent.fd)
        parent.check()
    return Directory(path, private=True)


class Input:
    """Hash, parse/read, and exit-stat the SAME descriptor with path binding."""
    def __init__(self, path, digest, size):
        self.path = _path(path)
        self.parent = Directory(self.path.parent)
        self.stream = None
        try:
            fd = os.open(self.path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.parent.fd)
            self.stream = os.fdopen(fd, 'rb')
            self.before = os.fstat(fd)
            _regular(self.before)
            if type(size) is not int or size < 0 or self.before.st_size != size:
                raise Rejected('input_size_mismatch')
            h = hashlib.sha256()
            while chunk := self.stream.read(BUFFER):
                h.update(chunk)
            if h.hexdigest() != digest:
                raise Rejected('input_sha256_mismatch')
            self.stream.seek(0)
            self.check()
        except BaseException:
            self.close(); raise

    def check(self):
        self.parent.check()
        info = os.fstat(self.stream.fileno())
        named = os.stat(self.path.name, dir_fd=self.parent.fd, follow_symlinks=False)
        _regular(info)
        if signature(info) != signature(self.before) or signature(named) != signature(self.before):
            raise PermissionError('input_changed_or_path_replaced')

    def read(self, limit=MAX_JSON):
        self.stream.seek(0); raw = self.stream.read(limit + 1)
        if len(raw) > limit:
            raise Rejected('bounded_input_required')
        self.check(); return raw

    def close(self):
        if self.stream is not None:
            self.stream.close(); self.stream = None
        self.parent.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            self.check()
        finally:
            self.close()


def _control(path, limit=MAX_JSON):
    """Read owned control once to derive its exact pin, retaining same-FD checks."""
    path = _path(path)
    with Directory(path.parent) as parent:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent.fd)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno()); _regular(before)
            raw = stream.read(limit + 1)
            named = os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)
            if (len(raw) > limit or len(raw) != before.st_size
                    or signature(before) != signature(os.fstat(stream.fileno()))
                    or signature(before) != signature(named)):
                raise PermissionError('control_changed_or_too_large')
            return raw


def load_policy():
    role()
    live = os.path.lexists(EXEC_POLICY)
    path = EXEC_POLICY if live else POLICY
    raw = _control(path, 65536); value = parse(raw)
    expected = {'version', 'role', 'uid', 'execute', 'archive_sha256', 'archive_bytes',
                'receipt_sha256', 'receipt_bytes', 'provider_sha256', 'provider_bytes',
                'inventory_sha256', 'inventory_bytes', 'source_sha256', 'output'}
    fixed = {'version':1, 'role':ROLE, 'uid':UID, 'archive_sha256':ARCHIVE_SHA,
             'archive_bytes':ARCHIVE_BYTES, 'receipt_sha256':RECEIPT_SHA,
             'receipt_bytes':RECEIPT_BYTES, 'provider_sha256':PROVIDER_SHA,
             'provider_bytes':PROVIDER_BYTES, 'inventory_sha256':INVENTORY_SHA,
             'inventory_bytes':INVENTORY_BYTES, 'output':str(OUTPUT)}
    if (type(value) is not dict or set(value) != expected
            or any(type(value[k]) is not type(v) or value[k] != v for k,v in fixed.items())
            or type(value['execute']) is not bool
            or (not live and value['execute'] is not False)):
        raise PermissionError('closed_pg_data_policy_required')
    digest = value['source_sha256']
    if type(digest) is not str or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise Rejected('source_sha256_required')
    with Input(SOURCE / 'pg_native_data.py', digest, (SOURCE / 'pg_native_data.py').lstat().st_size):
        pass
    return value, hashlib.sha256(raw).hexdigest(), path


def _provider(stream):
    module = types.ModuleType('pinned_pg_pure_archive_parser')
    exec(compile(stream.read(), str(PROVIDER), 'exec'), module.__dict__)
    return module


def _inside(name):
    return name == PREFIX or name.startswith(PREFIX + '/')


def _relative(name):
    if not _inside(name):
        raise Rejected('pg_prefix_required')
    rel = name[len(PREFIX):].lstrip('/')
    if rel and (str(PurePosixPath(rel)) != rel or '..' in PurePosixPath(rel).parts):
        raise Rejected('canonical_pg_member_required')
    return rel


def _plan(manifest, receipt, inventory):
    """Pure, closed mapping check. Regular bytes checked separately before writes."""
    if (receipt.get('output_sha256') != inventory['archive']['sha256']
            or receipt.get('output_bytes') != inventory['archive']['bytes']
            or manifest['members'] != inventory['archive_members']
            or manifest['unpacked_bytes'] != inventory['archive_unpacked_bytes']):
        raise Rejected('manifest_receipt_archive_binding_mismatch')
    rows = receipt['entrymap']
    mapped = {x['name']:x for x in rows}
    by = {x['name']:x for x in manifest['entries']}
    if len(mapped) != len(rows) or set(mapped) != set(by):
        raise Rejected('receipt_entrymap_exact_members_required')
    for name, entry in by.items():
        row = mapped[name]
        if any(row.get(k) != entry[v] for k,v in [('output_type','type'),('output_size','size'),('normalized_mode','mode')]):
            raise Rejected('receipt_entry_metadata_mismatch')
        if entry['type'] == 'symlink' and (row.get('parent_linkname') != entry['linkname']
                or row.get('resolved_target') != entry['resolved_target']
                or row.get('final_target') != entry['final_target']):
            raise Rejected('receipt_alias_binding_mismatch')
    expected = {x['name']:x for x in inventory['entries']}
    selected = {_relative(n):e for n,e in by.items() if _inside(n)}
    if len(expected) != len(inventory['entries']) or set(selected) != set(expected):
        raise Rejected('exact_pg_inventory_required')
    if selected.get('',{}).get('type') != 'directory':
        raise Rejected('pg_root_directory_required')
    aliases = {}; plan = {}
    for rel, entry in selected.items():
        exp = expected[rel]
        if exp['type'] != entry['type']:
            raise Rejected('pg_member_type_mismatch')
        if entry['type'] == 'directory':
            plan[rel] = {'type':'directory'}
            continue
        target = entry
        if entry['type'] == 'symlink':
            final = entry['final_target']
            if not _inside(final) or by[final]['type'] != 'file':
                raise Rejected('pg_alias_same_prefix_regular_target_required')
            target = by[final]
            alias = {'linkname':entry['linkname'], 'target':_relative(final),
                     'bytes':target['size'], 'sha256':mapped[final]['output_content_sha256']}
            if exp != {'name':rel, 'type':'symlink', **alias}:
                raise Rejected('pg_alias_not_exact_known_mapping')
            aliases[rel] = alias
        row = mapped[target['name']]
        digest = row.get('output_content_sha256')
        if type(digest) is not str or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise Rejected('regular_content_hash_required')
        if exp.get('bytes') != target['size'] or exp.get('sha256') != digest:
            raise Rejected('pg_regular_inventory_hash_mismatch')
        plan[rel] = {'type':'file','source':target['name'],'bytes':target['size'],'sha256':digest}
    if aliases != inventory['aliases']:
        raise Rejected('exact_known_alias_set_required')
    counts={'directories':sum(x['type']=='directory' for x in selected.values()),
            'regulars':sum(x['type']=='file' for x in selected.values()),
            'aliases_materialized':len(aliases),
            'output_regulars':sum(x['type']=='file' for x in plan.values())}
    if counts != inventory['counts'] or sum(x.get('bytes',0) for x in plan.values()) != inventory['output_regular_bytes']:
        raise Rejected('pg_inventory_counts_bytes_mismatch')
    return plan


def _hash_stream(stream, size):
    h=hashlib.sha256(); count=0
    while chunk:=stream.read(BUFFER):
        h.update(chunk); count+=len(chunk)
        if count > size:
            raise Rejected('member_larger_than_plan')
    if count != size:
        raise Rejected('truncated_member')
    return h.hexdigest()


def _validate_content(fp, parser, plan):
    wanted={e['source']:e for e in plan.values() if e['type']=='file'}
    seen=set(); fp.seek(0)
    with tarfile.open(fileobj=fp,mode='r:*',tarinfo=parser._BoundedTarInfo) as tar:
        for member in tar:
            expected=wanted.get(member.name)
            if expected is None: continue
            if member.name in seen or not member.isfile() or member.size!=expected['bytes']:
                raise Rejected('regular_source_changed')
            with tar.extractfile(member) as stream:
                if _hash_stream(stream,expected['bytes']) != expected['sha256']:
                    raise Rejected('regular_source_hash_mismatch')
            seen.add(member.name)
    if seen != set(wanted): raise Rejected('regular_source_missing')
    fp.seek(0)


def _parent(stage, rel):
    stage.check()
    parts=PurePosixPath(rel).parts
    if not parts or str(PurePosixPath(rel))!=rel or '..' in parts or rel.startswith('/'):
        raise Rejected('canonical_output_relative_path_required')
    parent='/'.join(parts[:-1])
    if parent and parent not in stage.anchors:
        raise PermissionError('original_output_parent_anchor_required')
    held=stage.fd if not parent else stage.anchors[parent][0]
    return os.dup(held),parts[-1]


def _mkdir(stage,rel):
    """Anchor the newly created directory; retain its FD for every later write."""
    parent,name=_parent(stage,rel)
    child=-1
    try:
        os.mkdir(name,0o700,dir_fd=parent)
        created=os.stat(name,dir_fd=parent,follow_symlinks=False)
        child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
        current=os.fstat(child)
        if (dir_identity(created)!=dir_identity(current) or current.st_uid!=UID
                or stat.S_IMODE(current.st_mode)!=0o700 or rel in stage.anchors):
            raise PermissionError('new_output_directory_identity_required')
        stage.anchors[rel]=(child,dir_identity(current));child=-1
        os.fsync(parent);stage.check()
    finally:
        if child>=0:os.close(child)
        os.close(parent)


def _write(stage,rel,stream,size,digest):
    parent,name=_parent(stage,rel)
    try:
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        with os.fdopen(fd,'wb') as out:
            h=hashlib.sha256();count=0
            while chunk:=stream.read(BUFFER):
                count+=len(chunk)
                if count>size:raise Rejected('output_overflow')
                out.write(chunk);h.update(chunk)
            if count!=size or h.hexdigest()!=digest:raise Rejected('output_content_mismatch')
            out.flush();os.fsync(out.fileno())
            info=os.fstat(out.fileno());_regular(info)
            if stat.S_IMODE(info.st_mode)!=0o600:raise PermissionError('output_mode600_required')
        os.fsync(parent);stage.check()
    finally:os.close(parent)


def _json(stage,name,value):
    import io
    raw=canonical(value)+b'\n'
    _write(stage,name,io.BytesIO(raw),len(raw),hashlib.sha256(raw).hexdigest())
    parent,leaf=_parent(stage,name)
    try:
        fd=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(stream.fileno());_regular(before)
            observed=stream.read(len(raw)+1)
            if (observed!=raw or signature(before)!=signature(os.fstat(stream.fileno()))
                    or signature(before)!=signature(os.stat(leaf,dir_fd=parent,follow_symlinks=False))):
                raise PermissionError('json_readback_changed')
    finally:os.close(parent)
    stage.check()


def _materialize(fp,parser,plan,stage):
    dirs=sorted((n for n,e in plan.items() if e['type']=='directory'),key=lambda n:(n.count('/'),n))
    for rel in dirs:
        dest='postgres'+('/'+rel if rel else '')
        _mkdir(stage,dest)
    wanted={}
    for rel,e in plan.items():
        if e['type']=='file':wanted.setdefault(e['source'],[]).append((rel,e))
    seen=set();fp.seek(0)
    with tarfile.open(fileobj=fp,mode='r:*',tarinfo=parser._BoundedTarInfo) as tar:
        for member in tar:
            if member.name not in wanted:continue
            if member.name in seen or not member.isfile():raise Rejected('output_source_changed')
            # Each alias independently copies the same held archive member.
            for rel,e in wanted[member.name]:
                if member.size!=e['bytes']:raise Rejected('output_source_size_changed')
                with tar.extractfile(member) as stream:
                    _write(stage,'postgres/'+rel,stream,e['bytes'],e['sha256'])
            seen.add(member.name)
    if seen!=set(wanted):raise Rejected('output_source_missing')
    stage.check()


def _inspect(stage,plan):
    result={}; directories=set()
    expected_dirs={n for n,e in plan.items() if e['type']=='directory' and n}
    expected={n:{'bytes':e['bytes'],'sha256':e['sha256']} for n,e in plan.items() if e['type']=='file'}
    def visit(fd,rel):
        for name in os.listdir(fd):
            current=rel+'/'+name if rel else name
            info=os.stat(name,dir_fd=fd,follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                if current not in expected_dirs:raise Rejected('unexpected_output_directory')
                if info.st_uid!=UID or stat.S_IMODE(info.st_mode)!=0o700:raise PermissionError('output_directory_private_required')
                child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                try:
                    if dir_identity(os.fstat(child))!=dir_identity(info):raise PermissionError('output_directory_changed')
                    directories.add(current);visit(child,current);os.fsync(child)
                    if dir_identity(os.stat(name,dir_fd=fd,follow_symlinks=False))!=dir_identity(info):raise PermissionError('output_directory_alias_changed')
                finally:os.close(child)
            else:
                if current not in expected or info.st_size!=expected[current]['bytes']:
                    raise Rejected('unexpected_or_oversized_output_file')
                _regular(info)
                if stat.S_IMODE(info.st_mode)!=0o600:raise PermissionError('output_file_private_required')
                filefd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
                with os.fdopen(filefd,'rb') as stream:
                    before=os.fstat(stream.fileno())
                    if signature(before)!=signature(info):raise PermissionError('output_file_changed')
                    digest=_hash_stream(stream,info.st_size)
                    if signature(before)!=signature(os.fstat(stream.fileno())) or signature(info)!=signature(os.stat(name,dir_fd=fd,follow_symlinks=False)):
                        raise PermissionError('output_file_changed')
                result[current]={'bytes':info.st_size,'sha256':digest}
    stage.check()
    if set(os.listdir(stage.fd))!={'DERIVATION-INTENT.json','postgres'}:raise Rejected('exact_staging_tree_required_before_receipt')
    postgres=os.dup(stage.anchors['postgres'][0])
    try:
        rootinfo=os.fstat(postgres)
        if rootinfo.st_uid!=UID or stat.S_IMODE(rootinfo.st_mode)!=0o700:
            raise PermissionError('postgres_root_private_required')
        visit(postgres,'')
    finally:os.close(postgres)
    if result!=expected or directories!=expected_dirs:
        raise Rejected('exact_output_tree_hashes_required')
    stage.check();return result


def produce():
    """Only fixed operational entry. Parent enables external policy after review."""
    policy,policy_sha,policy_path=load_policy()
    if policy['execute'] is not True:raise PermissionError('parent_execution_policy_required')
    with contextlib.ExitStack() as stack:
        provider=stack.enter_context(Input(PROVIDER,PROVIDER_SHA,PROVIDER_BYTES))
        parser=_provider(provider.stream)
        inventory_input=stack.enter_context(Input(INVENTORY,INVENTORY_SHA,INVENTORY_BYTES))
        inventory=parse(inventory_input.read())
        receipt_input=stack.enter_context(Input(RECEIPT,RECEIPT_SHA,RECEIPT_BYTES))
        receipt=parse(receipt_input.read())
        archive=stack.enter_context(Input(ARCHIVE,ARCHIVE_SHA,ARCHIVE_BYTES))
        manifest=parser.archive_manifest(archive.stream,'deps')
        plan=_plan(manifest,receipt,inventory)
        _validate_content(archive.stream,parser,plan)
        for item in (provider,inventory_input,receipt_input,archive):item.check()
        current=load_policy()
        if current!=(policy,policy_sha,policy_path):raise PermissionError('policy_changed_before_intent')
        stage=stack.enter_context(new_directory(OUTPUT))
        _json(stage,'DERIVATION-INTENT.json',{'version':1,'state':'intent_no_automatic_retry','role':ROLE,
             'archive_sha256':ARCHIVE_SHA,'receipt_sha256':RECEIPT_SHA,'policy_sha256':policy_sha,
             'inventory_sha256':INVENTORY_SHA,'qualified':False})
        _materialize(archive.stream,parser,plan,stage)
        files=_inspect(stage,plan)
        for item in (provider,inventory_input,receipt_input,archive):item.check()
        if load_policy()!=(policy,policy_sha,policy_path):raise PermissionError('policy_or_code_changed_before_receipt')
        record={'version':1,'state':'OFFLINE_PG_DATA_DERIVED','role':ROLE,'uid':UID,
                'archive_sha256':ARCHIVE_SHA,'archive_bytes':ARCHIVE_BYTES,'normalization_receipt_sha256':RECEIPT_SHA,
                'provider_sha256':PROVIDER_SHA,'source_sha256':policy['source_sha256'],
                'policy_sha256':policy_sha,'inventory_sha256':INVENTORY_SHA,
                'files':files,'files_sha256':hashlib.sha256(canonical(files)).hexdigest(),
                'file_count':len(files),'bytes':sum(x['bytes'] for x in files.values()),
                'materialized_aliases':inventory['aliases'],'qualified':False,
                'root_integrity_approved':False,'root_install_performed':False,'native_execution_performed':False}
        _json(stage,'DERIVATION-RECEIPT.json',record)
        for item in (provider,inventory_input,receipt_input,archive):item.check()
        stage.check()
        return {'state':record['state'],'output':str(OUTPUT),'files':len(files),'bytes':record['bytes'],
                'receipt_sha256':hashlib.sha256(canonical(record)+b'\n').hexdigest(),'qualified':False}
