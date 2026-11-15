"""UID1000 DATA inventory only; no Root install/execution or guard override.

Only main's four fixed/pinned projection manifests select actual inputs. A
writable ancestor confers no code/Root authority: leaf directories/files must
be private UID1000, all bytes pinned, no links, and identities rechecked.
"""
import hashlib,json,os,re,stat
from pathlib import Path,PurePosixPath
UID=1000
BASE=Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')


def signature(i):return (i.st_dev,i.st_ino,i.st_uid,i.st_gid,i.st_mode,i.st_nlink,i.st_size,i.st_mtime_ns,i.st_ctime_ns)

def relative(value):
    if type(value)is not str or not value or value.startswith('/')or value!=str(PurePosixPath(value))or any(p in ('','..','.')for p in value.split('/'))or'\\'in value or'\0'in value:raise ValueError('closed_relative_DATA_name')
    return value

def read(path,sha,size=None,metadata=False):
    if os.getuid()!=UID or os.geteuid()!=UID:raise PermissionError('UID1000_DATA_only')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb')as f:
        a=os.fstat(f.fileno())
        if not stat.S_ISREG(a.st_mode)or a.st_uid!=UID or a.st_nlink!=1 or stat.S_IMODE(a.st_mode)not in ((0o600,0o644)if metadata else(0o600,)):raise PermissionError('private_regular_DATA_required')
        if size is not None and a.st_size!=size:raise ValueError('DATA_size_mismatch')
        if a.st_size>512*1024**2:raise ValueError('bounded_DATA_file')
        digest=hashlib.sha256();count=0;out=bytearray()if metadata else None
        while block:=f.read(1048576):
            digest.update(block);count+=len(block)
            if metadata:out.extend(block)
            if count>a.st_size:raise ValueError('DATA_grew')
        if digest.hexdigest()!=sha or count!=a.st_size:raise ValueError('DATA_preimage_mismatch')
        if signature(a)!=signature(os.fstat(f.fileno()))or signature(a)!=signature(Path(path).lstat()):raise ValueError('DATA_changed')
    return bytes(out)if metadata else {'sha256':sha,'bytes':count,'source_identity':list(signature(a))}

def directory_snapshot(root):
    root=Path(root);dirs={};files=set()
    for folder,names,leaves in os.walk(root,followlinks=False):
        p=Path(folder);i=p.lstat()
        if not stat.S_ISDIR(i.st_mode)or i.st_uid!=UID or stat.S_IMODE(i.st_mode)!=0o700:raise PermissionError('private_DATA_directory_required')
        dirs[str(p)]=[i.st_dev,i.st_ino,i.st_uid,i.st_gid,i.st_mode,i.st_ctime_ns]
        for name in names:
            if not stat.S_ISDIR((p/name).lstat().st_mode):raise PermissionError('DATA_directory_link_refused')
        for name in leaves:files.add(relative((p/name).relative_to(root).as_posix()))
    if not dirs:raise PermissionError('existing_DATA_root_required')
    return dirs,files

def family(root,entries,target,count,maximum):
    before,names=directory_snapshot(root)
    if set(entries)!=names or len(names)!=count:raise ValueError('exact_projected_file_set_required')
    result={};total=0
    for name,row in sorted(entries.items()):
        name=relative(name);path=Path(root)/name;facts=read(path,row['sha256'],row['bytes']);total+=facts['bytes']
        output=relative(target+'/'+name);mode=0o644
        if output=='python312/bin/python3.12'or output.startswith('postgres/bin/')or output in {'chromium/chrome-linux64/chrome','chromium/chrome-linux64/chrome_crashpad_handler','chromium/chrome-linux64/chrome_sandbox'}:mode=0o755
        result[output]={**facts,'source_path':str(path),'future_Root_mode':oct(mode),'provenance_role':'verified_public_DATA_projection_not_installed'}
    if total!=maximum or directory_snapshot(root)!=(before,names):raise ValueError('DATA_tree_changed_or_byte_count_mismatch')
    return result

def main():
    specs=[('python',BASE/'python-stdlib-data-1/MANIFEST.json','4c11a80c78b2f58941dcde28977604259251f49b8cb6e08e1039af05006a02c3',BASE/'python-stdlib-data-1/python312','python312',625,22143399),
           ('browser',BASE/'browser-data-v2/browser-data-1/BROWSER-DATA-MANIFEST.json','414d7225f5423a86c8fb0708e6fb79a68924fc9bde1831191226ccb76db25f2f',BASE/'browser-data-v2/browser-data-1/chromium','chromium',303,406847046),
           ('pg',BASE/'pg-native-data-2/DERIVATION-RECEIPT.json','9d4bcd4f1c99da8d960513eeb3cb17bd779531e4613fd01e1373c7059ec2bc4e',BASE/'pg-native-data-2/postgres','postgres',1037,124558599),
           ('wheels',BASE/'wheel-data-v2/python-wheel-site-1/python-runtime.json','97f81dd1ed0b1170725983336a181942d85fccae360ebb25f3f0128971686c8e',BASE/'wheel-data-v2/python-wheel-site-1/sites','python-wheels/site',305,141979136)]
    files={};provenance={}
    for name,manifest,sha,root,target,count,maximum in specs:
        value=json.loads(read(manifest,sha,metadata=True));rows=value['files']
        if isinstance(rows,list):rows={r['relative']:{'sha256':r['output_sha256'],'bytes':r['output_bytes']}for r in rows}
        rows=family(root,rows,target,count,maximum)
        if set(files)&set(rows):raise ValueError('unique_target_names_required')
        files.update(rows);provenance[name]={'manifest':str(manifest),'manifest_sha256':sha,'files':count,'bytes':maximum}
    return {'version':1,'classification':'VERIFIED_DATA_INVENTORY_NOT_ROOT_INSTALL','future_prefix':'/opt/peticao-dev-profile-tools-v1','files':files,'provenance':provenance,'regulars':len(files),'bytes':sum(r['bytes']for r in files.values()),'missing_installation_inputs':['Node20 official member','pdfjs103 official asset projection','helpers/QA/source and normalized input archives','closed full-integrity attestation and sealed driver policy','Root installer/execution manifest/reservation/window'],'RootFullClosure':False,'candidate_execution':False,'root_install':False,'native_qualified':False}

if __name__=='__main__':print(json.dumps(main(),sort_keys=True))
