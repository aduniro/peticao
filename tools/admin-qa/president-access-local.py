#!/usr/bin/env python3
"""Isolated Node20/PG tests; no real identities, credentials or outbound mail."""
import hashlib,json,os,socket,subprocess,sys,tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[2]
assert root==Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-president-access-20261109')
assert len(sys.argv)==2 and sys.argv[1] in ['tests','types']
site=root/'site'
assert not any((site/p).exists() for p in ['.env','.env.local','.env.production','.env.production.local'])
assert (site/'node_modules').resolve()==Path('/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1',54367))!=0
node=Path('/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
assert hashlib.sha256(node.read_bytes()).hexdigest()=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
assert subprocess.check_output([str(node),'--version'],text=True).strip()=='v20.19.2'
scratch=Path(tempfile.mkdtemp(prefix='admin-president-access-'));scratch.chmod(0o700);(scratch/'empty').mkdir(mode=0o700)
env={k:v for k,v in os.environ.items() if k in ['HOME','LANG','LC_ALL']}
env.update(PATH=str(node.parent)+':/usr/bin:/bin',NODE_ENV='test',NODE_OPTIONS='--max-old-space-size=1536',DEV_DB_PORT='54367',DEV_DB_DIR=str(scratch/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54367/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',HASH_PEPPER='QA-PRESIDENT-ACCESS-PEPPER-FICTITIOUS-0123456789',DATA_ENCRYPTION_KEY='QA-PRESIDENT-ACCESS-NOT-PRODUCTION',CPF_CACHE_ENCRYPTION_KEY='QA-PRESIDENT-ACCESS-CACHE',SECRETS_DIR=str(scratch/'empty'),PETICAO_CONFIG_DIR=str(scratch/'empty'),CREDENTIALS_DIRECTORY=str(scratch/'empty'),MAIL_OUTBOX_DIR=str(scratch/'outbox'),SIGNER='none',TMPDIR=str(scratch))
sources=lambda:{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (site/'src').rglob('*') if p.is_file()}
before=sources();mode=sys.argv[1]
cmd=[str(node),'node_modules/typescript/bin/tsc','--noEmit','--incremental','false'] if mode=='types' else [str(node),'scripts/with-db.mjs',str(node),'--import','tsx','--test','--test-concurrency=1','src/lib/president-access.test.ts','src/lib/president-portal-contract.test.ts','src/lib/president-portal-store.test.ts']
print('Evidence:',scratch,flush=True)
with(scratch/'validation.log').open('w')as f:run=subprocess.run(cmd,cwd=site,env=env,stdout=f,stderr=subprocess.STDOUT)
assert sources()==before
result={'mode':mode,'cwd':str(root),'node':'v20.19.2','port':54367,'fictitiousOnly':True,'sourceStable':True,'exitCode':run.returncode}
(scratch/'execution.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True);print('\n'.join((scratch/'validation.log').read_text(errors='replace').splitlines()[-24:]),flush=True)
raise SystemExit(run.returncode)
