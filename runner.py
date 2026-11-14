"""Single-use Civo offline QA preparation and bounded isolated supervision."""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import shutil
import socket
import stat
import subprocess
import tarfile

ROOT = Path('/mnt/apps/peticao-final/.qt1')
UNIT = 'peticao-civo-c472-complete-qa-20261114.service'
BASE = Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2')
CHROMIUM = Path('/mnt/apps/peticao-final/.tools/host-civo/playwright/chromium-1234/chrome-linux64/chrome')
DIRS = ('pg-http', 'e', 't', 'outbox', 'c', 'g', 'r', 'logs', 'results')
FILES = ('fixture.private.json', 'processes.json', 'backend-tests.log', 'fixture.log', 'runtime.log', 'BACKEND-SMOKE.json', 'HTTP-REGRESSION.json', 'network-denials.jsonl')
BUDGET = 30 * 1024**3
HOME_PATHS = ('/home', '/root', '/run/user', '/tmp', '/var/tmp')
HOME_MARKERS = ('.ssh', '.config', '.codex')


def run(args, **kw):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True, **kw).stdout.strip()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_name(name):
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or str(p) != name or any(c.isspace() for c in name):
        raise ValueError('Unsafe relative path')
    return name


def write_json(path, value, group=False, exclusive=False):
    mode = 'x' if exclusive else 'w'
    with path.open(mode) as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'))
        stream.write('\n')
    path.chmod(0o640 if group else 0o600)
    if os.geteuid() == 0:
        os.chown(path, 0, pwd.getpwnam('civo').pw_gid)


def policy():
    p = json.loads((ROOT / 'inputs/policy.json').read_text())
    if p['target'] != 'peticao-civo' or p['tailnet_ipv4'] != '100.122.224.82' or p['unit'] != UNIT or p.get('remote_root', str(ROOT)) != str(ROOT):
        raise ValueError('Policy target mismatch')
    defaults = {'source_tar': str(BASE / 'inputs/source.tar.gz'), 'deps_root': str(BASE / 'deps/site'), 'node_path': str(BASE / 'tools/node20'), 'chromium_path': str(CHROMIUM), 'chromium_version': '151.0.7922.34'}
    for k, v in defaults.items():
        p.setdefault(k, v)
    for k in ('export_root', 'source_tar', 'deps_root', 'node_path', 'chromium_path'):
        value = Path(p[k])
        if not value.is_absolute() or value.resolve() != value or any(c.isspace() for c in str(value)):
            raise ValueError('Noncanonical path: ' + k)
    return p


def pin(path, expected):
    if Path(path).is_symlink() or not Path(path).is_file() or digest(path) != expected:
        raise ValueError('Hash mismatch: ' + str(path))


def wheel_rows(p):
    value = p['wheels']
    if isinstance(value, list):
        value = {row.get('filename', row.get('name')): row for row in value}
    if len(value) != 4:
        raise ValueError('Expected exactly four public wheels')
    return value


def validate_inputs(p):
    for name, value in p['inputs'].items():
        if '/' in safe_name(name):
            raise ValueError('Nested input refused')
        pin(ROOT / ('runner.py' if name == 'runner.py' else 'inputs/' + name), value['sha256'])
    required = {'runner.py', 'qa-driver.mjs', 'qa-runtime.mjs', 'network-guard.cjs', 'fixture.ts', 'backend-smoke.mjs', 'http-regression.mjs', 'refresh-fixture-session.mjs', 'real-map-browser.py', 'signature-explorer-r1-browser.py', 'requirements.lock'}
    if not required.issubset(p['inputs']):
        raise ValueError('Missing pinned inputs')
    rows = wheel_rows(p)
    for name, value in rows.items():
        if '/' in safe_name(name) or not name.endswith('.whl'):
            raise ValueError('Invalid wheel name')
        pin(ROOT / 'wheels' / name, value['sha256'] if isinstance(value, dict) else value)
    locks = (ROOT / 'inputs/requirements.lock').read_text()
    if any('--hash=sha256:' + (v['sha256'] if isinstance(v, dict) else v) not in locks for v in rows.values()):
        raise ValueError('Wheel absent from hash-locked requirements')
    pin(p['source_tar'], p['source_sha256'])
    pin(p['node_path'], p['node_sha256'])
    pin(Path(p['deps_root']) / 'package-lock.json', p['lock_sha256'])
    if run([p['node_path'], '--version']).split('.')[0] != 'v20':
        raise ValueError('Node20 required')
    if p['chromium_version'] not in run([p['chromium_path'], '--version']):
        raise ValueError('Chromium version mismatch')


