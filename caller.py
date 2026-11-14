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
STATE = SOURCE.parent / "state-attempt3"
COORD = "/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py"
DEST = "coord:civo-c472-export-recovery"
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
    need(lease["actor"] == "apoio" and lease["operation"] == "test" and DEST in lease["resources"], "wrong_deployment_lease")
    acquired = cli(["history", "--after-seq", str(cap["seq"] - 1), "--limit", "1"])[0]
    notice = cli(["history", "--after-seq", str(args.manifest_event - 1), "--limit", "1"])[0]
    need(acquired["data"]["manifest_event"] == args.manifest_event and notice["seq"] == args.manifest_event and notice["kind"] == "notice", "lease_notice_mismatch")
    body = notice["data"]
    head = subprocess.check_output(["/usr/bin/git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    need(head == body["manifest"]["commit"], "source_commit_drift")
    required = {"caller.py", "runner.py", "exporter.py", "policy.json", "known_hosts", "test_runner.py", "test_caller.py"}
    need(required <= set(body["file_sha256"]), "missing_source_closure")
    for name, digest in body["file_sha256"].items():
        need(Path(name).name == name and not (SOURCE / name).is_symlink() and sha(SOURCE / name) == digest, "source_hash_drift")
    policy = json.loads((SOURCE / "policy.json").read_text())
    expected = body["qualification"]
    need(expected["policy_sha256"] == sha(SOURCE / "policy.json"), "config_drift")
    need(policy["target"] == "peticao-civo" and policy["tailnet_ipv4"] == "100.122.224.82" and policy["remote_root"] == "/mnt/apps/peticao-final/.runtime/civo-export-c472-20261114-attempt3", "wrong_target")
    need(not any(x["target_event"] == args.manifest_event for x in cli(["status"]).get("notice_dispositions", [])), "notice_disposed")
    events=cli(["history", "--after-seq", str(args.manifest_event), "--limit", "1000"])
    need(any(x["kind"] == "ack" and x["actor"] == "admin-recuperacao" and x["data"].get("event_seq") == args.manifest_event for x in events), "Root_ACK_required")
    return policy, dict(cap, live_expires=live["expires"]), expected


REMOTE = "/mnt/apps/peticao-final/.runtime/civo-export-c472-20261114-attempt3"

def ssh_args():
    return ["/usr/bin/ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=peticao-civo.tail1a6d71.ts.net", "-o", "UserKnownHostsFile="+str(SOURCE/"known_hosts"), "-i", KEY, "root@100.122.224.82"]

def dispatch(args, command, *, stream=None, timeout=180, floor=None):
    policy,cap,binding=gate(args)
    budget=floor if floor else timeout+60
    need(cap['live_expires']-datetime.now(timezone.utc).timestamp()>budget,'renew_own_lease_for_dispatch_budget')
    return subprocess.run([*ssh_args(),command],stdin=stream,capture_output=True,timeout=timeout)

def root_python(code):
    return '/usr/bin/python3 -c '+shlex.quote(code)

def stage(args):
    policy,cap,binding=gate(args)
    intent=STATE/'stage.intent.json';need(not intent.exists(),'stage_already_attempted_reconcile')
    files=[(SOURCE/'runner.py','runner.py'),(SOURCE/'policy.json','inputs/policy.json'),(SOURCE/'exporter.py','inputs/exporter.py')]
    save(intent,{'state':'submitting','manifest_event':args.manifest_event},exclusive=True)
    code="import pathlib,os; p=pathlib.Path("+repr(REMOTE)+"); assert os.geteuid()==0 and not p.exists() and not p.is_symlink(); assert p.parent.is_dir() and not p.parent.is_symlink(); p.mkdir(mode=0o700);(p/'inputs').mkdir(mode=0o700)"
    r=dispatch(args,root_python(code));need(r.returncode==0,'new_root_failed_preserve')
    for path,dest in files:
        code="""import pathlib,os,sys,hashlib
root=pathlib.Path(ROOT);p=root/REL
assert os.geteuid()==0 and root.resolve()==root and not p.exists() and not p.is_symlink()
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
raw=sys.stdin.buffer.read(131073);assert len(raw)<=131072 and hashlib.sha256(raw).hexdigest()==EXPECTED
with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
""".replace('ROOT',repr(REMOTE)).replace('REL',repr(dest)).replace('EXPECTED',repr(sha(path)))
        with path.open('rb') as stream:r=dispatch(args,root_python(code),stream=stream)
        need(r.returncode==0,'source_transfer_failed_preserve')
    result={'stage':'complete','public_source_files':3,'credential_files':0}
    save(intent,{'state':'complete','result':result});return result

def phase(args):
    if args.phase=='stage':return stage(args)
    expected={REMOTE+'/runner.py':sha(SOURCE/'runner.py'),REMOTE+'/inputs/policy.json':sha(SOURCE/'policy.json')}
    code='import pathlib,hashlib,json,subprocess; expected='+repr(expected)+'; assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==s for p,s in expected.items()); '
    if args.phase=='evidence':
        code+='root=pathlib.Path('+repr(REMOTE)+'); out={}; paths='+repr(['STATE.json','host-home-baseline.json','host-preflight.json','custody-before.json','work/receipt.json','work/namespace-preflight.json','outputs/export-1/export-report.json','work/export.log'])+'; '
        code+="exec(\"for name in paths:\\n p=root/name\\n if p.is_file() and not p.is_symlink():\\n  size=p.stat().st_size\\n  out[name]={'bytes':size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'content':p.read_text() if size<=500000 else None}\"); print(json.dumps(out))"
    else:code+='raise SystemExit(subprocess.call(["/usr/bin/python3",'+repr(REMOTE+'/runner.py')+','+repr(args.phase)+']))'
    journal=STATE/(args.phase+'.intent.json') if args.phase in ['prepare','start'] else None
    if journal:
        need(not journal.exists(),'phase_already_attempted_reconcile')
        save(journal,{'state':'submitting','manifest_event':args.manifest_event},exclusive=True)
    r=dispatch(args,root_python(code),floor=2100 if args.phase=='start' else None)
    save(STATE/(args.phase+'.transport.private.json'),{'exit':r.returncode,'stdout':r.stdout.decode(errors='replace'),'stderr':r.stderr.decode(errors='replace')})
    need(r.returncode==0,'remote_phase_failed_preserve')
    result=json.loads(r.stdout);save(STATE/('RESULT-'+args.phase+'.json'),result)
    if journal:save(journal,{'state':'complete','result':result})
    return result

def main(args):
    os.umask(0o077);STATE.mkdir(mode=0o700,exist_ok=True)
    lock=(STATE/'caller.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    gate(args);return phase(args)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--phase',choices=['stage','prepare','start','status','evidence'],required=True);p.add_argument('--lease-file',required=True);p.add_argument('--manifest-event',type=int,required=True);args=p.parse_args()
    try:print(json.dumps(main(args)))
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'action':'preserve_reconcile_no_blind_retry'}));raise SystemExit(1)
