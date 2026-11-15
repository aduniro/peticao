"""Offline public DATA bundle builder. No SSH, candidates or package managers.

Pure rendering uses only the separately reviewed frozen driver source. This
does not call its Root-only produce/verify_closure or claim Root verification.
"""
import argparse
from contextlib import contextmanager
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tarfile

HERE=Path(__file__).resolve().parent
DRIVER=Path('/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source')
DRIVER_COMMIT='bcff9fcb34df060666670bad5482769b630bcef8'
PREFIX='/opt/peticao-dev-profile-tools-v1'
MAX_FILE=512*1024**2

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def pin(raw):return {'sha256':digest(raw),'bytes':len(raw)}
def signature(s):return tuple(getattr(s,k)for k in ('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))

@contextmanager
def source(ref):
    path=Path(ref['path'])
    if not path.is_absolute()or'..'in path.parts:raise ValueError('absolute_public_source_required')
    private_anchor=False
    for parent in reversed(path.parents):
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode)or info.st_uid not in {0,os.geteuid()}or info.st_mode&0o002 or (info.st_mode&0o020 and not private_anchor):raise PermissionError('controlled_public_ancestry')
        if info.st_uid==os.geteuid()and stat.S_IMODE(info.st_mode)==0o700:private_anchor=True
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb')as f:
        before=os.fstat(f.fileno())
        if not stat.S_ISREG(before.st_mode)or before.st_uid!=os.geteuid()or before.st_nlink!=1 or before.st_mode&0o002 or (before.st_mode&0o020 and not private_anchor) or before.st_size!=ref['bytes']:raise PermissionError('owned_regular_public_source')
        if 'source_identity'in ref and tuple(ref['source_identity'])!=signature(before):raise PermissionError('family_source_identity_changed')
        h=hashlib.sha256()
        while chunk:=f.read(1048576):h.update(chunk)
        if h.hexdigest()!=ref['sha256']:raise ValueError('source_content_changed')
        f.seek(0)
        yield f
        if signature(before)!=signature(os.fstat(f.fileno()))or signature(before)!=signature(path.lstat()):raise PermissionError('source_changed_during_use')

def raw(ref,maximum=16*1024**2):
    if ref['bytes']>maximum:raise ValueError('bounded_json_or_code_required')
    with source(ref)as f:
        value=f.read(maximum+1)
        if len(value)!=ref['bytes']or digest(value)!=ref['sha256']:raise ValueError('pinned_read_required')
    return value

def newfile(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())

def directory_sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def copy_member(ref,member,pin_value,target):
    with source(ref)as f,tarfile.open(fileobj=f,mode='r:*')as tf:
        names=set();found=False
        for item in tf:
            if item.name in names:raise ValueError('duplicate_vendor_member')
            names.add(item.name)
            if item.name!=member:continue
            if found or not item.isfile()or item.issparse()or item.size!=pin_value['bytes']or item.size>MAX_FILE:raise ValueError('exact_regular_vendor_member_required')
            found=True;h=hashlib.sha256();count=0
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb')as out,tf.extractfile(item)as stream:
                while block:=stream.read(1048576):
                    count+=len(block)
                    if count>pin_value['bytes']:raise ValueError('vendor_member_overflow')
                    h.update(block);out.write(block)
                out.flush();os.fsync(out.fileno())
            if count!=pin_value['bytes']or h.hexdigest()!=pin_value['sha256']:raise ValueError('vendor_member_pin_mismatch')
        if not found:raise ValueError('vendor_member_missing')
    return dict(pin_value,path=str(target))

def reviewed_modules(spec):
    if spec['source_driver_commit']!=DRIVER_COMMIT:raise ValueError('frozen_driver_required')
    def git(*args):return subprocess.check_output(['git','-C',str(DRIVER),*args],text=True).strip()
    if git('rev-parse','HEAD')!=DRIVER_COMMIT or git('status','--porcelain'):raise PermissionError('clean_frozen_reviewed_source_required')
    names={'artifact_policy.py','resource_plan.py','driver_contract.py','sealed_policy.py','freeze_driver.py'}
    refs=dict(spec['helpers']);refs.update(spec['reviewed_render_source'])
    # Pin all trusted modules BEFORE loading any. No incoming archive is code.
    blobs={name:raw(refs[name])for name in names}
    order=('artifact_policy','resource_plan','driver_contract','sealed_policy','freeze_driver')
    import types
    for name in order:
        if name in sys.modules:raise PermissionError('fresh_module_namespace_required')
        module=types.ModuleType(name);module.__file__=str(DRIVER/(name+'.py'));sys.modules[name]=module
        exec(compile(blobs[name+'.py'],module.__file__,'exec'),module.__dict__)
    return sys.modules['driver_contract'],sys.modules['sealed_policy'],sys.modules['freeze_driver']

def policy_for(contract,sealed,spec,files,helper_pins,qa_pins,proof):
    inventory={'version':1,'roots':list(sealed.TOOL_ROOTS),'files':files}
    deps={'version':1,'parent_archive':dict(contract.PARENT_DEPS),
          'normalized_archive':dict(spec['inputs']['inputs/dependencies.normalized.tar.gz'],path=PREFIX+'/inputs/dependencies.normalized.tar.gz'),
          'normalization_receipt_sha256':spec['inputs']['inputs/normalization-receipt.json']['sha256'],
          'toolchain':{},'toolchain_inventory_sha256':digest(canonical(inventory)),
          'qa_closure_sha256':digest(canonical(qa_pins)),
          'full_integrity_attestation':{'manifest_event':3429,'inventory_sha256':proof['inventory_sha256'],'evidence_sha256':spec['inputs']['inputs/full-integrity-proof.json']['sha256']},
          'original_cache_full_integrity_verified':False}
    for name,row in contract.TOOL_REFS.items():
        relative=row['path'][len(PREFIX)+1:];actual=files[relative]
        deps['toolchain'][name]=dict(row,**actual)
    policy={'version':1,'tools_root':PREFIX,'execution_enabled':True,'qualification_release_event':3435,
            'qualified':False,'operationalReady':False,'dependencies_ref':deps,
            'plans':{kind:contract.plan(kind,deps)for kind in sorted(contract.KINDS)},
            'helpers':helper_pins,'qa_inventory':qa_pins,'toolchain_inventory':inventory}
    sealed.validate_policy(policy,execution=True)
    sealed._python_runtime(raw(spec['qa_runtime_override']),files)
    return policy

def check_release():
    events=[];cursor=3434
    while True:
        p=subprocess.run(['python3','/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py','history','--after-seq',str(cursor),'--limit','200'],capture_output=True,text=True,check=True)
        page=json.loads(p.stdout[p.stdout.index('{'):])['result'];events.extend(page)
        if len(page)<200:break
        cursor=page[-1]['seq']
    release=[x for x in events if x['seq']==3435]
    if len(release)!=1 or release[0]['actor']!='admin-recuperacao':raise PermissionError('Root_preparation_release_required')
    expected=json.loads((HERE/'RELEASE-EXPECTED.json').read_bytes())
    if release[0]['data']!=expected:raise PermissionError('exact_Root_preparation_scope_required')
    if not any(x['kind']=='ack'and x['actor']=='apoio'and x.get('data',{}).get('event_seq')==3435 for x in events):raise PermissionError('real_apoio_preparation_ACK_required')
    # No automatic reinterpretation of a later disposal/revocation.
    for event in events:
        if event['seq']>3435 and event['kind']=='notice':
            data=event.get('data',{})
            if any(data.get(k)==3435 for k in ('supersedes','superseded_event','withdrawn_event','revoked_event','event_seq','target_event')):raise PermissionError('preparation_notice_disposition_requires_review')

def build(spec_sha):
    specpath=HERE/'BUILD-SPEC.json';spec=json.loads(raw({'path':str(specpath),'sha256':spec_sha,'bytes':specpath.stat().st_size}))
    if spec['prefix']!=PREFIX or spec['preparation_release_event']!=3435:raise PermissionError('fixed_prefix_and_release')
    check_release();contract,sealed,freeze=reviewed_modules(spec)
    output=HERE/'bundle-data-1';intent=HERE/'BUILD-INTENT.private.json'
    if output.exists()or intent.exists():raise FileExistsError('partial_or_existing_build_preserved_no_replay')
    newfile(intent,canonical({'spec_sha256':spec_sha,'state':'BUILD_INTENT_NO_REPLAY'}));directory_sync(HERE);output.mkdir(mode=0o700);directory_sync(HERE)
    generated=output/'generated';generated.mkdir(mode=0o700);directory_sync(output)
    references={};modes={}
    family=json.loads(raw(spec['verified_family_inventory']))
    for name,row in family['files'].items():
        references[name]={'path':row['source_path'],'sha256':row['sha256'],'bytes':row['bytes'],'source_identity':row['source_identity']};modes[name]=int(row['future_Root_mode'],8)
    node=spec['node'];references['node20']=copy_member({'path':node['archive_path'],'sha256':node['archive_sha256'],'bytes':node['archive_bytes']},node['member'],{k:node[k]for k in ('sha256','bytes')},generated/'node20');modes['node20']=0o755
    pdf=spec['pdfjs'];references['pdfjs/package.tgz']=copy_member({'path':pdf['container_path'],'sha256':pdf['container_sha256'],'bytes':207013889},pdf['container_member'],{'sha256':pdf['tar_sha256'],'bytes':pdf['tar_bytes']},generated/'pdfjs-package.tgz');modes['pdfjs/package.tgz']=0o644
    for name,ref in spec['source_wheels'].items():references[name]=ref;modes[name]=0o644
    toolpins={name:{k:ref[k]for k in ('sha256','bytes')}for name,ref in references.items()}
    helper_pins={name:pin(raw(ref))for name,ref in spec['helpers'].items()}
    qa_refs=dict(spec['qa']);qa_refs['qa/python-runtime.json']=spec['qa_runtime_override']
    qa_pins={name:pin(raw(ref))for name,ref in qa_refs.items()}
    proof=json.loads(raw(spec['inputs']['inputs/full-integrity-proof.json']))
    policy=policy_for(contract,sealed,spec,toolpins,helper_pins,qa_pins,proof)
    files=freeze.render(raw(spec['reviewed_render_source']['driver.py']),policy,helper_pins['sealed_policy.py']['sha256'])
    files['inputs/full-integrity-inventory.json']=canonical(proof['normalized_inventory'])
    if digest(files['inputs/full-integrity-inventory.json'])!=proof['inventory_sha256']:raise ValueError('full_integrity_inventory_digest')
    for name,data in files.items():
        target=generated/name.replace('/','--');newfile(target,data);references[name]=dict(pin(data),path=str(target));modes[name]=0o644
    for name,ref in {**spec['helpers'],**qa_refs,**spec['inputs']}.items():references[name]=ref;modes[name]=0o644
    plan={name:dict({k:ref[k]for k in ('sha256','bytes')},mode=modes[name])for name,ref in sorted(references.items())}
    if not 1<=len(plan)<=50000 or sum(r['bytes']for r in plan.values())>2*1024**3:raise ValueError('bounded_bundle_plan_required')
    if any(r['mode']not in {0o644,0o755}or not 0<=r['bytes']<=MAX_FILE for r in plan.values()):raise ValueError('bounded_regular_file_metadata')
    # Write only regular members. Directories, including empty-config, are
    # created deterministically by the separately reviewed Root materializer.
    target=output/'payload.tar.gz';fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:
        with gzip.GzipFile(fileobj=f,mode='wb',filename='',mtime=0,compresslevel=1)as gz,tarfile.open(fileobj=gz,mode='w|',format=tarfile.GNU_FORMAT)as tf:
            for name,ref in sorted(references.items()):
                if name!=str(PurePosixPath(name))or'..'in name.split('/')or name.startswith('/'):raise ValueError('fixed_relative_plan_required')
                with source(ref)as src:
                    member=tarfile.TarInfo(name);member.size=ref['bytes'];member.mode=modes[name];member.uid=member.gid=member.mtime=0
                    tf.addfile(member,src)
        f.flush();os.fsync(f.fileno())
    if target.stat().st_size>1536*1024**2:raise ValueError('compressed_bundle_budget_exceeded_preserve_output')
    h=hashlib.sha256()
    with target.open('rb')as f:
        while block:=f.read(1048576):h.update(block)
    result={'version':1,'state':'PUBLIC_BUNDLE_BUILT_NOT_ROOT_INSTALLED','files':plan,'unpacked_bytes':sum(r['bytes']for r in plan.values()),'payload_path':str(target),'payload_sha256':h.hexdigest(),'payload_bytes':target.stat().st_size,'qualified':False,'operationalReady':False,'root_install_performed':False,'candidate_programs_executed':False}
    directory_sync(generated);newfile(output/'RESULT.json',canonical(result));directory_sync(output)
    return {k:v for k,v in result.items()if k!='files'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--spec-sha256',required=True);args=parser.parse_args()
    print(json.dumps(build(args.spec_sha256),sort_keys=True))
