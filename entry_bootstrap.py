"""Root entry TCB: stdlib only; validates the closure BEFORE runtime imports.

Entry shims verify this file against their compiled-in hash before executing it.
Root-protected shims/OS/stdlib are trusted; this is not defense against root.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import stat

CODE_FILES=('entry_bootstrap.py','remote_contract.py','worker.py','artifacts.py','admission.py','systemd_adapter.py','cgroups.py',
            'log_redaction.py','rpc.py','fixture_job.py','transport.py','client_entry.py','controller.py','node_catalog.py')
NODES={'peticao-civo':'civo','peticao-build-a1':'akamai','peticao-azure-dev-01':'azure'}
ROOT=Path('/etc/peticao-dev-worker')


def read_root(path,public=False,limit=1024*1024):
    p=Path(path).absolute()
    for parent in p.parents:
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or (public and not info.st_mode&0o001):
            raise PermissionError('root_controlled_ancestors_required')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        info=os.fstat(f.fileno());mode=stat.S_IMODE(info.st_mode)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or mode not in ({0o444,0o644} if public else {0o400,0o444,0o600,0o644}):
            raise PermissionError('trusted_root_file_required')
        raw=f.read(limit+1)
    if len(raw)>limit:raise ValueError('bounded_root_metadata_required')
    return raw


def validate_packet(kind,lib,reader=read_root):
    if os.geteuid()!=0:raise PermissionError('root_entry_required')
    host=socket.gethostname().split('.')[0];boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    node=NODES.get(host)
    if kind=='worker':
        config=json.loads(reader(ROOT/'runtime.json'));raw=reader(ROOT/'qualification.json');evidence=json.loads(raw)
        if not node or config.get('status')!='QUALIFIED_RUNTIME' or config.get('worker_id')!=node or evidence.get('worker_id')!=node:
            raise PermissionError('qualified_worker_node_required')
        if type(config.get('qualification_manifest_event')) is not int or config['qualification_manifest_event']<1:
            raise PermissionError('qualification_manifest_required')
        profiles=config.get('profiles')
        if not isinstance(profiles,dict) or not profiles or set(profiles)-{'fixture-pass','fixture-fail'}:raise PermissionError('fixed_fixture_profiles_required')
        profile_sha=hashlib.sha256(json.dumps(profiles,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
        if evidence.get('profile_catalog_sha256')!=profile_sha:raise PermissionError('profile_runtime_qualification_required')
    elif kind=='transport':
        config=json.loads(reader(ROOT/'transport.json'));raw=reader(ROOT/'transport-qualification.json');evidence=json.loads(raw)
        if host!='peticao-civo' or config.get('status')!='QUALIFIED_TRANSPORT' or evidence.get('controller_host')!='peticao-civo':
            raise PermissionError('qualified_controller_transport_required')
    else:raise ValueError('fixed_entry_kind_required')
    if hashlib.sha256(raw).hexdigest()!=config.get('qualification_evidence_sha256') or evidence.get('status')!='PASS' or evidence.get('boot_id')!=boot:
        raise PermissionError('pinned_current_boot_qualification_required')
    pins=evidence.get('runtime_code_sha256')
    if not isinstance(pins,dict) or set(pins)!=set(CODE_FILES):raise PermissionError('complete_code_closure_required')
    for name in CODE_FILES:
        raw_code=reader(Path(lib)/name,public=True)
        if hashlib.sha256(raw_code).hexdigest()!=pins[name]:raise PermissionError('runtime_code_pin_mismatch_before_import')
    return config,evidence