def tree_rows(root):
    rows = []
    for path in sorted(Path(root).rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Link or special file in immutable tree')
        rows.append([str(path.relative_to(root)), path.stat().st_size, digest(path)])
    return rows


def tree_hash(root):
    return hashlib.sha256(json.dumps(tree_rows(root), separators=(',', ':')).encode()).hexdigest()


def verify_export(p):
    root = Path(p['export_root'])
    pin(root / 'runtime.tar', p['artifact_sha256'])
    manifest = json.loads((root / 'release-manifest.json').read_text())
    report = json.loads((root / 'export-report.json').read_text())
    pin(root / 'release-manifest.json', p['manifest_sha256'])
    if report['manifestSha256'] != p['manifest_sha256'] or manifest.get('source_commit') != p['source_commit'] or manifest.get('runtime_format') != 'next-start-v1' or manifest.get('entrypoint') != 'node_modules/next/dist/bin/next':
        raise ValueError('Export provenance differs')
    if report['artifactSha256'] != p['artifact_sha256']:
        raise ValueError('Export report artifact differs')
    expected = manifest['files']
    actual = tree_rows(root / 'runtime')
    if {r[0] for r in actual} != set(expected):
        raise ValueError('Runtime inventory differs')
    for name, size, sha in actual:
        safe_name(name)
        if expected[name] != {'bytes': size, 'sha256': sha}:
            raise ValueError('Runtime file differs: ' + name)
    return {'tree_sha256': tree_hash(root / 'runtime'), 'files': len(actual), 'bytes': sum(r[1] for r in actual)}


def extract_source(archive, destination, budget=BUDGET):
    if destination.exists() or destination.is_symlink():
        raise ValueError('Source already exists')
    with tarfile.open(archive, 'r:gz') as tf:
        members = tf.getmembers()
        seen = set()
        for item in members:
            name = item.name.rstrip('/')
            safe_name(name)
            if name in seen or not (item.isfile() or item.isdir()) or item.size < 0:
                raise ValueError('Unsafe or duplicate archive member')
            seen.add(name)
        if sum(x.size for x in members) > budget:
            raise ValueError('Source exceeds disk budget')
        destination.mkdir(mode=0o750)
        for item in members:
            path = destination / item.name.rstrip('/')
            if item.isdir():
                path.mkdir(mode=0o750, parents=True, exist_ok=True)
            else:
                path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
                with tf.extractfile(item) as src, path.open('xb') as out:
                    shutil.copyfileobj(src, out)
                path.chmod(0o755 if item.mode & 0o111 else 0o644)
    if not (destination / 'site/package.json').is_file():
        raise ValueError('Source archive missing site/package.json')


def freeze_tree(root):
    for path in [Path(root), *Path(root).rglob('*')]:
        if path.is_symlink():
            continue
        os.chown(path, 0, 0)
        path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)


def host_guard(p):
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != p['target']:
        raise ValueError('Root on designated host required')
    if p['tailnet_ipv4'] not in run(['/usr/sbin/ip', '-4', '-o', 'addr', 'show']).split():
        # ip prints CIDR, never rely on substring host matching.
        if p['tailnet_ipv4'] not in [x.split('/')[0] for x in run(['/usr/sbin/ip', '-4', '-o', 'addr', 'show']).split()]:
            raise ValueError('Tailnet address mismatch')
    if ROOT.is_symlink() or ROOT.resolve() != ROOT:
        raise ValueError('Unsafe QA root')


def home_stat(path):
    result = {'exists': False, 'device': None, 'markers': {k: (Path(path) / k).exists() for k in HOME_MARKERS}}
    try:
        info = Path(path).stat()
        result.update(exists=True, device=info.st_dev)
    except OSError:
        pass
    return result


def masked_homes(baseline):
    mounts = {}
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        before, _, after = line.partition(' - ')
        parts = before.split()
        if parts[4] in HOME_PATHS:
            mounts[parts[4]] = (after.split()[0], 'ro' in parts[5].split(','))
    for name in HOME_PATHS:
        current = home_stat(name)
        with os.scandir(name) as stream:
            empty = next(stream, None) is None
        if (mounts.get(name) != ('tmpfs', True) or not os.statvfs(name).f_flag & os.ST_RDONLY or not empty or any(current['markers'].values()) or current['device'] == baseline[name]['device']):
            raise ValueError('Namespace mask not proven: ' + name)


