#!/usr/bin/env python3
"""Freeze and verify an accepted local commit; no remote or implicit test selection."""
import argparse
import fcntl
import signal
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time

CHECKOUT_PARENT = Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration')
DEPENDENCIES = Path('/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
DB_PORT = 54364
HTTP_PORT = 3044
BLOCKED = 'rich-text'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)

def validate_name(checkout, commit):
    assert re.fullmatch('[a-f0-9]{40}', commit), 'Require full accepted commit hash'
    assert checkout.parent == CHECKOUT_PARENT and re.fullmatch('candidate-cumulative-[a-z0-9-]+', checkout.name), 'Only a new dedicated cumulative checkout'
    assert not checkout.is_symlink(), 'Checkout cannot redirect to another worktree'

def tracked_manifest(checkout):
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=checkout).decode().split('\0')
    assert paths and any(path.startswith('site/src/') for path in paths)
    return {p: digest(checkout / p) for p in paths if p and (checkout / p).is_file()}

def validate_runtime(checkout):
    site = checkout / 'site'
    assert not list(site.glob('.env*')), 'No environment files, even ignored files'
    for name in ['secrets', 'preview-state']:
        assert not (checkout / name).exists() and not (site / name).exists(), 'No private runtime directories'
    assert (site / 'node_modules').is_symlink() and (site / 'node_modules').resolve() == DEPENDENCIES
    assert not list((site / 'src').rglob('*rich-text*')), 'Interrupted rich WIP is outside this snapshot validation'
    for path in (site / 'src').rglob('*.test.ts'):
        assert not path.is_symlink() and BLOCKED not in path.read_text(), 'Do not run the interrupted rich test or import it indirectly'

def dependency_manifest(checkout):
    lock = json.loads((checkout / 'site/package-lock.json').read_text())
    installed, absent = {}, []
    for name, expected in lock['packages'].items():
        if not name.startswith('node_modules/'): continue
        file = DEPENDENCIES.parent / name / 'package.json'
        if not file.is_file():
            assert expected.get('optional'), 'Required dependency missing: ' + name
            absent.append(name); continue
        metadata = json.loads(file.read_text())
        assert metadata['version'] == expected['version'], 'Installed dependency mismatch: ' + name
        installed[name] = {'version': metadata['version'], 'sha256': digest(file)}
    return {'installed': installed, 'optionalAbsent': absent}

def snapshot(checkout, commit):
    validate_name(checkout, commit)
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
    assert actual == commit, 'HEAD differs from accepted frozen commit'
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=checkout), 'Tracked source is dirty'
    validate_runtime(checkout)
    source = tracked_manifest(checkout)
    tests = sorted(p for p in source if p.startswith(('site/src/lib/', 'site/src/i18n/')) and p.endswith('.test.ts') and '/' not in p.removeprefix('site/src/lib/').removeprefix('site/src/i18n/'))
    assert tests and all(BLOCKED not in p for p in tests)
    return {'commit': commit, 'checkout': str(checkout), 'source': source, 'tests': tests, 'testFiles': len(tests), 'dependencies': str(DEPENDENCIES), 'dependencyManifest': dependency_manifest(checkout), 'ports': {'http': HTTP_PORT, 'database': DB_PORT}, 'scope': 'incremental accepted snapshot; not complete admin certification', 'runnerSha256': digest(Path(__file__).resolve())}

def command_for(phase, plan):
    if phase == 'tests':
        return ['node', 'scripts/with-db.mjs', 'node', '--import', 'tsx', '--test', '--test-concurrency=1', *[str(Path(p).relative_to('site')) for p in plan['tests']]]
    if phase == 'schema':
        return ['node', 'scripts/with-db.mjs', 'node', '--import', 'tsx', '../deploy/test/admin-schema-upgrade.mjs']
    return ['npm', 'run', {'build': 'build', 'types': 'typecheck'}[phase]]

