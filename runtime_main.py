"""Pinned, one-shot financial service for Akamai. Dry-run by default.

Installing this file does not activate a timer. Activation needs the normal
reviewed deployment and a root-private policy digest embedded in the unit.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

from durable_api import Api, Journal, atomic
from financial_runtime import Controller
from ssh_adapter import Adapter
from usage_observer import observe
from exclusive_inventory import collect


ROOT=Path('/var/lib/peticao-civo')
SOURCE=Path('/opt/peticao-civo')


def private_file(path):
    path=Path(path)
    info=path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o077):
        raise ValueError('Expected root-owned private regular file')
    return path


def read_policy(path, expected_sha):
    path=private_file(path)
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha:
        raise ValueError('Persistent authority policy changed')
    value=json.loads(raw)
    if (value.get('state')!='reviewed-active' or value.get('scope')!='owned-civo-lifecycle-only'
            or value.get('region')!='NYC1' or value.get('new_resource_creation_allowed') is not False
            or value.get('deployment_manifest_event',0)<1
            or value.get('required_reviewers')!=['admin-recuperacao','apoio']):
        raise ValueError('Missing bounded persistent runtime authority')
    sources=value.get('source_sha256',{})
    required={'runtime_main.py','durable_api.py','financial_guard.py','financial_runtime.py',
              'usage_observer.py','ssh_adapter.py','exclusive_inventory.py'}
    if not required.issubset(sources):raise ValueError('Incomplete source manifest')
    for name,sha in sources.items():
        if Path(name).name!=name:raise ValueError('Unsafe source manifest path')
        source=SOURCE/name;info=source.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022
                or hashlib.sha256(source.read_bytes()).hexdigest()!=sha):
            raise ValueError('Runtime source differs from reviewed bytes')
    return value


def run(args):
    os.umask(0o077)
    policy=read_policy(args.policy,args.policy_sha256)
    if not args.execute_cleanup:
        return {'state':'policy-validated-dry-run','api_mutations':0,'timer_activation':False}
    now=datetime.now(timezone.utc)
    last=ROOT/'last-tick.json'
    if last.exists():
        old=datetime.fromisoformat(json.loads(private_file(last).read_text())['at'])
        if now<old:raise ValueError('Clock rolled back; admissions and cleanup refused')
    api=Api('/etc/peticao-civo/api-token',ROOT/'api-logs',policy['credential_sha256'])
    # Prove credential still refers to the exact reviewed account. Empty or
    # divergent account metadata never becomes a guessed identity.
    firewalls=api.request('GET','/v2/firewalls',query={'region':'NYC1'})
    if (not isinstance(firewalls,list) or not firewalls
            or any(x.get('account_id')!=policy['account_scope_id'] for x in firewalls)):
        raise ValueError('Live API account identity not proven')
    receipt_path=ROOT/'allocation.json'
    if not receipt_path.exists():
        inventory=collect(api,policy['account_scope_id'],None,
                          datetime.fromisoformat(policy['grant']['expires_at']))
        atomic(ROOT/'inventory.json',inventory)
        value={'state':'armed_without_allocation','at':now.isoformat(),
               'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
               'policy_sha256':args.policy_sha256,'account_scope_id':policy['account_scope_id'],
               'new_resource_creation_allowed':False,'api_mutations':0}
        atomic(ROOT/'readiness.json',value);atomic(last,{'at':now.isoformat()})
        return value
    receipt=json.loads(private_file(receipt_path).read_text())
    def gate():
        # Runtime uses explicit bounded delegation, not the old deployment lease.
        read_policy(args.policy,args.policy_sha256)
    def observation(clock):
        inventory=collect(api,policy['account_scope_id'],receipt,
                          datetime.fromisoformat(receipt['schedule']['delete_by']))
        atomic(ROOT/'inventory.json',inventory)
        return observe(api,policy['grant'],policy['rates'],clock,inventory=inventory,
                       horizon_until=datetime.fromisoformat(receipt['schedule']['delete_by']))
    adapter=Adapter(ROOT,receipt,ssh_key='/root/.ssh/id_ed25519_peticao_tailnet_v2',
                    known_hosts=ROOT/'known_hosts')
    controller=Controller(ROOT,policy,receipt,api,Journal(ROOT/'journal',gate),adapter,observation,gate)
    value=controller.tick(now)
    atomic(last,{'at':datetime.now(timezone.utc).isoformat()})
    return value


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--policy',default='/etc/peticao-civo/policy.json')
    parser.add_argument('--policy-sha256',required=True)
    parser.add_argument('--execute-cleanup',action='store_true')
    args=parser.parse_args()
    try:
        value=run(args)
        print(json.dumps({'state':value['state'],'at':value.get('at')}))
        if value.get('residual_billing_possible'):
            print('Cleanup blocked; owned resources preserved and residual billing possible',file=sys.stderr)
            raise SystemExit(2)
    except Exception as error:
        # Error details may contain credentials: retain only a class publicly.
        print('Civo financial service failed closed: '+type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