def access_preflight(p):
    # Run with the real application identity and inspect every dependency file.
    code = """import os,sys,json
errors=[]
for root in json.loads(sys.argv[1]):
 if not os.path.isdir(root): errors.append('missing tree')
 for current,dirs,files in os.walk(root,followlinks=True,onerror=lambda e: errors.append('walk')):
  if not os.access(current,os.R_OK|os.X_OK): errors.append('directory')
  for name in files:
   try:
    with open(os.path.join(current,name),'rb') as s:s.read(1)
   except OSError:errors.append('file')
if errors:raise SystemExit('Application identity cannot read all staged paths')
"""
    trees = [str(ROOT / x) for x in ('runtime', 'source', 'p', 'inputs', 'wheels')] + [p['deps_root'], str(Path(p['chromium_path']).parent)]
    run(['/usr/sbin/runuser', '-u', 'civo', '-g', 'civo', '--', '/usr/bin/python3', '-B', '-c', code, json.dumps(trees)])
    run(['/usr/sbin/runuser', '-u', 'civo', '--', p['node_path'], '--version'])
    for name in ('runner.py', 'STATE.json', 'custody-before.json', 'host-home-baseline.json', *p['inputs']):
        path = ROOT / name
        run(['/usr/sbin/runuser', '-u', 'civo', '--', '/usr/bin/python3', '-B', '-c', 'import sys; open(sys.argv[1],"rb").read(1)', path])
    run(['/usr/sbin/runuser', '-u', 'civo', '--', ROOT / 'p/bin/python', '-B', '-c', 'import playwright,greenlet,pyee,typing_extensions'])
    run(['/usr/sbin/runuser', '-u', 'civo', '--', p['chromium_path'], '--version'])


def setup():
    p = policy()
    host_guard(p)
    if any((ROOT / x).exists() or (ROOT / x).is_symlink() for x in ('STATE.json', 'source', 'runtime', 'p', 'install-tmp')):
        raise ValueError('Existing attempt refused; preserve evidence')
    validate_inputs(p)
    custody = verify_export(p)
    if shutil.disk_usage(ROOT).free < 32 * 1024**3:
        raise ValueError('At least 32 GiB free required')
    account = pwd.getpwnam('civo')
    ROOT.chmod(0o750)
    os.chown(ROOT, 0, account.pw_gid)
    write_json(ROOT / 'STATE.json', {'phase': 'preparing', 'unit': UNIT}, True, True)
    # No cleanup on failure: all partially prepared artifacts remain reviewable.
    for name in DIRS:
        dest = ROOT / name
        dest.mkdir(mode=0o700)
        os.chown(dest, account.pw_uid, account.pw_gid)
    for name in FILES:
        dest = ROOT / name
        with dest.open('x'):
            pass
        dest.chmod(0o600)
        os.chown(dest, account.pw_uid, account.pw_gid)
    for name in p['inputs']:
        if name == 'runner.py':
            continue
        dest = ROOT / name
        shutil.copyfile(ROOT / 'inputs' / name, dest)
        dest.chmod(0o640)
        os.chown(dest, 0, account.pw_gid)
    shutil.copytree(Path(p['export_root']) / 'runtime', ROOT / 'runtime', symlinks=False)
    extract_source(p['source_tar'], ROOT / 'source', BUDGET - custody['bytes'] - 1024**3)
    pin(ROOT / 'source/site/package-lock.json', p['lock_sha256'])
    modules = ROOT / 'source/site/node_modules'
    if modules.exists() or modules.is_symlink():
        raise ValueError('Source node_modules must be absent')
    modules.symlink_to(Path(p['deps_root']) / 'node_modules', target_is_directory=True)
    temporary = ROOT / 'install-tmp'
    temporary.mkdir(mode=0o700)
    env = {'PATH': '/usr/bin:/bin', 'HOME': str(temporary), 'TMPDIR': str(temporary), 'TEMP': str(temporary), 'TMP': str(temporary), 'PYTHONDONTWRITEBYTECODE': '1', 'PIP_CONFIG_FILE': '/dev/null', 'PIP_DISABLE_PIP_VERSION_CHECK': '1'}
    run(['/usr/bin/python3.12', '-m', 'venv', ROOT / 'p'], env=env)
    run([ROOT / 'p/bin/python', '-m', 'pip', 'install', '--no-index', '--no-deps', '--require-hashes', '--no-cache-dir', '--find-links=' + str(ROOT / 'wheels'), '-r', ROOT / 'requirements.lock'], env=env)
    for name in ('runtime', 'source', 'p', 'inputs', 'wheels'):
        freeze_tree(ROOT / name)
    # Runner is readable only by the QA group; Python entrypoint needs no execute bit.
    (ROOT / 'runner.py').chmod(0o640)
    os.chown(ROOT / 'runner.py', 0, account.pw_gid)
    if tree_hash(ROOT / 'runtime') != custody['tree_sha256'] or verify_export(p) != custody:
        raise ValueError('Runtime custody changed during preparation')
    write_json(ROOT / 'custody-before.json', custody, True, True)
    write_json(ROOT / 'host-home-baseline.json', {**{x: home_stat(x) for x in HOME_PATHS}, 'network_inode': Path('/proc/self/ns/net').stat().st_ino}, True, True)
    write_json(ROOT / 'STATE.json', {'phase': 'prepared', 'unit': UNIT}, True)
    access_preflight(p)
    print(json.dumps({'prepared': True, 'started': False, 'runtime': custody}))


