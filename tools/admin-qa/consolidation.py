#!/usr/bin/env python3
"""Run compiled local contracts with empty configuration and a new fictitious DB."""
import os
import argparse
from pathlib import Path
import socket
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--tests', action='store_true')
parser.add_argument('--contact-tests', action='store_true')
parser.add_argument('--mail-tests', action='store_true')
parser.add_argument('--ai-tests', action='store_true')
parser.add_argument('--document-tests', action='store_true')
parser.add_argument('--contracts', nargs='+', choices=['referrals', 'referrals-browser', 'content-retention', 'whatsapp-senders', 'contact-history', 'mail-recovery', 'mail-preview', 'ai-executor', 'batch-control', 'batch-reservation', 'batch-reconciliation'])
args = parser.parse_args()
assert Path.cwd().resolve() == root
assert root.parent == Path('/mnt/dev/peticao/.cache/admin-integration')
assert root.name == 'candidate-stage02-domains'
site = root / 'site'
for name in ['.env', '.env.local', '.env.production', '.env.production.local']:
    assert not (site / name).exists(), 'QA requires no environment files'
for port in [3033, 54349]:
    with socket.socket() as sock:
        assert sock.connect_ex(('127.0.0.1', port)) != 0, 'QA port occupied'
scratch = Path(tempfile.mkdtemp(prefix='admin-consolidation-'))
empty = scratch / 'empty'
empty.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME', 'LANG', 'LC_ALL']}
env.update(NODE_ENV='production', TMPDIR=str(scratch), DEV_DB_PORT='54349',
           DEV_DB_DIR=str(scratch / 'postgres'),
           DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54349/peticao',
           MAIL_PROVIDER='dev', MAIL_PROVIDERS='dev', PREVIEW_MODE='1',
           ADMIN_NO_PASSWORD='0', HASH_PEPPER='QA-ONLY-SUPERVISED-PEPPER-0123456789-FICTITIOUS',
           DATA_ENCRYPTION_KEY='QA-SENDERS-KEY-NOT-PRODUCTION',
           CPF_CACHE_ENCRYPTION_KEY='QA-ONLY-SUPERVISED-CACHE-KEY',
           SECRETS_DIR=str(empty), PETICAO_CONFIG_DIR=str(empty),
           CREDENTIALS_DIRECTORY=str(empty), MAIL_ARCHIVE_RETENTION='30',
           CRON_SECRET='QA-CONSOLIDATION-CRON', QA_CRON_SECRET='QA-CONSOLIDATION-CRON',
           QA_BASE_URL='http://127.0.0.1:3033', QA_OUTPUT_DIR=str(scratch),
           QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
           QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome')
assert len(env['HASH_PEPPER']) >= 32
env['MAIL_OUTBOX_DIR'] = str(scratch / 'outbox')
print(f'Fictitious QA evidence: {scratch}', flush=True)
if args.tests or args.contact_tests or args.mail_tests or args.ai_tests or args.document_tests:
    # Preview changes production guards; fixed provider lists override tests' fake adapters.
    # These flags belong to HTTP preview, not to the cumulative test process.
    for key in ['PREVIEW_MODE', 'ADMIN_NO_PASSWORD', 'MAIL_PROVIDERS', 'MAIL_ARCHIVE_RETENTION']:
        env.pop(key, None)
    env['NODE_ENV'] = 'test'
    files = sorted(str(p) for folder in ['src/lib', 'src/i18n'] for p in (site / folder).glob('*.test.ts'))
    if args.contact_tests:
        files = [str(site / 'src/lib' / name) for name in ['contact-history.test.ts', 'contact-campus-review.test.ts', 'contact-replies.test.ts', 'contact-draft-codec.test.ts', 'contact-suggestion.test.ts']]
    if args.mail_tests:
        files = [str(site / 'src/lib' / name) for name in ['mail-recovery.test.ts', 'mail-preview.test.ts', 'mail-archive.test.ts', 'mail-history.test.ts', 'mail-rollback.test.ts', 'admin-content-retention.test.ts']]
    if args.ai_tests:
        files = [str(site / 'src/lib' / name) for name in ['knowledge.test.ts', 'ai-context.test.ts', 'ai-executor.test.ts', 'contact-campus-review.test.ts']]
    if args.document_tests:
        files = [str(site / 'src/lib' / name) for name in ['batch-creation-actor.test.ts', 'batch-sending-control.test.ts', 'batch-mutation-atomicity.test.ts', 'batch-document-reservation.test.ts', 'batch-rejection-recovery.test.ts', 'batch-snapshot-reservation.test.ts', 'signed-pdf.test.ts', 'batches.test.ts', 'batches-foreign.test.ts']]
    command = ['node', 'scripts/with-db.mjs', 'node', '--import', 'tsx', '--test', '--test-concurrency=1', *files]
else:
    # Use the runtime paired with the selected Playwright (requires Node >=20).
    browser_node = Path('/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin')
    assert (browser_node / 'node').is_file()
    env['PATH'] = str(browser_node) + os.pathsep + env.get('PATH', '')
    command = ['node', 'scripts/with-db.mjs', 'node', '../tools/admin-qa/consolidation.mjs', *(args.contracts or [])]
with (scratch / 'validation.log').open('w') as log:
    result = subprocess.run(command, cwd=site, env=env, stdout=log, stderr=subprocess.STDOUT)
print(f'QA exit: {result.returncode}; log: {scratch / "validation.log"}', flush=True)
raise SystemExit(result.returncode)
