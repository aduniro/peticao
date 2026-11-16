"""Fixed Civo Root publication endpoint. No effects on import or free commands.

No program/helper from the incoming payload is imported or run. A released,
whole-blob-pinned outer archive is required; this is not a generic tar service.
The remote process trusts the already-checked SSH operator, not message text.
"""
import hashlib,json,os,re,socket,stat,struct,sys,time
from pathlib import Path
import materializer as m

RUNTIME=Path('/mnt/apps/peticao-final/.runtime')
PREFIX=Path(m.PREFIX)
INTENT=Path('/opt/.peticao-dev-profile-tools-v1.install-intent.json')
SESSION='01a1d130-2948-7140-bcfb-34696b20ab8d'
MAX_HEADER=2*1024**2
KEYS={'version','operation_id','operator_session','scope','source_notice','execution_notice','root_window_event','qualification_release_event','full_integrity_event','expected_boot_id','payload_sha256','payload_bytes','unpacked_bytes','files','deadline_unix'}


def unique(rows):
    value={}
    for k,v in rows:
        if k in value:raise ValueError('duplicate_header_key')
        value[k]=v
    return value


def read_exact(stream,size):
    out=bytearray()
    while len(out)<size:
        chunk=stream.read(min(1048576,size-len(out)))
        if not chunk:raise EOFError('short_frozen_payload_no_retry')
        out.extend(chunk)
    return bytes(out)


def guard():
    if os.getuid()!=0 or os.geteuid()!=0 or socket.gethostname().split('.')[0]!='peticao-civo':raise PermissionError('Civo_root_only')
    for ns in ('mnt','net'):
        if Path('/proc/self/ns/'+ns).stat().st_ino!=Path('/proc/1/ns/'+ns).stat().st_ino:raise PermissionError('PID1_namespaces_required')
    for root in (PREFIX.parent,RUNTIME):
        for p in [*reversed(root.parents),root]:
            i=p.lstat()
            if not stat.S_ISDIR(i.st_mode)or i.st_uid!=0 or i.st_mode&0o022:raise PermissionError('Root_controlled_publication_ancestors_required')
    if PREFIX.parent.stat().st_dev!=RUNTIME.stat().st_dev:raise PermissionError('same_filesystem_atomic_publication_required')


def header(value,observing=False):
    if type(value)is not dict or set(value)!=KEYS:raise ValueError('exact_fixed_install_header_required')
    if type(value['version'])is not int or value['version']!=1 or value['operator_session']!=SESSION or value['scope']!='new-civo-sealed-toolchain-no-dispatch':raise ValueError('fixed_role_scope_required')
    if type(value['operation_id'])is not str or not re.fullmatch('[a-f0-9]{32}',value['operation_id']):raise ValueError('fresh_operation_id_required')
    for field in ('source_notice','execution_notice','root_window_event','qualification_release_event','full_integrity_event'):
        if type(value[field])is not int or value[field]<1:raise ValueError('canonical_positive_event_required')
    if type(value['expected_boot_id'])is not str or (not observing and value['expected_boot_id']!=Path('/proc/sys/kernel/random/boot_id').read_text().strip()):raise PermissionError('exact_current_boot_required')
    if type(value['deadline_unix'])not in (int,float)or not 0<value['deadline_unix']<=time.time()+900 or(not observing and value['deadline_unix']<=time.time()):raise PermissionError('bounded_operator_deadline_required')
    m.sha(value['payload_sha256'])
    if type(value['payload_bytes'])is not int or not 1<=value['payload_bytes']<=1536*1024**2:raise ValueError('bounded_frozen_payload_required')
    m.validate_files(value['files'],value['unpacked_bytes'])
    for name,sha in {'node20':'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac','inputs/source.tar.gz':'19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5','inputs/dependencies.normalized.tar.gz':'4b2c828ffdd182a8eef3e7fab1dcc8e3a6784318cc2f0c727efd8f978933605f'}.items():
        if value['files'][name]['sha256']!=sha:raise PermissionError('frozen_R1_and_Node_inputs_required')
    return value


