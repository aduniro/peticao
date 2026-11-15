"""Pinned root SSH; fixed install/preflight/cleanup, default denied. No live logs."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

import reconcile as core

ROOT = Path(__file__).resolve().parent
PUBLIC = '/opt/peticao-attempt2-reconcile-20261115'
KNOWN = '/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-owner-bundle-20261114/known_hosts'
KNOWN_SHA = '011704a32b8bb573f75b6d67e8ce46421350584988394303a3e7fe365e6f013f'
IDENTITY = '/home/barre/.ssh/id_ed25519_peticao_tailnet_v2'
PHASES = {'install', 'preflight', 'cleanup'}

INSTALLER = r'''
import hashlib,json,os,pathlib,socket,stat,sys
if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='peticao-civo':raise PermissionError('fixed_civo_root_required')
base=pathlib.Path('/opt');public=base/'peticao-attempt2-reconcile-20261115'
for p in [*reversed(base.parents),base]:
 s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise PermissionError('trusted_opt_required')
raw=sys.stdin.buffer.read(2*1024*1024+1)
if len(raw)>2*1024*1024:raise ValueError('bounded_package_required')
data=json.loads(raw)
if type(data)is not dict or set(data)!={'host.py','reconcile.py','SOURCE-PINS.json','RUN-RECONCILE.json'}:raise ValueError('fixed_members_required')
for item in data.values():
 if type(item)is not dict or set(item)!={'text','sha256'} or type(item['text'])is not str or hashlib.sha256(item['text'].encode()).hexdigest()!=item['sha256']:raise ValueError('member_pin_required')
if os.path.lexists(public):raise PermissionError('occupied_attempt_no_replay')
fd=os.open(base/'.peticao-attempt2-reconcile-20261115.install-intent.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb')as f:f.write(json.dumps({'package_sha256':hashlib.sha256(raw).hexdigest()}).encode());f.flush();os.fsync(f.fileno())
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
public.mkdir(mode=0o755);os.chmod(public,0o755)
for name,item in data.items():
 fd=os.open(public/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb')as f:f.write(item['text'].encode());f.flush();os.fchmod(f.fileno(),0o644);os.fsync(f.fileno())
fd=os.open(public,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps({'state':'RECONCILIATION_CODE_INSTALLED','qualification_pass':False}))
'''


def denied(_):
    raise PermissionError('canonical_gate_required')


def package(request):
    result = {}
    for name, sha in request['code_sha256'].items():
        p = ROOT / name; info = p.lstat()
        if name not in {'host.py', 'reconcile.py', 'SOURCE-PINS.json'} or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
            raise PermissionError('fixed_regular_code_required')
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != sha:
            raise PermissionError('frozen_member_changed')
        result[name] = {'text': raw.decode(), 'sha256': sha}
    text = json.dumps(request, sort_keys=True, separators=(',', ':')) + '\n'
    result['RUN-RECONCILE.json'] = {'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()}
    return json.dumps(result, sort_keys=True, separators=(',', ':')).encode()


class SSH:
    def __init__(self, guard=denied):
        self.guard = guard

    def call(self, phase):
        if phase not in PHASES:
            raise ValueError('fixed_phase_required')
        request = self.guard(phase)
        if phase == 'install':
            raw = package(request)
            fixed = "/usr/bin/python3 -I -B -c '" + INSTALLER.replace("'", "'\\''") + "'"
        else:
            raw = b''
            fixed = '/usr/bin/python3 -I -B ' + PUBLIC + '/host.py ' + phase + ' ' + core.digest(request)
        if self.guard(phase) != request:
            raise PermissionError('scope_changed_before_ssh')
        if hashlib.sha256(Path(KNOWN).read_bytes()).hexdigest() != KNOWN_SHA:
            raise PermissionError('known_hosts_changed')
        argv = ['/usr/bin/ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'HostKeyAlias=212.2.241.70', '-o', 'UserKnownHostsFile=' + KNOWN,
                '-o', 'ConnectTimeout=15', '-i', IDENTITY, 'root@100.122.224.82', fixed]
        p = subprocess.run(argv, input=raw, capture_output=True, timeout=75, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        if p.returncode or len(p.stdout) > 32768:
            raise RuntimeError('remote_outcome_uncertain_no_replay')
        value = json.loads(p.stdout)
        expected = {'state': 'RECONCILIATION_CODE_INSTALLED', 'qualification_pass': False} if phase == 'install' else {'state': 'EXACT_ATTEMPT2_PREFLIGHT_VERIFIED' if phase == 'preflight' else 'EXACT_ATTEMPT2_RECONCILIATION_RETAINED', 'mount_count': 1 if phase == 'preflight' else 0, 'qualification_pass': False}
        if not core.exact(value, expected):
            raise ValueError('aggregate_result_only')
        return value


def intent(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write((json.dumps(value, sort_keys=True) + '\n').encode()); f.flush(); os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    import argparse
    from gate import Gate
    p = argparse.ArgumentParser(); p.add_argument('phase', choices=sorted(PHASES)); p.add_argument('--manifest-event', type=int, required=True); p.add_argument('--lease-file', type=Path, required=True); args = p.parse_args()
    if not args.lease_file.is_absolute():
        raise ValueError('absolute_own_capability_required')
    guard = Gate(args.manifest_event, args.lease_file); request = guard(args.phase)
    state = ROOT.parent / 'execution-state'
    if not os.path.lexists(state):
        state.mkdir(mode=0o700)
        fd = os.open(state.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    for path in [*reversed(state.parents), state]:
        if path.is_symlink():
            raise PermissionError('evidence_link_refused')
    info = state.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError('private_local_evidence_required')
    if args.phase in {'install', 'cleanup'}:
        intent(state / (args.phase + '-intent.json'), {'request_sha256': core.digest(request), 'phase': args.phase})
    result = SSH(guard).call(args.phase)
    if args.phase in {'install', 'cleanup'}:
        intent(state / (args.phase + '-receipt.json'), result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
