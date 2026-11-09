from pathlib import Path
import os,socket,tempfile,subprocess,json,sys,datetime,hashlib
r=Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-inbound-mail-20261109');site=r/'site'
assert sys.argv[1:] in [['inbound-unit'],['inbound-types'],['inbound-schema']]
assert not any((site/x).exists() for x in ['.env','.env.local','.env.production','.env.production.local'])
for port in [3045,54361]:
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Do not assume another QA process'
p=Path(tempfile.mkdtemp(prefix='admin-mail-history-'));p.chmod(0o700);(p/'empty').mkdir(mode=0o700)
e={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL']}
e.update(NODE_ENV='production',NODE_OPTIONS='--max-old-space-size=1536',DEV_DB_PORT='54361',DEV_DB_DIR=str(p/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54361/peticao',DATABASE_SCHEMA='qa_user_outcomes',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',PREVIEW_MODE='1',ADMIN_NO_PASSWORD='0',HASH_PEPPER='QA-ONLY-HISTORY-PEPPER-FICTITIOUS-0123456789',DATA_ENCRYPTION_KEY='QA-ONLY-HISTORY-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-ONLY-HISTORY-CACHE',MAIL_ARCHIVE_RETENTION='30',MAIL_OUTBOX_DIR=str(p/'outbox'),SECRETS_DIR=str(p/'empty'),PETICAO_CONFIG_DIR=str(p/'empty'),CREDENTIALS_DIRECTORY=str(p/'empty'),TMPDIR=str(p),QA_BASE_URL='http://127.0.0.1:3045',QA_OUTPUT_DIR=str(p),QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome')
mode=sys.argv[1];head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()
if mode=='inbound-types':cmd=['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']
elif mode=='inbound-schema':cmd=['node','scripts/with-db.mjs','node','--import','tsx','../deploy/test/admin-schema-upgrade.mjs']
else:cmd=['node','scripts/with-db.mjs','node','--import','tsx','--test','--test-concurrency=1','src/lib/mail-inbound-contract.test.ts','src/lib/mail-inbound-codec.test.ts','src/lib/mail-inbound-store.test.ts','src/lib/mail-inbound-route.test.ts','src/lib/admin-content-retention.test.ts','src/lib/contact-drafts.test.ts','src/lib/mail-archive.test.ts']
info={'mode':mode,'base_commit':head,'cwd':str(r),'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'fictitious_only':True,'network_services':'loopback3045/54361; no real provider'}
print('Evidence:',p,flush=True)
with (p/'validation.log').open('w') as f:result=subprocess.run(cmd,cwd=site,env=e,stdout=f,stderr=subprocess.STDOUT)
info.update(exit_code=result.returncode,finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat());(p/'execution.json').write_text(json.dumps(info,indent=2));print(info,flush=True);print('\n'.join((p/'validation.log').read_text(errors='replace').splitlines()[-24:]),flush=True)
raise SystemExit(result.returncode)
