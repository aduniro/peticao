import argparse,os,sys,json,subprocess,time,socket,threading,hashlib,base64,importlib.util,shutil
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
parser=argparse.ArgumentParser();parser.add_argument('--browser',action='store_true');args=parser.parse_args()
ROOT=Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109')
OUT=ROOT.parent/"admin-v2-retomada-20261109"/(("a1-e2e-ui-" if args.browser else "a1-e2e-")+str(time.time_ns()))
OUT.mkdir(mode=0o700)
assert ROOT==Path("/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109")
assert (ROOT/"site/node_modules").is_dir()
(OUT/"node_modules").symlink_to(ROOT/"site/node_modules")
shutil.copyfile(Path(__file__).with_name("a1-browser-scenario.ts" if args.browser else "a1-e2e-scenario.ts"),OUT/"scenario.ts")
NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
assert hashlib.sha256(NODE.read_bytes()).hexdigest()=='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
COMMIT=subprocess.check_output(['/usr/bin/git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
assert not subprocess.check_output(['/usr/bin/git','-C',str(ROOT),'status','--porcelain','--','site','tools/signing','tools/admin-qa'],text=True).strip(),'commit the tested snapshot first'
tracked=subprocess.check_output(['/usr/bin/git','-C',str(ROOT),'ls-files','site','tools/signing','tools/admin-qa'],text=True).splitlines()
def manifest():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in tracked if (ROOT/name).is_file()}
before=manifest()
assert (OUT/'node_modules').is_dir(),'private Node dependencies must be prepared before the test'
with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',54377))!=0,'private QA database port occupied'
if args.browser:
 private_ram=Path('/run/user')/str(os.getuid())/'peticao-a1-qa'
 assert private_ram.parent.stat().st_uid==os.getuid() and not private_ram.parent.stat().st_mode & 0o077
 private_ram.mkdir(mode=0o700,exist_ok=True)
 assert not private_ram.is_symlink() and private_ram.stat().st_uid==os.getuid() and not private_ram.stat().st_mode & 0o077
 assert shutil.disk_usage(private_ram).free>1024*1024*1024
 os.environ['A1_TEST_PRIVATE_ROOT']=str(private_ram)
else:
 os.environ['A1_TEST_PRIVATE_ROOT']='/home/barre/.cache/peticao-a1-worker-qa'
sys.path.insert(0,str(ROOT/'tools/signing'))
spec=importlib.util.spec_from_file_location('qa_fixture_worker',ROOT/'tools/signing/test_worker.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
C=module.WorkerTests
C.setUpClass()
server=None;broker=None;log=None
try:
 policy_path=C.root/'certificates'/'policy.der';policy_path.write_bytes((ROOT/'tools/signing/fixtures/ad-rb-v1.3.der').read_bytes());policy_path.chmod(0o600)
 cfg={**C.cfg,'profile':module.worker.DECLARED_PROFILE,'policyPath':str(policy_path)}
 C.config_path.write_text(json.dumps(cfg));C.config_path.chmod(0o600)
 sock=C.root/'w.sock';assert len(str(sock).encode())<100
 # Do not weaken trusted-code checks or change group-writable development directories.
 protected_python=Path('/home/barre/.cache/peticao-a1-worker-qa/e2e-venv')
 if not protected_python.exists():
  assert sys.prefix!=sys.base_prefix
  shutil.copytree(Path(sys.prefix),protected_python,symlinks=True)
  for base,dirs,files in os.walk(protected_python):
   Path(base).chmod(Path(base).stat().st_mode & ~0o022)
   for name in files:
    path=Path(base)/name
    if not path.is_symlink():path.chmod(path.stat().st_mode & ~0o022)
 protected_python=protected_python/'bin/python'
 code_dir=C.root/'code';code_dir.mkdir(mode=0o700)
 for name in ['worker.py','signature_policy.py','service.py']:
  source=ROOT/'tools/signing'/name;target=code_dir/name;target.write_bytes(source.read_bytes());target.chmod(0o600)
  assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(source.read_bytes()).digest()
 service_cfg={'version':1,'socketPath':str(sock),'pythonPath':str(protected_python),'workerPath':str(code_dir/'worker.py'),'workerConfigPath':str(C.config_path),'maxConcurrent':1,'workerTimeoutSeconds':60}
 service_path=C.root/'service.json';service_path.write_text(json.dumps(service_cfg));service_path.chmod(0o600)
 token='QA-E2E-VALIDATOR-CONTRACT-NOT-REAL'
 state={'mode':'valid','pdfRequests':0,'cryptographicChecks':0}
 from pyhanko.pdf_utils.reader import PdfFileReader
 from pyhanko.sign.validation import validate_pdf_signature
 from pyhanko.keys import load_certs_from_pemder_data
 from pyhanko_certvalidator import ValidationContext
 from signature_policy import PINNED_POLICY_HASH_SHA256
 import io
 roots=list(load_certs_from_pemder_data(Path(cfg['trustRootsPath']).read_bytes()))
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   if self.headers.get('Authorization')!='Bearer '+token:self.send_error(403);return
   try:
    size=int(self.headers.get('Content-Length','-1'))
    if not 0<=size<=25*1024*1024:self.send_error(413);return
    raw=self.rfile.read(size)
    if self.path=='/control':
     value=json.loads(raw);assert value=={'mode':'wrong-policy'};state['mode']='wrong-policy';response={'ok':True}
    elif self.path=='/validate':
     state['pdfRequests']+=1
     pdf=PdfFileReader(io.BytesIO(raw),strict=True);assert len(pdf.embedded_signatures)==1
     sig=pdf.embedded_signatures[0]
     context=ValidationContext(trust_roots=roots,allow_fetching=False,revocation_mode='soft-fail')
     checked=validate_pdf_signature(sig,signer_validation_context=context)
     assert checked.intact and checked.valid and checked.trusted and checked.docmdp_ok and checked.coverage.name=='ENTIRE_FILE'
     assert hashlib.sha256(sig.signer_cert.dump()).hexdigest()==C.req['certificateFingerprintSha256']
     attrs=[x for x in sig.signer_info['signed_attrs'] if x['type'].dotted=='1.2.840.113549.1.9.16.2.15'];assert len(attrs)==1
     declaration=attrs[0]['values'][0].chosen
     assert declaration['sig_policy_id'].native=='2.16.76.1.7.1.11.1.3';assert declaration['sig_policy_hash']['digest'].native.hex()==PINNED_POLICY_HASH_SHA256
     state['cryptographicChecks']+=1
     from datetime import datetime,timezone
     response={'protocol':'peticao-a1-validation','version':2,'valid':True,'sha256':hashlib.sha256(raw).hexdigest(),'cnpj':'15883671000115','certificateFingerprintSha256':C.req['certificateFingerprintSha256'],'integrity':True,'icpBrasilChainTrusted':True,'coverage':'entire-file','modificationsAllowed':True,'revocation':'good','profile':'QA-SYNTHETIC-CONTRACT-ONLY','policyOid':'2.16.76.1.7.1.11.1.3' if state['mode']=='valid' else '1.3.6.1.4.1.55555.999','validatedAt':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'validatorVersion':'qa-e2e-1'}
     # The true-valued trust/revocation fields simulate the application contract only.
     # This root is SYNTHETIC QA, is not ICP-Brasil, and never authorizes production.
    else:self.send_error(404);return
    body=json.dumps(response).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
   except Exception:
    body=b'{"valid":false}';self.send_response(422);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 env_service={k:v for k,v in os.environ.items() if k not in ['A1_WORKER_CONFIG','PYTHONPATH','QA_A1_POLICY_RESULT_DIR']};env_service['A1_SERVICE_CONFIG']=str(service_path)
 log=(OUT/'broker.log').open('w');broker=subprocess.Popen([str(protected_python),str(code_dir/'service.py')],env=env_service,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
 deadline=time.monotonic()+10
 while not sock.exists() and time.monotonic()<deadline:
  if broker.poll() is not None:raise RuntimeError('synthetic broker exited before readiness')
  time.sleep(0.05)
 assert sock.exists(),'synthetic Unix broker not ready'
 fixture={'policy':{'version':1,'revision':1,'enabled':True,'credentialActive':True,'credentialVersionId':cfg['credentialVersionId'],'profileVersion':cfg['profile'],'trustStoreVersion':cfg['trustStoreVersion'],'expectedCnpj':'15883671000115','certificateFingerprintSha256':C.req['certificateFingerprintSha256']},'validatorControl':f'http://127.0.0.1:{server.server_port}/control','validatorToken':token}
 fixture_path=C.root/'public-fixture.json';fixture_path.write_text(json.dumps(fixture));fixture_path.chmod(0o600)
 empty=C.root/'empty';empty.mkdir(mode=0o700)
 env={k:os.environ[k] for k in ['HOME','LANG'] if k in os.environ}
 env.update(PATH=str(NODE.parent)+':/usr/bin:/bin',NODE_ENV='test',MAIL_PROVIDER='dev',SIGNER='none',APPROVER_EMAIL='',RECIPIENTS='',BATCH_SIZE='1',BATCH_A1_ENABLED='1',A1_VALIDATION_ENABLED='1',A1_VALIDATION_ACCEPTED_POLICIES=json.dumps([{'profile':'QA-SYNTHETIC-CONTRACT-ONLY','policyOid':'2.16.76.1.7.1.11.1.3'}]),ICP_VALIDATOR_URL=f'http://127.0.0.1:{server.server_port}/validate',ICP_VALIDATOR_TOKEN=token,A1_WORKER_SOCKET=str(sock),CRON_SECRET='QA-E2E-CRON-NOT-REAL-0123456789',DEV_DB_PORT='54377',DEV_DB_DIR=str(C.root/'postgres-qa'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54377/peticao',TMPDIR=str(C.root),HASH_PEPPER='QA-E2E-NEVER-PRODUCTION-0123456789',SECRETS_DIR=str(empty),PETICAO_CONFIG_DIR=str(empty),CREDENTIALS_DIRECTORY=str(empty),QA_A1_E2E_FIXTURE=str(fixture_path),QA_A1_E2E_OUTPUT_DIR=str(OUT))
 command=[str(NODE),'scripts/with-db.mjs',str(NODE),'--import','tsx',str(OUT/'scenario.ts')]
 with (OUT/'scenario.log').open('w') as f:
  child=subprocess.Popen(command,cwd=ROOT/'site',env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=child.wait(timeout=300 if args.browser else 180)
  except subprocess.TimeoutExpired:
   import signal
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   code=124
 stable=before==manifest() and COMMIT==subprocess.check_output(['/usr/bin/git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
 if code==0 and (state['pdfRequests']!=2 or state['cryptographicChecks']!=2):code=2
 report={'exit':code,'commit':COMMIT,'commitStable':stable,'syntheticOnly':True,'notIcpHomologation':True,'validatorTrustSimulated':True,'validatorRequests':state['pdfRequests'],'realCryptographicChecks':state['cryptographicChecks'],'databasePort':54377,'browserToActualApi':args.browser,'qaDatabaseStorage':'private-user-tmpfs' if args.browser else 'private-disk','log':str(OUT/'scenario.log')}
 (OUT/'source-manifest.json').write_text(json.dumps(before,sort_keys=True));(OUT/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));print((OUT/'scenario.log').read_text()[-6000:])
 if code or not stable:raise SystemExit(code or 2)
 assert state['pdfRequests']==2 and state['cryptographicChecks']==2
finally:
 if broker:
  broker.terminate()
  try:broker.wait(timeout=5)
  except subprocess.TimeoutExpired:broker.kill();broker.wait()
 if log:log.close()
 if server:server.shutdown();server.server_close()
 # Only the self-created QA postmaster can be stopped here; never another service.
 pid_file=C.root/'postgres-qa'/'postmaster.pid'
 if pid_file.exists():
  lines=pid_file.read_text().splitlines()
  if len(lines)>3 and lines[3]=='54377':
   subprocess.run([str(ROOT/'site/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl'),'-D',str(C.root/'postgres-qa'),'-m','immediate','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
 C.tearDownClass()
