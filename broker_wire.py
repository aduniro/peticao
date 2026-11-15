"""Local Linux UNIX-stream wire protocol, not a deployable worker broker.

The future qualified root entry owns listener activation, a single persistent
reference keeper/WorkerRPC and startup reconciliation. This module creates no
listener, service, queue, worker, credential or job on import/construction.
"""
import json
import os
import re
import socket
import struct

MAX_REQUEST = 65536
MAX_REPLY = ((512 * 1024 * 1024 + 2) // 3) * 4 + 65536
HEADER = struct.Struct('!Q')
ACTIONS = {'prepare', 'start', 'observe', 'logs', 'finalize', 'cancel', 'bundle'}


class Rejected(ValueError):
    pass


class OutcomeUncertain(RuntimeError):
    pass


def peer(conn, expected_uid):
    if conn.family != socket.AF_UNIX or conn.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM:
        raise Rejected('local_unix_stream_required')
    pid, uid, gid = struct.unpack('3i', conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    if type(expected_uid) is not int or expected_uid < 0 or pid <= 0 or uid != expected_uid:
        raise Rejected('kernel_authenticated_peer_uid_required')
    return {'pid': pid, 'uid': uid, 'gid': gid}


def read_exact(conn, count):
    out = bytearray()
    while len(out) < count:
        data = conn.recv(min(count - len(out), 1024 * 1024))
        if not data:
            raise OutcomeUncertain('broker_reply_or_request_incomplete_no_retry')
        out.extend(data)
    return bytes(out)


def receive(conn, limit):
    count = HEADER.unpack(read_exact(conn, HEADER.size))[0]
    if not 0 < count <= limit:
        raise Rejected('bounded_nonempty_broker_frame_required')
    return read_exact(conn, count)


def send(conn, raw, limit):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= limit:
        raise Rejected('bounded_broker_frame_required')
    conn.sendall(HEADER.pack(len(raw)))
    conn.sendall(raw)


def pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise Rejected('duplicate_broker_json_key')
        out[key] = value
    return out


def nonfinite(_):
    raise Rejected('finite_broker_json_required')


def decode(raw):
    try:
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    except (ValueError, UnicodeError):
        raise Rejected('canonical_broker_object_required') from None
    if type(value) is not dict:
        raise Rejected('broker_object_required')
    return value


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


class Broker:
    """One trusted handler instance across requests, sequential executor only.

uid injection is a local fixture seam; the real root entry must use default0
and validate listener ownership/config/code/epoch before calling this object.
There is no public handler selection, path or generic command in the protocol.
"""
    def __init__(self, handler_factory, *, uid=0, io_timeout=15):
        if os.geteuid() != uid or type(uid) is not int or uid < 0:
            raise Rejected('root_broker_process_required')
        self.uid, self.io_timeout = uid, io_timeout
        self.pid = os.getpid()
        self.handler = handler_factory()
        if not callable(self.handler):
            raise Rejected('fixed_internal_worker_handler_required')

    def serve_connection(self, conn):
        if os.getpid() != self.pid or os.geteuid() != self.uid:
            raise Rejected('original_broker_process_required')
        # Verify kernel peer credentials BEFORE reading bytes or invoking work.
        peer(conn, self.uid)
        conn.settimeout(self.io_timeout)
        try:
            request = decode(receive(conn, MAX_REQUEST))
            if request.get('action') not in ACTIONS:
                raise Rejected('fixed_worker_action_required')
            # WorkerRPC, not this wire layer, validates every action's exact
            # fields/profile/manifest/authority/claim/token/admission.
            result = self.handler(request)
            if type(result) is not dict:
                raise Rejected('internal_worker_result_object_required')
            response = {'ok': True, 'result': result}
        except Exception as error:
            kind = type(error).__name__
            if not re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,63}', kind):kind = 'RuntimeError'
            # Never propagate exception text, JSON excerpts, tokens or logs.
            response = {'ok': False, 'error_type': kind}
        try:
            send(conn, encode(response), MAX_REPLY)
        except (OSError, ValueError):
            # A handler might already have committed or started work. Never
            # invoke it again because the client disappeared or a reply failed.
            raise OutcomeUncertain('broker_outcome_uncertain_observe_same_job') from None


def proxy_once(conn, request, *, expected_uid=0, io_timeout=15):
    """One send/receive only. Caller owns SSH identity/Gate and socket closing."""
    peer(conn, expected_uid)
    conn.settimeout(io_timeout)
    if type(request) is not dict or request.get('action') not in ACTIONS:
        raise Rejected('fixed_internal_worker_request_required')
    raw = encode(request)
    if len(raw) > MAX_REQUEST:
        raise Rejected('bounded_broker_request_required')
    try:
        send(conn, raw, MAX_REQUEST)
        value = decode(receive(conn, MAX_REPLY))
        if (value.get('ok') is True and set(value) == {'ok', 'result'} and type(value['result']) is dict
                or value.get('ok') is False and set(value) == {'ok', 'error_type'} and type(value['error_type']) is str
                and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,63}', value['error_type'])):
            return value
        raise Rejected('exact_broker_reply_required')
    except (OSError, ValueError, OutcomeUncertain):
        raise OutcomeUncertain('broker_outcome_uncertain_observe_same_job') from None