def unit_args(p):
    writable = ' '.join(str(ROOT / x) for x in DIRS + FILES)
    readonly = [ROOT, Path(p['deps_root']), Path(p['node_path']), Path(p['chromium_path']).parent, Path(p['export_root'])]
    props = {'Type': 'oneshot', 'RemainAfterExit': 'yes', 'User': 'civo', 'Group': 'civo', 'MemoryMax': '8G', 'CPUQuota': '400%', 'TasksMax': '256', 'TimeoutStartSec': '2700', 'RuntimeMaxSec': '2700', 'TimeoutStopSec': '30', 'KillMode': 'control-group', 'SendSIGKILL': 'yes', 'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict', 'ProtectHome': 'tmpfs', 'PrivateNetwork': 'yes', 'PrivateDevices': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '', 'RestrictSUIDSGID': 'yes', 'ProtectProc': 'invisible', 'UMask': '0077', 'ReadWritePaths': writable, 'ReadOnlyPaths': ' '.join(map(str, readonly)), 'InaccessiblePaths': '-/run/docker.sock -/var/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale', 'TemporaryFileSystem': '/tmp:ro /var/tmp:ro /home:ro /root:ro /run/user:ro', 'BindReadOnlyPaths': p['node_path'] + ':/usr/local/bin/node', 'StandardOutput': 'append:' + str(ROOT / 'logs/unit.log'), 'StandardError': 'append:' + str(ROOT / 'logs/unit.log')}
    return ['/usr/bin/systemd-run', '--unit=' + UNIT, '--no-block', '--working-directory=' + str(ROOT)] + ['--property=' + k + '=' + v for k, v in props.items()] + ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE=1', 'TMPDIR=' + str(ROOT / 't'), 'HOME=' + str(ROOT / 'e'), '/usr/bin/python3', '-B', str(ROOT / 'runner.py'), 'execute']


def start():
    p = policy()
    host_guard(p)
    validate_inputs(p)
    if json.loads((ROOT / 'STATE.json').read_text())['phase'] != 'prepared':
        raise ValueError('Attempt already submitted or unprepared')
    write_json(ROOT / 'STARTED.json', {'claimed': True, 'unit': UNIT}, True, True)
    if any((ROOT / 'logs' / x).exists() for x in ('QA-SUMMARY.json', 'supervisor.log')):
        raise ValueError('Prior execution evidence present')
    if verify_export(p) != json.loads((ROOT / 'custody-before.json').read_text()) or tree_hash(ROOT / 'runtime') != json.loads((ROOT / 'custody-before.json').read_text())['tree_sha256']:
        raise ValueError('Runtime custody changed before start')
    for name, value in p['inputs'].items():
        pin(ROOT / name, value['sha256'])
    access_preflight(p)
    write_json(ROOT / 'STATE.json', {'phase': 'submitting', 'unit': UNIT}, True)
    run(unit_args(p))
    write_json(ROOT / 'STATE.json', {'phase': 'submitted', 'unit': UNIT}, True)
    print(json.dumps({'submitted': True, 'unit': UNIT}))


