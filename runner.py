"""Single-use offline export of retained Civo output. Never compiles or deploys."""
import argparse
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess

ROOT = Path('/mnt/apps/peticao-final/.runtime/civo-export-c472-20261114-attempt1')
RETAINED = Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2')
UNIT = 'peticao-civo-export-c472-20261114-attempt1.service'
OLD_UNIT = 'peticao-civo-qualified-build-20261114-attempt2.service'
EXPECTED = {'files': 700, 'bytes': 269498993, 'build_id': 'fsa238mHOAm9so9xiR0pL', 'sha256': '49c9931eb49840c9f797410b7eeaeba26a84e53ab8febbf09cc4b8812bcb6627'}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def custody(path):
    """Hash a deterministic inventory; reject links and special files in .next."""
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError('Unsafe retained build root')
    entries = []
    for item in sorted(path.rglob('*')):
        mode = item.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Retained build contains a link or special file')
        entries.append([str(item.relative_to(path)), item.stat().st_size, digest(item)])
    return {'files': len(entries), 'bytes': sum(row[1] for row in entries), 'build_id': (path / 'BUILD_ID').read_text().strip(), 'sha256': hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()}


def check_custody():
    value = custody(RETAINED / 'snapshot/site/.next')
    if value != EXPECTED:
        raise ValueError('Retained compiled custody changed')
    return value


def write_json(path, value, mode=0o600, exclusive=False):
    if exclusive:
        with path.open('x') as stream:
            stream.write(canonical(value).decode())
        path.chmod(mode)
        return
    temporary = path.with_name(path.name + '.writing-' + str(os.getpid()))
    try:
        with temporary.open('x') as stream:
            stream.write(canonical(value).decode())
        temporary.chmod(mode)
        if path.exists():
            os.chown(temporary, -1, path.stat().st_gid)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_inputs():
    if os.geteuid() != 0 or ROOT.is_symlink() or ROOT.resolve() != ROOT or RETAINED.is_symlink() or RETAINED.resolve() != RETAINED:
        raise ValueError('Unexpected execution root')
    status = json.loads(run(['tailscale', 'status', '--json']))
    if (run(['hostname', '--short']) != 'peticao-civo'
            or status.get('BackendState') != 'Running'
            or '100.122.224.82' not in status.get('Self', {}).get('TailscaleIPs', [])):
        raise ValueError('Wrong retained Civo node')
    if run(['uname', '-m']) != 'x86_64':
        raise ValueError('Unqualified architecture')
    if run(['systemctl', 'show', OLD_UNIT, '--property=MainPID', '--value']) != '0':
        raise ValueError('Retained build unit is still running')
    policy_path = ROOT / 'inputs/policy.json'
    if policy_path.is_symlink():
        raise ValueError('Policy link rejected')
    policy = json.loads(policy_path.read_text())
    if set(policy['inputs']) != {'runner.py', 'exporter.py'}:
        raise ValueError('Unexpected delegated input inventory')
    for name, record in policy['inputs'].items():
        path = ROOT / ('runner.py' if name == 'runner.py' else 'inputs/exporter.py')
        if path.is_symlink() or digest(path) != record['sha256']:
            raise ValueError('Frozen input drift')
    return policy


def prepare():
    validate_inputs()
    if (ROOT / 'STATE.json').exists():
        raise ValueError('Attempt already exists; reconcile, never reset')
    before = check_custody()
    account = pwd.getpwnam('civo')
    if not account.pw_uid or not account.pw_gid:
        raise ValueError('Exporter must be unprivileged')
    os.chown(ROOT, 0, account.pw_gid)
    ROOT.chmod(0o750)
    write_json(ROOT / 'STATE.json', {'phase': 'preparing', 'unit': UNIT}, 0o640, exclusive=True)
    for path in [ROOT / 'inputs', ROOT / 'runner.py', ROOT / 'STATE.json'] + list((ROOT / 'inputs').iterdir()):
        if path.is_symlink():
            raise ValueError('Staged link rejected')
        os.chown(path, 0, account.pw_gid)
        path.chmod(0o750 if path.is_dir() else 0o640)
    tools = ROOT / 'tools'
    tools.mkdir(mode=0o750)
    os.chown(tools, 0, account.pw_gid)
    for source, name in [(ROOT / 'runner.py', 'runner.py'), (ROOT / 'inputs/exporter.py', 'exporter.py')]:
        target = tools / name
        target.write_bytes(source.read_bytes())
        target.chmod(0o640)
        os.chown(target, 0, account.pw_gid)
    for name in ['outputs', 'work']:
        path = ROOT / name
        path.mkdir(mode=0o700)
        os.chown(path, account.pw_uid, account.pw_gid)
    for name in ['tmp', 'empty']:
        path = ROOT / 'work' / name
        path.mkdir(mode=0o700)
        os.chown(path, account.pw_uid, account.pw_gid)
    write_json(ROOT / 'custody-before.json', before, 0o640, exclusive=True)
    os.chown(ROOT / 'custody-before.json', 0, account.pw_gid)
    write_json(ROOT / 'STATE.json', {'phase': 'prepared', 'unit': UNIT}, 0o640)
    print(json.dumps({'prepared': True, 'export_started': False}))


