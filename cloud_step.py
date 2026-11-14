"""Private SSH entrypoint for a single NORMAL-deployment Civo step.

No daemon calls this entrypoint. All API credentials, intent/response journals,
clock and receipts remain on Akamai. Only IDs and safe status leave over SSH.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import sys

import deploy_permit
from durable_api import Api,atomic
from provision_steps import request_for,perform_step
from cloud_receipt import allocation_clock,reconcile
from runtime_main import read_policy,ROOT,SOURCE


def context(args):
    if os.geteuid()!=0:raise ValueError('Root SSH operator required')
    policy=read_policy('/etc/peticao-civo/policy.json',args.policy_sha256)
    required={'cloud_step.py','cloud_receipt.py','deploy_permit.py','provision_steps.py'}
    if not required.issubset(policy['source_sha256']) or policy.get('manual_normal_deploy_steps_allowed') is not True:
        raise ValueError('Manual deployment source closure or authority missing')
    public_key=None
    if args.step=='ssh-key':
        path=Path('/root/.ssh/id_ed25519_peticao_tailnet_v2.pub')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=policy.get('ssh_public_key_sha256'):
            raise ValueError('Public SSH key differs from reviewed account access')
        public_key=raw.decode().strip()
    path,payload=request_for(args.step,ROOT/'journal',public_key)
    return policy,public_key,{'method':'POST','path':path,'payload':payload}


def main(args):
    os.umask(0o077)
    policy,public_key,request=context(args)
    if args.preview:return {'request':request,'source_commit':policy['creation_source_commit']}
    envelope=json.loads(sys.stdin.buffer.read(65536))
    permit=envelope['permit']
    if permit.get('source_commit')!=policy['creation_source_commit']:
        raise ValueError('Normal permit belongs to another reviewed source commit')
    folder=ROOT/'permits';folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    name=hashlib.sha256(json.dumps(permit,sort_keys=True).encode()).hexdigest()
    path=folder/(name+'.json')
    if path.exists():
        if path.is_symlink() or json.loads(path.read_text())!=permit:raise ValueError('Permit storage mismatch')
    else:atomic(path,permit)
    def gate(actual):
        read_policy('/etc/peticao-civo/policy.json',args.policy_sha256)
        deploy_permit.check(path,actual,args.policy_sha256)
    gate(request)
    api=Api('/etc/peticao-civo/api-token',ROOT/'api-logs',policy['credential_sha256'])
    if args.step=='instance':allocation_clock(ROOT)
    result=perform_step(args.step,ROOT,api,gate,public_key,policy_sha=args.policy_sha256)
    if args.step in {'instance','volume'}:result['allocation']=reconcile(ROOT,policy)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--step',required=True)
    parser.add_argument('--policy-sha256',required=True)
    parser.add_argument('--preview',action='store_true')
    args=parser.parse_args()
    try:print(json.dumps(main(args)))
    except Exception as error:
        print('Cloud deployment step failed closed: '+type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
