"""Fixed isolated inbox QA; no inherited service configuration or public listener."""
from pathlib import Path
import os, socket, tempfile, subprocess, hashlib, json, sys
r=Path(__file__).resolve().parents[2]
assert r==Path('/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-read-20261109')
site=r/'site'
assert sys.argv[1:] in [['tests'],['types']]
assert not any((site/x).exists() for x in ['.env','.env.local','.env.production','.env.production.local'])
if sys.argv[1]=='tests':
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',54362))!=0,'Owned QA port occupied'
p=Path(tempfile.mkdtemp(prefix='admin-inbox-read-'));p.chmod(0o700);(p/'empty').mkdir(mode=0o700)
env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL']}
env.update(NODE_ENV='test',DEV_DB_PORT='54362',DEV_DB_DIR=str(p/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54362/peticao',MAIL_PROVIDER='dev',HASH_PEPPER='QA-INBOX-READ-FICTITIOUS-PEPPER-0123456789',DATA_ENCRYPTION_KEY='QA-INBOX-FICTITIOUS-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-INBOX-FICTITIOUS-CACHE',SECRETS_DIR=str(p/'empty'),PETICAO_CONFIG_DIR=str(p/'empty'),CREDENTIALS_DIRECTORY=str(p/'empty'),MAIL_OUTBOX_DIR=str(p/'outbox'),TMPDIR=str(p))
sources=['src/lib/mail/inbound-queries.ts','src/lib/mail/inbound-controllers.ts','src/lib/mail-inbox-read.test.ts','src/lib/mail/inbound-store.ts','src/lib/mail/preview-render.ts']+[str(x.relative_to(site)) for x in (site/'src/app/api/admin/inbox').rglob('route.ts')]
fingerprints=lambda:{name:hashlib.sha256((site/name).read_bytes()).hexdigest() for name in sources}
before=fingerprints();(p/'sources.json').write_text(json.dumps(before,indent=2));print('Evidence:',p,flush=True)
if sys.argv[1]=='types':cmd=['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']
else:cmd=['node','scripts/with-db.mjs','node','--import','tsx','--test','--test-concurrency=1','src/lib/mail-inbox-read.test.ts','src/lib/mail-preview.test.ts','src/lib/mail-inbound-contract.test.ts','src/lib/mail-inbound-codec.test.ts','src/lib/mail-inbound-store.test.ts','src/lib/mail-inbound-route.test.ts','src/lib/admin-users.test.ts']
with (p/'validation.log').open('w') as f:result=subprocess.run(cmd,cwd=site,env=env,stdout=f,stderr=subprocess.STDOUT)
assert fingerprints()==before,'Source changed during QA'
print('Exit:',result.returncode,flush=True);print('\n'.join((p/'validation.log').read_text(errors='replace').splitlines()[-22:]),flush=True)
raise SystemExit(result.returncode)