def record(path,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    d=os.open(Path(path).parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(d)
    finally:os.close(d)


def policy_before_publish(tree,plan):
    fd=os.open('driver-policy.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=tree.fd)
    with os.fdopen(fd,'rb')as f:raw=f.read(MAX_HEADER+1)
    if len(raw)>MAX_HEADER:raise ValueError('bounded_policy_required')
    value=json.loads(raw,object_pairs_hook=unique)
    if value.get('tools_root')!=m.PREFIX or value.get('execution_enabled')is not True or value.get('qualified')is not False or value.get('operationalReady')is not False or value.get('qualification_release_event')!=plan['qualification_release_event']:raise PermissionError('sealed_isolated_candidate_policy_only')
    # Never import incoming verifier/helper code merely to trust a package.


def install(stream):
    guard();size=int.from_bytes(read_exact(stream,8),'big')
    if not 1<=size<=MAX_HEADER:raise ValueError('bounded_header_required')
    raw=read_exact(stream,size);plan=header(json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('finite_header_required'))))
    operation=RUNTIME/('civo-toolchain-install-'+plan['operation_id'])
    if any(os.path.lexists(p)for p in (PREFIX,INTENT,operation)):raise FileExistsError('existing_or_uncertain_operation_preserved_no_replay')
    # Global fixed metadata sentinel prevents competing/new attempts even if
    # this process loses SSH before project staging or publication completes.
    record(INTENT,{'operation_id':plan['operation_id'],'header_sha256':hashlib.sha256(raw).hexdigest(),'execution_notice':plan['execution_notice'],'prefix':str(PREFIX),'writer':process_identity()})
    operation.mkdir(mode=0o700)
    parent=os.open(RUNTIME,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(parent)
    finally:os.close(parent)
    record(operation/'intent.json',{'header_sha256':hashlib.sha256(raw).hexdigest(),'no_retry':True,'writer':process_identity()});record(operation/'header.json',plan)
    payload=operation/'payload.tar.gz';fd=os.open(payload,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w+b')as f:
        left=plan['payload_bytes'];digest=hashlib.sha256()
        while left:
            if time.time()>plan['deadline_unix']:raise TimeoutError('install_deadline_partial_preserved')
            chunk=stream.read(min(1048576,left))
            if not chunk:raise EOFError('truncated_payload_partial_preserved')
            f.write(chunk);digest.update(chunk);left-=len(chunk)
        if stream.read(1)or digest.hexdigest()!=plan['payload_sha256']:raise ValueError('whole_payload_mismatch_preserved')
        f.flush();os.fsync(f.fileno());stage=operation/'tree';stage.mkdir(mode=0o755);os.chmod(stage,0o755);tree=m.Tree(stage)
        try:
            m.extract(f,tree,plan['files']);policy_before_publish(tree,plan)
            if time.time()>plan['deadline_unix']:raise TimeoutError('deadline_before_publication_preserve_stage')
            tree.check();m.rename_noreplace(stage,PREFIX);tree.path=str(PREFIX);tree.check()
            public=os.open(PREFIX.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(public)
            finally:os.close(public)
            tree.verify(plan['files'])
            result={'state':'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED','operation_id':plan['operation_id'],'prefix':str(PREFIX),'files':len(plan['files']),'bytes':plan['unpacked_bytes'],'source_notice':plan['source_notice'],'execution_notice':plan['execution_notice'],'candidate_programs_executed':False,'operational_ready':False,'native_profiles_qualified':False,'queue_cutover':False}
            record(operation/'receipt.json',result);return result
        finally:tree.close()


def process_identity():
    fields=Path('/proc/self/stat').read_text().rpartition(') ')[2].split()
    return {'pid':os.getpid(),'start_ticks':fields[19],'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def writer_alive(identity):
    if type(identity)is not dict or type(identity.get('pid'))is not int or identity['pid']<1:raise PermissionError('positive_bound_writer_identity')
    if identity.get('boot_id')!=Path('/proc/sys/kernel/random/boot_id').read_text().strip():return False
    try:fields=Path('/proc/'+str(identity['pid'])+'/stat').read_text().rpartition(') ')[2].split()
    except FileNotFoundError:return False
    return fields[19]==str(identity.get('start_ticks'))and fields[0]!='Z'


def read_record(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb')as f:
        before=os.fstat(f.fileno())
        if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_nlink!=1 or stat.S_IMODE(before.st_mode)!=0o600 or before.st_size>MAX_HEADER:raise PermissionError('bounded_Root_private_record')
        raw=f.read(MAX_HEADER+1);after=os.fstat(f.fileno());named=Path(path).lstat()
        fields=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
        if len(raw)>MAX_HEADER or any(getattr(before,k)!=getattr(after,k)or getattr(before,k)!=getattr(named,k)for k in fields):raise PermissionError('record_changed_while_reading')
    return json.loads(raw,object_pairs_hook=unique)


def observe(stream):
    guard();size=int.from_bytes(read_exact(stream,8),'big')
    if not 1<=size<=MAX_HEADER:raise ValueError('bounded_header_required')
    raw=read_exact(stream,size)
    if stream.read(1):raise ValueError('readonly_observation_takes_no_payload')
    plan=header(json.loads(raw,object_pairs_hook=unique),observing=True);operation=RUNTIME/('civo-toolchain-install-'+plan['operation_id'])
    if not os.path.lexists(INTENT):
        return {'state':'NOT_STARTED'if not(os.path.lexists(PREFIX)or os.path.lexists(operation))else'FOREIGN_PATH_WITHOUT_INTENT_UNCERTAIN','no_retry':True,'operational_ready':False}
    intent=read_record(INTENT)
    if intent.get('operation_id')!=plan['operation_id']or intent.get('header_sha256')!=hashlib.sha256(raw).hexdigest():raise PermissionError('own_original_intent_and_header_required')
    live=writer_alive(intent['writer']);receipt_path=operation/'receipt.json'
    if not os.path.lexists(receipt_path):return {'state':'WRITER_ACTIVE_OBSERVE_ONLY'if live else'PARTIAL_OR_VISIBLE_WITHOUT_RECEIPT_RECONCILIATION_REQUIRED','writer':intent['writer'],'writer_alive':live,'prefix_exists':os.path.lexists(PREFIX),'no_retry':True,'operational_ready':False}
    receipt=read_record(receipt_path)
    if receipt.get('state')!='SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED'or receipt.get('operation_id')!=plan['operation_id']or receipt.get('execution_notice')!=plan['execution_notice']:raise PermissionError('matching_publication_receipt_required')
    tree=m.Tree(PREFIX)
    try:tree.verify(plan['files'])
    finally:tree.close()
    return {'state':'PUBLISHED_CANDIDATE_RECEIPT_AND_TREE_VERIFIED','writer':intent['writer'],'writer_alive':live,'files':len(plan['files']),'operational_ready':False,'native_profiles_qualified':False,'queue_cutover':False}


def dispatch(action,stream):
    if action not in {'install','observe'}:raise PermissionError('closed_installer_action_required')
    return install(stream)if action=='install'else observe(stream)


if __name__=='__main__':
    try:os.umask(0o077);print(json.dumps(dispatch('install',sys.stdin.buffer),sort_keys=True))
    except BaseException as e:print(json.dumps({'state':'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY','error_type':type(e).__name__}));raise SystemExit(1)