def execute():
    p = policy()
    account = pwd.getpwnam('civo')
    if os.geteuid() != account.pw_uid or os.getegid() != account.pw_gid or account.pw_uid == 0:
        raise ValueError('Wrong namespace identity')
    baseline = json.loads((ROOT / 'host-home-baseline.json').read_text())
    masked_homes(baseline)
    # Aggregate every new writable path before starting PG, server or browser.
    errors = []
    for name in DIRS:
        directory = ROOT / name
        canary = directory / '.qa-write-preflight'
        try:
            with canary.open('x') as stream: stream.write('fictitious-preflight')
            canary.unlink()
        except OSError: errors.append('directory-write:' + name)
    for name in FILES:
        try:
            with (ROOT / name).open('ab') as stream: stream.write(b'')
        except OSError: errors.append('file-write:' + name)
    for name in ('runtime', 'source', 'p', 'inputs', 'wheels', 'runner.py', 'STATE.json', 'custody-before.json', 'host-home-baseline.json'):
        if os.access(ROOT / name, os.W_OK): errors.append('protected-write:' + name)
    security = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if security.get('NoNewPrivs', '').strip() != '1' or any(int(security.get(k, '1').strip(), 16) for k in ('CapEff', 'CapBnd', 'CapPrm')):
        errors.append('capabilities-or-no-new-privileges')
    interfaces = [line.split(':', 1)[0].strip() for line in Path('/proc/net/dev').read_text().splitlines()[2:] if ':' in line]
    if interfaces != ['lo']: errors.append('network-not-private-loopback')
    if run(['/usr/local/bin/node', '--version']) != 'v20.19.2': errors.append('node-version')
    if errors: raise ValueError('Namespace preflight failed: ' + ','.join(errors))
    if Path('/proc/self/ns/net').stat().st_ino == baseline['network_inode']:
        raise ValueError('Network namespace unchanged')
    for path in ('/run/tailscale', '/var/lib/tailscale', '/run/containerd'):
        if os.access(path, os.R_OK | os.X_OK):
            raise ValueError('Host control directory visible')
    for name in ('runtime', 'source', 'p', 'inputs', 'wheels'):
        if not os.statvfs(ROOT / name).f_flag & os.ST_RDONLY:
            raise ValueError('Protected tree writable: ' + name)
    for name in ('/run/docker.sock', '/var/run/docker.sock'):
        sock = socket.socket(socket.AF_UNIX)
        try:
            sock.connect(name)
        except OSError as error:
            if error.errno not in {errno.EACCES, errno.EPERM, errno.ENOENT}:
                raise ValueError('Unexpected Docker socket error') from error
        else:
            raise ValueError('Docker socket accessible')
        finally:
            sock.close()
    if tree_hash(ROOT / 'runtime') != json.loads((ROOT / 'custody-before.json').read_text())['tree_sha256']:
        raise ValueError('Runtime custody differs')
    write_json(ROOT / 'logs/namespace-preflight.json', {'passed': True, 'network': 'private', 'identity': 'civo'}, exclusive=True)
    os.execve('/usr/local/bin/node', ['/usr/local/bin/node', str(ROOT / 'qa-driver.mjs')], {'PATH': '/usr/bin:/bin', 'HOME': str(ROOT / 'e'), 'TMPDIR': str(ROOT / 't'), 'PYTHONDONTWRITEBYTECODE': '1'})


def state():
    fields = ('MainPID', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'ControlGroup', 'MemoryPeak', 'CPUUsageNSec')
    raw = run(['/usr/bin/systemctl', 'show', UNIT] + ['--property=' + k for k in fields])
    return {k: v for line in raw.splitlines() if '=' in line for k, v in [line.split('=', 1)] if k in fields}


def stop():
    host_guard(policy())
    run(['/usr/bin/systemctl', 'stop', UNIT])
    value = state()
    if value.get('MainPID') != '0' or value.get('ActiveState') not in ('inactive', 'failed'):
        raise ValueError('Unit remains active')
    cgroup = value.get('ControlGroup', '')
    if cgroup:
        if cgroup != '/system.slice/' + UNIT:
            raise ValueError('Unexpected cgroup')
        root = Path('/sys/fs/cgroup') / cgroup.lstrip('/')
        for item in [root / 'cgroup.procs', *root.glob('**/cgroup.procs')]:
            if item.exists() and item.read_text().strip():
                raise ValueError('Unit cgroup still has children')
    print(json.dumps({'stopped': True, 'MainPID': 0, 'unit': UNIT}))


def evidence():
    p = policy()
    value = {'unit': UNIT, 'systemd': state(), 'operationalReady': False}
    report = ROOT / 'logs/QA-SUMMARY.json'
    if report.exists():
        summary = json.loads(report.read_text())
        allowed = ('status', 'backend', 'backendSmoke', 'browser', 'maps', 'httpReset', 'refreshed', 'fictionalOnly', 'operationalReady')
        value['qa'] = {k: summary[k] for k in allowed if k in summary and isinstance(summary[k], (str, int, bool))}
    before = json.loads((ROOT / 'custody-before.json').read_text())
    value['custodyUnchanged'] = verify_export(p) == before and tree_hash(ROOT / 'runtime') == before['tree_sha256']
    print(json.dumps(value))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('setup', 'start', 'status', 'stop', 'evidence', 'execute'))
    args = parser.parse_args()
    if args.action == 'status':
        print(json.dumps({'unit': UNIT, **state()}))
    else:
        globals()[args.action]()
