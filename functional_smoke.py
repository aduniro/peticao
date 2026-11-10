#!/usr/bin/python3
"""Own fixture DB and frozen runtime only; no deployment or document mutations."""
import pathlib,subprocess,os,json,hashlib,time,http.client,urllib.parse,signal,uuid,shutil,socket,importlib.util,re
from native_pg import NativePG,Cancelled,live_context,cgroup_of
ROOT=pathlib.Path(__file__).resolve().parent
CONFIG_PATH=os.environ.get('HISTORY_SMOKE_CONFIG')
CONFIG=json.loads(pathlib.Path(CONFIG_PATH).read_text()) if CONFIG_PATH else {}
PORTABLE=ROOT.parent/'r0000-portable-runtime-20261110'
NODE=pathlib.Path(CONFIG.get('node_path','/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node'))
NODE_SHA=CONFIG.get('node_sha256','b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac')
EXPECTED_CGROUP=CONFIG.get('expected_cgroup')
SOURCE=pathlib.Path(CONFIG.get('schema_source_dir',str(ROOT/'schema-sources') if (ROOT/'schema-sources').exists() else str(ROOT.parent/'r0000-production-profile-20261110/runs/build-1794348288170924986/clone/site/src/lib')))
RUNTIME_SOURCE=pathlib.Path(CONFIG.get('runtime_dir',str(PORTABLE/'export/runtime')))
RELEASE_MANIFEST=pathlib.Path(CONFIG.get('release_manifest',str(ROOT/'release-manifest.json') if (ROOT/'release-manifest.json').exists() else str(PORTABLE/'export/release-manifest.json')))
COORD_PREFIX=CONFIG.get('coord_cli_prefix',['/usr/bin/python3','/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'])
DB='postgres://fixture_only:fixture_only@127.0.0.1:55485/fixture_only'
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

