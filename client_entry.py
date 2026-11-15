#!/usr/bin/python3 -EsB
"""Candidate fixed sudo helper; NOT installed and no sudoers supplied yet."""
import json
import os
from pathlib import Path
import socket
import sys



def main():
    if os.geteuid()!=0 or len(sys.argv)!=2 or sys.argv[1] not in {'civo','akamai','azure'}:raise PermissionError('fixed_root_worker_client_required')
    if socket.gethostname().split('.')[0]!='peticao-civo':raise PermissionError('controller_host_required')
    LIB=Path('/opt/peticao-dev-worker')
    for path in [LIB,*LIB.parents]:
        if path.is_symlink() or not path.is_dir() or path.stat().st_uid!=0 or path.stat().st_mode&0o022:raise PermissionError('root_module_directory_required')
    sys.path.insert(0,str(LIB));sys.dont_write_bytecode=True
    import remote_contract as contract
    from rpc import make_service
    from transport import SSHTransport,MAX_REQUEST
    request=sys.stdin.buffer.read(MAX_REQUEST+1)
    if len(request)>MAX_REQUEST:raise ValueError('bounded_request_required')
    value=json.loads(request)
    if not isinstance(value,dict) or value.get('action') not in {'prepare','start','observe','logs','finalize','cancel','bundle'}:
        raise ValueError('fixed_worker_action_required')
    config=json.loads(contract.root_control_file('/etc/peticao-dev-worker/transport.json').read_text())
    if config.get('status')!='QUALIFIED_TRANSPORT':raise PermissionError('transport_not_qualified')
    node=sys.argv[1]
    if node=='civo':result=make_service().rpc(value)
    else:result=SSHTransport(config['nodes'],timeout=120).call(node,value)
    print(contract.canonical({'ok':True,'result':result}))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