def unit_args():
    writable = ' '.join(str(ROOT / p) for p in ['work', 'outputs'])
    return ['systemd-run', '--unit=' + UNIT, '--no-block', '--property=Type=oneshot',
            '--property=RemainAfterExit=yes', '--property=User=civo', '--property=Group=civo',
            '--property=MemoryMax=8G', '--property=CPUQuota=400%', '--property=TasksMax=256',
            '--property=TimeoutStartSec=1800', '--property=NoNewPrivileges=yes',
            '--property=ProtectSystem=strict', '--property=ProtectHome=tmpfs',
            '--property=PrivateNetwork=yes', '--property=PrivateDevices=yes',
            '--property=CapabilityBoundingSet=', '--property=RestrictSUIDSGID=yes',
            '--property=ProtectProc=invisible', '--property=ReadWritePaths=' + writable,
            '--property=ReadOnlyPaths=' + str(RETAINED) + ' ' + str(ROOT / 'tools') + ' ' + str(ROOT / 'inputs'),
            '--property=InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale',
            '--property=TemporaryFileSystem=/tmp:ro /var/tmp:ro',
            '--property=StandardOutput=append:' + str(ROOT / 'work/export.log'),
            '--property=StandardError=append:' + str(ROOT / 'work/export.log'),
            '--working-directory=' + str(ROOT / 'work'),
            '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE=1',
            'TMPDIR=' + str(ROOT / 'work/tmp'), 'TMP=' + str(ROOT / 'work/tmp'),
            'TEMP=' + str(ROOT / 'work/tmp'), 'HOME=' + str(ROOT / 'work/empty'),
            '/usr/bin/python3', '-B', str(ROOT / 'tools/runner.py'), 'export']


def start():
    validate_inputs()
    state = json.loads((ROOT / 'STATE.json').read_text())
    if state['phase'] != 'prepared':
        raise ValueError('Export already submitted or not prepared')
    if (ROOT / 'outputs/export-1').exists():
        raise ValueError('Output already exists')
    check_custody()
    write_json(ROOT / 'STATE.json', {'phase': 'export-submitting', 'unit': UNIT}, 0o640)
    run(unit_args())
    write_json(ROOT / 'STATE.json', {'phase': 'export-submitted', 'unit': UNIT}, 0o640)
    print(json.dumps({'submitted': True, 'unit': UNIT, 'compile': False}))


def deny_socket(path='/run/docker.sock'):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        try:
            connection.connect(str(path))
        except OSError as error:
            if error.errno in {errno.EACCES, errno.EPERM, errno.ENOENT}:
                return
            raise ValueError('Unexpected Docker socket check failure') from error
    raise ValueError('Docker socket unexpectedly accessible')


def export_only():
    account = pwd.getpwnam('civo')
    if os.geteuid() != account.pw_uid or os.getegid() != account.pw_gid or account.pw_uid == 0:
        raise ValueError('Wrong export execution identity')
    if json.loads((ROOT / 'STATE.json').read_text())['phase'] not in {'export-submitting', 'export-submitted'}:
        raise ValueError('Export was not submitted')
    output = ROOT / 'outputs/export-1'
    if output.exists() or output.is_symlink():
        raise ValueError('Output already exists; preserve prior run')
    write_json(ROOT / 'work/export-attempt.json', {'started': True}, exclusive=True)
    deny_socket()
    before = check_custody()
    if json.loads((ROOT / 'custody-before.json').read_text()) != before:
        raise ValueError('Prepared custody changed')
    spec = importlib.util.spec_from_file_location('canonical_exporter', ROOT / 'tools/exporter.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if module.BUILD != RETAINED / 'snapshot':
        raise ValueError('Exporter retained build binding changed')
    try:
        result = module.export(module.BUILD, output)
        verification = module.verify(output)
    finally:
        after = check_custody()
        if before != after:
            raise ValueError('Compiled custody changed during export')
    write_json(ROOT / 'work/receipt.json', {'phase': 'export-verified', 'unit': UNIT, 'compiled_custody_before': before, 'compiled_custody_after': after, 'compiled_bytes_rewritten': False, 'operational_ready': False, 'export': result, 'verification': verification}, exclusive=True)
    print(json.dumps({'export_verified': True, 'operational_ready': False}))


def status():
    fields = ['MainPID', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'MemoryPeak', 'CPUUsageNSec']
    raw = run(['systemctl', 'show', UNIT] + ['--property=' + field for field in fields])
    result = {key: value for line in raw.splitlines() if '=' in line for key, value in [line.split('=', 1)] if key in fields}
    result.update(unit=UNIT, phase=None, receipt_present=False)
    state = ROOT / 'STATE.json'
    if state.is_file():
        result['phase'] = json.loads(state.read_text())['phase']
    receipt = ROOT / 'work/receipt.json'
    if receipt.is_file():
        own = json.loads(receipt.read_text())
        result.update(phase=own['phase'], receipt_present=True, compiled_bytes_rewritten=own['compiled_bytes_rewritten'], operational_ready=own['operational_ready'])
    print(json.dumps(result))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'start', 'status', 'export'])
    args = parser.parse_args()
    try:
        {'prepare': prepare, 'start': start, 'status': status, 'export': export_only}[args.phase]()
    except Exception as error:
        print(json.dumps({'failed': type(error).__name__, 'detail': str(error)[:150]}))
        raise SystemExit(1)
