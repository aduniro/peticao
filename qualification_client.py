"""Pinned operator client for composition into reviewed SourceA.

Import/construction does not contact a host. Default guard denies all calls.
Every mutation has an exclusive durable intent; a lost reply is observe-only.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

import qualification_contract as q

HOST = '100.122.224.82'
ALIAS = '212.2.241.70'
IDENTITY = '/home/barre/.ssh/id_ed25519_peticao_tailnet_v2'
KNOWN_HOSTS = '/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-owner-bundle-20261114/known_hosts'
KNOWN_HOSTS_SHA256 = '011704a32b8bb573f75b6d67e8ce46421350584988394303a3e7fe365e6f013f'
PUBLIC = Path('/opt/peticao-dev-short-alias-native-20261115-attempt1')
PRIVATE = Path('/mnt/apps/peticao-final/.runtime/civo-short-alias-native-20261115-attempt1')
INSTALL_INTENT = PUBLIC.parent/('.'+PUBLIC.name+'.install-intent.json')
PHASES = {'preflight', 'bootstrap', 'start', 'observe', 'cleanup'}
MUTATIONS = {'install', 'bootstrap', 'start', 'cleanup'}


def denied(_phase):
    raise PermissionError('canonical_review_own_reservation_and_infra_window_required')


def record(path, value):
    raw = (q.canonical(value)+'\n').encode()
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(Path(path).parent, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


# Fixed code and paths. Only the bounded, reviewed PUBLIC code package is stdin.
INSTALLER = r'''
import hashlib,json,os,pathlib,socket,stat,sys
if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='peticao-civo':raise PermissionError('exact_civo_root_required')
base=pathlib.Path('/opt');public=base/'peticao-dev-short-alias-native-20261115-attempt1'
private=pathlib.Path('/mnt/apps/peticao-final/.runtime/civo-short-alias-native-20261115-attempt1')
socket_parent=pathlib.Path('/run/peticao-dev-short-alias-native-20261115-attempt1')
for parent in [*reversed(base.parents),base]:
 i=parent.lstat()
 if stat.S_ISLNK(i.st_mode) or i.st_uid!=0 or i.st_mode&0o022 or not stat.S_ISDIR(i.st_mode):raise PermissionError('trusted_opt_required')
raw=sys.stdin.buffer.read(2*1024*1024+1)
if len(raw)>2*1024*1024:raise ValueError('bounded_public_package_required')
data=json.loads(raw)
names={'remote_contract.py','admission.py','artifacts.py','worker.py','controller.py','systemd_adapter.py','log_redaction.py','cgroups.py','project_storage.py','unit_refs.py','broker_entry.py','broker_lifecycle.py','broker_server.py','broker_wire.py','broker_proxy.py','qualification_contract.py','fixture_core.py','qualification_helper.py','broker_a_server.py','qualification_job.py','storage_probe.py','alias_contract.py','alias_probe.py','RUN-REQUEST.json','readonly-marker'}
if type(data)is not dict or set(data)!=names:raise ValueError('exact_public_package_required')
for name,item in data.items():
 if type(item)is not dict or set(item)!={'text','sha256'} or type(item['text'])is not str or hashlib.sha256(item['text'].encode()).hexdigest()!=item['sha256']:raise ValueError('public_member_digest_required')
if any(os.path.lexists(p)for p in (public,private,socket_parent)):raise PermissionError('occupied_public_private_or_socket_attempt_refused')
intent=base/'.peticao-dev-short-alias-native-20261115-attempt1.install-intent.json'
fd=os.open(intent,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb')as f:f.write(json.dumps({'package_sha256':hashlib.sha256(raw).hexdigest()}).encode());f.flush();os.fsync(f.fileno())
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
os.mkdir(public,0o755);os.chmod(public,0o755)
runtime={'remote_contract.py','admission.py','artifacts.py','worker.py','controller.py','systemd_adapter.py','log_redaction.py','cgroups.py','project_storage.py','unit_refs.py'}
broker={'broker_entry.py','broker_lifecycle.py','broker_server.py','broker_wire.py','broker_proxy.py'}
for name in ('runtime','broker'):
 os.mkdir(public/name,0o755);os.chmod(public/name,0o755)
for name,item in data.items():
 target=public/('runtime'if name in runtime else 'broker')/name if name in runtime|broker else public/name
 fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb')as f:f.write(item['text'].encode());f.flush();os.fchmod(f.fileno(),0o644);os.fsync(f.fileno())
for directory in (public/'runtime',public/'broker',public,base):
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps({'state':'PUBLIC_PACKAGE_INSTALLED','file_count':len(data)}))
'''


def package(request, directory):
    request = q.operation(request, execution=True)
    if q.PUBLIC != PUBLIC or q.PRIVATE != PRIVATE:
        raise PermissionError('fixed_sourceA_placement_required')
    directory = Path(directory)
    result = {}
    for field, prefix in (('runtime_sha256','runtime'), ('broker_sha256','broker'), ('harness_sha256','')):
        for name, sha in request[field].items():
            path = directory/prefix/name
            for item in (path, *path.parents):
                if item.is_symlink():
                    raise PermissionError('package_source_symlink_forbidden')
            i = path.lstat()
            if not stat.S_ISREG(i.st_mode) or i.st_nlink != 1 or i.st_size > 1024*1024:
                raise PermissionError('regular_bounded_code_required')
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != sha:
                raise PermissionError('reviewed_public_code_digest_changed')
            result[name] = {'text':raw.decode(), 'sha256':sha}
    for name,raw in (('RUN-REQUEST.json',q.canonical(request).encode()), ('readonly-marker',b'synthetic public readonly marker\n')):
        result[name] = {'text':raw.decode(), 'sha256':hashlib.sha256(raw).hexdigest()}
    raw = q.canonical(result).encode()
    if len(raw) > 2*1024*1024:
        raise ValueError('bounded_public_package_required')
    return raw


class PinnedSSH:
    def __init__(self, scope_guard=denied):
        self.scope_guard = scope_guard

    def argv(self):
        return ['/usr/bin/ssh','-F','/dev/null','-T','-p','22','-i',IDENTITY,
                '-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
                '-o','UserKnownHostsFile='+KNOWN_HOSTS,'-o','HostKeyAlias='+ALIAS,
                '-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10',
                '-o','ConnectionAttempts=1','root@'+HOST]

    def call(self, phase, raw=b''):
        if phase not in PHASES|{'install'}:
            raise PermissionError('fixed_qualification_phase_required')
        grant = self.scope_guard(phase)
        request = q.operation(grant['qualification_operation'], execution=True)
        if q.PUBLIC != PUBLIC or q.PRIVATE != PRIVATE:
            raise PermissionError('fixed_sourceA_placement_required')
        if phase == 'install':
            if raw != package(request, Path(__file__).resolve().parent):
                raise PermissionError('install_payload_not_equal_to_reviewed_source')
            fixed = "/usr/bin/python3 -I -B -c '"+INSTALLER.replace("'", "'\\''")+"'"
        else:
            if raw:
                raise ValueError('phase_cannot_accept_free_stdin')
            fixed = '/usr/bin/python3 -I -B '+str(PUBLIC/'qualification_helper.py')+' '+phase+' '+q.digest(request)
        if self.scope_guard(phase) != grant:
            raise PermissionError('reviewed_scope_changed_before_transport')
        if hashlib.sha256(Path(KNOWN_HOSTS).read_bytes()).hexdigest() != KNOWN_HOSTS_SHA256:
            raise PermissionError('reviewed_public_host_key_pin_changed')
        r = subprocess.run(self.argv()+[fixed], input=raw, capture_output=True, timeout=75,
                           env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        if r.returncode:
            # Never reveal the remote stderr, token or live job logs.
            raise RuntimeError('remote_phase_uncertain_preserve_observe_only')
        if len(r.stdout) > 32768:
            raise ValueError('bounded_aggregate_reply_required')
        return aggregate_reply(json.loads(r.stdout))


def aggregate_reply(value):
    allowed = {'state','file_count','job_count','jobs','cutover','no_replay','systemd_major',
               'systemd_version_sha256','scope','global_qualified','pending_intents',
               'prestart_no_unit','evidence_deleted','live_held_reference_io_recovery_qualified'}
    if (type(value) is not dict or type(value.get('state')) is not str
            or not re.fullmatch('[A-Z0-9_]{1,96}', value['state']) or not set(value) <= allowed):
        raise ValueError('aggregate_reply_only')
    if 'scope' in value and value['scope'] != 'isolated-short-alias':
        raise PermissionError('qualification_A_scope_only')
    for key in ('global_qualified','cutover','evidence_deleted','live_held_reference_io_recovery_qualified'):
        if key in value and value[key] is not False:
            raise PermissionError('global_readiness_or_destructive_claim_forbidden')
    return value


class Client:
    def __init__(self, evidence_root, transport=None):
        self.root = Path(evidence_root).absolute()
        for item in (self.root, *self.root.parents):
            if item.is_symlink():
                raise PermissionError('local_evidence_symlink_forbidden')
        i = self.root.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid != os.geteuid() or stat.S_IMODE(i.st_mode) != 0o700:
            raise PermissionError('owned_private_evidence_directory_required')
        self.transport = transport if transport is not None else PinnedSSH()

    def phase(self, name, raw=b''):
        if name not in PHASES|{'install'}:
            raise PermissionError('fixed_qualification_phase_required')
        if name in MUTATIONS:
            record(self.root/(name+'-intent.json'), {'phase':name, 'input_sha256':hashlib.sha256(raw).hexdigest()})
        value = self.transport.call(name, raw)
        if name in MUTATIONS:
            record(self.root/(name+'-receipt.json'), value)
        return value


def main():
    import argparse
    from review_gate import Gate
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=sorted(PHASES|{'install'}))
    parser.add_argument('--manifest-event', type=int, required=True)
    parser.add_argument('--lease-file', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    guard = Gate(args.manifest_event, args.lease_file)
    grant = guard(args.phase)  # Before any intent/directory/network effect.
    state = Path(__file__).resolve().parent.parent/'execution-state'
    if not os.path.lexists(state):
        state.mkdir(mode=0o700)
    raw = package(grant['qualification_operation'], Path(__file__).resolve().parent) if args.phase == 'install' else b''
    value = Client(state, PinnedSSH(guard)).phase(args.phase, raw)
    print(json.dumps({'phase':args.phase, 'ok':True, 'state':value['state']}))


if __name__ == '__main__': main()
