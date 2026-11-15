"""Fixed root SSH target: one request, one local connection, no replay."""
import json
import os
from pathlib import Path
import socket
import sys


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1 or Path(__file__).absolute() != Path('/opt/peticao-dev-worker-broker/broker_proxy.py'):
        raise PermissionError('fixed_root_broker_proxy_required')
    # No broker code import before trusted self/bootstrap validation. The entry
    # is root-protected TCB; verify its file/ancestors before compiling its bytes.
    import stat
    path = Path('/opt/peticao-dev-worker-broker/broker_entry.py')
    for parent in path.parents:
        i = parent.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid != 0 or i.st_mode & 0o022:
            raise PermissionError('root_proxy_tcb_ancestors_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        i = os.fstat(f.fileno())
        if not stat.S_ISREG(i.st_mode) or i.st_uid != 0 or i.st_nlink != 1 or stat.S_IMODE(i.st_mode) != 0o644:
            raise PermissionError('root_proxy_tcb_file_required')
        raw = f.read(131073)
    if len(raw) > 131072:
        raise ValueError('bounded_proxy_tcb_required')
    ns = {'__file__': str(path), '__name__': 'qualified_proxy_bootstrap'}
    exec(compile(raw, str(path), 'exec'), ns)
    ns['validate']('proxy')
    from broker_server import trusted_endpoint, SOCKET
    from broker_wire import decode, MAX_REQUEST, proxy_once
    raw_request = sys.stdin.buffer.read(MAX_REQUEST+1)
    if len(raw_request) > MAX_REQUEST:
        raise ValueError('bounded_broker_request_required')
    request = decode(raw_request)
    trusted_endpoint()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(15)
        client.connect(str(SOCKET))
        reply = proxy_once(client, request)
    print(json.dumps(reply, sort_keys=True, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
