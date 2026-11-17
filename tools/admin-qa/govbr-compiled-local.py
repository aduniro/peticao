#!/usr/bin/python3
from pathlib import Path
import os,sys,socket,subprocess,hashlib,json,time,shutil,argparse,fcntl
ROOT=Path(__file__).resolve().parents[2];SITE=ROOT/'site'
assert ROOT==Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109')
parser=argparse.ArgumentParser(description='Compiled isolated gov.br UI and approval-code recovery QA')
parser.add_argument('--build-result',required=True,type=Path)
args=parser.parse_args()
assert args.build_result.is_absolute()
base=ROOT.parent/'admin-v2-retomada-20261109'
lock=(base/'integrated/next-output.lock').open('a');os.chmod(lock.name,0o600)
fcntl.flock(lock,fcntl.LOCK_EX)
OUT=base/('govbr-compiled-'+str(time.time_ns()));OUT.mkdir(mode=0o700)

assert OUT.parent==ROOT.parent/'admin-v2-retomada-20261109'and OUT.name.startswith('govbr-compiled-')
node=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node');assert hashlib.sha256(node.read_bytes()).hexdigest()=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
for port in [54378,3053,3054,3853]:
 with socket.socket()as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned QA port occupied'
for name in ['.env','.env.local','.env.production','.env.production.local']:assert not(SITE/name).exists()
commit=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();build=args.build_result;r=json.loads(build.read_text());assert r['mode']=='build' and r['exit']==0 and r['sourceStable'] and r['commitStable']
compiled_sources=json.loads((build.parent/'source-manifest.json').read_text());assert compiled_sources and all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h for f,h in compiled_sources.items()),'Build must match current source bytes'
assert not subprocess.check_output(['/usr/bin/git','status','--porcelain'],cwd=ROOT,text=True).strip()
files=subprocess.check_output(['/usr/bin/git','ls-files','site','deploy/test','tools/signing','tools/admin-qa'],cwd=ROOT,text=True).splitlines()
def manifest():return{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest()for f in files if(ROOT/f).is_file()}
before=manifest();(OUT/'source-before.json').write_text(json.dumps(before));(OUT/'empty').mkdir(mode=0o700,exist_ok=True)
tmp=Path('/mnt/apps/peticao-final/_qa')/('gv-'+str(time.time_ns()));tmp.mkdir(mode=0o700)
e={k:os.environ[k]for k in ['HOME','LANG','LC_ALL']if k in os.environ};e.update(PATH=str(node.parent)+':/usr/bin:/bin',NODE_ENV='test',NEXT_TELEMETRY_DISABLED='1',DEV_DB_PORT='54378',DEV_DB_DIR=str(OUT/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54378/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',MAIL_FROM='QA <qa-sender@example.test>',MAIL_OUTBOX_DIR=str(OUT/'outbox'),MAIL_ARCHIVE_RETENTION='30',APPROVER_EMAIL='qa-approver@example.test',RECIPIENTS='qa-recipient@example.test',HASH_PEPPER='QA-GOVBR-COMPILED-ONLY-PEPPER-0123456789',DATA_ENCRYPTION_KEY='QA-GOVBR-COMPILED-ONLY-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-GOVBR-COMPILED-ONLY-CACHE',ADMIN_PASSWORD='QA-NOT-A-REAL-PASSWORD',ADMIN_NO_PASSWORD='0',SIGNER='none',GEO_DIR='/mnt/apps/peticao-final/peticao/site/geo-data',SECRETS_DIR=str(OUT/'empty'),PETICAO_CONFIG_DIR=str(OUT/'empty'),CREDENTIALS_DIRECTORY=str(OUT/'empty'),QA_SITE_DIR=str(SITE),QA_EXPECTED_COMMIT=commit,QA_OUTPUT_DIR=str(OUT),QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',TMPDIR=str(tmp))
command=[str(node),'scripts/with-db.mjs',str(node),'--import','tsx',str(ROOT/'tools/admin-qa/govbr-compiled-scenario.mjs')];print('Compiled browser QA:',OUT,flush=True)
with(OUT/'validation.log').open('w')as log:code=subprocess.run(command,cwd=SITE,env=e,stdout=log,stderr=subprocess.STDOUT).returncode
after=manifest();same=before==after;commit_same=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==commit
result=dict(exit=code,commit=commit,sourceStable=same,commitStable=commit_same,buildResult=str(build),buildCommit=r['commit'],scope='compiled Next application, real controls/handlers/PG, synthetic verifier and development delivery only',realCryptoHomologation=False,ports=[54378,3053,3054,3853],log=str(OUT/'validation.log'));(OUT/'execution.json').write_text(json.dumps(result,indent=2));(base/'latest-govbr-compiled-path.txt').write_text(str(OUT));shutil.rmtree(tmp);print(json.dumps(result),flush=True)
if code:print((OUT/'validation.log').read_text()[-5000:])
raise SystemExit(code if same and commit_same else 2)
