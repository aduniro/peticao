"""Prepare an observation-only handoff for an owner-created Civo instance.

This is deliberately not an ownership journal or runtime cleanup authority.
The lifecycle controller continues rejecting this candidate: a separate reviewed
delegation must bind the exact manual resource before any destructive operation.
"""
from datetime import timedelta
import hashlib
import json
import re

from financial_guard import instant, deadlines


def candidate(owner_evidence, expected_sha256, live_instance, account_proof,
              *, observed_at, policy):
    """Bind exact owner evidence bytes to a fresh GET snapshot, without API calls.

    The caller supplies owner evidence from the authorized conversation and
    independently establishes account identity. A JSON label is not proof of
    authentication; this function only checks the bindings and their scope.
    """
    if not isinstance(owner_evidence, bytes):
        raise ValueError('Owner evidence must be exact preserved bytes')
    digest=hashlib.sha256(owner_evidence).hexdigest()
    if digest!=expected_sha256:
        raise ValueError('Owner evidence differs from reviewed bytes')
    owner=json.loads(owner_evidence)
    if (owner.get('kind')!='owner_created_handoff'
            or not isinstance(owner.get('source_ref'),str) or not owner['source_ref'].strip()):
        raise ValueError('Owner handoff provenance missing')
    ident=owner.get('instance_id')
    if not isinstance(ident,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',ident):
        raise ValueError('Exact instance ID required; name is insufficient')
    account_id=policy['account_scope_id']
    if (owner.get('account_scope_id')!=account_id or owner.get('region')!='NYC1'
            or account_proof.get('account_scope_id')!=account_id
            or account_proof.get('identity_verified') is not True
            or account_proof.get('region')!='NYC1'):
        raise ValueError('Account or region identity is not verified')
    now=instant(observed_at)
    proof_at=instant(account_proof['observed_at'])
    if proof_at>now or now-proof_at>timedelta(minutes=5):
        raise ValueError('Account identity snapshot is stale')
    expected=owner.get('expected')
    if (not isinstance(expected,dict) or expected.get('hostname')!='peticao-civo'
            or expected.get('size')!='g4c.medium'
            or any(not isinstance(k,str) or v is None or isinstance(v,(dict,list))
                   for k,v in expected.items())):
        raise ValueError('Expected worker identity incomplete')
    if live_instance.get('id')!=ident or live_instance.get('_not_found'):
        raise ValueError('API did not return exact owner-nominated instance')
    if live_instance.get('account_id',account_id)!=account_id:
        raise ValueError('Instance belongs to another account')
    if any(live_instance.get(k)!=v for k,v in expected.items()):
        raise ValueError('Live worker identity differs from handoff')
    # Never substitute the observation time for the billable allocation time.
    allocated=owner.get('allocated_at')
    if allocated!=live_instance.get('created_at') or instant(allocated)>now:
        raise ValueError('Billable allocation time absent or changed')
    schedule=deadlines(policy['grant'],policy['quote'],allocated)
    return dict(kind='owner-created-observation-candidate',
                state='observed-not-delegated',observed_at=observed_at,
                account_scope_id=account_id,region='NYC1',instance_id=ident,
                expected=expected,owner_evidence_sha256=digest,
                owner_source_ref=owner['source_ref'],allocated_at=allocated,
                proposed_schedule=schedule,creation_response_bound=False,
                cleanup_authorized=False,development_jobs_enabled=False,
                ssh_access_verified=False,image_and_ssh_key_qualification_pending=True,
                allowed_operations=['observe'])
