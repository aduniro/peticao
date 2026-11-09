#!/usr/bin/env python3
"""Inbox UI only: fixed local ports, clean config and an owned fictitious database."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
assert root == Path('/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109')
assert Path.cwd().resolve() == root
site = root / 'site'
for name in ['.env', '.env.local', '.env.production', '.env.production.local']:
    assert not (site / name).exists(), 'No environment files allowed'
assert not list((site / 'src/lib').glob('rich-text*.ts')), 'Interrupted rich-text work is outside this QA'
assert (site / 'node_modules').resolve() == Path('/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['build','http'])
args = parser.parse_args()
owned = root / '.cache/qa-inbox-ui-20261109/http'
owned.mkdir(parents=True, exist_ok=True)
lock = (owned / 'run.lock').open('w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
for port in [3036, 54356]:
    with socket.socket() as sock:
        assert sock.connect_ex(('127.0.0.1', port)) != 0, 'QA port already owned by another process'
scratch = Path(tempfile.mkdtemp(prefix='admin-inbox-ui-http-'))
scratch.chmod(0o700)
(scratch / 'empty').mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if k in ['HOME', 'PATH', 'LANG', 'LC_ALL']}
env.update(NODE_ENV='production', NODE_OPTIONS='--max-old-space-size=1024',
           DEV_DB_PORT='54356', DEV_DB_DIR=str(scratch / 'postgres'),
           DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54356/peticao',
           MAIL_PROVIDER='dev', MAIL_PROVIDERS='dev', PREVIEW_MODE='1', ADMIN_NO_PASSWORD='0',
           HASH_PEPPER='QA-CENTRAL-VISUAL-PEPPER-0123456789-FICTITIOUS',
           DATA_ENCRYPTION_KEY='QA-CENTRAL-VISUAL-KEY-NOT-PRODUCTION',
           CPF_CACHE_ENCRYPTION_KEY='QA-CENTRAL-VISUAL-CACHE-NOT-PRODUCTION',
           SECRETS_DIR=str(scratch / 'empty'), PETICAO_CONFIG_DIR=str(scratch / 'empty'),
           CREDENTIALS_DIRECTORY=str(scratch / 'empty'), MAIL_OUTBOX_DIR=str(scratch / 'outbox'),
           PUBLICAR_ESTADO_DIR=str(scratch / 'empty'), MAIL_ARCHIVE_RETENTION='30', TMPDIR=str(scratch), QA_BASE_URL='http://127.0.0.1:3036',
           QA_OUTPUT_DIR=str(scratch),
           QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
           QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome')
if args.mode == 'build':
    env.update(CIRCLE_NODE_TOTAL='1', NEXT_TELEMETRY_DISABLED='1', NODE_OPTIONS='--max-old-space-size=1536')
    command=['node','node_modules/next/dist/bin/next','build']
else:
    assert (site / '.next/BUILD_ID').is_file(), 'A closed compiled artifact is required'
    browser_node = Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin')
    assert (browser_node / 'node').is_file()
    env['PATH'] = str(browser_node) + os.pathsep + '/usr/bin:/bin'
    command = ['node', 'scripts/with-db.mjs', 'node', '../tools/admin-qa/inbox-ui-local.mjs']
env['PATH']='/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin:/usr/bin:/bin'
import hashlib
def manifest():
    names=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
    return {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names if name and (root/name).is_file()}
before=manifest()
info = {'mode': args.mode, 'cwd': str(root), 'ports': [3036, 54356], 'fictitious': True,
        'command': command, 'rich_text_executed': False, 'read_only_browser': True}
(scratch / 'execution.json').write_text(json.dumps(info, indent=2) + '\n')
(owned / 'current.json').write_text(json.dumps({'scratch': str(scratch), 'mode': args.mode}, indent=2) + '\n')
print('Fictitious local inbox UI QA:', scratch, flush=True)
with (scratch / 'validation.log').open('w') as log:
    result = subprocess.run(command, cwd=site, env=env, stdout=log, stderr=subprocess.STDOUT)
info['exit_code'] = result.returncode
info['source_same']=before==manifest()
info['source_sha256']=before
assert info['source_same'],'Sources changed during QA'
(scratch / 'execution.json').write_text(json.dumps(info, indent=2) + '\n')
print('Exit:', result.returncode, 'Log:', scratch / 'validation.log', flush=True)
print('\n'.join((scratch / 'validation.log').read_text(errors='replace').splitlines()[-25:]), flush=True)
raise SystemExit(result.returncode)
