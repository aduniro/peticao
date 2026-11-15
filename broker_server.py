"""Socket-activated local broker; owns no queue and never creates a listener."""
import os
from pathlib import Path
import signal
import socket
import stat

from broker_wire import Broker, OutcomeUncertain, Rejected


SOCKET = Path('/run/peticao-dev-worker-broker/worker.sock')


def trusted_endpoint(path=SOCKET, uid=0):
    path = Path(path).absolute()
    for parent in path.parents:
        i = parent.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid not in {0, uid} or i.st_mode & 0o022:
            raise PermissionError('trusted_socket_ancestors_required')
    i, p = path.lstat(), path.parent.lstat()
    if (not stat.S_ISSOCK(i.st_mode) or i.st_uid != uid or stat.S_IMODE(i.st_mode) != 0o600
            or p.st_uid != uid or stat.S_IMODE(p.st_mode) != 0o700):
        raise PermissionError('root_private_local_socket_required')
    return path


def inherited_listener(environ=None):
    env = os.environ if environ is None else environ
    if os.geteuid() != 0 or env.get('LISTEN_PID') != str(os.getpid()) or env.get('LISTEN_FDS') != '1':
        raise PermissionError('one_root_socket_activation_fd_required')
    trusted_endpoint()
    conn = socket.fromfd(3, socket.AF_UNIX, socket.SOCK_STREAM)
    conn.set_inheritable(False)
    if (conn.family != socket.AF_UNIX or conn.getsockname() != str(SOCKET)
            or conn.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
            or conn.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1):
        conn.close()
        raise PermissionError('exact_inherited_local_listener_required')
    os.set_inheritable(3, False)
    return conn


class Server:
    def __init__(self, lifecycle):
        self.lifecycle = lifecycle
        self.draining = False
        self.broker = Broker(lambda: self.handle)

    def handle(self, request):
        if self.draining and request.get('action') in {'prepare', 'start'}:
            raise RuntimeError('worker_broker_draining_no_new_work')
        return self.lifecycle(request)

    def stop(self, *_):
        self.draining = True

    def drained(self):
        refs = self.lifecycle.references
        return not refs.lost and all(r['state'] == 'released' for r in refs.records.values())

    def run(self, listener):
        self.lifecycle.startup()  # No accept until durable state is reconciled.
        listener.settimeout(1)
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        while not (self.draining and self.drained()):
            try:
                self.lifecycle.check()
            except Exception:
                # Quarantine: retain this process/connection rather than drop
                # possibly-held references on a transient cleanup/storage error.
                # Only bounded read-only observations remain available. Never
                # create another keeper or let a healthy job erase uncertainty.
                self.lifecycle.uncertain = True
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            with client:
                try:
                    self.broker.serve_connection(client)
                except (OutcomeUncertain, Rejected, OSError):
                    # No reconnect, handler replay or automatic unit cleanup.
                    # Root caller must observe the same durable job identity.
                    pass
        self.lifecycle.references.close()

