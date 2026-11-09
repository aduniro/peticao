#!/usr/bin/env python3
"""Owned contact-triage QA, closed local worktree and fictitious configuration only."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
assert root == Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-contact-triage-qa-20261109')
assert Path.cwd().resolve() == root
site = root / 'site'
for name in ['.env', '.env.local', '.env.production', '.env.production.local']:
    assert not (site / name).exists()
assert not list((site / 'src/lib').glob('rich-text*.ts'))
assert (site / 'node_modules').resolve() == Path('/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['build', 'types', 'http', 'tests'])
args = parser.parse_args()
owned = root / '.cache/contact-triage-qa'
owned.mkdir(parents=True, exist_ok=True)
lock = (owned / 'run.lock').open('w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
for port in [3043, 54363]:
    with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1', port)) != 0
scratch = Path(tempfile.mkdtemp(prefix='admin-triage-isolated-'));scratch.chmod(0o700)
(scratch / 'empty').mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if k in ['HOME', 'PATH', 'LANG', 'LC_ALL']}
env.update(NODE_ENV='production', NODE_OPTIONS='--max-old-space-size=1536', CIRCLE_NODE_TOTAL='1',
           DEV_DB_PORT='54363', DEV_DB_DIR=str(scratch / 'postgres'),
           DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54363/peticao',
           MAIL_PROVIDER='dev', MAIL_PROVIDERS='dev', PREVIEW_MODE='1', ADMIN_NO_PASSWORD='0',
           HASH_PEPPER='QA-TRIAGE-PEPPER-0123456789-FICTITIOUS',
           DATA_ENCRYPTION_KEY='QA-TRIAGE-KEY-NOT-PRODUCTION', CPF_CACHE_ENCRYPTION_KEY='QA-TRIAGE-CACHE-NOT-PRODUCTION',
           SECRETS_DIR=str(scratch / 'empty'), PETICAO_CONFIG_DIR=str(scratch / 'empty'), CREDENTIALS_DIRECTORY=str(scratch / 'empty'),
           MAIL_OUTBOX_DIR=str(scratch / 'outbox'), MAIL_ARCHIVE_RETENTION='30', SIGNER='none', BATCH_SIZE='10',
           TMPDIR=str(scratch), QA_BASE_URL='http://127.0.0.1:3043', QA_OUTPUT_DIR=str(scratch),
           QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
           QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome')
if args.mode == 'build': command = ['npm', 'run', 'build']
elif args.mode == 'types': command = ['npm', 'run', 'typecheck']
elif args.mode == 'tests':
    env['NODE_ENV'] = 'test'
    for key in ['MAIL_PROVIDERS', 'PREVIEW_MODE', 'ADMIN_NO_PASSWORD', 'MAIL_ARCHIVE_RETENTION']:
        env.pop(key, None)
    command = ['node', 'scripts/with-db.mjs', 'node', '--import', 'tsx', '--test', '--test-concurrency=1', 'src/lib/contact-triage-display.test.ts', 'src/lib/contact-triage.test.ts']
else:
    assert (site / '.next/BUILD_ID').is_file()
    runtime = Path('/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin')
    assert (runtime / 'node').is_file();env['PATH'] = str(runtime) + os.pathsep + env.get('PATH', '')
    command = ['node', 'scripts/with-db.mjs', 'node', '../tools/admin-qa/triage-local.mjs']
files = subprocess.check_output(['git', 'ls-files', '-z', 'site'], cwd=root).decode().split('\0')
def sources(): return {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files if p}
before = sources()
(scratch / 'source-before.json').write_text(json.dumps(before, indent=2) + '\n')
info = {'mode': args.mode, 'cwd': str(root), 'command': command, 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'fictitious': True, 'ports': [3043, 54363]}
(scratch / 'execution.json').write_text(json.dumps(info, indent=2) + '\n')
(owned / 'current.json').write_text(json.dumps({'scratch': str(scratch), 'mode': args.mode}, indent=2) + '\n')
print('Owned triage QA:', scratch, flush=True)
with (scratch / 'validation.log').open('w') as log:
    result = subprocess.run(command, cwd=site, env=env, stdout=log, stderr=subprocess.STDOUT)
after = sources();(scratch / 'source-after.json').write_text(json.dumps(after, indent=2) + '\n')
info.update(exit_code=result.returncode, source_same=before == after)
(scratch / 'execution.json').write_text(json.dumps(info, indent=2) + '\n')
print('Exit:', result.returncode, 'source_same:', info['source_same'], 'Log:', scratch / 'validation.log', flush=True)
print('\n'.join((scratch / 'validation.log').read_text(errors='replace').splitlines()[-25:]), flush=True)
raise SystemExit(result.returncode or (0 if info['source_same'] else 1))
