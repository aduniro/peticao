"""Root entry TCB: validate both immutable closures before importing runtime."""
import hashlib
import contextlib
import fcntl
import json
import os
from pathlib import Path
import socket
import stat
import sys

LIB = Path('/opt/peticao-dev-worker-broker')
RUNTIME = Path('/opt/peticao-dev-worker')
ROOT = Path('/etc/peticao-dev-worker')
BOOTSTRAP_SHA256 = '995a9fb23b2fd35fa804599d5995d3ab804ab0a6a771a637a0f9290274e139a0'
FILES = ('broker_entry.py', 'broker_lifecycle.py', 'broker_server.py', 'broker_wire.py', 'broker_proxy.py')


def read_root(path, mode=None, limit=1024*1024):
    path = Path(path).absolute()
    for parent in path.parents:
        i = parent.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid != 0 or i.st_mode & 0o022:
            raise PermissionError('root_code_or_policy_ancestors_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        i = os.fstat(f.fileno())
        if (not stat.S_ISREG(i.st_mode) or i.st_uid != 0 or i.st_nlink != 1
                or stat.S_IMODE(i.st_mode) not in ({mode} if mode else {0o400, 0o444, 0o600, 0o644})):
            raise PermissionError('root_regular_code_or_policy_required')
        raw = f.read(limit+1)
    if len(raw) > limit:
        raise ValueError('bounded_root_broker_input_required')
    return raw


def manager_namespace():
    def identity(p):
        i = os.stat(p)
        return i.st_dev, i.st_ino
    if identity('/proc/self/ns/mnt') != identity('/proc/1/ns/mnt'):
        raise PermissionError('broker_pid1_mount_namespace_required')
    for name in ('/', '/tmp', '/var/tmp'):
        if identity(name) != identity('/proc/1/root' + name):
            raise PermissionError('broker_pid1_filesystem_view_required')


@contextlib.contextmanager
def singleton():
    # Operator-prepared OS metadata, never created/chmodded by a runtime call.
    path = Path('/srv/peticao-dev-worker/broker.lock')
    read_root(path, mode=0o600, limit=0)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        i = os.fstat(fd)
        if not stat.S_ISREG(i.st_mode) or i.st_uid != 0 or i.st_nlink != 1 or stat.S_IMODE(i.st_mode) != 0o600 or i.st_size != 0:
            raise PermissionError('original_root_broker_lock_required')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise PermissionError('existing_broker_reference_owner_no_takeover') from None
        yield
    finally:
        os.close(fd)


def validate(kind):
    if os.geteuid() != 0 or kind not in {'broker', 'proxy'}:
        raise PermissionError('root_fixed_broker_entry_required')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    policy = json.loads(read_root(ROOT/'broker.json'))
    evidence_raw = read_root(ROOT/'broker-qualification.json')
    evidence = json.loads(evidence_raw)
    if (set(policy) != {'status', 'boot_id', 'host', 'evidence_sha256', 'code_sha256'}
            or policy['status'] != 'QUALIFIED_BROKER' or policy['boot_id'] != boot
            or policy['host'] != socket.gethostname().split('.')[0]
            or evidence.get('status') != 'PASS' or evidence.get('boot_id') != boot
            or evidence.get('host') != policy['host']
            or hashlib.sha256(evidence_raw).hexdigest() != policy['evidence_sha256']
            or evidence.get('broker_code_sha256') != policy['code_sha256']
            or set(policy['code_sha256']) != set(FILES)):
        raise PermissionError('current_boot_qualified_broker_closure_required')
    for name in FILES:
        if hashlib.sha256(read_root(LIB/name, mode=0o644)).hexdigest() != policy['code_sha256'][name]:
            raise PermissionError('broker_code_digest_mismatch_before_import')
    raw = read_root(RUNTIME/'entry_bootstrap.py', mode=0o644)
    if hashlib.sha256(raw).hexdigest() != BOOTSTRAP_SHA256:
        raise PermissionError('runtime_bootstrap_pin_required')
    namespace = {'__file__': str(RUNTIME/'entry_bootstrap.py'), '__name__': 'qualified_broker_bootstrap'}
    exec(compile(raw, namespace['__file__'], 'exec'), namespace)
    _, runtime_evidence = namespace['validate_packet'](
        'worker', RUNTIME,
        reader=lambda path, public=False: read_root(path, mode=0o644 if public else None))
    if evidence.get('runtime_code_sha256') != runtime_evidence['runtime_code_sha256']:
        raise PermissionError('broker_runtime_qualification_binding_required')
    if kind == 'broker':
        manager_namespace()
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(LIB), str(RUNTIME)]
    return policy, evidence


def main():
    if len(sys.argv) != 1 or Path(__file__).absolute() != LIB/'broker_entry.py':
        raise PermissionError('fixed_broker_entry_without_arguments_required')
    validate('broker')
    from broker_server import inherited_listener, Server
    from broker_lifecycle import Lifecycle
    from unit_refs import UnitReferences
    from rpc import make_service
    with singleton(), inherited_listener() as listener:
        references = UnitReferences()  # One real process-long sd-bus connection.
        service = make_service(references=references)
        lifecycle = Lifecycle(service, references, '/mnt/apps/peticao-final/.runtime/peticao-dev-worker/retirements')
        Server(lifecycle).run(listener)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # Private journals hold details. Never emit token/exception text.
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
