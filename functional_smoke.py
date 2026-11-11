#!/usr/bin/python3
"""Own fixture DB and frozen runtime only; no deployment or document mutations."""
import pathlib,subprocess,os,json,hashlib,time,http.client,urllib.parse,signal,uuid,shutil,socket,importlib.util,re
from local_controller import DockerPG,Cancelled,live_context,cgroup_of,verify_local_context,CancellationState
ROOT=pathlib.Path(__file__).resolve().parent
CONFIG_PATH=os.environ.get('HISTORY_SMOKE_CONFIG')
CONFIG=json.loads(pathlib.Path(CONFIG_PATH).read_text()) if CONFIG_PATH else {}
NODE=pathlib.Path(CONFIG.get('node_path','/usr/bin/node'))
NODE_SHA=CONFIG.get('node_sha256','ca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e')
EXPECTED_CGROUP=CONFIG.get('expected_cgroup')
SOURCE=pathlib.Path(CONFIG.get('schema_source_dir',str(ROOT/'schema-sources')))
RUNTIME_SOURCE=pathlib.Path(CONFIG.get('runtime_dir',str(ROOT/'runtime-source/runtime')))
ORIGIN_RUNTIME=pathlib.Path(CONFIG.get('origin_runtime_dir','/missing-origin-runtime'))
RELEASE_MANIFEST=pathlib.Path(CONFIG.get('release_manifest',str(ROOT/'runtime-source/release-manifest.json')))
DB='postgres://fixture_only:fixture_only@127.0.0.1:55490/fixture_only'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify_runtime_tree(root,manifest):
 if not root.is_dir() or root.is_symlink():return False
 actual=set()
 for item in root.rglob('*'):
  if item.is_symlink() or not(item.is_file() or item.is_dir()):return False
  if item.is_file():actual.add(str(item.relative_to(root)))
 if actual!=set(manifest['files']):return False
 return all((root/name).stat().st_size==entry['bytes'] and digest(root/name)==entry['sha256'] for name,entry in manifest['files'].items())

def command(args,**kw):
 p=subprocess.run(args,text=True,capture_output=True,timeout=60,**kw)
 if p.returncode:raise RuntimeError('command failed '+args[0]+': '+p.stderr[:2000])
 return p.stdout.strip()
def members(pgid):
 result=[]
 for p in pathlib.Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    f=(p/'stat').read_text().rsplit(')',1)[1].split()
    if int(f[2])==pgid and f[0]!='Z':result.append(int(p.name))
   except (OSError,ValueError,IndexError):pass
 return result

def stop_owned_node(proc,expected_cgroup,start_ticks,proc_root=pathlib.Path('/proc')):
 ids=members(proc.pid)
 for pid in ids:
  try:
   path=proc_root/str(pid)
   if path.stat().st_uid!=os.getuid() or cgroup_of(pid,proc_root)!=expected_cgroup:raise RuntimeError('refuse signalling process group outside own job')
   if pid==proc.pid and (path/'stat').read_text().rsplit(')',1)[1].split()[19]!=start_ticks:raise RuntimeError('Node PID reused; never signal it')
  except FileNotFoundError:pass
 if ids:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:
   for pid in members(proc.pid):
    try:
     if cgroup_of(pid,proc_root)!=expected_cgroup:raise RuntimeError('refuse kill after cgroup changed')
    except FileNotFoundError:pass
   os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
 return {'remainingProcesses':members(proc.pid),'cgroup':expected_cgroup}

def bootstrap_local_fixture(pg,config):
 # Re-fence after all runtime/schema copying, and immediately before every PG stage/SQL handshake.
 for action in [pg.prepare,pg.initialize,pg.start]:
  verify_local_context(config);action()
 verify_local_context(config);return pg.bootstrap()

