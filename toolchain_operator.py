"""One reviewed Azure worker. No generic provisioning or automatic retries."""
import argparse
from datetime import datetime, timezone
import hashlib
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import shlex
import io
import tarfile
import subprocess

SOURCE = Path(__file__).resolve().parent
STATE = SOURCE.parent / "state"
COORD = "/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py"
DEST = "deploy:peticao-azure-dev-toolchain"
SUB = "57298c3f-7cf2-4dbe-9884-c7bafdff4478"
RG = "peticao-dev-eastus"
VM = "peticao-azure-dev-01"
DEPLOYMENT = "apoio-azure-worker-20261114-v1"
KEY = "/home/barre/.ssh/id_ed25519_peticao_tailnet_v2"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def need(value, message):
    if not value:
        raise RuntimeError(message)


def save(path, value, exclusive=False):
    path = Path(path)
    raw = (json.dumps(value, indent=2) + "\n").encode()
    target = path if exclusive else path.with_name("." + path.name + ".new")
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | (os.O_EXCL if exclusive else os.O_TRUNC)
    fd = os.open(target, flags, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    if not exclusive:
        os.replace(target, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def cli(args):
    result = subprocess.run(["/usr/bin/python3", COORD, *args], capture_output=True, text=True, timeout=30)
    need(result.returncode == 0, "canonical_check_refused")
    value = json.loads(result.stdout)
    need(value.get("ok"), "canonical_check_failed")
    return value["result"]


def gate(args):
    envelope = json.loads(Path(args.lease_file).read_text())
    cap = envelope.get("result", envelope)
    live = cli(["check", "--actor", "apoio", "--lease", cap["lease"], "--token", cap["token"], "--fence", str(cap["fence"])])
    need(live["valid"] and live["expires"] - datetime.now(timezone.utc).timestamp() > 300, "renew_own_lease_before_operation")
    lease = next(x for x in cli(["status"])["leases"] if x["id"] == cap["lease"])
    need(lease["actor"] == "apoio" and lease["operation"] == "deploy" and DEST in lease["resources"], "wrong_deployment_lease")
    acquired = cli(["history", "--after-seq", str(cap["seq"] - 1), "--limit", "1"])[0]
    notice = cli(["history", "--after-seq", str(args.manifest_event - 1), "--limit", "1"])[0]
    need(acquired["data"]["manifest_event"] == args.manifest_event and notice["seq"] == args.manifest_event and notice["kind"] == "notice", "lease_notice_mismatch")
    body = notice["data"]
    head = subprocess.check_output(["/usr/bin/git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    need(head == body["manifest"]["commit"], "source_commit_drift")
    required = {"toolchain_operator.py", "bootstrap.sh", "smoke.sh", "pins.json", "known_hosts", "policy.json", "test_bootstrap.py"}
    need(required <= set(body["file_sha256"]), "missing_source_closure")
    for name, digest in body["file_sha256"].items():
        need(Path(name).name == name and not (SOURCE / name).is_symlink() and sha(SOURCE / name) == digest, "source_hash_drift")
    policy = json.loads((SOURCE / "policy.json").read_text())
    expected = body["azure_toolchain"]
    need(expected["policy_sha256"] == sha(SOURCE / "policy.json"), "config_drift")
    need(policy["subscription"] == SUB and policy["resource_group"] == RG and policy["vm_name"] == VM, "wrong_target")
    return policy, dict(cap, live_expires=live["expires"]), expected


def gate_ssh(args, command, data=b"", timeout=900):
    policy, cap, binding = gate(args)
    need(cap["live_expires"] - datetime.now(timezone.utc).timestamp() > timeout + 60, "renew_own_lease_for_ssh_budget")
    need(args.phase in {"install", "smoke"}, "exact_phase_required")
    # API ownership and shape are read fresh; the existing approved host key is pinned in source.
    r = subprocess.run(["/usr/bin/az", "vm", "show", "--subscription", SUB, "-g", RG, "-n", VM, "--show-details", "-o", "json", "--only-show-errors"],capture_output=True,text=True,timeout=90)
    need(r.returncode == 0, "vm_read_failed")
    vm = json.loads(r.stdout)
    need(vm["id"].lower() == policy["vm_id"].lower() and vm["publicIps"] == policy["public_ipv4"] and vm.get("tags",{}).get("Operation") == "APOIO-AZURE-20261114", "wrong_vm_or_ip")
    need(vm["hardwareProfile"]["vmSize"] == "Standard_E8ads_v7" and vm["provisioningState"] == "Succeeded", "vm_shape_state_differs")
    digest=hashlib.sha256(command.encode()+data).hexdigest()
    intent=STATE/(args.phase+".intent.json")
    if intent.exists():
        old=json.loads(intent.read_text())
        need(old.get("state")=="complete" and old.get("sha256")==digest,"uncertain_or_changed_phase_no_retry")
        return old["result"]
    save(intent,{"state":"pending","sha256":digest,"manifest_event":args.manifest_event,"fence":cap["fence"]},exclusive=True)
    gate(args)
    cmd=["/usr/bin/ssh","-F","/dev/null","-o","BatchMode=yes","-o","ConnectTimeout=15","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes","-o","HostKeyAlias="+policy["public_ipv4"],"-o","UserKnownHostsFile="+str(SOURCE/"known_hosts"),"-i",KEY,"builder@100.76.178.21",command]
    r=subprocess.run(cmd,input=data,capture_output=True,timeout=timeout)
    log=STATE/(args.phase+".private.log");log.write_bytes(r.stdout+r.stderr);log.chmod(0o600)
    need(r.returncode==0,"ssh_phase_failed_reconcile_no_blind_retry")
    result={"phase":args.phase,"exit":0,"stdout":r.stdout.decode(),"log_sha256":sha(log)}
    save(intent,{"state":"complete","sha256":digest,"fence":cap["fence"],"result":result})
    return result

RECEIVER = r"""
import pathlib,os,sys,tarfile,io,subprocess
if os.geteuid()!=0:raise RuntimeError('root required')
b=pathlib.Path('/opt/peticao-toolchain/source')
for d in [b.parent,b]:
 if d.is_symlink():raise RuntimeError('symlink path refused')
 d.mkdir(mode=0o755,exist_ok=True)
allowed={'bootstrap.sh','smoke.sh','pins.json'}
raw=sys.stdin.buffer.read(262144)
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as t:
 members=t.getmembers()
 if {m.name for m in members}!=allowed or len(members)!=3:raise RuntimeError('exact bundle required')
 for m in members:
  if not m.isfile() or m.name not in allowed or m.size>131072:raise RuntimeError('unsafe bundle')
  p=b/m.name;data=t.extractfile(m).read()
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
p=b/'pins.json';dest=b.parent/'pins.json'
fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
with os.fdopen(fd,'wb') as f:f.write(p.read_bytes());f.flush();os.fsync(f.fileno())
subprocess.run(['/usr/bin/bash',str(b/'bootstrap.sh'),'--apply'],check=True,timeout=1500)
"""

def main(args):
    os.umask(0o077);STATE.mkdir(mode=0o700,exist_ok=True)
    lock=(STATE/'operator.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    gate(args)
    if args.phase=='install':
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w:') as t:
            for name in ['bootstrap.sh','smoke.sh','pins.json']:
                data=(SOURCE/name).read_bytes();m=tarfile.TarInfo(name);m.size=len(data);m.mode=0o644;t.addfile(m,io.BytesIO(data))
        return gate_ssh(args,'/usr/bin/sudo -n /usr/bin/python3 -c '+shlex.quote(RECEIVER),stream.getvalue(),timeout=1600)
    return gate_ssh(args,'/usr/bin/bash /opt/peticao-toolchain/source/smoke.sh --run',timeout=240)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--phase',choices=['install','smoke'],required=True);p.add_argument('--lease-file',required=True);p.add_argument('--manifest-event',type=int,required=True);args=p.parse_args()
    try:
        result=main(args);print(json.dumps({'phase':result['phase'],'exit':result['exit'],'log_sha256':result['log_sha256']}))
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'action':'reconcile_recorded_phase_no_blind_retry'}));raise SystemExit(1)
