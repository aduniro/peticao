"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7',ORIGIN='http://127.0.0.1:31395';
const CHROME='/home/barre/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',CHROME_SHA='481fea1516a1f2b76454664272f12cd9dd1f20117b21e1f1498e08bc7f872c00';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function socketBudget(tmpdir) {
  // Linux sockaddr_un.sun_path is108bytes including the terminating NUL.
  // Reserve64bytes for Chromium's private directory/socket suffix.
  assert.ok(Buffer.byteLength(tmpdir) + 1 + 64 < 108, "short Chromium Unix socket path budget");
  return Buffer.byteLength(tmpdir) + 1 + 64;
}
function privateParent(parent, api = fs) {
  assert.equal(parent, `/run/user/${process.getuid()}`);
  const info = api.lstatSync(parent);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(info.uid, process.getuid());
  assert.equal(info.mode & 0o777, 0o700);
  assert.equal(api.realpathSync(parent), parent);
  return info;
}
function createShortTmp(nonce, api = fs) {
  assert.match(nonce, /^[a-f0-9]{12}$/);
  const parent = `/run/user/${process.getuid()}`; privateParent(parent, api);
  const directory = api.mkdtempSync(path.join(parent, `r15-${nonce}-`));
  api.chmodSync(directory, 0o700);
  socketBudget(directory);
  const info = api.lstatSync(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o700);
  assert.equal(api.realpathSync(directory), directory);
  return { parent, directory, nonce, uid: info.uid, dev: info.dev, ino: info.ino };
}
function removeShortTmp(identity, browserClosed, api = fs) {
  assert.equal(browserClosed, true, "browser must close before private temp removal");
  privateParent(identity.parent, api);
  assert.equal(path.dirname(identity.directory), identity.parent);
  assert.match(path.basename(identity.directory), new RegExp(`^r15-${identity.nonce}-[A-Za-z0-9]{6}$`));
  socketBudget(identity.directory);
  const info = api.lstatSync(identity.directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(api.realpathSync(identity.directory), identity.directory);
  for (const key of ["uid", "dev", "ino"]) assert.equal(info[key], identity[key]);
  assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o700);
  api.rmSync(identity.directory, { recursive: true, force: false });
  assert.equal(api.existsSync(identity.directory), false);
  return true;
}
function diagnostic(error, cookie = "") {
  let value = String(error);
  for (const secret of [cookie, cookie.startsWith("adm=") ? cookie.slice(4) : ""].filter(Boolean)) {
    value = value.split(secret).join("[REDACTED]");
    value = value.split(encodeURIComponent(secret)).join("[REDACTED]");
  }
  return value.length <= 4400 ? value : value.slice(0, 2100) + "\n...[diagnostic middle omitted]...\n" + value.slice(-2100);
}
function privateJson(filename){const st=fs.lstatSync(filename);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&st.nlink===1&&(st.mode&0o777)===0o600&&st.size<2*1024*1024);assert.equal(fs.realpathSync(filename),filename);return JSON.parse(fs.readFileSync(filename,'utf8'));}
const ROOT='/mnt/apps/peticao-final/_ops/qa-r0015-a1-admission-browser-20261111';
function validateConfig(cfg,filename,cgroup){const run=path.dirname(filename);assert.equal(path.dirname(run),ROOT+'/runs');assert.match(path.basename(run),/^[a-f0-9]{12}$/);assert.equal(filename,run+'/browser-config.json');assert.equal(cfg.run,run);assert.equal(cfg.sourceCommit,SOURCE);assert.equal(cfg.origin,ORIGIN);assert.equal(cfg.cgroup,cgroup);assert.ok(cgroup.endsWith('/peticao-r0015-a1-admission-browser-qa-20261111.service'));assert.match(cfg.cookie,/^adm=[A-Za-z0-9_.~-]{16,4096}$/);assert.match(cfg.documentVersion,/^[a-f0-9]{64}$/);assert.match(cfg.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(cfg.policyRevision,1);assert.equal(cfg.cryptographicOperationTested,false);assert.ok(Array.isArray(cfg.assetPaths)&&cfg.assetPaths.every(p=>(p.startsWith('/_next/static/')||p.startsWith('/')&&!p.startsWith('/api/'))&&!p.includes('..')&&!p.includes('?')&&!p.includes('#')));return run;}
function classifyRequest(raw,method,body,headers,cfg,state){const u=new URL(raw);if(u.origin!==ORIGIN||u.username||u.password||u.hash)return'external';
 if(headers['x-r15-observer']&&(headers['x-r15-observer']!=='1'||method!=='GET'||u.pathname!=='/api/admin/lotes/1/a1'))return'mutation';
 if(['GET','HEAD'].includes(method)){
  if(u.search===''&&(u.pathname==='/icon-192.png'||cfg.assetPaths.includes(u.pathname)&&!u.pathname.startsWith('/api/')||u.pathname==='/api/admin/alertas'))return'allowed';
  if(method!=='GET')return'unreviewed-get';
  if(u.pathname==='/admin/presidente'&&u.search==='?lote=1')return'allowed';
  if(u.pathname==='/api/admin/lotes/1/a1'&&(u.search===''||state.requestId&&u.search==='?requestId='+state.requestId))return'allowed';
  return'unreviewed-get';
 }
 if(headers['x-r15-observer'])return'mutation';
 if(method!=='POST'||u.pathname!=='/api/admin/lotes/1/a1'||u.search!==''||!state.armed||state.posted||headers.origin!==ORIGIN||(headers['content-type']||'').split(';')[0]!=='application/json')return'mutation';
 let v;try{v=JSON.parse(body);}catch{return'mutation';}
 if(!v||Object.keys(v).sort().join(',')!=='expectedDocumentVersion,expectedPolicyRevision,requestId'||v.expectedDocumentVersion!==cfg.documentVersion||v.expectedPolicyRevision!==cfg.policyRevision||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.requestId))return'mutation';
 state.posted=true;state.requestId=v.requestId;return'allowed-post';
}
function verifyJob(j,cfg,requestId){for(const[k,v]of Object.entries({requestId,batchId:1,documentVersion:cfg.documentVersion,policyRevision:1,inputSha256:cfg.sourceSha256,state:'queued',revision:1,attempts:0,ownArtifactId:null,outputVersionId:null,outputSha256:null,validationReportId:null,leaseUntil:null}))assert.equal(j[k],v,k);assert.match(j.jobId,/^[a-f0-9-]{36}$/);assert.equal(j.inputArtifactVersionId,cfg.historyVersionId);assert.equal(j.inputByteLength,cfg.pdfBytes);return j;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));let markers=[];function safeError(e){let s=String(e);for(const v of markers.filter(Boolean))s=s.split(v).join('[REDACTED]');return s.slice(0,2000);}
async function execute(filename){const cfg=privateJson(filename),cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(s=>s.startsWith('0::')).slice(3),run=validateConfig(cfg,filename,cg);markers=[cfg.cookie,cfg.cookie.slice(4)];assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,'1');const{chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');let browser,tmp,closed=false;const state={armed:false,posted:false,requestId:null};
 const result={sourceCommit:SOURCE,classification:'LOCAL_A1_ORIGINAL_QUEUED_ADMISSION_RECOVERY_ONLY',cryptographicOperationTested:false,workerExecuted:false,approvalOrSendAttempted:false,browserLoginUiTested:false,checks:[],requests:[],blocked:[],pageErrors:[],consoleErrors:[],exit:1,browserTmpRemoved:false};const check=(name,ok)=>{result.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 try{
  tmp=createShortTmp(path.basename(run));browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},env:{PATH:'/usr/bin:/bin',HOME:run+'/empty',TMPDIR:tmp.directory,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});assert.match(browser.version(),/^145\./);
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:false,serviceWorkers:'block'});check('fresh context without inherited cookies',(await context.cookies()).length===0);await context.addCookies([{name:'adm',value:cfg.cookie.slice(4),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url()),kind=classifyRequest(req.url(),req.method(),req.postData(),req.headers(),cfg,state);if(!['allowed','allowed-post'].includes(kind)){result.blocked.push({method:req.method(),path:u.pathname,kind});return route.abort();}result.requests.push({method:req.method(),path:u.pathname,query:u.search,source:req.headers()['x-r15-observer']==='1'?'observer':'app'});return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(safeError(e)));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safeError(m.text()));});
  const response=await page.goto(ORIGIN+'/admin/presidente?lote=1',{waitUntil:'networkidle'});check('authenticated original portal ready',response.status()===200);
  const trigger=page.getByRole('button',{name:'Assinar com certificado A1',exact:true}).first();await trigger.click();const dialog=page.getByRole('dialog',{name:'Assinar com certificado A1 · 1',exact:true});await dialog.waitFor();
  async function read(url){return page.evaluate(async url=>{const r=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'x-r15-observer':'1'}});return{status:r.status,value:await r.json()};},url);}
  const available=await read('/api/admin/lotes/1/a1');assert.equal(available.status,200);assert.equal(available.value.ok,true);assert.equal(available.value.available,true);assert.equal(available.value.documentVersion,cfg.documentVersion);assert.equal(available.value.policyRevision,1);assert.equal(available.value.latestJob,null);check('availability bound to actual original and policy',true);
  const submit=dialog.getByRole('button',{name:'Assinar com certificado A1',exact:true});await submit.waitFor();const enabledUntil=Date.now()+10000;while(!(await submit.isEnabled())){assert.ok(Date.now()<enabledUntil,'UI availability/readPending did not settle');await pause(25);}check('native explicit admission button enabled',await submit.isEnabled());state.armed=true;const posting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===ORIGIN+'/api/admin/lotes/1/a1');await submit.click();const posted=await posting;state.armed=false;check('one native A1 admission HTTP202',posted.status()===202&&state.posted);await dialog.getByRole('status').filter({hasText:'Aguardando assinatura'}).waitFor();check('queued status rendered without success claim',!(await dialog.innerText()).includes('ICP-Brasil'));
  fs.writeFileSync(run+'/admitted.json',JSON.stringify({nonce:path.basename(run),sourceCommit:SOURCE,requestId:state.requestId}),{mode:0o600,flag:'wx'});const ack=run+'/admitted-proof.json',deadline=Date.now()+15000;while(!fs.existsSync(ack)){assert.ok(Date.now()<deadline,'queued DB proof timeout');await pause(50);}const proof=privateJson(ack);assert.equal(proof.nonce,path.basename(run));assert.equal(proof.sourceCommit,SOURCE);const j=verifyJob(proof.job,cfg,state.requestId);check('DB confirms exact one inert queued job',true);check('new admission disabled while queued',await submit.isDisabled());
  const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([k])=>k.startsWith('a1-ui:'))));const selected=Object.keys(stored).filter(k=>k.endsWith(':selected'));assert.equal(selected.length,1);const pointer=stored[selected[0]],intent=JSON.parse(stored[pointer]);assert.deepEqual(intent,{batchId:1,requestId:state.requestId,expectedDocumentVersion:cfg.documentVersion,expectedPolicyRevision:1});check('sessionStorage holds exact original intent',true);
  const manual=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/a1?requestId='+state.requestId&&!r.request().headers()['x-r15-observer']);await dialog.getByRole('button',{name:'Conferir assinatura',exact:true}).click();assert.equal((await manual).status(),200);await dialog.getByRole('status').filter({hasText:'Aguardando assinatura'}).waitFor();const observed=await read('/api/admin/lotes/1/a1?requestId='+state.requestId);assert.equal(observed.status,200);assert.equal(observed.value.ok,true);assert.equal(verifyJob(observed.value.job,cfg,state.requestId).jobId,j.jobId);check('exact request GET recovers same queued job',true);
  await dialog.getByRole('button',{name:'Fechar',exact:true}).click();await page.reload({waitUntil:'networkidle'});const restored=await page.evaluate(k=>sessionStorage.getItem(k),pointer);assert.equal(restored,stored[pointer]);check('reload preserves same saved intent',true);await page.getByRole('button',{name:'Assinar com certificado A1',exact:true}).first().click();await dialog.getByRole('status').filter({hasText:'Aguardando assinatura'}).waitFor();check('reload reconciles queued through GET only',await dialog.getByRole('button',{name:'Assinar com certificado A1',exact:true}).isDisabled());
  const recheck=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/a1?requestId='+state.requestId&&!r.request().headers()['x-r15-observer']);await dialog.getByRole('button',{name:'Conferir assinatura',exact:true}).click();assert.equal((await recheck).status(),200);await dialog.getByRole('status').filter({hasText:'Aguardando assinatura'}).waitFor();const recovered=await read('/api/admin/lotes/1/a1?requestId='+state.requestId);assert.equal(recovered.status,200);assert.equal(verifyJob(recovered.value.job,cfg,state.requestId).jobId,j.jobId);check('same UUID job after reload',true);const observer=result.requests.filter(r=>r.source==='observer');assert.equal(observer.length,3);assert.ok(observer.every(r=>r.method==='GET'));result.observerGetCount=observer.length;result.appExactRequestGetCount=result.requests.filter(r=>r.source==='app'&&r.method==='GET'&&r.query==='?requestId='+state.requestId).length;assert.ok(result.appExactRequestGetCount>=2);check('observer reads separated from native UI reads',true);await page.screenshot({path:run+'/a1-browser.png',fullPage:true,mask:[page.locator('input[type="password"]')]});
  check('exactly one A1 POST no replay',result.requests.filter(r=>r.method==='POST').length===1);check('no unexpected requests',result.blocked.length===0);check('no JavaScript errors',result.pageErrors.length===0);check('no console errors',result.consoleErrors.length===0);result.jobId=j.jobId;result.requestId=state.requestId;await context.close();result.exit=0;
 }catch(e){result.error=safeError(e);}finally{if(browser)try{await browser.close();closed=true;}catch(e){result.exit=1;result.closeError=safeError(e);}if(tmp)try{result.browserTmpRemoved=removeShortTmp(tmp,closed);}catch(e){result.exit=1;result.tmpError=safeError(e);}if(!result.browserTmpRemoved)result.exit=1;fs.writeFileSync(run+'/private-markers.json',JSON.stringify(markers),{mode:0o600});fs.writeFileSync(run+'/a1-browser-result.json',JSON.stringify(result,null,2),{mode:0o600});}return result.exit;
}
module.exports={validateConfig,classifyRequest,socketBudget,verifyJob};if(require.main===module)execute(process.argv[2]).then(code=>process.exitCode=code).catch(e=>{console.error(safeError(e));process.exitCode=1;});
