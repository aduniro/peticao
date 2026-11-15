#!/usr/bin/python3 -EsB
"""Fixed root transport shim; not installed/sudo-authorized by source prep."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import sys

LIB=Path('/opt/peticao-dev-worker')
BOOTSTRAP_SHA256='e9c1f89ab77cce41df6435779bddf5cab0bceeebc22de700ab6410c72cc9b1cd'


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


def main():
    if os.geteuid()!=0 or len(sys.argv)!=2 or sys.argv[1] not in {'civo','akamai','azure'}:raise PermissionError('fixed_root_worker_client_required')
    bootstrap=_load_bootstrap()
    config,evidence=bootstrap['validate_packet']('transport',LIB)
    sys.path.insert(0,str(LIB));sys.dont_write_bytecode=True
    import remote_contract as contract
    from transport import BrokerTransport,MAX_REQUEST
    request=sys.stdin.buffer.read(MAX_REQUEST+1)
    if len(request)>MAX_REQUEST:raise ValueError('bounded_request_required')
    value=json.loads(request)
    if not isinstance(value,dict) or value.get('action') not in {'prepare','start','observe','logs','finalize','cancel','bundle','retire','retirement'}:raise ValueError('fixed_worker_action_required')
    node=sys.argv[1]
    result=BrokerTransport(config['nodes'],timeout=120).call(node,value)
    print(contract.canonical({'ok':True,'result':result}))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