def main():
 os.umask(0o077)
 if CONFIG_PATH!=str(ROOT/'config.json') or not EXPECTED_CGROUP:raise RuntimeError('explicit LOCAL Docker profile config/cgroup required')
 from local_controller import verify_local_manifest
 verify_local_manifest()
 limits=live_context(EXPECTED_CGROUP)
 job_deadline=time.monotonic()+600
 cancellation=CancellationState()
 for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,cancellation.handle)
 signal.alarm(600)
 executor=verify_local_context(CONFIG)
 for port in [55490,31390]:
  with socket.socket() as s:
   if s.connect_ex(('127.0.0.1',port))==0:raise RuntimeError('reserved port already occupied')
 if not re.fullmatch('[a-f0-9]{64}',NODE_SHA) or digest(NODE)!=NODE_SHA:raise RuntimeError('node drift')
 if digest(RELEASE_MANIFEST)!='7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3':raise RuntimeError('release manifest pin mismatch')
 observed=json.loads(command([str(NODE),'--eval',"console.log(JSON.stringify({node:process.versions.node,modules:process.versions.modules,napi:process.versions.napi,arch:process.arch,platform:process.platform}))"],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'LANG':'C.UTF-8'}))
 if observed!={'node':'20.19.2','modules':'115','napi':'9','arch':'x64','platform':'linux'}:raise RuntimeError('Node ABI/version target mismatch')
 for path in [NODE,SOURCE,RUNTIME_SOURCE,RELEASE_MANIFEST]:
  if not path.is_absolute() or path.is_symlink():raise RuntimeError('input path not absolute/canonical')
 manifest=json.loads(RELEASE_MANIFEST.read_text())
 if not verify_runtime_tree(ORIGIN_RUNTIME,manifest):raise RuntimeError('original R2 runtime hash drift')
 if not verify_runtime_tree(RUNTIME_SOURCE,manifest):raise RuntimeError('runtime input inventory/hash/symlink mismatch; never copy unknown files')
 needed=sum(((v['bytes']+4095)//4096)*4096 for v in manifest['files'].values())
 statfs=os.statvfs(ROOT)
 if statfs.f_bavail*statfs.f_frsize<2*1024**3+64*1024**2:raise RuntimeError('LOCAL fixture requires user-available2GiB plus64MiB receipts; existing runtime reused')
 nonce=uuid.uuid4().hex[:12];run=ROOT/'runs'/nonce;run.mkdir(mode=0o700,parents=True)
 for d in ['empty','tmp','sources','pdf-fixtures','downloads','tools','mail-outbox']: (run/d).mkdir(mode=0o700)
 # Runtime reused directly after complete inventory; not mount/read-only enforced.
 for tool in ['functional_smoke.py','local_controller.py','docker_control.py','fixture.cjs','seed_contract.cjs','package_http.py','browser_hook.py','package-browser.cjs','functional-guard.mjs']:
  shutil.copy2(ROOT/tool,run/'tools'/tool)
 fixtures=[]
 def pdf_bytes(text):
  stream=('BT /F1 16 Tf 50 750 Td ('+text+') Tj ET').encode('ascii')
  objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
  out=b'%PDF-1.4\n';offsets=[0]
  for i,obj in enumerate(objects,1):offsets.append(len(out));out+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
  start=len(out);out+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(('%010d 00000 n \n'%x).encode() for x in offsets[1:]);out+=b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(start).encode()+b'\n%%EOF\n';return out
 for name,text in [('batch-1.pdf','Synthetic package one NOT ICP'),('batch-2.pdf','Synthetic package two NOT ICP'),('base.pdf','Synthetic peticao base NOT govbr')]:
  data=pdf_bytes(text);(run/'pdf-fixtures'/name).write_bytes(data);fixtures.append({'filename':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
 (run/'pdf-fixtures/manifest.json').write_text(json.dumps(fixtures,indent=2)+'\n')

 source_hashes={}
 expected_schema_file=ROOT/'schema-source-manifest.json'
 if not expected_schema_file.is_file()or expected_schema_file.is_symlink():raise RuntimeError('required schema manifest missing')
 expected_schemas=json.loads(expected_schema_file.read_text())
 for name in ['db.ts','batch-a1-schema.ts','document-reference-schema.ts','petition-base-schema.ts','batch-package-schema.ts','president-own-document-schema.ts','president-own-a1-schema.ts','peticao.ts']:
  shutil.copy2(SOURCE/name,run/'sources'/name);source_hashes[name]=digest(run/'sources'/name)
  if source_hashes[name]!=expected_schemas[name]:raise RuntimeError('schema source pin mismatch')
 if digest(RELEASE_MANIFEST)!='7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3':raise RuntimeError('release manifest pin mismatch')
 manifest=json.loads(RELEASE_MANIFEST.read_text())
 def stable():return verify_runtime_tree(RUNTIME_SOURCE,manifest)
 if not stable():raise RuntimeError('runtime copy mismatch')
 (run/'source-manifest.json').write_text(json.dumps(source_hashes,indent=2)+'\n')
 env={'PATH':str(NODE.parent)+':/usr/bin:/bin','LANG':'C.UTF-8','NODE_ENV':'production','APP_URL':'http://127.0.0.1:31390','DATABASE_URL':DB,'HASH_PEPPER':'FUNCTIONAL_ONLY_NOT_A_PRODUCTION_PEPPER_0123456789','ADMIN_PASSWORD':'FixtureLegacy-NotUsed-998877','ADMIN_PASSWORD_FILE':str(run/'empty/never-present.hash'),'MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'Fixture <noreply@fixture.invalid>','CONTACT_TO':'noreply@fixture.invalid','CONTACT_BCC':'','RECIPIENTS':'qa-recipient@example.test','APPROVER_EMAIL':'qa-approver@example.test','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SIGNER':'none','PRESIDENT_OWN_ENABLED':'1','GOVBR_BASE_ENABLED':'1','BATCH_PACKAGE_ENABLED':'1','GOVBR_BASE_VALIDATION_ENABLED':'1','GOVBR_BASE_VALIDATOR_URL':'http://127.0.0.1:1/validate','GOVBR_BASE_VALIDATOR_TOKEN':'QA-R10-ONLY','GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES':'["QA-R10-PROOF"]','MAIL_ARCHIVE_RETENTION':'30','MAIL_OUTBOX_DIR':str(run/'mail-outbox'),'R10_RUNTIME':str(RUNTIME_SOURCE),'NEXT_TELEMETRY_DISABLED':'1','CI':'1','TMPDIR':str(run/'tmp'),'RUNTIME_SMOKE_RUN':str(run),'RUNTIME_SMOKE_PORT':'31390','FUNCTIONAL_NONCE':nonce,'FUNCTIONAL_PGDATA':'/var/lib/postgresql/data','NODE_OPTIONS':'--max-old-space-size=1536 --import='+str(ROOT/'functional-guard.mjs')}
 for key in ['HOME','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']:env[key]=str(run/'empty')
 def fixture(action):
  remaining=job_deadline-time.monotonic()
  if remaining<=0:raise TimeoutError('job budget exhausted before fixture action')
  p=subprocess.run([str(NODE),str(ROOT/'fixture.cjs'),action],cwd=RUNTIME_SOURCE,env=env,text=True,capture_output=True,timeout=min(60,remaining))
  (run/(action+'.log')).write_text(p.stdout+p.stderr)
  if p.returncode:raise RuntimeError('fixture '+action+' failed: '+p.stderr[:1200])
  return json.loads(p.stdout)
 pg=DockerPG(run,nonce,EXPECTED_CGROUP,env,NODE,CONFIG);proc=None
 result={'classification':'LOCAL_R0010_TWO_PDF_APPROVAL_RECONCILIATION_BROWSER_PG17','operationalReady':False,'run':str(run),'sourceCommit':manifest['source_commit'],'checks':[],'dbPort':55490,'appPort':31390,'node':'20.19.2','postgresBackend':'local-docker17.11','santiagoExecution':False,'workerJob':False,'limits':limits,'nonce':nonce,'browserProtocolMutatingRequestsExpected':True,'documentBytePreservationExpected':True,'deployment':False,'runtimeReusedNotMountReadOnly':True,'stepupNote':'State seeded only after successful real login; email challenge is outside this smoke'}
 try:
  if time.monotonic()>job_deadline:raise TimeoutError('job budget exhausted before LOCAL Docker PG')
  result['postgresHandshake']=bootstrap_local_fixture(pg,CONFIG)
  result['seed']=fixture('seed');result['before']=fixture('snapshot')
  log=(run/'server.log').open('w');proc=subprocess.Popen([str(NODE),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','31390'],cwd=RUNTIME_SOURCE,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  node_start=(pathlib.Path('/proc')/str(proc.pid)/'stat').read_text().rsplit(')',1)[1].split()[19]
  (run/'pid.json').write_text(json.dumps({'startTicks':node_start,'cgroup':EXPECTED_CGROUP,'pid':proc.pid,'pgid':proc.pid,'nonce':nonce,'postgresData':str(pg.data),'postgresNonce':nonce})+'\n')
  def request(method,path,body=None,cookie=None):
   allowed=(method=='GET'and path=='/presidente')or(method=='POST'and path=='/api/admin/login')
   if not allowed:raise RuntimeError('HTTP method/path outside fixed protocol allowlist')
   remaining=job_deadline-time.monotonic()
   if remaining<=0:raise TimeoutError('job budget exhausted')
   c=http.client.HTTPConnection('127.0.0.1',31390,timeout=min(15,remaining));headers={}
   if cookie:headers['Cookie']=cookie
   if body is not None:headers.update({'Content-Type':'application/x-www-form-urlencoded','Origin':'http://127.0.0.1:31390'})
   c.request(method,path,body,headers);response=c.getresponse();data=response.read(8*1024*1024);h={k.lower():v for k,v in response.getheaders()};status=response.status;c.close();return status,data,h
  deadline=time.monotonic()+45
  while True:
   if proc.poll() is not None:raise RuntimeError('Next terminated early')
   try:
    if request('GET','/presidente')[0]==200:break
   except OSError:pass
   if time.monotonic()>deadline:raise TimeoutError('Next readiness')
   time.sleep(.3)
  def check(label,method,path,expect,body=None,cookie=None):
   status,data,headers=request(method,path,body,cookie)
   result['checks'].append({'check':label,'method':method,'path':path,'status':status,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
   if status!=expect:raise RuntimeError('status '+label+':'+str(status))
   return data,headers
  from package_http import verify_sent_batch,verify_document_preservation,spool_state
  from browser_hook import run_browser_hook
  data,headers=check('owner HTTP login before browser','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'owner@fixture.invalid','password':'Fixture-Only-92837465'}))
  cookie=headers.get('set-cookie','').split(';')[0]
  if not cookie.startswith('adm=')or not all(v in headers.get('set-cookie','')for v in ['Secure','HttpOnly','SameSite=strict']):raise RuntimeError('unchanged secure HTTP login session required')
  result['syntheticStepup']=fixture('stepup-fixture')
  fixture('fault-on')
  assets=sorted(('/_next/static/'+name[len('.next/static/'):])if name.startswith('.next/static/')else('/'+name[len('public/'):])for name in manifest['files']if name.startswith(('.next/static/','public/')))
  result['browser']=run_browser_hook(run,cookie,result['seed']['packages'],EXPECTED_CGROUP,NODE,CONFIG,cancellation,fixture,assets)
  final=fixture('snapshot');verify_sent_batch(final,1);verify_sent_batch(final,2)
  verify_document_preservation(result['before']['documentByteFingerprints'],final['documentByteFingerprints'])
  if final['counts']!={'batch_sends':2,'mail_messages':4,'mail_message_attempts':4,'mail_outbox':0} or len([m for m in final['messages']if m['kind']=='lote'and m['status']=='accepted'])!=2:raise RuntimeError('exactly two accepted package transports required')
  verified=fixture('verify-attachments')
  if len(verified['verified'])!=2 or sorted(v['batchId']for v in verified['verified'])!=[1,2]or not all(v['exactBytes']for v in verified['verified']):raise RuntimeError('both archived two-PDF envelopes must match exact bytes')
  spool=spool_state(run)
  if len(spool)!=4:raise RuntimeError('two approval codes plus two package dev spool files required')
  result['protocol']={'complete':True,'documentByteFingerprintsStable':True,'browserApprovalAndReconciliation':True,'spoolFiles':4,'acceptedPackageTransports':2,'exactAttachmentProofs':verified,'realDeliveryConfirmed':False,'cryptographicValidation':False,'remaining':['expiry and five wrong codes HTTP','indeterminate transport','real certificate validator and delivery']}
  result['exit']=0
 except BaseException as e:result.update(exit=1,error=type(e).__name__+':'+str(e),cancelled=isinstance(e,(Cancelled,KeyboardInterrupt)))
 finally:
  cancellation.cleaning=True;signal.alarm(0)
  result['localContext']=executor
  if proc:
   try:
    result['nodeCleanup']=stop_owned_node(proc,EXPECTED_CGROUP,node_start)
    result['remainingAppProcesses']=result['nodeCleanup']['remainingProcesses']
   except BaseException as cleanup_error:
    result['nodeCleanup']={'uncertain':True,'error':type(cleanup_error).__name__+':'+str(cleanup_error)};result['exit']=1
   finally:log.close()
  try:
   result['postgresCleanup']=pg.stop()
   if not result['postgresCleanup'].get('stopped'):result['exit']=1
   result['dockerCleanup']=result['postgresCleanup']
  except BaseException as cleanup_error:
   result['postgresCleanup']={'stopped':False,'uncertain':True,'error':type(cleanup_error).__name__+':'+str(cleanup_error)};result['exit']=1
  result['postgresLifecycle']=pg.report()
  result['runtimeStable']=stable();result['originRuntimeStable']=verify_runtime_tree(ORIGIN_RUNTIME,manifest)
  records=[json.loads(x) for x in (run/'guard.jsonl').read_text().splitlines()] if (run/'guard.jsonl').exists() else []
  result['guardInstalled']=any(x['kind']=='installed' for x in records);result['guardDenials']=sum(x['kind']=='denied' for x in records)
  result['cancelSignals']=cancellation.signals
  if result.get('remainingAppProcesses') or not result['runtimeStable'] or not result['originRuntimeStable'] or result['guardDenials'] or result['guardInstalled'] is not True or result.get('protocol',{}).get('complete')is not True or cancellation.signals:result['exit']=1
  (run/'result.json').write_text(json.dumps(result,indent=2)+'\n');(ROOT/'latest-run.json').write_text(json.dumps({'run':str(run),'exit':result['exit']})+'\n')
 from local_controller import finalize_local
 result=finalize_local(run,result,EXPECTED_CGROUP)
 cancellation.cleaning=False # A later signal raises: outer unit must never report successful cancellation.
 if cancellation.signals:
  result['exit']=1;result['cancelSignals']=cancellation.signals;(run/'outer-result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2));return result['exit']
if __name__=='__main__':raise SystemExit(main())
