"""Pinned root worker entry; no runtime module executes before closure checks."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import sys

LIB=Path('/opt/peticao-dev-worker')
BOOTSTRAP_SHA256='48b314c980732ae54378e2e2488e7169263aa840931025236525fff93487d492'


def _load_bootstrap():
    if os.geteuid()!=0:raise PermissionError('root_entry_required')
    for parent in [LIB,*LIB.parents]:
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or not info.st_mode&0o001:raise PermissionError('root_public_module_directory_required')
    path=LIB/'entry_bootstrap.py'
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        info=os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode) not in {0o444,0o644}:raise PermissionError('root_bootstrap_file_required')
        raw=f.read(131073)
    if len(raw)>131072 or hashlib.sha256(raw).hexdigest()!=BOOTSTRAP_SHA256:raise PermissionError('bootstrap_pin_mismatch_before_import')
    # Compile exactly the bytes just validated, not another file open.
    namespace={'__name__':'qualified_entry_bootstrap','__file__':str(path)}
    exec(compile(raw,str(path),'exec'),namespace)
    return namespace


def make_service():
    bootstrap=_load_bootstrap()
    config,evidence=bootstrap['validate_packet']('worker',LIB)
    # Every own runtime module is now root-controlled and hash-checked.
    sys.path.insert(0,str(LIB));sys.dont_write_bytecode=True
    import remote_contract as contract
    from worker import WorkerRPC
    from systemd_adapter import SystemdAdapter
    from admission import Admission
    profiles=config['profiles'];node=config['worker_id']
    for name,descriptor in profiles.items():
        if descriptor.get('name')!=name or descriptor.get('program')!='/opt/peticao-dev-worker/fixture_job.py':raise PermissionError('fixed_profile_program_required')
    journal=contract.WorkerJournal('/srv/peticao-dev-worker/receipts.sqlite',node,config['generation'],
        lambda:Path('/proc/sys/kernel/random/boot_id').read_text().strip(),{k:contract.digest(v) for k,v in profiles.items()},
        contract.EpochGuard('/etc/peticao-dev-authority/epoch.json'))
    return WorkerRPC(journal,SystemdAdapter(),profiles,'/srv/peticao-dev-worker/exports',Admission('/srv/peticao-dev-worker'))


def main():
    if len(sys.argv)!=1:raise ValueError('stdin_rpc_only_no_command_arguments')
    service=make_service()
    raw=sys.stdin.buffer.read(65537)
    if len(raw)>65536:raise ValueError('bounded_rpc_request_required')
    result=service.rpc(json.loads(raw))
    print(json.dumps({'ok':True,'result':result},sort_keys=True,separators=(',',':'),allow_nan=False))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
