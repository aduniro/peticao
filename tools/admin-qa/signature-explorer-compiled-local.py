#!/usr/bin/python3
from pathlib import Path
from pdfjs_runtime import runtime_manifest
import os,sys,socket,subprocess,hashlib,json,time,shutil,argparse,fcntl
ROOT=Path(__file__).resolve().parents[2];SITE=ROOT/'site'
assert ROOT==Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109')
parser=argparse.ArgumentParser(description='Compiled isolated signature explorer UI and complete CSV QA')
parser.add_argument('--build-result',required=True,type=Path)
args=parser.parse_args()
assert args.build_result.is_absolute()
base=ROOT.parent/'admin-v2-retomada-20261109'
lock=(base/'integrated/next-output.lock').open('a');os.chmod(lock.name,0o600)
fcntl.flock(lock,fcntl.LOCK_EX)
OUT=base/('signature-explorer-compiled-'+str(time.time_ns()));OUT.mkdir(mode=0o700)

assert OUT.parent==ROOT.parent/'admin-v2-retomada-20261109'and OUT.name.startswith('signature-explorer-compiled-')
node=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node');assert hashlib.sha256(node.read_bytes()).hexdigest()=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
for port in [54388,3073,3074]:
 with socket.socket()as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned QA port occupied'
for name in ['.env','.env.local','.env.production','.env.production.local']:assert not(SITE/name).exists()
commit=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();build=args.build_result;r=json.loads(build.read_text());assert r['mode']=='build' and r['exit']==0 and r['sourceStable'] and r['commitStable']
compiled_sources=json.loads((build.parent/'source-manifest.json').read_text())
build_files=subprocess.check_output(['/usr/bin/git','ls-files','site','deploy','tools/signing'],cwd=ROOT,text=True).splitlines()
current_build_sources={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in build_files if (ROOT/f).is_file()}
assert compiled_sources and compiled_sources==current_build_sources,'Build source manifest must equal the complete current source map (including newly added files)'
# QA-only commits may differ; the complete app source map and all runtime bytes must remain exactly equal.
assert isinstance(r['commit'],str) and r['commit'],'Record the separate build SHA without requiring a QA-only HEAD match'
runtime_before=runtime_manifest(ROOT,required=True)
assert len(runtime_before)==202,'Expected all 202 pinned runtime assets'
assert runtime_before==json.loads((build.parent/'runtime-assets-manifest.json').read_text()),'Pinned browser runtime must match the tested build'
assert not subprocess.check_output(['/usr/bin/git','status','--porcelain'],cwd=ROOT,text=True).strip()
files=subprocess.check_output(['/usr/bin/git','ls-files','site','deploy','tools/signing','tools/admin-qa'],cwd=ROOT,text=True).splitlines()
def manifest():return{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest()for f in files if(ROOT/f).is_file()}
before=manifest();(OUT/'source-before.json').write_text(json.dumps(before));(OUT/'empty').mkdir(mode=0o700,exist_ok=True)
tmp=Path('/mnt/apps/peticao-final/_qa')/('explorer-' +str(time.time_ns()));tmp.mkdir(mode=0o700)
e={k:os.environ[k]for k in ['HOME','LANG','LC_ALL']if k in os.environ};e.update(PATH=str(node.parent)+':/usr/bin:/bin',NODE_ENV='test',NEXT_TELEMETRY_DISABLED='1',DEV_DB_PORT='54388',DEV_DB_DIR=str(OUT/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54388/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',MAIL_FROM='QA <qa-sender@example.test>',MAIL_OUTBOX_DIR=str(OUT/'outbox'),MAIL_ARCHIVE_RETENTION='30',APPROVER_EMAIL='qa-approver@example.test',RECIPIENTS='qa-recipient@example.test',HASH_PEPPER='QA-EXPLORER-COMPILED-ONLY-PEPPER-0123456789',DATA_ENCRYPTION_KEY='QA-EXPLORER-COMPILED-ONLY-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-EXPLORER-COMPILED-ONLY-CACHE',ADMIN_PASSWORD='QA-NOT-A-REAL-PASSWORD',ADMIN_NO_PASSWORD='0',SIGNER='none',BATCH_A1_ENABLED='1',A1_VALIDATION_ENABLED='1',A1_VALIDATION_ACCEPTED_POLICIES='[{"profile":"QA-ADMISSION-ONLY","policyOid":"1.3.6.1.4.1.55555.1"}]',ICP_VALIDATOR_URL='http://127.0.0.1:3073/qa-never-call-validator',A1_WORKER_SOCKET=str(OUT/'worker-not-started.sock'),CRON_SECRET='',GEO_DIR='/mnt/apps/peticao-final/peticao/site/geo-data',SECRETS_DIR=str(OUT/'empty'),PETICAO_CONFIG_DIR=str(OUT/'empty'),CREDENTIALS_DIRECTORY=str(OUT/'empty'),QA_SITE_DIR=str(SITE),QA_EXPECTED_COMMIT=commit,QA_OUTPUT_DIR=str(OUT),QA_CHROMIUM='/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',QA_PLAYWRIGHT_MODULE='/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',TMPDIR=str(tmp))
e.update(BATCH_A1_ENABLED='0',A1_VALIDATION_ENABLED='0',ICP_VALIDATOR_URL='',PRESIDENT_OWN_ENABLED='0',CRON_SECRET='')
command=[str(node),'scripts/with-db.mjs',str(node),'--import','tsx',str(ROOT/'tools/admin-qa/signature-explorer-compiled-scenario.mjs')];print('Compiled browser QA:',OUT,flush=True)
with(OUT/'validation.log').open('w')as log:code=subprocess.run(command,cwd=SITE,env=e,stdout=log,stderr=subprocess.STDOUT).returncode
ports_closed={}
close_deadline=time.monotonic()+10
while True:
 for port in [54388,3073,3074]:
  with socket.socket() as s: ports_closed[str(port)]=s.connect_ex(('127.0.0.1',port))!=0
 if all(ports_closed.values()) or time.monotonic()>=close_deadline:break
 time.sleep(0.1)
after=manifest();runtime_same=runtime_before==runtime_manifest(ROOT,required=True);same=before==after and runtime_same;commit_same=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==commit
result=dict(exit=code,commit=commit,sourceStable=same,runtimeAssetsStable=runtime_same,runtimeAssets=len(runtime_before),commitStable=commit_same,buildResult=str(build),buildCommit=r['commit'],buildHeadSame=r['commit']==commit,completeBuildSourceMapEqual=True,scope='compiled signature explorer UI, actual handlers and isolated PG, fictitious data, no real sending',ports=[54388,3073,3074],portsClosed=ports_closed,log=str(OUT/'validation.log'));(OUT/'execution.json').write_text(json.dumps(result,indent=2));(base/'latest-signature-explorer-compiled-path.txt').write_text(str(OUT));shutil.rmtree(tmp);print(json.dumps(result),flush=True)
if code:print((OUT/'validation.log').read_text()[-5000:])
raise SystemExit(code if same and commit_same and all(ports_closed.values()) else 2)
