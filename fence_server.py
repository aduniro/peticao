"""Persistent process owns source-fencing bus through known uncertainties.

No daemon restart/rearm/adoption of an interrupted intent is provided. A
quarantined owner serves observations and refuses mutation/shutdown while any
reference is held/uncertain. Root/power/process loss still needs reconciliation.
"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import sys

LIB = Path('/opt/peticao-dev-bootstrap-v2')
CORE_SHA256 = '588c8aaed6a0c1e4a6cd7ffbb1f836ea0d5d62f14075457aa11fc37963c82cdc'


def load_core():
    if os.geteuid() != 0:
        raise PermissionError('root_fence_server_required')
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


class Controller:
    def __init__(self, fence, journal, reference_factory, request_validator, native=True):
        self.fence, self.journal = fence, journal
        self.reference_factory, self.request_validator = reference_factory, request_validator
        self.native = native
        self.refs = None
        self.quarantined = False
        self.shutdown_requested = False
        # A fresh process is never a replacement reference keeper for an old
        # interrupted intent. Existing terminal receipts are readonly too.
        self.recovered_readonly = journal.read('fence-intent.json') is not None
        fence.continue_operation = lambda: not self.quarantined and not self.shutdown_requested

    def unsafe_references(self):
        if self.refs is None:
            return False
        if self.refs.lost or self.refs.closed:
            return True
        return any(record.get('state') != 'released' for record in self.refs.records.values())

    def signal_stop(self, *_):
        if self.unsafe_references():
            self.quarantined = True
            return False
        self.shutdown_requested = True
        return True

    def handle(self, request):
        self.request_validator(request)
        action = request['action']
        if action == 'observe':
            result = self.fence.observe()
            return {**result, 'owner_pid': os.getpid(), 'owner_quarantined': self.quarantined,
                    'owner_recovered_readonly': self.recovered_readonly,
                    'references_unreleased_or_uncertain': self.unsafe_references()}
        if action == 'shutdown':
            if self.unsafe_references():
                raise PermissionError('cannot_shutdown_held_or_uncertain_fence_owner')
            self.shutdown_requested = True
            return {'state': 'shutdown_ready', 'owner_pid': os.getpid()}
        if action != 'fence' or self.quarantined or self.recovered_readonly or self.shutdown_requested:
            raise PermissionError('fence_owner_readonly_no_rearm_or_replay')
        if self.journal.read('fence-intent.json') is not None:
            raise PermissionError('existing_fence_intent_observe_only')
        try:
            self.refs = self.reference_factory()
            if self.native and self.refs.bus.backend_kind != 'libsystemd-sd-bus':
                raise PermissionError('native_persistent_reference_owner_required')
            self.fence.refs = self.refs
            return self.fence.run()
        except BaseException:
            # Never close the bus here, even if close() would raise. An error
            # reply ends only this request, not the reference-owning process.
            self.quarantined = True
            raise

    def close_if_safe(self):
        if self.unsafe_references():
            raise PermissionError('persistent_fence_owner_must_remain_alive')
        if self.refs is not None:
            self.refs.close()
        self.journal.close()


def serve(listener, controller, wire, peer_validator=None):
    peer_validator = wire.peer if peer_validator is None else peer_validator
    listener.settimeout(0.5)
    while not controller.shutdown_requested or controller.unsafe_references():
        try:
            connection, _ = listener.accept()
        except socket.timeout:
            continue
        with connection:
            try:
                connection.settimeout(15)
                peer_validator(connection)  # Authenticate before any frame.
                request = wire.receive(connection)
                result = controller.handle(request)
                reply = {'ok': True, 'result': result}
            except BaseException as error:
                reply = {'ok': False, 'error_type': type(error).__name__,
                         'owner_quarantined': controller.quarantined}
            try:
                wire.send(connection, reply)
            except (OSError, EOFError, ValueError):
                # Caller/SSH disappearance does not terminate the owner, repeat
                # a mutation, or drop held native references.
                continue


def run_owner(listener, controller, wire, peer_validator=None):
    """Do not unwind the owning process/context on known or outer faults."""
    while True:
        try:
            serve(listener, controller, wire, peer_validator)
            controller.close_if_safe()
            return
        except BaseException:
            if not controller.unsafe_references():
                raise
            controller.quarantined = True
            # A broken listener or unexpected outer I/O must not busy-spin or
            # become an implicit close/exit of the native reference owner.
            signal.pause()


@contextlib.contextmanager
def listener(wire):
    root = wire.ROOT
    for parent in [*reversed(root.parents), root]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError('prepared_root_fence_runtime_directory_required')
    if stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise PermissionError('private_fence_runtime_directory_required')
    lock = root / 'owner.lock'
    opened = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    sock = None
    try:
        info = os.fstat(opened)
        current = lock.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != 0
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)):
            raise PermissionError('original_root_fence_owner_lock_required')
        fcntl.flock(opened, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if os.path.lexists(wire.SOCKET):
            raise PermissionError('existing_fence_socket_no_takeover')
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(wire.SOCKET))
        os.chmod(wire.SOCKET, 0o600)
        sock.listen(4)
        identity = wire.endpoint()
        yield sock
        if wire.endpoint() != identity:
            raise PermissionError('fence_socket_identity_changed_before_cleanup')
        wire.SOCKET.unlink()  # Only own empty operational socket after safe exit.
    finally:
        if sock is not None:
            sock.close()
        os.close(opened)


def main():
    if len(sys.argv) != 1 or Path(__file__).absolute() != LIB / 'fence_server.py':
        raise PermissionError('fixed_installed_fence_server_required')
    core = load_core()
    raw_policy = core['read_root'](core['POLICY'], 0o600)
    policy = json.loads(raw_policy)
    request = {'action': 'observe', 'operation_id': policy['operation_id'],
               'policy_sha256': hashlib.sha256(raw_policy).hexdigest()}
    core['gate'](request)
    sys.path.insert(0, str(LIB))
    sys.dont_write_bytecode = True
    import fence_wire as wire
    from operator_journal import Journal
    from service_metadata import Metadata, SANTIAGO
    operation = {key: policy[key] for key in ('operation_id', 'source_boot_id', 'authority_sha256')}
    journal = Journal(core['STATE'] / operation['operation_id'], operation['operation_id'])
    authority = Metadata('/srv/admin-v2-coordinator/authority.json', SANTIAGO)
    fence = core['Fence'](authority, core['Manager'](), None, journal, operation)
    def validate(request):
        if request.get('operation_id') != operation['operation_id'] or request.get('policy_sha256') != hashlib.sha256(raw_policy).hexdigest():
            raise PermissionError('original_fence_operation_policy_required')
        core['gate'](request)
    owner = Controller(fence, journal, core['references'], validate)
    signal.signal(signal.SIGTERM, owner.signal_stop)
    signal.signal(signal.SIGINT, owner.signal_stop)
    # The listener context must never be unwound with live references. serve()
    # contains request faults and refuses controlled termination while unsafe.
    with listener(wire) as sock:
        run_owner(sock, owner, wire)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
