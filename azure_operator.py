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
import subprocess

SOURCE = Path(__file__).resolve().parent
STATE = SOURCE.parent / "state"
COORD = "/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py"
DEST = "deploy:peticao-azure-worker"
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
    required = {"azure_operator.py", "main.json", "bootstrap.sh", "policy.json", "test_template.py"}
    need(required <= set(body["file_sha256"]), "missing_source_closure")
    for name, digest in body["file_sha256"].items():
        need(Path(name).name == name and not (SOURCE / name).is_symlink() and sha(SOURCE / name) == digest, "source_hash_drift")
    policy = json.loads((SOURCE / "policy.json").read_text())
    expected = body["azure_worker"]
    need(expected["policy_sha256"] == sha(SOURCE / "policy.json") and expected["parameters_sha256"] == sha(STATE / "parameters.private.json"), "config_drift")
    need(policy["subscription"] == SUB and policy["resource_group"] == RG and policy["vm_name"] == VM, "wrong_target")
    return policy, dict(cap, live_expires=live["expires"]), expected


def az(query, label, timeout=100):
    result = subprocess.run(["/usr/bin/az", *query, "--subscription", SUB, "--only-show-errors", "-o", "json"], capture_output=True, text=True, timeout=timeout)
    save(STATE / (label + ".private.json"), {"exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
    need(result.returncode == 0, "azure_operation_failed_see_private_result")
    return json.loads(result.stdout) if result.stdout.strip() else None


def mutation(args, phase, command):
    policy, cap, binding = gate(args)
    timeout = 900 if phase == "deploy" else 180
    need(cap["live_expires"] - datetime.now(timezone.utc).timestamp() > timeout + 60, "renew_own_lease_for_phase_budget")
    request_hash = hashlib.sha256(json.dumps(command, sort_keys=True).encode()).hexdigest()
    path = STATE / (phase + ".intent.json")
    if path.exists():
        old = json.loads(path.read_text())
        need(old.get("state") == "complete" and old.get("request_sha256") == request_hash, "uncertain_or_different_request_no_retry")
        return old["response"]
    save(path, {"state": "pending", "request_sha256": request_hash, "fence": cap["fence"], "manifest_event": args.manifest_event}, exclusive=True)
    gate(args)
    value = az(command, phase, timeout=timeout)
    save(path, {"state": "complete", "request_sha256": request_hash, "fence": cap["fence"], "manifest_event": args.manifest_event, "response": value})
    return value


def verify(args):
    policy, cap, binding = gate(args)
    value = az(["vm", "show", "--resource-group", RG, "--name", VM, "--show-details"], "vm-observed")
    need(value["provisioningState"] == "Succeeded" and value["hardwareProfile"]["vmSize"] == policy["sku"], "vm_shape_or_state_differs")
    need(value["location"] == policy["location"] and value.get("tags", {}).get("Operation") == policy["operation"], "vm_ownership_tag_differs")
    expected_id = "/subscriptions/" + SUB + "/resourceGroups/" + RG + "/providers/Microsoft.Compute/virtualMachines/" + VM
    need(value["id"].lower() == expected_id.lower(), "vm_id_differs")
    image = value["storageProfile"]["imageReference"]
    need(image["publisher"] == "Debian" and image["offer"] == "debian-13" and image["sku"] == "13-gen2" and image["version"] == policy["image_version"], "vm_image_differs")
    address = str(ipaddress.IPv4Address(value["publicIps"]))
    receipt = {"id": value["id"], "name": VM, "resource_group": RG, "sku": policy["sku"], "public_ipv4": address, "private_ipv4": value.get("privateIps"), "location": value["location"], "provisioning_state": value["provisioningState"], "power_state": value.get("powerState"), "operation": policy["operation"], "manifest_event": args.manifest_event}
    save(STATE / "VM-RECEIPT.json", receipt)
    return receipt


def ssh_command(address, alias):
    return ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=" + alias, "-o", "UserKnownHostsFile=" + str(STATE / "known_hosts"), "-i", KEY, "builder@" + address]


def ssh(args, command, *, data=b"", address=None, timeout=100):
    policy, cap, binding = gate(args)
    need(cap["live_expires"] - datetime.now(timezone.utc).timestamp() > timeout + 60, "renew_own_lease_for_ssh_budget")
    receipt = json.loads((STATE / "VM-RECEIPT.json").read_text())
    host = str(ipaddress.IPv4Address(receipt["public_ipv4"]))
    intent = STATE / ("ssh-" + args.phase + ".intent.json") if args.phase in {"bootstrap", "join"} else None
    digest = hashlib.sha256(json.dumps({"phase": args.phase, "command": command, "vm_id": receipt["id"], "manifest_event": args.manifest_event}, sort_keys=True).encode()).hexdigest()
    if intent:
        if intent.exists():
            old = json.loads(intent.read_text())
            need(old.get("state") == "complete" and old.get("request_sha256") == digest, "uncertain_ssh_no_blind_retry")
            return old["response"].encode()
        save(intent, {"state": "pending", "request_sha256": digest, "fence": cap["fence"]}, exclusive=True)
    gate(args)
    result = subprocess.run([*ssh_command(address or host, host), command], input=data, capture_output=True, timeout=timeout)
    # Never print raw host output. Bootstrap logs and joining output are private.
    log = STATE / (args.phase + ".ssh.private.log")
    with log.open("ab") as stream:
        stream.write(result.stdout + result.stderr)
    need(result.returncode == 0, "ssh_step_failed_reconcile_before_retry")
    if intent:
        save(intent, {"state": "complete", "request_sha256": digest, "fence": cap["fence"], "response": result.stdout.decode()})
    return result.stdout


JOIN = r'''
import json,subprocess,os,pathlib
root=pathlib.Path('/var/lib/peticao-infra');root.mkdir(mode=0o700,exist_ok=True)
def status():
 r=subprocess.run(['/usr/bin/tailscale','status','--json'],capture_output=True,text=True)
 try:return json.loads(r.stdout)
 except Exception:return {}
x=status()
if x.get('BackendState')!='Running':
 import sys
 key=root/'tailscale.authkey'
 fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(sys.stdin.buffer.read(4096));stream.flush();os.fsync(stream.fileno())
 try:
  r=subprocess.run(['/usr/bin/tailscale','up','--auth-key=file:'+str(key),'--hostname=peticao-azure-dev-01','--accept-dns=true','--accept-routes=false'],capture_output=True,timeout=120)
  if r.returncode:raise RuntimeError('Existing Tailnet enrollment failed')
 finally:key.unlink(missing_ok=True)
x=status()
if x.get('BackendState')!='Running':raise RuntimeError('Tailnet not Running')
print(json.dumps({'backend':x['BackendState'],'dns':x['Self']['DNSName'],'ips':x['Self']['TailscaleIPs']}))
'''


def main(args):
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    lock = (STATE / "operator.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    policy, cap, binding = gate(args)
    params = "@" + str(STATE / "parameters.private.json")
    command = ["--resource-group", RG, "--template-file", str(SOURCE / "main.json"), "--parameters", params]
    if args.phase == "group":
        groups = az(["group", "list", "--query", "[?name=='" + RG + "']"], "group-preflight")
        if groups:
            need(groups[0]["location"] == policy["location"], "existing_group_location_differs")
            save(STATE / "existing-group.json", groups[0])
            return {"state": "existing_approved_named_group_preserved", "id": groups[0]["id"]}
        value = mutation(args, "group-create", ["group", "create", "--name", RG, "--location", policy["location"], "--tags", "Project=peticao", "Operation=" + policy["operation"], "ManagedBy=apoio"])
        return {"state": "group-created", "id": value["id"]}
    if args.phase in {"validate", "deploy"}:
        if args.phase == "deploy":
            existing = az(["vm", "list", "--resource-group", RG, "--query", "[?name=='" + VM + "']"], "vm-before-deploy")
            need(not existing or (STATE / "deploy.intent.json").exists(), "existing_vm_requires_explicit_reconciliation")
        operation = ["deployment", "group", "create" if args.phase == "deploy" else "validate", "--name", DEPLOYMENT, *command]
        if args.phase == "deploy":
            operation += ["--mode", "Incremental"]
        value = mutation(args, args.phase, operation)
        return {"state": value.get("properties", {}).get("provisioningState"), "deployment_id": value.get("id")}
    if args.phase == "verify":
        return verify(args)
    if args.phase == "bootstrap":
        receipt = verify(args)
        host = receipt["public_ipv4"]
        scan = subprocess.run(["/usr/bin/ssh-keyscan", "-T", "8", "-t", "ed25519", host], capture_output=True, timeout=15)
        need(scan.returncode == 0 and scan.stdout, "host_key_scan_failed")
        known = STATE / "known_hosts"
        if known.exists():
            need(known.read_bytes() == scan.stdout, "host_key_changed")
        else:
            known.write_bytes(scan.stdout)
            known.chmod(0o600)
        ssh(args, "/usr/bin/sudo -n /usr/bin/bash -s", data=(SOURCE / "bootstrap.sh").read_bytes(), timeout=600)
        return {"state": "basic_bootstrap_completed", "host_key_trust": "TOFU pinned to API-verified owned IP plus successful approved-key SSH"}
    if args.phase == "join":
        verify(args)
        key = Path("/home/barre/.config/peticao/credentials/sanciona-integral")
        need(not key.is_symlink() and key.stat().st_mode & 0o077 == 0, "private_existing_tailnet_key_required")
        raw = ssh(args, "/usr/bin/sudo -n /usr/bin/python3 -c " + shlex.quote(JOIN), data=key.read_bytes(), timeout=180)
        value = json.loads(raw)
        need(value["backend"] == "Running" and value["dns"].rstrip(".").endswith(".tail1a6d71.ts.net"), "unexpected_tailnet_identity")
        save(STATE / "TAILNET-RECEIPT.json", value)
        return value
    if args.phase == "access":
        value = json.loads((STATE / "TAILNET-RECEIPT.json").read_text())
        targets = [*value["ips"], value["dns"].rstrip(".")]
        for host in targets:
            need(ssh(args, "/usr/bin/hostname", address=host).decode().strip() == VM, "tailnet_ssh_hostname_differs")
        result = {"ssh_targets_pass": targets, "user": "builder", "jobs_released": False, "basic_access_only": True}
        save(STATE / "ACCESS-PROOF.json", result)
        return result
    raise ValueError("Unsupported exact operation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=["group", "validate", "deploy", "verify", "bootstrap", "join", "access"])
    parser.add_argument("--lease-file", required=True)
    parser.add_argument("--manifest-event", required=True, type=int)
    args = parser.parse_args()
    try:
        print(json.dumps(main(args)))
    except Exception as error:
        print(json.dumps({"errorType": type(error).__name__, "action": "stop_and_reconcile_recorded_phase_no_blind_retry"}))
        raise SystemExit(1)
