"""Candidate authority hooks. No writes, subprocesses, network or installation.

Uses the exact EpochGuard frozen in remote-worker contract notice3046. A root
operator still has to qualify installation/distribution, admission closure and
fencing. A local floor does not make a distributed promotion atomic.
"""
from __future__ import annotations

import os
from pathlib import Path
import socket

from remote_contract import EpochGuard, generation, hex_value


GUARD = EpochGuard("/etc/peticao-dev-authority/epoch.json")
NODES = {"peticao-civo": "civo", "sonda-verifica3": "santiago"}


def local_node():
    try:
        return NODES[socket.gethostname().split(".")[0]]
    except KeyError:
        raise PermissionError("unqualified_coordinator_host") from None


def boot_id():
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def require_primary(authority):
    node, boot = local_node(), boot_id()
    value = generation(authority.get("generation"))
    operation = hex_value(authority.get("authority_operation_id"), 32)
    if (authority.get("role") != "primary" or authority.get("armed_boot_id") != boot
            or authority.get("coordinator_host") != node):
        raise PermissionError("coordinator_not_armed_on_authorized_node")
    sha = GUARD.require(value, node, boot, operation, authority.get("epoch_sha256"))
    # Absence is not accepted as a wildcard for an authority restored from the
    # old code. Bootstrap must explicitly prime and qualify the new fields.
    if authority.get("epoch_sha256") != sha:
        raise PermissionError("authority_epoch_digest_required")
    return sha


def effective(authority):
    if authority.get("role") != "primary":
        return authority.get("role", "suspended")
    try:
        require_primary(authority)
        return "primary"
    except (OSError, ValueError, TypeError, AttributeError, PermissionError):
        return "suspended"


def authorize_promotion(authority, proof, confirmation):
    """Check the PREPARED next epoch after the live verifier, before writes.

    This is an administrative genN→N+1 operation, not require_primary: the
    restored target is still standby at genN while the root floor is genN+1.
    The legacy verifier must already have proved nonce/freshness/source fencing.
    This hook only adds the common target/boot/op/floor binding.
    """
    old = generation(authority.get("generation"))
    if authority.get("role") not in {"standby", "suspended"} or type(proof.get("new_generation")) is not int or proof["new_generation"] != old + 1:
        raise PermissionError("promotion_requires_passive_previous_generation")
    node, boot = local_node(), boot_id()
    if node != "civo":
        raise PermissionError("only_civo_promotion_in_current_plan")
    operation = hex_value(proof.get("authority_operation_id"), 32)
    sha = GUARD.require(old + 1, node, boot, operation, proof.get("epoch_sha256"))
    identity = {"coordinator_host": node, "coordinator_boot_id": boot,
                "authority_operation_id": operation, "epoch_sha256": sha}
    if any(proof.get(k) != v or confirmation.get(k) != v for k, v in identity.items()):
        raise PermissionError("live_proof_target_boot_operation_epoch_mismatch")
    if confirmation.get("new_generation") != old + 1 or confirmation.get("confirmed") is not True:
        raise PermissionError("live_confirmation_generation_required")
    return {"coordinator_host": node, "authority_operation_id": operation, "epoch_sha256": sha}


def rearmed_copy(authority, operation_id, require_root=True):
    """In-memory only. No CLI/RPC, floor update or authority write is provided."""
    if require_root and os.geteuid() != 0:
        raise PermissionError("rearm_requires_operator_root")
    if authority.get("role") not in {"primary", "suspended"}:
        raise PermissionError("standby_requires_promotion_not_rearm")
    value = generation(authority.get("generation"))
    operation = hex_value(operation_id, 32)
    node, boot = local_node(), boot_id()
    sha = GUARD.require(value, node, boot, operation)
    if operation == authority.get("authority_operation_id"):
        raise PermissionError("rearm_requires_new_canonical_operation")
    result = {**authority, "role": "primary", "armed_boot_id": boot,
              "coordinator_host": node, "authority_operation_id": operation, "epoch_sha256": sha}
    require_primary(result)
    return result


def require_gateway_qualified():
    # Never expose the legacy Santiago/SP hardcoded topology on Civo.
    raise PermissionError("gateway_topology_and_authenticated_rpc_not_qualified")


def require_replication_qualified():
    # Replication still targets production SP in the original; no such change
    # is authorized by this source-only candidate.
    raise PermissionError("replication_destination_not_qualified")
