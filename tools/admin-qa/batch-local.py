#!/usr/bin/env python3
"""Owned batch QA: fixed candidate, new fictitious DB54357 and HTTP3035 only."""
import argparse
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
assert Path.cwd().resolve() == root == Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-stage02-domains')
parser = argparse.ArgumentParser()
parser.add_argument('--contract', choices=['batch-input'], required=True)
args = parser.parse_args()
site = root / 'site'
for name in ['.env', '.env.local', '.env.production', '.env.production.local']:
    assert not (site / name).exists(), 'QA requires no environment files'
for port in [54357, 3035]:
    with socket.socket() as sock:
        assert sock.connect_ex(('127.0.0.1', port)) != 0, 'Owned QA port occupied'
scratch = Path(tempfile.mkdtemp(prefix='admin-batch-local-'))
empty = scratch / 'empty'
empty.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME', 'LANG', 'LC_ALL']}
env.update(NODE_ENV='production', TMPDIR=str(scratch), DEV_DB_PORT='54357', DEV_DB_DIR=str(scratch / 'postgres'),
           DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54357/peticao', MAIL_PROVIDER='dev', MAIL_PROVIDERS='dev',
           PREVIEW_MODE='1', ADMIN_NO_PASSWORD='0', HASH_PEPPER='QA-BATCH-ONLY-FICTITIOUS-PEPPER-0123456789',
           DATA_ENCRYPTION_KEY='QA-BATCH-FICTITIOUS-KEY', CPF_CACHE_ENCRYPTION_KEY='QA-BATCH-FICTITIOUS-CACHE',
           SECRETS_DIR=str(empty), PETICAO_CONFIG_DIR=str(empty), CREDENTIALS_DIRECTORY=str(empty), MAIL_ARCHIVE_RETENTION='30',
           QA_BASE_URL='http://127.0.0.1:3035', QA_OUTPUT_DIR=str(scratch), MAIL_OUTBOX_DIR=str(scratch / 'outbox'))
assert len(env['HASH_PEPPER']) >= 32
runtime = Path('/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin')
assert (runtime / 'node').is_file()
env['PATH'] = str(runtime) + os.pathsep + env.get('PATH', '')
command = ['node', 'scripts/with-db.mjs', 'node', '../tools/admin-qa/batch-local-contract.mjs', args.contract]
sources = ['src/lib/batch-http-input.ts', 'src/app/api/admin/lotes/[id]/aprovar/route.ts', 'src/app/api/admin/lotes/[id]/assinado/route.ts', 'src/app/api/admin/lotes/[id]/codigo/route.ts', 'src/app/api/admin/lotes/[id]/cancelar/route.ts', 'src/app/api/admin/lotes/criar/route.ts']
fingerprints = lambda: {name: hashlib.sha256((site / name).read_bytes()).hexdigest() for name in sources}
before = fingerprints()
(scratch / 'sources.txt').write_text('\n'.join(f'{value}  {name}' for name, value in before.items()) + '\n')
print(f'Fictitious owned QA evidence: {scratch}', flush=True)
with (scratch / 'validation.log').open('w') as log:
    result = subprocess.run(command, cwd=site, env=env, stdout=log, stderr=subprocess.STDOUT)
assert fingerprints() == before, 'Relevant source changed during QA; result is not a stable checkpoint'
print(f'QA exit: {result.returncode}; log: {scratch / "validation.log"}', flush=True)
raise SystemExit(result.returncode)
