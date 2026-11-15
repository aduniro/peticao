"""One-request Root client; it owns no native unit reference connection."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

LIB = Path('/opt/peticao-dev-bootstrap-v2')
CORE_SHA256 = '588c8aaed6a0c1e4a6cd7ffbb1f836ea0d5d62f14075457aa11fc37963c82cdc'


def load_core():
    if os.geteuid() != 0:
        raise PermissionError('root_fence_client_required')
    path = LIB / 'legacy_fence.py'
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError('root_fence_tcb_ancestry_required')
    opened = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(opened, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o644:
            raise PermissionError('root_fence_tcb_required')
        raw = stream.read(524289)
    if len(raw) > 524288 or hashlib.sha256(raw).hexdigest() != CORE_SHA256:
        raise PermissionError('fence_core_pin_required_before_compile')
    namespace = {'__file__': str(path), '__name__': 'pinned_source_fence_core'}
    exec(compile(raw, str(path), 'exec'), namespace)
    return namespace


def main():
    if len(sys.argv) != 1 or Path(__file__).absolute() != LIB / 'fence_proxy.py':
        raise PermissionError('fixed_installed_fence_proxy_required')
    core = load_core()
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError('fence_request_budget')
    request = json.loads(raw, object_pairs_hook=core['unique'])
    core['gate'](request)
    sys.path.insert(0, str(LIB))
    sys.dont_write_bytecode = True
    import fence_wire as wire
    result = wire.once(wire.SOCKET, request)
    print(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
