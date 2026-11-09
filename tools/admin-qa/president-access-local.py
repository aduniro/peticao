"""Closed production-like fixture; Node20 pinned, own loopback app/PG/mock only."""
from pathlib import Path
import sys,os,subprocess,socket,tempfile,hashlib,json,re
owner=Path(__file__).resolve().parents[2]
assert owner.name=='candidate-inbox-read-20261109'
assert len(sys.argv)==3 and sys.argv[1] in ['build','http'] and re.fullmatch('[a-f0-9]{40}',sys.argv[2])
mode,commit=sys.argv[1:];root=owner.parent/f'candidate-president-access-http-{commit[:7]}-20261109';site=root/'site'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==commit
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip(),'Dirty source is not accepted'
assert not any((site/name).exists() for name in ['.env','.env.local','.env.production','.env.production.local'])
for port in [3049,54368]:
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned QA port occupied'
runtime=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin');node=runtime/'node';node_sha=hashlib.sha256(node.read_bytes()).hexdigest()
assert node_sha=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
version=subprocess.check_output([str(node),'--version'],text=True).strip();assert version=='v20.19.2'
p=Path(tempfile.mkdtemp(prefix='admin-president-access-'));p.chmod(0o700);(p/'empty').mkdir(mode=0o700)
e={k:v for k,v in os.environ.items() if k in ['HOME','LANG','LC_ALL']};e['PATH']=str(runtime)+':/usr/bin:/bin'
e.update(NODE_ENV='production',NODE_OPTIONS='--max-old-space-size=1536',CIRCLE_NODE_TOTAL='2',RAYON_NUM_THREADS='2',NEXT_TELEMETRY_DISABLED='1',DEV_DB_PORT='54368',DEV_DB_DIR=str(p/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54368/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',MAIL_FROM='QA <qa-sender@example.test>',PREVIEW_MODE='1',CPF_FORCE_MOCK='1',CPF_MOCK_DATA=json.dumps({'52998224725':{'nome':'Pessoa Responsavel QA','nasc':'01/01/2000'}}),ADMIN_NO_PASSWORD='0',ADMIN_PASSWORD='QA-NOT-A-REAL-PASSWORD',ADMIN_PASSWORD_FILE=str(p/'empty'/'no-password'),HASH_PEPPER='QA-PRESIDENT-ECNPJ-PEPPER-0123456789-FICTITIOUS',DATA_ENCRYPTION_KEY='QA-PRESIDENT-ECNPJ-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-PRESIDENT-ECNPJ-CACHE-0123456789',SECRETS_DIR=str(p/'empty'),PETICAO_CONFIG_DIR=str(p/'empty'),CREDENTIALS_DIRECTORY=str(p/'empty'),PUBLICAR_ESTADO_DIR=str(p/'empty'),MAIL_OUTBOX_DIR=str(p/'outbox'),MAIL_ARCHIVE_RETENTION='30',SIGNER='none',BATCH_SIZE='1',APPROVER_EMAIL='qa-approver@example.test',RECIPIENTS='qa-authority@example.test',ICP_EXPECTED_CNPJ='15883671000115',TMPDIR=str(p),QA_OUTPUT_DIR=str(p),QA_BASE_URL='http://127.0.0.1:3049',QA_EXPECTED_COMMIT=commit,QA_SITE_DIR=str(site))
files=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
fingerprint=lambda:{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}
before=fingerprint();(p/'source-before.json').write_text(json.dumps(before,indent=2));print('Evidence:',p,flush=True)
if mode=='build':cmd=['node','scripts/with-db.mjs','node','node_modules/next/dist/bin/next','build']
else:
 assert(site/'.next/BUILD_ID').is_file(),'Own compiled artifact required'
 cmd=['node','scripts/with-db.mjs','node','--import','tsx',str(owner/'tools/admin-qa/president-access-http.mjs')]
with(p/'validation.log').open('w')as f:result=subprocess.run(cmd,cwd=site,env=e,stdout=f,stderr=subprocess.STDOUT)
assert fingerprint()==before,'Tracked source changed during QA'
info={'mode':mode,'commit':commit,'cwd':str(root),'node':version,'nodeSha256':node_sha,'ports':[3049,54368],'fictitiousOnly':True,'cryptoHomologation':False,'mailProviders':['dev'],'exitCode':result.returncode,'sourceStable':True}
(p/'execution.json').write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True);print('\n'.join((p/'validation.log').read_text(errors='replace').splitlines()[-24:]),flush=True)
raise SystemExit(result.returncode)
