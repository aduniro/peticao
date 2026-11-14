"""Akamai-local, short-lived capability issued by the normal deployment caller.

The caller must first check its OWN live canonical lease, then write this file
through authenticated root SSH. This is not runtime authority and the financial
timer never issues permits. No token or reusable authentication key is present.
"""
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import re
from runtime_main import private_file


def check(path, request, policy_sha, *, clock=None):
    now=(clock or (lambda:datetime.now(timezone.utc)))()
    permit=json.loads(private_file(path).read_text())
    if (permit.get('authority')!='normal-deploy-lease-checked'
            or type(permit.get('manifest_event')) is not int or permit['manifest_event']<1
            or type(permit.get('lease_fence')) is not int or permit['lease_fence']<1
            or permit.get('policy_sha256')!=policy_sha):
        raise ValueError('No bounded normal deployment capability')
    issued=datetime.fromisoformat(permit['issued_at'])
    expires=datetime.fromisoformat(permit['expires_at'])
    lease_expires=datetime.fromisoformat(permit['lease_expires_at'])
    if any(x.tzinfo is None for x in [issued,expires,lease_expires]):
        raise ValueError('Deployment capability timestamps need timezones')
    if (issued>now or now>=expires or expires>lease_expires
            or expires-issued>timedelta(seconds=60) or now-issued>timedelta(seconds=60)):
        raise ValueError('Deployment capability expired or exceeds checked lease')
    digest=hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()
    if digest!=permit.get('request_sha256'):
        raise ValueError('Deployment capability cannot change its request')
    return permit
