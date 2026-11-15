"""Prepared pinned client. Default guard denies EVERY remote operation.

No background watcher, new coordinator or implicit authorization. The
canonical executor must inject its existing manifest/lease/global-release check.
Never call this client during the current source-only preparation.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

import qualification_contract as q


HOST = "100.122.224.82"
ALIAS = "peticao-civo.tail1a6d71.ts.net"
IDENTITY = "/home/barre/.ssh/id_ed25519_peticao_tailnet_v2"
KNOWN_HOSTS = "/home/barre/.ssh/known_hosts_peticao_mesh_v3"
PHASES = {"preflight", "bootstrap", "start", "observe", "cleanup"}


def denied(_phase):
    raise PermissionError("canonical_review_own_lease_and_infra_release_required")


def record(path, value):
    raw = (q.canonical(value) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


# Fixed installer. No shell/archive, no path from stdin, no existing-parent chmod.
# It writes a root-owned install intent in /opt BEFORE creating the exact new
# public attempt. Partial result is preserved and cannot be reinstalled blindly.
INSTALLER = r'''
import hashlib,json,os,pathlib,socket,stat,sys
if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='peticao-civo':raise PermissionError('civo_root_required')
base=pathlib.Path('/opt');public=base/'peticao-dev-worker-qual-20261114-attempt1'
for parent in [*reversed(base.parents),base]:
 i=parent.lstat()
 if stat.S_ISLNK(i.st_mode) or i.st_uid!=0 or i.st_mode&0o022 or not stat.S_ISDIR(i.st_mode):raise PermissionError('trusted_opt_required')
raw=sys.stdin.buffer.read(2*1024*1024+1)
if len(raw)>2*1024*1024:raise ValueError('bounded_public_package_required')
data=json.loads(raw)
names={'qualification_contract.py','qualification_helper.py','qualification_job.py','remote_contract.py','worker.py','controller.py','systemd_adapter.py','artifacts.py','admission.py','log_redaction.py','cgroups.py','RUN-REQUEST.json','readonly-marker'}
if type(data)is not dict or set(data)!=names:raise ValueError('exact_public_package_required')
for name,item in data.items():
 if type(item)is not dict or set(item)!={'text','sha256'} or type(item['text'])is not str or hashlib.sha256(item['text'].encode()).hexdigest()!=item['sha256']:raise ValueError('public_member_digest_required')
if os.path.lexists(public):raise PermissionError('occupied_public_attempt_refused')
intent=base/'.peticao-dev-worker-qual-20261114-attempt1.install-intent.json'
fd=os.open(intent,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb')as f:f.write(json.dumps({'package_sha256':hashlib.sha256(raw).hexdigest()}).encode());f.flush();os.fsync(f.fileno())
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
os.mkdir(public,0o755);os.chmod(public,0o755)
for name,item in data.items():
 fd=os.open(public/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb')as f:f.write(item['text'].encode());f.flush();os.fchmod(f.fileno(),0o644);os.fsync(f.fileno())
fd=os.open(public,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps({'state':'PUBLIC_PACKAGE_INSTALLED','file_count':len(data)}))
'''


def package(request, directory):
    q.operation(request, execution=True)
    directory = Path(directory)
    result = {}
    for name, sha in {**request["runtime_sha256"], **request["harness_sha256"]}.items():
        path = directory / name if name in q.HARNESS else directory / "runtime" / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024*1024:
            raise ValueError("regular_bounded_code_member_required")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != sha:
            raise PermissionError("frozen_member_changed")
        result[name] = {"text": raw.decode(), "sha256": sha}
    for name, raw in (("RUN-REQUEST.json", q.canonical(request).encode()), ("readonly-marker", b"synthetic public readonly marker\n")):
        result[name] = {"text": raw.decode(), "sha256": hashlib.sha256(raw).hexdigest()}
    raw = q.canonical(result).encode()
    if len(raw) > 2*1024*1024:
        raise ValueError("bounded_public_package_required")
    return raw


class PinnedSSH:
    def __init__(self, scope_guard=denied):
        self.scope_guard = scope_guard

    def argv(self):
        return ["/usr/bin/ssh", "-F", "/dev/null", "-T", "-p", "22", "-i", IDENTITY,
                "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", "UserKnownHostsFile=" + KNOWN_HOSTS, "-o", "HostKeyAlias=" + ALIAS,
                "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "root@" + HOST]

    def call(self, phase, raw=b""):
        if phase not in PHASES | {"install"}:
            raise ValueError("fixed_client_phase_required")
        grant = self.scope_guard(phase)
        if type(grant) is not dict or "qualification_operation" not in grant:
            raise PermissionError("reviewed_operation_binding_required")
        approved = q.operation(grant["qualification_operation"], execution=True)
        if phase == "install":
            if raw != package(approved, Path(__file__).resolve().parent):
                raise PermissionError("install_payload_not_equal_to_reviewed_package")
            # SSH joins args through a remote shell; robust single-quote fixed
            # installer code. No request data or secret is interpolated here.
            fixed = "/usr/bin/python3 -I -B -c '" + INSTALLER.replace("'", "'\\''") + "'"
        else:
            if raw:
                raise ValueError("phase_cannot_accept_free_stdin")
            fixed = "/usr/bin/python3 -I -B " + str(q.PUBLIC / "qualification_helper.py") + " " + phase + " " + q.digest(approved)
        # Check active own lease/review again after assembling the bounded
        # package, immediately before any network effect.
        if self.scope_guard(phase) != grant:
            raise PermissionError("reviewed_scope_changed_before_transport")
        answer = subprocess.run(self.argv() + [fixed], input=raw, capture_output=True, timeout=75,
                                env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
        # Do not print stderr, raw logs or credentials into tool context.
        if answer.returncode:
            raise RuntimeError("remote_phase_uncertain_preserve_observe_only")
        if len(answer.stdout) > 32768:
            raise ValueError("bounded_aggregate_reply_required")
        value = json.loads(answer.stdout)
        if type(value) is not dict or not set(value) <= {"state", "file_count", "job_count", "jobs", "cutover", "no_replay"}:
            raise ValueError("aggregate_reply_only")
        return value


class Client:
    def __init__(self, evidence_root, transport=None):
        self.root = Path(evidence_root).absolute()
        for parent in [*reversed(self.root.parents), self.root]:
            if stat.S_ISLNK(parent.lstat().st_mode):
                raise PermissionError("local_evidence_link_forbidden")
        info = self.root.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise PermissionError("owned_private_evidence_directory_required")
        self.transport = transport if transport is not None else PinnedSSH()

    def phase(self, name, raw=b""):
        if name not in PHASES | {"install"}:
            raise ValueError("fixed_client_phase_required")
        if name in {"install", "bootstrap", "start", "cleanup"}:
            # Exclusive durable intent. Exception/timeout/caller crash means
            # NEVER repeat a mutation under this attempt; only observe.
            record(self.root / (name + "-intent.json"), {"phase": name, "input_sha256": hashlib.sha256(raw).hexdigest()})
        value = self.transport.call(name, raw)
        if name in {"install", "bootstrap", "start", "cleanup"}:
            record(self.root / (name + "-receipt.json"), value)
        return value


def main():
    import argparse
    from review_gate import Gate
    parser = argparse.ArgumentParser(description="LEASED isolated Civo qualification; preparation alone cannot execute")
    parser.add_argument("phase", choices=sorted(PHASES | {"install"}))
    parser.add_argument("--manifest-event", type=int, required=True)
    parser.add_argument("--lease-file", type=Path, required=True)
    args = parser.parse_args()
    if not args.lease_file.is_absolute():
        raise ValueError("absolute_own_capability_file_required")
    os.umask(0o077)
    guard = Gate(args.manifest_event, args.lease_file)
    grant = guard(args.phase)  # No local intent/directory or remote action before authorization.
    source = Path(__file__).resolve().parent
    state = source.parent / "execution-state"
    if not os.path.lexists(state):
        state.mkdir(mode=0o700)
    transport = PinnedSSH(guard)
    raw = package(grant["qualification_operation"], source) if args.phase == "install" else b""
    result = Client(state, transport).phase(args.phase, raw)
    print(json.dumps({"phase": args.phase, "ok": True, "state": result["state"]}))


if __name__ == "__main__":
    main()
