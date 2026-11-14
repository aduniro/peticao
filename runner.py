"""One frozen Civo build attempt. No production endpoints or host credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tarfile

ROOT = Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt1')
UNIT = 'peticao-civo-qualified-build-20261114-attempt1.service'
OLD = '/opt/peticao-qa/admin-query-r1-20261114-retry1'
OLD_CACHE = '/srv/peticao/ncpf-build-20261113/snapshot-a/site'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def safe_members(archive, dependencies=False):
    for member in archive:
        p = Path(member.name)
        if p.is_absolute() or '..' in p.parts or member.isdev() or member.isfifo():
            raise ValueError('Unsafe archive member')
        if dependencies:
            if p.parts[0] != 'node_modules' and member.name not in {'node', 'package-lock.json', 'package.tgz'}:
                raise ValueError('Unexpected dependency member')
        elif member.issym() or member.islnk():
            raise ValueError('Source links are not delegated')
        yield member


def chown_tree(path, uid, gid):
    for directory, dirs, files in os.walk(path, followlinks=False):
        os.chown(directory, uid, gid)
        for name in dirs + files:
            os.chown(Path(directory) / name, uid, gid, follow_symlinks=False)


def journal(phase, **values):
    p = ROOT / 'STATE.json'
    p.write_text(json.dumps(dict(phase=phase, unit=UNIT, **values), indent=2) + '\n')
    p.chmod(0o600)


def validate_inputs(policy):
    if os.geteuid() != 0 or ROOT.is_symlink() or ROOT.resolve() != ROOT:
        raise ValueError('Unexpected execution root')
    status = json.loads(run(['tailscale', 'status', '--json']))
    if status.get('BackendState') != 'Running' or '100.122.224.82' not in status['Self']['TailscaleIPs']:
        raise ValueError('Wrong Civo node')
    if run(['uname', '-m']) != 'x86_64':
        raise ValueError('Unqualified architecture')
    for name, item in policy['inputs'].items():
        p = ROOT / 'inputs' / name
        if Path(name).name != name or p.is_symlink() or digest(p) != item['sha256']:
            raise ValueError('Frozen input drift')


def prepare(policy):
    validate_inputs(policy)
    if (ROOT / 'STATE.json').exists():
        raise ValueError('Attempt already exists; reconcile, never reset')
    if shutil.disk_usage(ROOT).free < 32 * 1024**3:
        raise ValueError('Insufficient disk for approved 30GiB budget')
    journal('preparing')
    account = pwd.getpwnam('civo')
    os.chown(ROOT, 0, account.pw_gid)
    ROOT.chmod(0o750)
    inputs = ROOT / 'inputs'
    os.chown(inputs, 0, account.pw_gid)
    inputs.chmod(0o750)
    for p in inputs.iterdir():
        os.chown(p, 0, account.pw_gid)
        p.chmod(0o640)
    deps = ROOT / 'deps/site'
    deps.mkdir(parents=True, mode=0o755)
    deps.parent.chmod(0o755)
    with tarfile.open(inputs / 'dependencies.tar.gz', 'r:gz') as archive:
        archive.extractall(deps, members=safe_members(archive, True), filter='data')
    for directory, dirs, files in os.walk(deps, followlinks=False):
        Path(directory).chmod(0o755)
        for name in dirs + files:
            p = Path(directory) / name
            if p.is_symlink():
                if not p.resolve().is_relative_to(deps):
                    raise ValueError('Dependency link escape')
            elif p.is_file():
                p.chmod(0o755 if p.stat().st_mode & 0o111 else 0o644)
    if digest(deps / 'package-lock.json') != policy['lock_sha256'] or digest(deps / 'node') != policy['node_sha256']:
        raise ValueError('Dependency inventory changed')
    tools = ROOT / 'tools'
    tools.mkdir(mode=0o755)
    tools.chmod(0o755)
    shutil.copyfile(deps / 'node', tools / 'node20')
    (tools / 'node20').chmod(0o755)
    if run([str(tools / 'node20'), '--version']) != 'v20.19.2':
        raise ValueError('Wrong application Node version')
    snapshot = ROOT / 'snapshot'
    snapshot.mkdir(mode=0o750)
    with tarfile.open(inputs / 'source.tar.gz', 'r:gz') as archive:
        archive.extractall(snapshot, members=safe_members(archive), filter='data')
    if digest(snapshot / 'site/package-lock.json') != policy['lock_sha256']:
        raise ValueError('Canonical application lock changed')
    (snapshot / 'site/node_modules').symlink_to(deps / 'node_modules', target_is_directory=True)
    profile = ROOT / 'profile'
    run_dir = profile / 'runs/build-1'
    empty = run_dir / 'empty'
    cache = empty / '.cache/peticao/pdfjs-dist/6.5.438'
    cache.mkdir(parents=True, mode=0o700)
    (run_dir / 'tmp').mkdir(mode=0o700)
    shutil.copyfile(deps / 'package.tgz', cache / 'package.tgz')
    for directory, _, _ in os.walk(profile):
        Path(directory).chmod(0o700)
    for source, destination in [('guard.mjs', 'guard.mjs'), ('qualified-build.mjs', 'qualified-build.mjs'), ('export.py', 'export.py')]:
        raw = (inputs / source).read_text()
        raw = raw.replace(OLD_CACHE, str(deps)).replace(OLD, str(ROOT))
        if destination == 'export.py':
            raw = raw.replace(str(ROOT) + '/source-r1.tar.gz', str(ROOT) + '/inputs/source.tar.gz')
        (tools / destination).write_text(raw)
        (tools / destination).chmod(0o644)
    for path in [snapshot, profile]:
        chown_tree(path, account.pw_uid, account.pw_gid)
    for name in ['export', 'unit-tmp']:
        p = ROOT / name
        p.mkdir(mode=0o700)
        os.chown(p, account.pw_uid, account.pw_gid)
    entry = tools / 'build.sh'
    entry.write_text(build_entry())
    entry.chmod(0o755)
    journal('prepared', node='20.19.2', source=policy['source_commit'], host_credentials_mounted=False)
    print(json.dumps(dict(prepared=True, node='20.19.2', workload_started=False)))


def build_entry():
    return '''#!/bin/bash
set -euo pipefail
umask 077
base=ROOT_VALUE
run="$base/profile/runs/build-1"
cd "$base/snapshot/site"
test "$(/usr/local/bin/node --version)" = v20.19.2
test ! -e /home/civo/.ssh/id_ed25519_peticao_civo_node
test ! -S /run/docker.sock
/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR="$run/tmp" /usr/local/bin/node scripts/prepare-pdfjs-assets.mjs --offline --cache-dir "$run/empty/.cache/peticao/pdfjs-dist/6.5.438"
find src public assets -type f -print0 | sort -z | xargs -0 sha256sum > "$run/source-before.sha256"
/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production MAIL_PROVIDER=dev MAIL_PROVIDERS=dev DATABASE_URL=postgres://build_only:build_only@127.0.0.1:1/build_only APP_URL=https://fixture.invalid ADMIN_URL=https://admin.fixture.invalid HASH_PEPPER=BUILD_ONLY_PEPPER_NOT_PRODUCTION_0123456789 ADMIN_PASSWORD=BuildOnly-NotAProductionPassword WHATSAPP_ENABLED=0 CRON_SECRET= SECRETS_DIR="$run/empty" PETICAO_CONFIG_DIR="$run/empty" CREDENTIALS_DIRECTORY="$run/empty" GEO_DIR="$run/empty" ADMIN_PASSWORD_FILE="$run/empty/admin-password-never-present.hash" TMPDIR="$run/tmp" TMP="$run/tmp" TEMP="$run/tmp" PRODUCTION_PROFILE_ROOT="$base/profile" PRODUCTION_PROFILE_RUN="$run" NODE_OPTIONS="--import=$base/tools/guard.mjs --max-old-space-size=3072" NEXT_BUILD_CPUS=2 NEXT_TELEMETRY_DISABLED=1 DB_BOOTSTRAP_MODE=verify DB_SCHEMA_SHA256=0000000000000000000000000000000000000000000000000000000000000000 npm_config_update_notifier=false /usr/local/bin/node "$base/tools/qualified-build.mjs"
find src public assets -type f -print0 | sort -z | xargs -0 sha256sum > "$run/source-after.sha256"
cmp "$run/source-before.sha256" "$run/source-after.sha256"
/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR="$run/tmp" /usr/bin/python3 "$base/tools/export.py" export --out "$base/export" > "$base/export/export-result.json"
echo CIVO_CANONICAL_BUILD_AND_EXPORT_PASS
'''.replace('ROOT_VALUE', str(ROOT))


def start_build(policy):
    validate_inputs(policy)
    state = json.loads((ROOT / 'STATE.json').read_text())
    if state['phase'] != 'prepared':
        raise ValueError('Build already submitted or not prepared')
    journal('build-submitting')
    args = ['systemd-run', '--unit=' + UNIT, '--no-block', '--property=Type=oneshot',
            '--property=RemainAfterExit=yes', '--property=User=civo', '--property=Group=civo',
            '--property=MemoryMax=8G', '--property=CPUQuota=400%', '--property=TasksMax=256',
            '--property=TimeoutStartSec=1800', '--property=NoNewPrivileges=yes',
            '--property=ProtectSystem=strict', '--property=ProtectHome=tmpfs',
            '--property=PrivateNetwork=yes', '--property=PrivateDevices=yes',
            '--property=CapabilityBoundingSet=', '--property=RestrictSUIDSGID=yes',
            '--property=ProtectProc=invisible', '--property=ReadWritePaths=' + str(ROOT),
            '--property=ReadOnlyPaths=' + ' '.join(str(ROOT / x) for x in ['deps', 'tools', 'inputs']),
            '--property=InaccessiblePaths=-/run/docker.sock -/run/containerd -/var/lib/tailscale -/run/tailscale',
            '--property=BindReadOnlyPaths=' + str(ROOT / 'tools/node20') + ':/usr/local/bin/node',
            '--property=TemporaryFileSystem=/tmp:ro /var/tmp:ro',
            '--property=StandardOutput=append:' + str(ROOT / 'build.log'),
            '--property=StandardError=append:' + str(ROOT / 'build.log'),
            '--working-directory=' + str(ROOT / 'snapshot/site'),
            '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
            'TMPDIR=' + str(ROOT / 'unit-tmp'), '/bin/bash', str(ROOT / 'tools/build.sh')]
    run(args)
    journal('build-submitted')
    print(json.dumps(dict(submitted=True, unit=UNIT, public_listeners=False, network='private-loopback-only')))


def status():
    fields = ['ActiveState', 'SubState', 'Result', 'MainPID', 'ExecMainStatus', 'MemoryPeak', 'CPUUsageNSec']
    raw = run(['systemctl', 'show', UNIT] + ['--property=' + x for x in fields])
    result = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
    result['compiled_build_present'] = (ROOT / 'snapshot/site/.next/BUILD_ID').is_file()
    result['export_report_present'] = (ROOT / 'export/export-report.json').is_file()
    print(json.dumps(result))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'build', 'status'])
    args = parser.parse_args()
    try:
        policy = json.loads((ROOT / 'inputs/policy.json').read_text())
        if args.phase == 'prepare': prepare(policy)
        elif args.phase == 'build': start_build(policy)
        else: status()
    except Exception as error:
        print(json.dumps({'failed': type(error).__name__, 'detail': str(error)[:150]}))
        raise SystemExit(1)
