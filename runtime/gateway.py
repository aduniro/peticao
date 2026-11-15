"""Current-topology successor. Entry stays blocked by the qualification gate.

No replication ingest/fencing implementation is inferred from the old gateway.
Those administrative operations require separately reviewed native providers.
The public coordinator command receives only the allowlisted client actions.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

import authority_guard
import topology

MAX_REQUEST = 1024 * 1024
MAX_REPLY = 4 * 1024 * 1024


def environment(policy):
    # Never inherit owner dotfiles, remote-dispatch enablement or credentials.
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
            'ADMIN_CLUSTER_ROOT': policy['queue_root'],
            'ADMIN_WORKER_ROOT': policy['worker_root'],
            'ADMIN_CLUSTER_DISPATCH': '0',
            'PYTHONDONTWRITEBYTECODE': '1'}


def handle(policy, local, peer, request):
    if type(request) is not dict or type(request.get('action')) is not str:
        raise ValueError('gateway_object_action_required')
    action = request['action']
    topology.authorize_peer(policy, local, peer, action)
    if action in topology.RECOVERY_ACTIONS | {'replica-ingest'}:
        # Do not return the old weak unit-count-only "fenced" assertion, nor
        # store an archive without current epoch/ownership/custody binding.
        raise PermissionError('native_recovery_provider_not_qualified')
    if local != policy['coordinator']:
        raise PermissionError('passive_node_does_not_accept_work')
    # The coordinator facade validates generation/boot/floor/catalog inside its
    # queue transaction. SSH client actions cannot reach dispatch/finalization.
    program = policy['code_root'] + '/coordinator.py'
    process = subprocess.run(['/usr/bin/python3', '-s', '-E', '-B', program, 'rpc'],
                             input=topology.canonical(request), text=True,
                             capture_output=True, timeout=120, env=environment(policy),
                             cwd=policy['code_root'])
    if process.returncode or len(process.stdout.encode()) > MAX_REPLY:
        # Never echo captured stderr or arbitrary runtime exception strings.
        raise RuntimeError('coordinator_rpc_failed_or_reply_unbounded')
    result = json.loads(process.stdout, object_pairs_hook=topology.no_duplicates)
    if type(result) is not dict:
        raise ValueError('coordinator_object_reply_required')
    return result


def main():
    authority_guard.require_gateway_qualified()
    policy, local = topology.load(), topology.local_node()
    peer = topology.connection_peer(os.environ.get('SSH_CONNECTION', ''), local)
    # Reject an inappropriate node before reading its request bytes.
    if (local == 'civo' and peer not in {'dell', 'akamai', 'santiago'}
            or local == 'santiago' and peer not in {'civo', 'dell'}):
        raise PermissionError('unreviewed_gateway_peer')
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise ValueError('gateway_request_too_large')
    request = json.loads(raw, object_pairs_hook=topology.no_duplicates)
    return handle(policy, local, peer, request)


if __name__ == '__main__':
    try:
        print(topology.canonical(main()))
    except Exception:
        print('{"error":"gateway_request_rejected"}')
        sys.exit(1)