def main():
 os.umask(0o077)
 if not CONFIG_PATH or not EXPECTED_CGROUP:raise RuntimeError('explicit native profile config/cgroup required')
 limits=live_context(EXPECTED_CGROUP)
 job_deadline=time.monotonic()+600
 def cancelled(signum,frame):raise Cancelled('executor cancellation signal')
 signal.signal(signal.SIGTERM,cancelled)
 lease=json.loads((ROOT/'active-lease.json').read_text())['result']
 gate=json.loads(command([*COORD_PREFIX,'check','--actor','admin','--lease',lease['lease'],'--token',lease['token'],'--fence',str(lease['fence'])]))
 if gate.get('ok') is not True:raise RuntimeError('coordination lease not confirmed')
 for port in [55485,31385]:
  with socket.socket() as s:
   if s.connect_ex(('127.0.0.1',port))==0:raise RuntimeError('reserved port already occupied')
 if not re.fullmatch('[a-f0-9]{64}',NODE_SHA) or digest(NODE)!=NODE_SHA:raise RuntimeError('node drift')
 if digest(RELEASE_MANIFEST)!='12b7d8a8e617c98c7d4f22b9e0865b8e3cde63e8d8933b871f65cceb68f72576':raise RuntimeError('release manifest pin mismatch')
 observed=json.loads(command([str(NODE),'--eval',"console.log(JSON.stringify({node:process.versions.node,modules:process.versions.modules,napi:process.versions.napi,arch:process.arch,platform:process.platform}))"],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'LANG':'C.UTF-8'}))
 if observed!={'node':'20.19.2','modules':'115','napi':'9','arch':'x64','platform':'linux'}:raise RuntimeError('Node ABI/version target mismatch')
 for path in [NODE,SOURCE,RUNTIME_SOURCE,RELEASE_MANIFEST]:
  if not path.is_absolute() or path.is_symlink():raise RuntimeError('input path not absolute/canonical')
 manifest=json.loads(RELEASE_MANIFEST.read_text())
 if not verify_runtime_tree(RUNTIME_SOURCE,manifest):raise RuntimeError('runtime input inventory/hash/symlink mismatch; never copy unknown files')
 if shutil.disk_usage(ROOT).free<2*1024**3:raise RuntimeError('fixture job requires 2GiB free disk')
 nonce=uuid.uuid4().hex[:12];run=ROOT/'runs'/nonce;run.mkdir(mode=0o700,parents=True)
 for d in ['empty','tmp','sources','pdf-fixtures','downloads','tools']: (run/d).mkdir(mode=0o700)
 shutil.copytree(RUNTIME_SOURCE,run/'runtime')
 for tool in ['functional_smoke.py','native_pg.py','fixture.cjs','functional-guard.mjs']:
  shutil.copy2(ROOT/tool,run/'tools'/tool)
 fixtures=[]
 def pdf_bytes(text):
  stream=('BT /F1 16 Tf 50 750 Td ('+text+') Tj ET').encode('ascii')
  objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
  out=b'%PDF-1.4\n';offsets=[0]
  for i,obj in enumerate(objects,1):offsets.append(len(out));out+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
  start=len(out);out+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(('%010d 00000 n \n'%x).encode() for x in offsets[1:]);out+=b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(start).encode()+b'\n%%EOF\n';return out
 for ordinal,identifier in [(1,'11111111-1111-4111-8111-111111111111'),(2,'22222222-2222-4222-8222-222222222222')]:
  filename='version-'+str(ordinal)+'.pdf';data=pdf_bytes('Synthetic history version '+str(ordinal)+' - no signature');(run/'pdf-fixtures'/filename).write_bytes(data);fixtures.append({'id':identifier,'ordinal':ordinal,'filename':filename,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'capturedAt':'2026-11-10T12:00:0'+str(ordinal)+'Z'})
 (run/'pdf-fixtures/manifest.json').write_text(json.dumps(fixtures,indent=2)+'\n')

 source_hashes={}
 expected_schema_file=ROOT/'schema-source-manifest.json'
 expected_schemas=json.loads(expected_schema_file.read_text()) if expected_schema_file.exists() else None
 for name in ['db.ts','batch-a1-schema.ts','document-reference-schema.ts','petition-base-schema.ts','batch-package-schema.ts','president-own-document-schema.ts','president-own-a1-schema.ts']:
  shutil.copy2(SOURCE/name,run/'sources'/name);source_hashes[name]=digest(run/'sources'/name)
  if expected_schemas and source_hashes[name]!=expected_schemas[name]:raise RuntimeError('schema source pin mismatch')
 if digest(RELEASE_MANIFEST)!='12b7d8a8e617c98c7d4f22b9e0865b8e3cde63e8d8933b871f65cceb68f72576':raise RuntimeError('release manifest pin mismatch')
 manifest=json.loads(RELEASE_MANIFEST.read_text())
 def stable():return verify_runtime_tree(run/'runtime',manifest)
 if not stable():raise RuntimeError('runtime copy mismatch')
 (run/'source-manifest.json').write_text(json.dumps(source_hashes,indent=2)+'\n')
 env={'PATH':str(NODE.parent)+':/usr/bin:/bin','LANG':'C.UTF-8','NODE_ENV':'production','APP_URL':'http://127.0.0.1:31385','DATABASE_URL':DB,'HASH_PEPPER':'FUNCTIONAL_ONLY_NOT_A_PRODUCTION_PEPPER_0123456789','ADMIN_PASSWORD':'FixtureLegacy-NotUsed-998877','ADMIN_PASSWORD_FILE':str(run/'empty/never-present.hash'),'MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'Fixture <noreply@fixture.invalid>','CONTACT_TO':'noreply@fixture.invalid','CONTACT_BCC':'','RECIPIENTS':'','APPROVER_EMAIL':'','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SIGNER':'none','PRESIDENT_OWN_ENABLED':'1','GOVBR_BASE_ENABLED':'1','NEXT_TELEMETRY_DISABLED':'1','CI':'1','TMPDIR':str(run/'tmp'),'RUNTIME_SMOKE_RUN':str(run),'RUNTIME_SMOKE_PORT':'31385','FUNCTIONAL_NONCE':nonce,'FUNCTIONAL_PGDATA':str(run/'postgres'),'NODE_OPTIONS':'--max-old-space-size=1536 --import='+str(ROOT/'functional-guard.mjs')}
 for key in ['HOME','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']:env[key]=str(run/'empty')
 def fixture(action):
  remaining=job_deadline-time.monotonic()
  if remaining<=0:raise TimeoutError('job budget exhausted before fixture action')
  p=subprocess.run([str(NODE),str(ROOT/'fixture.cjs'),action],cwd=run/'runtime',env=env,text=True,capture_output=True,timeout=min(60,remaining))
  (run/(action+'.log')).write_text(p.stdout+p.stderr)
  if p.returncode:raise RuntimeError('fixture '+action+' failed: '+p.stderr[:1200])
  return json.loads(p.stdout)
 pg=NativePG(run,nonce,EXPECTED_CGROUP);proc=None
 result={'classification':'POPULATED_HISTORY_NATIVE_PG17_NOT_HTTP_QUALIFIED_UNTIL_EXECUTED','operationalReady':False,'run':str(run),'sourceCommit':manifest['source_commit'],'checks':[],'dbPort':55485,'appPort':31385,'node':'20.19.2','postgresBackend':'native17.11','limits':limits,'nonce':nonce,'documentMutatingRequests':0,'deployment':False,'stepupNote':'State seeded only after successful real login; email challenge is outside this smoke'}
 try:
  if time.monotonic()>job_deadline:raise TimeoutError('job budget exhausted before native PG')
  pg.prepare();pg.initialize();pg.start();result['postgresHandshake']=pg.bootstrap()
  result['seed']=fixture('seed');result['before']=fixture('snapshot')
  log=(run/'server.log').open('w');proc=subprocess.Popen([str(NODE),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','31385'],cwd=run/'runtime',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  node_start=(pathlib.Path('/proc')/str(proc.pid)/'stat').read_text().rsplit(')',1)[1].split()[19]
  (run/'pid.json').write_text(json.dumps({'startTicks':node_start,'cgroup':EXPECTED_CGROUP,'pid':proc.pid,'pgid':proc.pid,'nonce':nonce,'postgresData':str(pg.data),'postgresNonce':nonce})+'\n')
  def request(method,path,body=None,cookie=None):
   remaining=job_deadline-time.monotonic()
   if remaining<=0:raise TimeoutError('job budget exhausted')
   c=http.client.HTTPConnection('127.0.0.1',31385,timeout=min(15,remaining));headers={}
   if cookie:headers['Cookie']=cookie
   if body is not None:headers.update({'Content-Type':'application/x-www-form-urlencoded','Origin':'http://127.0.0.1:31385'})
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
  check('unauthenticated history','GET','/api/admin/lotes/1/versoes',401)
  data,h=check('wrong password','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'owner@fixture.invalid','password':'Wrong-Only-778899'}))
  if 'set-cookie' in h or 'erro=' not in h.get('location',''):raise RuntimeError('wrong password accepted')
  data,h=check('synthetic owner login','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'owner@fixture.invalid','password':'Fixture-Only-92837465'}))
  cookie=h.get('set-cookie','').split(';')[0]
  if not cookie.startswith('adm=') or 'Secure' not in h.get('set-cookie',''):raise RuntimeError('missing secure session cookie')
  check('step-up enforced','GET','/api/admin/lotes/1/versoes',403,cookie=cookie)
  result['syntheticStepup']=fixture('stepup-fixture')
  data,h=check('populated document history','GET','/api/admin/lotes/1/versoes',200,cookie=cookie)
  listing=json.loads(data)
  if not listing.get('ok') or [v['id'] for v in listing['versions']]!=[fixtures[1]['id'],fixtures[0]['id']] or listing['nextBefore'] is not None:raise RuntimeError('history order/identifiers')
  for got,item in zip(listing['versions'],reversed(fixtures)):
   if got['ordinal']!=item['ordinal'] or got['sha256']!=item['sha256'] or got['byte_length']!=item['bytes'] or got['variant']!='original' or got['source']!='prepared' or got['signature_kind'] is not None or got['author_id']!=1:raise RuntimeError('history metadata mismatch')
  result['historyContent']={'order':[2,1],'metadataMatched':True,'cryptographicSignatures':0}
  data,h=check('history ordinal filter','GET','/api/admin/lotes/1/versoes?antes=2',200,cookie=cookie)
  if [v['id'] for v in json.loads(data)['versions']]!=[fixtures[0]['id']]:raise RuntimeError('ordinal filter content')
  for item in fixtures:
   data,h=check('download version '+str(item['ordinal']),'GET','/api/admin/lotes/1/versoes/'+item['id'],200,cookie=cookie)
   if data!=(run/'pdf-fixtures'/item['filename']).read_bytes() or hashlib.sha256(data).hexdigest()!=item['sha256']:raise RuntimeError('download body mismatch')
   expectedDisposition='attachment; filename="lote-1-versao-'+str(item['ordinal'])+'-original.pdf"'
   for key,wanted in {'content-type':'application/pdf','content-disposition':expectedDisposition,'cache-control':'private, no-store','x-content-type-options':'nosniff','x-document-sha256':item['sha256']}.items():
    if h.get(key)!=wanted:raise RuntimeError('download header '+key)
   (run/'downloads'/item['filename']).write_bytes(data)
  check('cross batch version not found','GET','/api/admin/lotes/2/versoes/'+fixtures[0]['id'],404,cookie=cookie)
  check('nonexistent version','GET','/api/admin/lotes/1/versoes/33333333-3333-4333-8333-333333333333',404,cookie=cookie)
  check('malformed version rejected','GET','/api/admin/lotes/1/versoes/invalid',400,cookie=cookie)
  check('download without session','GET','/api/admin/lotes/1/versoes/'+fixtures[0]['id'],401)
  data,h=check('reader login','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'reader@fixture.invalid','password':'Fixture-Reader-92837465'}))
  reader_cookie=h.get('set-cookie','').split(';')[0]
  if not reader_cookie.startswith('adm='):raise RuntimeError('reader session missing')
  result['readerStepup']=fixture('stepup-fixture')
  check('reader history forbidden','GET','/api/admin/lotes/1/versoes',403,cookie=reader_cookie)
  check('reader download forbidden','GET','/api/admin/lotes/1/versoes/'+fixtures[0]['id'],403,cookie=reader_cookie)
  for label,path in [('base documents','/api/admin/documentos/base'),('president receipts','/api/admin/lotes/1/presidente/historico?kind=receipts'),('president artifacts','/api/admin/lotes/1/presidente/historico?kind=artifacts'),('batch page','/admin/lotes')]:
   data,h=check(label,'GET',path,200,cookie=cookie)
   if path.startswith('/api/') and json.loads(data).get('ok') is not True:raise RuntimeError('API not ok '+label)
  result['after']=fixture('snapshot')
  if result['before']['counts']!=result['after']['counts']:raise RuntimeError('business row counts changed')
  if result['after']['syntheticSessions']!=1 or result['after']['allSyntheticSessions']!=2:raise RuntimeError('session count')
  for key in ['documentRowsSha256','batchRowsSha256']:
   if result['before'][key]!=result['after'][key]:raise RuntimeError('fixture business content changed')
  result['exit']=0
 except BaseException as e:result.update(exit=1,error=type(e).__name__+':'+str(e),cancelled=isinstance(e,(Cancelled,KeyboardInterrupt)))
 finally:
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
   elif pg.prepared:result['socketCleanup']=pg.release_socket()
  except BaseException as cleanup_error:
   result['postgresCleanup']={'stopped':False,'uncertain':True,'error':type(cleanup_error).__name__+':'+str(cleanup_error)};result['exit']=1
  result['postgresLifecycle']=pg.report()
  result['runtimeStable']=stable();result['originRuntimeStable']=verify_runtime_tree(RUNTIME_SOURCE,manifest)
  records=[json.loads(x) for x in (run/'guard.jsonl').read_text().splitlines()] if (run/'guard.jsonl').exists() else []
  result['guardInstalled']=any(x['kind']=='installed' for x in records);result['guardDenials']=sum(x['kind']=='denied' for x in records)
  if result.get('remainingAppProcesses') or not result['runtimeStable'] or not result['originRuntimeStable'] or result['guardDenials']:result['exit']=1
  (run/'result.json').write_text(json.dumps(result,indent=2)+'\n');(ROOT/'latest-run.json').write_text(json.dumps({'run':str(run),'exit':result['exit']})+'\n')
 print(json.dumps(result,indent=2));return result['exit']
if __name__=='__main__':raise SystemExit(main())
