"""Concrete reviewed composition; install/observe only, never free commands.

Gate checks canonical source, execution, release, full SRI, independent reviews,
fresh Root window and own DEPLOY capability BEFORE transport construction.
Client and transport independently recheck the same grant before each SSH.
"""
import argparse
import json
from pathlib import Path

import client
import gate

ROOT=Path(__file__).resolve().parent
CAPFILE=ROOT/'execution-state/deploy-capability.private.json'


def run(action,event):
    if action not in {'install','observe'}or type(event)is not int or event<1:
        raise PermissionError('closed_action_and_canonical_execution_event_required')
    guard=gate.Gate(event,CAPFILE)
    grant=guard(action)  # First authority check, before local state or transport.
    execution=grant['execution']
    contract=client.OwnerContract(execution['header_template'])
    blobs={name:{'path':str(ROOT/name),'sha256':sha,'bytes':(ROOT/name).stat().st_size}
           for name,sha in execution['remote_code_sha256'].items()}
    transport=client.PinnedSSH(blobs,integration_enabled=True,deadline_seconds=900)
    operator=client.Client(scope_guard=guard,transport=transport,contract=contract)
    if action=='install':
        return operator.install(None,ROOT/execution['payload_path'],execution['payload_sha256'],execution['payload_bytes'])
    return operator.observe()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--action',choices=('install','observe'),required=True)
    parser.add_argument('--event',type=int,required=True)
    args=parser.parse_args()
    try:
        result=run(args.action,args.event)
        print(json.dumps(result,sort_keys=True,separators=(',',':'),allow_nan=False))
    except Exception as error:
        print(json.dumps({'state':'LOCAL_OPERATION_REFUSED_OR_UNCERTAIN_NO_RETRY','error_type':type(error).__name__},sort_keys=True))
        return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
