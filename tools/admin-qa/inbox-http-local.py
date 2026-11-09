"""Compiled QA of fixed clean commit, restricted to owned loopback services."""
from pathlib import Path
import os,socket,tempfile,subprocess,hashlib,json,sys
owner=Path(__file__).resolve().parents[2]
assert sys.argv[1:] in [['build'],['http'],['build','node20'],['http','node20']]
node20=len(sys.argv)==3
expected='8cdd97a' if node20 else '079ca7a'
root=owner.parent/('candidate-inbox-http-node20-8cdd97a-20261109' if node20 else 'candidate-inbox-http-079ca7a-20261109');site=root/'site'
assert owner.name=='candidate-inbox-read-20261109'
assert subprocess.check_output(['git','rev-parse','--short=7','HEAD'],cwd=root,text=True).strip()==expected
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip(),'QA copy must be clean'
assert not any((site/x).exists() for x in ['.env','.env.local','.env.production','.env.production.local'])
for port in [3047,54362]:
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned QA port occupied'
p=Path(tempfile.mkdtemp(prefix='admin-inbox-compiled-'));p.chmod(0o700);(p/'empty').mkdir(mode=0o700)
env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL']}
env.update(NODE_ENV='production',NODE_OPTIONS='--max-old-space-size=1536',CIRCLE_NODE_TOTAL='2',RAYON_NUM_THREADS='2',NEXT_TELEMETRY_DISABLED='1',DEV_DB_PORT='54362',DEV_DB_DIR=str(p/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54362/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',PREVIEW_MODE='1',ADMIN_NO_PASSWORD='0',ADMIN_PASSWORD='QA-NOT-A-REAL-PASSWORD',ADMIN_PASSWORD_FILE=str(p/'empty'/'no-password'),HASH_PEPPER='QA-INBOX-COMPILED-PEPPER-FICTITIOUS-0123456789',DATA_ENCRYPTION_KEY='QA-INBOX-COMPILED-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-INBOX-COMPILED-CACHE-0123456789',SECRETS_DIR=str(p/'empty'),PETICAO_CONFIG_DIR=str(p/'empty'),CREDENTIALS_DIRECTORY=str(p/'empty'),PUBLICAR_ESTADO_DIR=str(p/'empty'),MAIL_OUTBOX_DIR=str(p/'outbox'),TMPDIR=str(p),QA_OUTPUT_DIR=str(p),QA_BASE_URL='http://127.0.0.1:3047',QA_EXPECTED_COMMIT=expected)
runtime=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin' if node20 else '/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin')
assert(runtime/'node').is_file()
node_hash=hashlib.sha256((runtime/'node').read_bytes()).hexdigest()
if node20:assert node_hash=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
node_version=subprocess.check_output([str(runtime/'node'),'--version'],text=True).strip()
if node20:assert node_version=='v20.19.2'
env['PATH']=str(runtime)+os.pathsep+'/usr/bin:/bin'
accepted_plan=None
if node20:
 plan_path=owner.parent/'candidate-cumulative-8cdd97a-20261109/.cache/accepted-cumulative-node20/plan.json'
 accepted_plan=json.loads(plan_path.read_text())
 assert accepted_plan['commit'].startswith(expected)
 for name,sha in accepted_plan['source'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha
 for name,data in accepted_plan['dependencyManifest']['installed'].items():
  package=root/'site'/name/'package.json'
  assert hashlib.sha256(package.read_bytes()).hexdigest()==data['sha256']
  assert json.loads(package.read_text())['version']==data['version']
 assert all(not(root/'site'/name/'package.json').exists() for name in accepted_plan['dependencyManifest']['optionalAbsent'])
 (p/'accepted-manifest-check.json').write_text(json.dumps({'manifestPath':str(plan_path),'manifestSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'sourceFilesEqual':len(accepted_plan['source']),'installedManifestEqual':len(accepted_plan['dependencyManifest']['installed']),'optionalAbsentEqual':len(accepted_plan['dependencyManifest']['optionalAbsent'])},indent=2))
tracked=subprocess.check_output(['git','ls-files','site/src','site/next.config.mjs','site/package.json','site/package-lock.json'],cwd=root,text=True).splitlines()
fingerprints=lambda:{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in tracked}
before=fingerprints();(p/'sources.json').write_text(json.dumps(before,indent=2));mode=sys.argv[1]
if mode=='build':cmd=['node','scripts/with-db.mjs','node','node_modules/next/dist/bin/next','build']
else:
 assert(site/'.next/BUILD_ID').is_file(),'Own compiled artifact required'
 cmd=['node','scripts/with-db.mjs','node','--import','tsx',str(owner/'tools/admin-qa/inbox-http-compiled.mjs')]
print('Evidence:',p,flush=True)
with(p/'validation.log').open('w')as f:result=subprocess.run(cmd,cwd=site,env=env,stdout=f,stderr=subprocess.STDOUT)
assert fingerprints()==before,'Tracked application sources changed during QA'
if accepted_plan:assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==sha for name,sha in accepted_plan['source'].items())
info={'baseCommit':expected,'nodeVersion':node_version,'nodeSha256':node_hash,'mode':mode,'exitCode':result.returncode,'cwd':str(root),'ports':[3047,54362],'fictitiousOnly':True,'workers':1,'sourceStable':True}
(p/'execution.json').write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True);print('\n'.join((p/'validation.log').read_text(errors='replace').splitlines()[-30:]),flush=True)
raise SystemExit(result.returncode)