def clean_env(scratch, phase):
    empty = scratch / 'empty'; empty.mkdir(mode=0o700)
    env = {k: v for k, v in os.environ.items() if k in ['HOME', 'PATH', 'LANG', 'LC_ALL']}
    env.update(NODE_ENV='test' if phase in ['tests', 'schema'] else 'production', NODE_OPTIONS='--max-old-space-size=1536', CIRCLE_NODE_TOTAL='1', TMPDIR=str(scratch), DEV_DB_PORT=str(DB_PORT), DEV_DB_DIR=str(scratch / 'postgres'), DATABASE_URL=f'postgres://peticao:peticao@127.0.0.1:{DB_PORT}/peticao', MAIL_PROVIDER='dev', HASH_PEPPER='QA-CUMULATIVE-ONLY-FICTITIOUS-PEPPER-0123456789', DATA_ENCRYPTION_KEY='QA-CUMULATIVE-NOT-PRODUCTION', CPF_CACHE_ENCRYPTION_KEY='QA-CUMULATIVE-CACHE-NOT-PRODUCTION', SECRETS_DIR=str(empty), PETICAO_CONFIG_DIR=str(empty), CREDENTIALS_DIRECTORY=str(empty), MAIL_OUTBOX_DIR=str(scratch / 'outbox'), SIGNER='none')
    return env

def execute(phase, plan, output):
    checkout = Path(plan['checkout'])
    assert snapshot(checkout, plan['commit']) == plan, 'Frozen plan/source/runner changed; prepare a new accepted plan'
    for port in [DB_PORT, HTTP_PORT]:
        with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1', port)) != 0, 'Dedicated QA port is occupied'
    scratch = Path(tempfile.mkdtemp(prefix='admin-accepted-cumulative-')); scratch.chmod(0o700)
    env = clean_env(scratch, phase); command = command_for(phase, plan)
    before = tracked_manifest(checkout); write_json(scratch / 'source-before.json', before)
    info = {'phase': phase, 'commit': plan['commit'], 'checkout': str(checkout), 'command': command, 'started': time.time(), 'status': 'running', 'runnerPid': os.getpid(), 'log': str(scratch / 'validation.log'), 'scratch': str(scratch)}
    write_json(output / f'{phase}.json', info)
    print(json.dumps(info), flush=True)
    try:
        with (scratch / 'validation.log').open('w') as log:
            child = subprocess.Popen(command, cwd=checkout / 'site', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            info['childPid'] = child.pid; write_json(output / f'{phase}.json', info)
            code = child.wait()
        info.update(exitCode=code, status='passed' if code == 0 else 'failed')
    except BaseException:
        info['status'] = 'interrupted'
        if 'child' in locals() and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait()
        raise
    finally:
        after = tracked_manifest(checkout); write_json(scratch / 'source-after.json', after)
        info.update(finished=time.time(), sourceSame=before == after)
        if before != after: info['status'] = 'failed'
        info['logSha256'] = digest(scratch / 'validation.log')
        write_json(output / f'{phase}.json', info)
        write_json(scratch / 'execution.json', info)
        write_json(output / f"{phase}-{scratch.name}.json", info)
        print(json.dumps(info), flush=True)
    assert info['status'] == 'passed', 'Phase failed; retain evidence and do not silently repeat it'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'tests', 'schema', 'build', 'types'])
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--execute', action='store_true', help='Explicitly run exactly the frozen phase; absent means preparation only')
    args = parser.parse_args()
    checkout = args.checkout.absolute(); plan = snapshot(checkout, args.commit)
    output = checkout / '.cache/accepted-cumulative'; output.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = output / 'plan.json'
    if args.phase == 'prepare':
        assert not args.execute
        if target.exists(): assert json.loads(target.read_text()) == plan, 'Do not overwrite a different frozen plan'
        write_json(target, plan); print(json.dumps({'plan': str(target), 'commit': plan['commit'], 'testFiles': plan['testFiles']})); return
    assert args.execute, 'No execution without explicit --execute phase'
    assert target.is_file() and json.loads(target.read_text()) == plan, 'Prepare and verify a fixed plan first'
    with (output / 'run.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        execute(args.phase, plan, output)

if __name__ == '__main__': main()
