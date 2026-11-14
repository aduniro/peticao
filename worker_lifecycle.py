"""Root-owned lifecycle helper for a newly provisioned SETUP-ONLY Civo worker.

It cannot qualify a worker that already accepts development jobs. That future
integration must provide real queue/runner counts and its own reviewed adapter.
No API tokens or Tailscale state are archived. Production paths are never used.
"""
import fcntl
import json
import os
from pathlib import Path
import sys
import subprocess
import tarfile
from datetime import datetime, timezone

from durable_api import atomic

ROOT = Path('/srv/peticao-worker')


def checked(request):
    config=json.loads((ROOT/'control/identity.json').read_text())
    if request.get('instance_id') != config['instance_id']:
        raise ValueError('Worker identity mismatch')
    state=json.loads((ROOT/'control/state.json').read_text())
    if state.get('mode') != 'setup-only' or state.get('development_jobs_enabled') is not False:
        raise ValueError('This adapter cannot attest development job quiescence')
    if state.get('setup_complete') is not True:
        raise ValueError('Setup still executing or interrupted')
    if config.get('volume_id'):
        mounted=subprocess.run(['/usr/bin/findmnt','-n','-o','UUID','--mountpoint',str(ROOT/'data')],
                               capture_output=True,text=True,timeout=10)
        if (mounted.returncode or not config.get('volume_fs_uuid')
                or mounted.stdout.strip()!=config['volume_fs_uuid']):
            raise ValueError('Owned data volume mount not verified')
    return config,state


def handle(request):
    with open(ROOT/'control/lifecycle.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        config,state=checked(request)
        action=request['action']
        if action in {'drain','freeze'}:
            state['admission_closed']=True
            if action=='freeze':state['frozen']=True
            atomic(ROOT/'control/state.json',state)
        if action=='snapshot':
            return dict(instance_id=config['instance_id'],at=datetime.now(timezone.utc).isoformat(),
                        authority_verified=True,admission_closed=state.get('admission_closed') is True,
                        running=0,finalizing=0,exports_pending=0,mode='setup-only',
                        resource_ids=config['resource_ids'])
        if action in {'export','assert-frozen'}:
            if state.get('admission_closed') is not True or state.get('frozen') is not True:
                raise ValueError('Worker not frozen')
            if action=='export':
                # All disposable worker data lives beneath this dedicated root.
                # Include the mounted data volume rather than only its mountpoint.
                with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz',dereference=False) as archive:
                    archive.add(ROOT,arcname='peticao-worker',recursive=True)
                return None
        if action not in {'drain','freeze','assert-frozen','export','snapshot'}:
            raise ValueError('Unsupported lifecycle action')
        return dict(ok=True,instance_id=config['instance_id'])


if __name__=='__main__':
    os.umask(0o077)
    try:
        request=json.loads(sys.stdin.buffer.read(16384))
        result=handle(request)
        if result is not None:print(json.dumps(result))
    except Exception:
        # No traceback or filesystem contents can enter SSH/desktop notifications.
        print('Worker lifecycle verification failed',file=sys.stderr)
        raise SystemExit(1)
