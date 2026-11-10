#!/usr/bin/python3
"""Private PG18.4 qualification only; no Next build, provider, migration or candidate writes."""
from pathlib import Path
import argparse,fcntl,hashlib,json,os,shutil,socket,subprocess,time,signal
CANDIDATE=Path(__file__).resolve().parents[2]
assert CANDIDATE==Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109')
QA_BASE=CANDIDATE.parent/'admin-v2-retomada-20261109/mail-transaction-qa-runs'
QA_BASE.mkdir(parents=True,exist_ok=True,mode=0o700)
NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
DEPS=Path('/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
POSTGRES=DEPS/'@embedded-postgres/linux-x64/native/bin/postgres'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--expected-candidate-commit');args=parser.parse_args()
commit=subprocess.check_output(['/usr/bin/git','-C',str(CANDIDATE),'rev-parse','HEAD'],text=True).strip()
bootstrap=CANDIDATE/'site/src/lib/db.ts'
assert sha(NODE)=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
assert subprocess.check_output([str(NODE),'--version'],text=True).strip()=='v20.19.2'
assert subprocess.check_output([str(POSTGRES),'--version'],text=True).strip()=='postgres (PostgreSQL) 18.4'
tracked=subprocess.check_output(['/usr/bin/git','-C',str(CANDIDATE),'ls-files','site/src','site/public/data','site/scripts','site/tsconfig.json','site/package.json','site/next-env.d.ts','tools/preview/egress-bridge.mjs','tools/preview/egress-bridge.d.mts'],text=True).splitlines()
base={name:sha(CANDIDATE/name)for name in tracked if(CANDIDATE/name).is_file()}
owned={}
plan={'execute':args.execute,'candidateCommit':commit,'candidateBootstrap':str(bootstrap),'candidateBootstrapSha256':sha(bootstrap),'port':54382,'database':'fictitious peticao, isolated per-test schemas qa_resend_*','node':'20.19.2','postgres':'18.4','tests':'13new plus legacy archive/events regression','qaTooling':{str(Path(__file__)):sha(Path(__file__)),str(CANDIDATE/'tools/admin-qa/mail-transaction-network-guard.mjs'):sha(CANDIDATE/'tools/admin-qa/mail-transaction-network-guard.mjs')},'physicalMessagesAllowed':False,'candidateWritesAllowed':False,'entrypoint':'integrated shared mail transaction primitives'}
if not args.execute:print(json.dumps(plan,indent=2));raise SystemExit(0)
assert args.expected_candidate_commit==commit,'Explicit expected candidate commit is required'
assert not subprocess.check_output(['/usr/bin/git','-C',str(CANDIDATE),'status','--porcelain'],text=True).strip(),'Candidate must be frozen and clean'
lock=(QA_BASE/'pg-54382.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
with socket.socket()as probe:assert probe.connect_ex(('127.0.0.1',54382))!=0,'Port54382 already occupied'
run=QA_BASE/str(time.time_ns());run.mkdir(mode=0o700,parents=True)
site=run/'site';site.mkdir(mode=0o700)
for name in tracked:
 source=CANDIDATE/name
 if source.is_file():
  target=run/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
(site/'node_modules').symlink_to(DEPS,target_is_directory=True)
for name in ['empty','schema']:(run/name).mkdir(mode=0o700)
short=Path('/mnt/apps/peticao-final/_qa')/('finish-'+str(time.time_ns()));short.mkdir(mode=0o700)

preload=CANDIDATE/'tools/admin-qa/mail-transaction-network-guard.mjs'
env={'PATH':str(NODE.parent)+':/usr/bin:/bin','NODE_ENV':'test','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','SIGNER':'none','HASH_PEPPER':'QA-RESERVATION-FAKE-NEVER-PRODUCTION-0123456789','DATABASE_URL':'postgres://peticao:peticao@127.0.0.1:54382/peticao','DEV_DB_PORT':'54382','DEV_DB_DIR':str(run/'postgres'),'TMPDIR':str(short),'SECRETS_DIR':str(run/'empty'),'PETICAO_CONFIG_DIR':str(run/'empty'),'CREDENTIALS_DIRECTORY':str(run/'empty'),'QA_RESEND_ALLOW_PG':'isolated-fictitious-54382','QA_SITE_DIR':str(site),'QA_OUTPUT_DIR':str(run),'QA_ALLOWED_NET_PORTS':'54382','NODE_OPTIONS':'--import='+str(preload),'NEXT_TELEMETRY_DISABLED':'1'}
command=[str(NODE),str(site/'scripts/with-db.mjs'),str(NODE),'--import',str(DEPS/'tsx/dist/loader.mjs'),'--test','--test-concurrency=1',str(site/'src/lib/mail/archive-finish-transaction.pg.test.ts'),str(site/'src/lib/mail/archive-finish-composition.pg.test.ts'),str(site/'src/lib/mail/archive-prepare-transaction.pg.test.ts'),str(site/'src/lib/mail-archive.test.ts'),str(site/'src/lib/mail-message-events.test.ts')]
(run/'source-before.json').write_text(json.dumps({'candidate':base,'draft':owned},indent=2));(run/'profile.json').write_text(json.dumps({**plan,'command':command,'cwd':str(site),'environment':{k:v for k,v in env.items()if k!='HASH_PEPPER'}},indent=2));print(str(run),flush=True)
try:
 with(run/'validation.log').open('w')as log:
  child=subprocess.Popen(command,cwd=site,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  code=child.wait(timeout=180)
except subprocess.TimeoutExpired:
 code=124
 os.killpg(child.pid,signal.SIGTERM)
 try:child.wait(timeout=10)
 except subprocess.TimeoutExpired:
  os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=10)
finally:
 # Only the fresh, owned PGDATA may be stopped; never kill a pre-existing/foreign server.
 pidfile=run/'postgres/postmaster.pid'
 if pidfile.exists():
  pid=pidfile.read_text().splitlines()[0]
  process=Path('/proc')/pid/'cmdline'
  if process.exists() and str(run/'postgres').encode() in process.read_bytes():
   subprocess.run([str(POSTGRES.parent/'pg_ctl'),'-D',str(run/'postgres'),'-m','fast','stop'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15,check=False)
closed=False
for _ in range(100):
 with socket.socket()as probe:closed=probe.connect_ex(('127.0.0.1',54382))!=0
 if closed:break
 time.sleep(0.05)
stable=base=={name:sha(CANDIDATE/name)for name in base} and all(sha(Path(name))==value for name,value in plan['qaTooling'].items())
head_same=commit==subprocess.check_output(['/usr/bin/git','-C',str(CANDIDATE),'rev-parse','HEAD'],text=True).strip()
guard=[json.loads(line)for line in(run/'network-guard.jsonl').read_text().splitlines()] if (run/'network-guard.jsonl').exists() else []
result={**plan,'exit':code,'sourceStable':stable,'candidateHeadStable':head_same,'portClosed':closed,'networkGuardInstalled':any(x['kind']=='installed'for x in guard),'networkDenials':sum(x['kind']=='denied'for x in guard),'log':str(run/'validation.log')}
(run/'execution.json').write_text(json.dumps(result,indent=2));shutil.rmtree(short);print(json.dumps(result),flush=True)
if code:print((run/'validation.log').read_text()[-12000:])
raise SystemExit(code if stable and head_same and closed and result['networkGuardInstalled']and not result['networkDenials'] else 2)
