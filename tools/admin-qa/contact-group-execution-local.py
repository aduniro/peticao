#!/usr/bin/env python3
"""Isolated durable group execution tests and schema rehearsal; no public services."""
import hashlib, json, os, socket, subprocess, tempfile, sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
assert root==Path.cwd().resolve()==Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-referral-management-20261109')
site=root/'site'
assert (site/'node_modules').resolve()==Path('/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
for name in ['.env','.env.local','.env.production','.env.production.local']:
 assert not (site/name).exists()
with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1',54356))!=0
scratch=Path(tempfile.mkdtemp(prefix='admin-contact-group-execution-'));scratch.chmod(0o700)
empty=scratch/'empty';empty.mkdir(mode=0o700)
env={k:v for k,v in os.environ.items() if k in ['HOME','LANG','LC_ALL']}
env.update(PATH='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin',NODE_ENV='test',DEV_DB_PORT='54356',DEV_DB_DIR=str(scratch/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54356/peticao',MAIL_PROVIDER='dev',CONTACT_BCC='qa-owner@example.test',MAIL_REPLY_TO='qa-owner@example.test',HASH_PEPPER='QA-REFERRAL-MANAGEMENT-FICTITIOUS-PEPPER-0123456789',DATA_ENCRYPTION_KEY='QA-REFERRAL-FICTITIOUS-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-FICTITIOUS-CACHE',SECRETS_DIR=str(empty),PETICAO_CONFIG_DIR=str(empty),CREDENTIALS_DIRECTORY=str(empty),TMPDIR=str(scratch),MAIL_OUTBOX_DIR=str(scratch/'outbox'))
files=['src/lib/db.ts','src/lib/contact-group-execution.ts','src/lib/contact-group-execution.test.ts','src/lib/contact-group-preview.ts','src/lib/contact-replies.ts','src/app/api/admin/contato/grupo/confirmar/route.ts','src/app/api/admin/contato/grupo/resultado/route.ts','../deploy/test/admin-schema-upgrade.mjs']
fingerprints=lambda:{f:hashlib.sha256((site/f).read_bytes()).hexdigest() for f in files}
before=fingerprints(); info={'source':before,'fictitious':True,'port':54356,'provider':'dev','external_services':False}
print('QA evidence:',scratch,flush=True)
commands=[('validation',['node','scripts/with-db.mjs','node','--import','tsx','--test','--test-concurrency=1','src/lib/contact-group-execution.test.ts','src/lib/contact-group-preview.test.ts','src/lib/contact-replies.test.ts','src/lib/contact-drafts.test.ts','src/lib/admin-content-retention.test.ts']),('schema-upgrade',['node','scripts/with-db.mjs','node','--import','tsx','../deploy/test/admin-schema-upgrade.mjs']),('types',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])]
assert sys.argv[1:] in [[], ['--schema-only']]
if sys.argv[1:]: commands=[item for item in commands if item[0]=='schema-upgrade']
code=0
for name,command in commands:
 with (scratch/(name+'.log')).open('w') as log: result=subprocess.run(command,cwd=site,env=env,stdout=log,stderr=subprocess.STDOUT)
 info[name]=result.returncode;print(name,result.returncode,flush=True)
 if result.returncode: code=result.returncode;break
assert fingerprints()==before
info['sources_unchanged']=True;info['exit_code']=code
(scratch/'execution.json').write_text(json.dumps(info,indent=2)+'\n')
raise SystemExit(code)
