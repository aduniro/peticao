"""Fixed SSH worker entry. Not installed; actual qualification file is required."""
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

sys.dont_write_bytecode=True
import remote_contract as contract
from worker import WorkerRPC
from systemd_adapter import SystemdAdapter
from admission import Admission

CONFIG=Path('/etc/peticao-dev-worker/runtime.json')
QUALIFICATION=Path('/etc/peticao-dev-worker/qualification.json')
NODES={'peticao-civo':'civo','peticao-build-a1':'akamai','peticao-azure-dev-01':'azure'}
CODE_FILES=('remote_contract.py','worker.py','artifacts.py','admission.py','systemd_adapter.py','log_redaction.py','rpc.py','fixture_job.py')


def make_service():
    if os.geteuid()!=0:raise PermissionError('root_worker_entry_required')
    node=NODES.get(socket.gethostname().split('.')[0])
    if not node:raise PermissionError('qualified_worker_hostname_required')
    config=json.loads(contract.root_control_file(CONFIG).read_text())
    if config.get('status')!='QUALIFIED_RUNTIME' or config.get('worker_id')!=node:raise PermissionError('worker_not_qualified')
    raw=contract.root_control_file(QUALIFICATION).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=config.get('qualification_evidence_sha256'):raise PermissionError('qualification_evidence_pin_required')
    evidence=json.loads(raw)
    if (evidence.get('status')!='PASS' or evidence.get('worker_id')!=node or evidence.get('boot_id')!=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            or type(config.get('qualification_manifest_event')) is not int or config['qualification_manifest_event']<1):raise PermissionError('actual_current_boot_qualification_required')
    pins=evidence.get('runtime_code_sha256')
    if not isinstance(pins,dict) or set(pins)!=set(CODE_FILES):raise PermissionError('complete_qualified_runtime_code_required')
    for name,pin in pins.items():
        code=contract.root_control_file(Path(__file__).parent/name)
        if hashlib.sha256(code.read_bytes()).hexdigest()!=pin:raise PermissionError('qualified_runtime_code_changed')
    profiles=config.get('profiles')
    if not isinstance(profiles,dict) or not profiles or set(profiles)-{'fixture-pass','fixture-fail'}:
        raise PermissionError('only_qualified_fixture_profiles_in_this_candidate')
    if evidence.get('profile_catalog_sha256')!=contract.digest(profiles):raise PermissionError('actual_profile_runtime_qualification_required')
    for name,descriptor in profiles.items():
        if descriptor.get('name')!=name or descriptor.get('program')!='/opt/peticao-dev-worker/fixture_job.py':raise PermissionError('fixed_profile_program_required')
    journal=contract.WorkerJournal('/srv/peticao-dev-worker/receipts.sqlite',node,config['generation'],
                                    lambda:Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                                    {k:contract.digest(v) for k,v in profiles.items()},
                                    contract.EpochGuard('/etc/peticao-dev-authority/epoch.json'))
    return WorkerRPC(journal,SystemdAdapter(),profiles,'/srv/peticao-dev-worker/exports',Admission('/srv/peticao-dev-worker'))


def main():
    if len(sys.argv)!=1:raise ValueError('stdin_rpc_only_no_command_arguments')
    raw=sys.stdin.buffer.read(65537)
    if len(raw)>65536:raise ValueError('bounded_rpc_request_required')
    request=json.loads(raw)
    result=make_service().rpc(request)
    print(contract.canonical({'ok':True,'result':result}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        # No payload, secret, command output, report bytes or traceback in logs.
        print(json.dumps({'ok':False,'error_type':type(error).__name__}));raise SystemExit(1)
