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
DEST = "coord:azure-c472-worker-qualification"
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
    need(lease["actor"] == "apoio" and lease["operation"] == "test" and DEST in lease["resources"], "wrong_deployment_lease")
    acquired = cli(["history", "--after-seq", str(cap["seq"] - 1), "--limit", "1"])[0]
    notice = cli(["history", "--after-seq", str(args.manifest_event - 1), "--limit", "1"])[0]
    need(acquired["data"]["manifest_event"] == args.manifest_event and notice["seq"] == args.manifest_event and notice["kind"] == "notice", "lease_notice_mismatch")
    body = notice["data"]
    head = subprocess.check_output(["/usr/bin/git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    need(head == body["manifest"]["commit"], "source_commit_drift")
    required = {"caller.py", "runner.py", "policy.json", "known_hosts", "test_boundaries.py", "test_caller.py"}
    need(required <= set(body["file_sha256"]), "missing_source_closure")
    for name, digest in body["file_sha256"].items():
        need(Path(name).name == name and not (SOURCE / name).is_symlink() and sha(SOURCE / name) == digest, "source_hash_drift")
    policy = json.loads((SOURCE / "policy.json").read_text())
    expected = body["qualification"]
    need(expected["policy_sha256"] == sha(SOURCE / "policy.json"), "config_drift")
    need(policy["target"] == VM and policy["tailnet_ipv4"] == "100.76.178.21" and policy["remote_root"] == "/mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1", "wrong_target")
    need(not any(x["target_event"] == args.manifest_event for x in cli(["status"]).get("notice_dispositions", [])), "notice_disposed")
    events=cli(["history", "--after-seq", str(args.manifest_event), "--limit", "1000"])
    need(any(x["kind"] == "ack" and x["actor"] == "admin-recuperacao" and x["data"].get("event_seq") == args.manifest_event for x in events), "Root_ACK_required")
    return policy, dict(cap, live_expires=live["expires"]), expected


REMOTE = "/mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1"

def ssh_args():
    return ["/usr/bin/ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=20.85.215.204", "-o", "UserKnownHostsFile="+str(SOURCE/"known_hosts"), "-i", KEY, "builder@100.76.178.21"]

def dispatch(args, command, *, stream=None, timeout=180, floor=None):
    policy,cap,binding=gate(args)
    budget=floor if floor else timeout+60
    need(cap['live_expires']-datetime.now(timezone.utc).timestamp()>budget,'renew_own_lease_for_dispatch_budget')
    return subprocess.run([*ssh_args(),command],stdin=stream,capture_output=True,timeout=timeout)

def root_python(code):
    return '/usr/bin/sudo -n /usr/bin/python3 -c '+shlex.quote(code)

def validate_vm(args):
    policy,cap,binding=gate(args)
    r=subprocess.run(['/usr/bin/az','vm','show','--subscription',SUB,'-g',RG,'-n',VM,'--show-details','--only-show-errors','-o','json'],capture_output=True,text=True,timeout=90)
    need(r.returncode==0,'vm_API_read_failed');v=json.loads(r.stdout)
    need(v['id'].lower()==policy['vm_id'].lower() and v['publicIps']==policy['public_ipv4'] and v.get('tags',{}).get('Operation')=='APOIO-AZURE-20261114','wrong_owned_VM')
    need(v['provisioningState']=='Succeeded' and v.get('powerState')=='VM running','VM_not_ready')
    return policy

def stage(args):
    policy=validate_vm(args)
    intent=STATE/'stage.intent.json'
    need(not intent.exists(),'stage_already_attempted_reconcile_no_blind_retry')
    files=[(SOURCE/'runner.py','runner.py',sha(SOURCE/'runner.py')),(SOURCE/'policy.json','inputs/policy.json',sha(SOURCE/'policy.json'))]
    for name,item in policy['inputs'].items():
        need(Path(name).name==name,'input_basename_required')
        path=Path(item['path']);need(not path.is_symlink() and sha(path)==item['sha256'] and path.stat().st_size==item['bytes'],'public_input_drift')
        files.append((path,'inputs/'+name,item['sha256']))
    save(intent,{'state':'submitting','manifest_event':args.manifest_event},exclusive=True)
    code="import pathlib,os; p=pathlib.Path("+repr(REMOTE)+"); assert os.geteuid()==0 and not p.exists() and not p.is_symlink(); assert p.parent.is_dir() and not p.parent.is_symlink(); p.mkdir(mode=0o700);(p/'inputs').mkdir(mode=0o700)"
    r=dispatch(args,root_python(code));need(r.returncode==0,'new_attempt_root_failed_preserve')
    for path,dest,digest in files:
        code="""import pathlib,os,sys,hashlib
root=pathlib.Path(ROOT);rel=REL;expected=EXPECTED
p=root/rel
assert os.geteuid()==0 and root.resolve()==root and not p.exists() and not p.is_symlink()
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);h=hashlib.sha256()
with os.fdopen(fd,'wb') as out:
 while True:
  block=sys.stdin.buffer.read(1048576)
  if not block:break
  h.update(block);out.write(block)
 out.flush();os.fsync(out.fileno())
assert h.hexdigest()==expected
""".replace('ROOT',repr(REMOTE)).replace('REL',repr(dest)).replace('EXPECTED',repr(digest))
        with path.open('rb') as stream:r=dispatch(args,root_python(code),stream=stream,timeout=600)
        need(r.returncode==0,'public_input_transfer_failed_preserve')
    result={'stage':'complete','files':len(files),'credential_files':0}
    save(intent,{'state':'complete','manifest_event':args.manifest_event,'result':result})
    return result

def phase(args):
    policy=validate_vm(args)
    if args.phase=='stage':return stage(args)
    hashes={REMOTE+'/runner.py':sha(SOURCE/'runner.py'),REMOTE+'/inputs/policy.json':sha(SOURCE/'policy.json')}
    prefix='import pathlib,hashlib,json,subprocess; expected='+repr(hashes)+'; assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==s for p,s in expected.items()); '
    if args.phase=='evidence':
        code=prefix+"root=pathlib.Path("+repr(REMOTE)+"); out={}; paths=['STATE.json','snapshot/site/.next/BUILD_ID','exports/build-1/export-report.json','exports/export-result.json','build.log']; "
        code+="exec(\"for name in paths:\\n p=root/name\\n if p.is_file() and not p.is_symlink():\\n  size=p.stat().st_size\\n  out[name]={'bytes':size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'content':p.read_text() if size<=500000 else None}\"); print(json.dumps(out))"
    else:code=prefix+'raise SystemExit(subprocess.call(["/usr/bin/python3",'+repr(REMOTE+'/runner.py')+','+repr(args.phase)+']))'
    journal=STATE/(args.phase+'.intent.json') if args.phase in ['prepare','build'] else None
    if journal:
        need(not journal.exists(),'phase_already_attempted_reconcile_no_blind_retry')
        save(journal,{'state':'submitting','manifest_event':args.manifest_event},exclusive=True)
    r=dispatch(args,root_python(code),floor=2100 if args.phase=='build' else None)
    save(STATE/(args.phase+'.transport.private.json'),{'exit':r.returncode,'stdout':r.stdout.decode(errors='replace'),'stderr':r.stderr.decode(errors='replace')})
    need(r.returncode==0,'remote_phase_failed_preserve_before_retry')
    result=json.loads(r.stdout)
    save(STATE/('RESULT-'+args.phase+'.json'),result)
    if journal:save(journal,{'state':'complete','manifest_event':args.manifest_event,'result':result})
    return result

def main(args):
    os.umask(0o077);STATE.mkdir(mode=0o700,exist_ok=True)
    lock=(STATE/'caller.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    gate(args);return phase(args)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--phase',choices=['stage','prepare','build','status','evidence'],required=True);p.add_argument('--lease-file',required=True);p.add_argument('--manifest-event',type=int,required=True);args=p.parse_args()
    try:print(json.dumps(main(args)))
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'action':'preserve_attempt_reconcile_no_blind_retry'}));raise SystemExit(1)
