"""Local caller; secrets stay in local capability files and cloud private config.

This is inert without explicit --apply, a reviewed live policy and OWN normal
deployment lease bound to the exact request set. Never run from an agent notice.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import operator_gate

HOST='peticao-akamai-root-tailnet'


def remote(step,sha,*,preview=False,permit=None):
    # Values embedded into the fixed remote command have restricted alphabets.
    import re
    if not re.fullmatch('[a-z-]{1,80}',step) or not re.fullmatch('[a-f0-9]{64}',sha):
        raise ValueError('Invalid bounded deployment arguments')
    command='/usr/bin/python3 -B /opt/peticao-civo/cloud_step.py --step '+step+' --policy-sha256 '+sha
    if preview:command+=' --preview'
    data=b'' if permit is None else json.dumps({'permit':permit}).encode()
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',HOST,command],
                          input=data,capture_output=True,timeout=90)
    if result.returncode:raise RuntimeError('Cloud SSH step failed; reconcile cloud journal before retry')
    return json.loads(result.stdout)


def main(args):
    preview=remote(args.step,args.policy_sha256,preview=True)
    if not args.apply:return {'step':args.step,'preview_only':True,'api_mutations':0}
    permit=operator_gate.issue(args.lease_file,args.manifest_event,Path(__file__).resolve().parent,
                               preview['request'],args.policy_sha256)
    if permit['source_commit']!=preview['source_commit']:
        raise ValueError('Cloud and local reviewed source commits differ')
    return remote(args.step,args.policy_sha256,permit=permit)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--step',required=True);parser.add_argument('--policy-sha256',required=True)
    parser.add_argument('--lease-file');parser.add_argument('--manifest-event',type=int)
    parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:print(json.dumps(main(args)))
    except Exception as error:
        print('Deployment caller failed closed: '+type(error).__name__,file=sys.stderr);raise SystemExit(1)
