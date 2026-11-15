"""Bounded one-request UNIX framing; peer credentials precede request bytes."""
import json
import os
from pathlib import Path
import socket
import stat
import struct

ROOT = Path('/run/peticao-dev-source-fence')
SOCKET = ROOT / 'source.sock'
LIMIT = 65536


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_fence_wire_key')
        result[key] = value
    return result


def endpoint(path=SOCKET, owner=0):
    path = Path(path)
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            raise PermissionError('root_fence_socket_ancestry_required')
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o600:
        raise PermissionError('private_root_fence_socket_required')
    return info.st_dev, info.st_ino


def peer(connection, owner=0):
    pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if pid < 1 or uid != owner:
        raise PermissionError('root_fence_peer_required_before_read')
    return pid, uid, gid


def exact(connection, count):
    result = bytearray()
    while len(result) < count:
        block = connection.recv(count - len(result))
        if not block:
            raise EOFError('incomplete_fence_frame')
        result.extend(block)
    return bytes(result)


def receive(connection):
    size = struct.unpack('!I', exact(connection, 4))[0]
    if not 1 <= size <= LIMIT:
        raise ValueError('bounded_fence_frame_required')
    value = json.loads(exact(connection, size), object_pairs_hook=unique)
    if type(value) is not dict:
        raise ValueError('object_fence_frame_required')
    return value


def send(connection, value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if not 1 <= len(raw) <= LIMIT:
        raise ValueError('bounded_fence_reply_required')
    connection.sendall(struct.pack('!I', len(raw)) + raw)


def once(path, request, timeout=600):
    identity = endpoint(path)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(str(path))
        peer(connection)
        if endpoint(path) != identity:
            raise PermissionError('fence_socket_replaced_during_connect')
        send(connection, request)
        return receive(connection)
