"""Explicit development topology, never an authority/promotion mechanism.

The fixed node set is a reviewed migration scope, not tailnet discovery.
Reading this configuration does not authorize any queue write, launch or SSH.
The caller must still validate the current epoch, installed code and RPC gate.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import stat

CONFIG = Path('/etc/peticao-dev-authority/topology.json')
MAX_BYTES = 16384
NODES = {
    'civo': ('peticao-civo', '100.122.224.82', 22),
    'akamai': ('peticao-build-a1', '100.74.19.123', 2224),
    'santiago': ('sonda-verifica3', '100.80.18.81', 2224),
    'sao-paulo': (None, '100.109.6.122', 2224),
    'dell': ('dell3576-zorin', '100.105.193.63', 2224),
    'waha': (None, '100.115.154.25', 2224),
}
QUEUE = '/srv/admin-v2-coordinator'
WORKER = '/srv/admin-v2-worker'
CHECKPOINTS = '/mnt/apps/peticao-final/.runtime/coordinator-checkpoints'
CODE = '/opt/admin-v2-cluster'
SSH_IDENTITY = '/home/vigia-coord/.ssh/id_dev_recovery'
SSH_KNOWN_HOSTS = '/home/vigia-coord/.ssh/known_hosts_dev_recovery'
KEYS = {'version', 'coordinator', 'recovery', 'workers', 'queue_root',
        'worker_root', 'checkpoint_root', 'code_root', 'fence_scope',
        'recovery_identity', 'recovery_known_hosts', 'recovery_known_hosts_sha256'}
READ_ACTIONS = frozenset({'health', 'jobs', 'status', 'logs'})
RECOVERY_ACTIONS = frozenset({'node-info', 'fence-info', 'replica-info'})


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_topology_key')
        result[key] = value
    return result


def validate(value):
    if type(value) is not dict or set(value) != KEYS:
        raise ValueError('exact_topology_fields_required')
    fixed = {
        'coordinator': 'civo', 'recovery': 'santiago',
        'workers': ['civo', 'akamai'], 'queue_root': QUEUE,
        'worker_root': WORKER, 'checkpoint_root': CHECKPOINTS,
        'code_root': CODE, 'fence_scope': ['civo', 'akamai', 'santiago', 'sao-paulo'],
        'recovery_identity': SSH_IDENTITY, 'recovery_known_hosts': SSH_KNOWN_HOSTS,
    }
    if type(value['version']) is not int or value['version'] != 1:
        raise ValueError('topology_version_required')
    if any(value[key] != expected for key, expected in fixed.items()):
        raise ValueError('reviewed_civo_topology_required')
    sha = value['recovery_known_hosts_sha256']
    if type(sha) is not str or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha) or sha == '0' * 64:
        raise ValueError('actual_recovery_hostkey_file_digest_required')
    return value


def control_bytes(path):
    """Bounded immutable-fd read under root-owned non-writable ancestry."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise PermissionError('absolute_root_control_path_required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise PermissionError('root_control_ancestry_required')
        opened = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(opened)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                    or stat.S_IMODE(before.st_mode) != 0o644 or before.st_size > MAX_BYTES):
                raise PermissionError('root0644_singlelink_control_required')
            raw = bytearray()
            while len(raw) <= MAX_BYTES:
                block = os.read(opened, min(65536, MAX_BYTES + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
            after = os.fstat(opened)
            fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
            current = os.stat(path.name, dir_fd=fd, follow_symlinks=False)
            if (len(raw) > MAX_BYTES or len(raw) != before.st_size
                    or any(getattr(before, k) != getattr(after, k) or getattr(before, k) != getattr(current, k) for k in fields)):
                raise PermissionError('control_changed_during_read')
            return bytes(raw)
        finally:
            os.close(opened)
    finally:
        os.close(fd)


def load():
    return validate(json.loads(control_bytes(CONFIG), object_pairs_hook=no_duplicates))


def local_node(hostname=None):
    name = socket.gethostname() if hostname is None else hostname
    # No first-label heuristic; the configured OS hostname must match exactly.
    for node, (host, _, _) in NODES.items():
        if host is not None and name == host:
            return node
    raise PermissionError('unknown_development_host')


def connection_peer(connection, local):
    """Validate sshd-provided connection metadata; this is not SSH key auth.

    Forced-command/key/sshd installation remains a separate qualification gate.
    No caller-controlled request body may substitute these process variables.
    """
    fields = connection.split()
    if len(fields) != 4 or local not in {'civo', 'santiago'}:
        raise PermissionError('authenticated_ssh_context_required')
    source, source_port, destination, destination_port = fields
    try:
        address = str(ipaddress.ip_address(source))
        dest = str(ipaddress.ip_address(destination))
        ports = tuple(int(p) for p in (source_port, destination_port))
    except (ValueError, TypeError):
        raise PermissionError('invalid_ssh_context') from None
    if not all(1 <= p <= 65535 for p in ports) or (dest, ports[1]) != NODES[local][1:]:
        raise PermissionError('ssh_destination_mismatch')
    for node, (_, tail_ip, _) in NODES.items():
        if address == tail_ip:
            return node
    raise PermissionError('unreviewed_ssh_peer')


def authorize_peer(topology, local, peer, action):
    validate(topology)
    if type(action) is not str:
        raise PermissionError('fixed_gateway_action_required')
    if local == topology['coordinator']:
        # The recovery node and production/WhatsApp nodes never submit work.
        if peer == 'santiago' and action in RECOVERY_ACTIONS:
            return 'recovery-observer'
        if peer in {'dell', 'akamai'} and action in READ_ACTIONS | {'submit', 'cancel'}:
            return 'client'
    elif local == topology['recovery']:
        if peer == topology['coordinator'] and action in RECOVERY_ACTIONS | {'replica-ingest'}:
            return 'replication'
        if peer == 'dell' and action in RECOVERY_ACTIONS:
            return 'recovery-observer'
    raise PermissionError('gateway_peer_action_rejected')


def replication_argv(topology, local):
    validate(topology)
    if local != topology['coordinator']:
        raise PermissionError('only_civo_sends_checkpoints')
    _, address, port = NODES[topology['recovery']]
    # Host key bytes are verified from the protected service installation by
    # the replication caller; this function never loads a private identity.
    return ['/usr/bin/ssh', '-F', '/dev/null', '-T', '-p', str(port),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ControlMaster=no',
            '-o', 'ControlPath=none', '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
            '-o', 'UserKnownHostsFile=' + topology['recovery_known_hosts'],
            '-i', topology['recovery_identity'], 'vigia-coord@' + address]


def migration_inventory(topology):
    """Required observations, not a live fencing receipt or executable plan."""
    validate(topology)
    return {
        'version': 1, 'topology_sha256': digest(topology),
        'single_queue': QUEUE + '/queue.sqlite',
        'candidate_coordinator': 'civo', 'recovery': 'santiago',
        'required_fence_nodes': list(topology['fence_scope']),
        'required_worker_nodes': list(topology['workers']),
        'dispatch_enabled': False, 'qualification': False,
        'required_proofs': [
            'root-window-and-valid-global-code-and-deploy-leases',
            'all-source-writers-and-launchers-fenced-with-cgroup-observation',
            'fresh-quiesced-snapshot-and-exact-queue-reconciliation',
            'source-and-destination-service-uid-gid-and-mode-preserved',
            'monotonic-genuine-epoch-installed-on-all-fence-nodes',
            'target-authority-bound-to-new-boot-operation-and-epoch',
            'broker-normal-entry-and-real-profiles-qualified',
            'paired-legacy-guard-and-same-queue-consumer-qualified',
            'recovery-replication-key-and-forced-command-qualified',
            'real-build-qa-restart-recovery-failback-and-dell-off',
        ],
    }
