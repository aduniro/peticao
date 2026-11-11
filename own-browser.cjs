"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7',ORIGIN='http://127.0.0.1:31394';
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
  const directory = api.mkdtempSync(path.join(parent, `r14-${nonce}-`));
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
  assert.match(path.basename(identity.directory), new RegExp(`^r14-${identity.nonce}-[A-Za-z0-9]{6}$`));
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
const ROOT='/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111';
function validateConfig(cfg,filename,cgroup){const run=path.dirname(filename);assert.equal(path.dirname(run),ROOT+'/runs');assert.match(path.basename(run),/^[a-f0-9]{12}$/);assert.equal(filename,run+'/browser-config.json');assert.equal(cfg.run,run);assert.equal(cfg.sourceCommit,SOURCE);assert.equal(cfg.origin,ORIGIN);assert.equal(cfg.cgroup,cgroup);assert.ok(cgroup.startsWith('/user.slice/')&&cgroup.endsWith('/peticao-r0014-own-document-browser-qa-20261111.service'));assert.match(cfg.cookie,/^adm=[A-Za-z0-9_.~-]{16,4096}$/);assert.match(cfg.receiptId,/^[a-f0-9-]{36}$/);assert.match(cfg.documentVersion,/^[a-f0-9]{64}$/);assert.match(cfg.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(cfg.identityPreconditionSeeded,true);assert.equal(cfg.externalIdentityVerified,false);assert.ok(Array.isArray(cfg.assetPaths)&&cfg.assetPaths.every(p=>p.startsWith('/_next/static/')||p.startsWith('/')&&!p.startsWith('/api/')&&!p.includes('..')));return run;}
function classifyRequest(raw,method,body,headers,cfg,state){const u=new URL(raw);if(u.origin!==ORIGIN||u.username||u.password||u.hash)return'external';
 if(['GET','HEAD'].includes(method)){
  if(u.search===''&&(u.pathname==='/icon-192.png'||cfg.assetPaths.includes(u.pathname)||u.pathname==='/api/admin/alertas'))return'allowed';
  if(u.pathname==='/admin/presidente'&&u.search==='?lote=1')return'allowed';
  if(u.pathname==='/api/admin/lotes/1/presidente/historico'&&['?kind=receipts','?kind=artifacts'].includes(u.search))return'allowed';
  if(state.requestId&&u.pathname==='/api/admin/presidente/documentos-proprios'&&u.search==='?requestId='+state.requestId)return'allowed';
  if(state.artifactId&&u.pathname==='/api/admin/presidente/documentos-proprios/'+state.artifactId&&u.search==='')return'allowed';
  return'unreviewed-get';
 }
 if(method!=='POST'||u.pathname!=='/api/admin/presidente/documentos-proprios'||u.search!==''||!state.armed||state.posted||headers.origin!==ORIGIN||(headers['content-type']||'').split(';')[0]!=='application/json')return'mutation';
 let v;try{v=JSON.parse(body);}catch{return'mutation';}
 if(!v||Object.keys(v).sort().join(',')!=='batchId,expectedDocumentVersion,receiptId,requestId'||v.batchId!==1||v.receiptId!==cfg.receiptId||v.expectedDocumentVersion!==cfg.documentVersion||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.requestId))return'mutation';
 state.posted=true;state.requestId=v.requestId;return'allowed-post';
}
function verifyMetadata(value,cfg,requestId){assert.deepEqual(Object.keys(value).sort(),['document','ok']);assert.equal(value.ok,true);const d=value.document;assert.deepEqual(Object.keys(d).sort(),'source,dispatchAllowed,icpBrasil,govBr,requestId,state,artifactId,batchId,receiptId,documentVersion,sha256,sourceSha256,error,createdAt'.split(',').sort());assert.equal(d.source,'president-own');for(const k of ['dispatchAllowed','icpBrasil','govBr'])assert.equal(d[k],false);assert.equal(d.requestId,requestId);assert.equal(d.batchId,1);assert.equal(d.receiptId,cfg.receiptId);assert.equal(d.documentVersion,cfg.documentVersion);assert.equal(d.state,'completed');assert.match(d.artifactId,/^[a-f0-9-]{36}$/);assert.match(d.sha256,/^[a-f0-9]{64}$/);assert.equal(d.sourceSha256,cfg.sourceSha256);assert.equal(d.error,null);assert.ok(typeof d.createdAt==='string'&&d.createdAt.length<=30&&Number.isFinite(Date.parse(d.createdAt)));return d;}
function verifyHistoryDocuments(value,cfg,artifact){assert.deepEqual(Object.keys(value).sort(),'ok,kind,batchId,documents,hasMore,nextCursor'.split(',').sort());assert.equal(value.ok,true);assert.equal(value.kind,'artifacts');assert.equal(value.batchId,1);assert.equal(value.hasMore,false);assert.equal(value.nextCursor,null);assert.equal(value.documents.length,1);const d=value.documents[0];for(const k of ['artifactId','sha256','sourceSha256','receiptId','documentVersion','source','createdBy'])assert.equal(d[k],artifact[k]);assert.equal(d.byteLength,artifact.byteLength);assert.equal(d.batchId,1);assert.equal(d.assurance,'own-confirmation');for(const k of ['icpBrasil','govBr','dispatchAllowed'])assert.equal(d[k],false);assert.match(d.createdAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);return d;}
async function observeGet(response,readDom,verifyDom,report=()=>{}){const d={status:null,finishedError:null,requestFailed:null,uiOwnStatus:null,passed:false};try{d.status=response.status();assert.equal(d.status,200,'exact GET status');const finished=await response.finished();d.finishedError=finished?safeError(finished).slice(0,240):null;assert.equal(finished,null,'GET must finish without error');const failed=response.request().failure();d.requestFailed=failed?safeError(failed.errorText||'request failed').slice(0,240):null;assert.equal(failed,null,'GET request must not fail');const dom=await readDom();d.uiOwnStatus=typeof dom.status==='string'?dom.status.slice(0,180):null;verifyDom(dom);d.passed=true;return dom;}catch(e){d.error=safeError(e).slice(0,320);throw e;}finally{report(d);}}
async function clickAfterObservationReady(install,click){const ack=await install();assert.equal(ack.ready,true,'observer installation ACK required before click');await click();}
function freshCompletion(states){let clearedBusy=false;for(const value of states){if(value.busy&&value.status==='')clearedBusy=true;if(clearedBusy&&!value.busy&&value.status==='PDF da confirmação disponível.')return true;}return false;}
function verifyOwnDom(dom,cfg,requestId,artifact){assert.equal(dom.busy,false);assert.equal(dom.status,'PDF da confirmação disponível.');assert.equal(dom.freshCompleted,true,'new pending/cleared to completed cycle required');assert.equal(dom.requestId,requestId);assert.equal(dom.receiptId,cfg.receiptId);assert.equal(dom.documentVersion,cfg.documentVersion);assert.equal(dom.sha256,artifact.sha256);assert.equal(dom.sourceSha256,cfg.sourceSha256);assert.equal(dom.href,'/api/admin/presidente/documentos-proprios/'+artifact.artifactId);return dom;}
let markers=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));function safeError(e){let s=String(e);for(const v of markers.filter(Boolean))s=s.split(v).join('[REDACTED]').split(encodeURIComponent(v)).join('[REDACTED]');return s.slice(0,2000);}
async function execute(filename){const cfg=privateJson(filename),cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(s=>s.startsWith('0::')).slice(3),run=validateConfig(cfg,filename,cg);markers=[cfg.cookie,cfg.cookie.slice(4)];assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,'1');const{chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');let browser,tmp,page,closed=false;const state={armed:false,posted:false,requestId:null,artifactId:null};
 const result={sourceCommit:SOURCE,classification:'LOCAL_OWN_CONFIRMATION_BROWSER_WITH_SEEDED_IDENTITY',identityPreconditionSeeded:true,externalIdentityVerified:false,A1OperationTested:false,approvalOrSendAttempted:false,browserLoginUiTested:false,checks:[],requests:[],blocked:[],pageErrors:[],consoleErrors:[],exit:1,browserTmpRemoved:false,phase:'startup',getObservations:[]};const observe=d=>{if(result.getObservations.length<10)result.getObservations.push({phase:result.phase,...d});};const check=(name,ok)=>{result.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 try{
  tmp=createShortTmp(path.basename(run));browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},env:{PATH:'/usr/bin:/bin',HOME:run+'/empty',TMPDIR:tmp.directory,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});assert.match(browser.version(),/^145\./);
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true,serviceWorkers:'block'});check('fresh context without inherited cookies',(await context.cookies()).length===0);await context.addCookies([{name:'adm',value:cfg.cookie.slice(4),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url()),kind=classifyRequest(req.url(),req.method(),req.postData(),req.headers(),cfg,state);if(!['allowed','allowed-post'].includes(kind)){result.blocked.push({method:req.method(),path:u.pathname,kind});return route.abort();}result.requests.push({method:req.method(),path:u.pathname});return route.continue();});
  page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(safeError(e)));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safeError(m.text()));});
  function history(){return page.getByRole('heading',{name:'Histórico de confirmações e documentos próprios',exact:true}).locator('..');}function own(){return page.getByRole('heading',{name:'Documento da confirmação própria',exact:true}).locator('..');}
  async function selectReceipt(){result.phase='receipt_inventory_GET';const pending=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/presidente/historico?kind=receipts');await history().getByRole('button',{name:'Consultar histórico',exact:true}).nth(0).click();await observeGet(await pending,async()=>{const prepare=history().getByRole('button',{name:'Preparar documento desta confirmação',exact:true});await prepare.waitFor();const rows=history().locator(':scope > ul').nth(0).locator('li');return {count:await rows.count(),text:await rows.first().innerText(),enabled:await prepare.isEnabled()};},d=>{assert.equal(d.count,1);assert.ok(d.text.includes(cfg.receiptId)&&d.text.includes('Compatível com o documento atual'));assert.equal(d.enabled,true);},observe);await history().getByRole('button',{name:'Preparar documento desta confirmação',exact:true}).click();await own().waitFor();}
  const response=await page.goto(ORIGIN+'/admin/presidente?lote=1',{waitUntil:'networkidle'});check('authenticated own portal ready',response.status()===200);await selectReceipt();check('seeded compatible receipt selected',await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).isEnabled());
  result.phase='own_creation_POST_ack';state.armed=true;const posting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===ORIGIN+'/api/admin/presidente/documentos-proprios');await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).click();const posted=await posting;state.armed=false;assert.equal(posted.status(),200);const value=await posted.json(),doc=verifyMetadata(value,cfg,state.requestId);state.artifactId=doc.artifactId;check('own artifact created by one native POST',state.posted&&/^[a-f0-9-]{36}$/.test(state.artifactId));
  await own().getByText('PDF da confirmação disponível.',{exact:true}).waitFor();result.phase='post_creation_DB_handshake';fs.writeFileSync(run+'/own-created.json',JSON.stringify({nonce:path.basename(run),sourceCommit:SOURCE,requestId:state.requestId,artifactId:state.artifactId}),{mode:0o600,flag:'wx'});const ack=run+'/own-created-proof.json',deadline=Date.now()+15000;while(!fs.existsSync(ack)){assert.ok(Date.now()<deadline,'own DB proof timeout');await pause(50);}const proof=privateJson(ack);assert.equal(proof.nonce,path.basename(run));assert.equal(proof.sourceCommit,SOURCE);assert.equal(proof.artifact.artifactId,state.artifactId);assert.equal(proof.artifact.requestId,state.requestId);assert.equal(proof.artifact.sourceSha256,cfg.sourceSha256);assert.equal(doc.sha256,proof.artifact.sha256);
  async function recover(){
   result.phase='manual_own_recovery_GET';
   // Install a read-only observer BEFORE click; the old download link alone is never freshness proof.
   const pending=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/presidente/documentos-proprios?requestId='+state.requestId);
   await clickAfterObservationReady(()=>own().evaluate(el=>{
    const key=Symbol.for('peticao.qa.r14.responseObservationV2'),previous=globalThis[key];if(previous&&!previous.settled)throw Error('previous own observation still pending');
    const observation={element:el,ready:false,settled:false,promise:null};globalThis[key]=observation;
    observation.promise=new Promise((resolve,reject)=>{let clearedBusy=false;const states=[];const observer=new MutationObserver(read),timer=setTimeout(()=>{observer.disconnect();observation.settled=true;reject(Error('own UI did not commit a fresh completed recovery'));},35000);function read(){const busy=el.getAttribute('aria-busy')==='true',status=(el.querySelector(':scope > [role="status"]')?.textContent||'').slice(0,180);states.push({busy,status});if(states.length>64){clearTimeout(timer);observer.disconnect();observation.settled=true;reject(Error('bounded own UI observation exceeded'));return;}if(busy&&status==='')clearedBusy=true;if(clearedBusy&&!busy&&status==='PDF da confirmação disponível.'){clearTimeout(timer);observer.disconnect();observation.settled=true;resolve(states);}}observer.observe(el,{childList:true,subtree:true,characterData:true,attributes:true});read();}).then(value=>({ok:true,value}),error=>({ok:false,error:String(error).slice(0,240)}));
    observation.ready=true;return{ready:true};
   }),()=>own().getByRole('button',{name:'Conferir geração do PDF',exact:true}).click());
   await observeGet(await pending,async()=>{const transition=await own().evaluate(el=>{const observation=globalThis[Symbol.for('peticao.qa.r14.responseObservationV2')];if(!observation||observation.element!==el||!observation.ready)throw Error('missing own observer installation identity');return observation.promise;});assert.equal(transition.ok,true,transition.error);assert.equal(freshCompletion(transition.value),true,'fresh cleared busy cycle before completed UI');return own().evaluate(el=>{const fields=Object.fromEntries(Array.from(el.querySelectorAll(':scope > dl > dt')).map(dt=>[dt.textContent,dt.nextElementSibling?.textContent]));return{busy:el.getAttribute('aria-busy')==='true',status:el.querySelector(':scope > [role="status"]')?.textContent||'',freshCompleted:true,requestId:Array.from(el.querySelectorAll(':scope > p.small')).find(p=>p.textContent.startsWith('Solicitação:'))?.querySelector('code')?.textContent,receiptId:fields['Comprovante'],documentVersion:fields['Versão do documento'],sha256:fields['SHA256 do PDF'],sourceSha256:fields['SHA256 do PDF original'],href:Array.from(el.querySelectorAll(':scope > a')).find(a=>a.textContent==='Baixar PDF da confirmação')?.getAttribute('href')};});},dom=>verifyOwnDom(dom,cfg,state.requestId,proof.artifact),observe);
  }
  async function download(link,name){result.phase='download_'+name;const pending=page.waitForEvent('download');await link.click();const d=await pending;assert.equal(await d.failure(),null);const dest=run+'/downloads/'+name;await d.saveAs(dest);const data=fs.readFileSync(dest);assert.equal(sha(data),proof.artifact.sha256);assert.ok(data.equals(fs.readFileSync(run+'/downloads/own-database.pdf')));}
  await recover();check('manual same UUID recovery returns same artifact',true);await download(own().getByRole('link',{name:'Baixar PDF da confirmação',exact:true}),'browser-own.pdf');check('own download bytes match DB',true);
  result.phase='artifact_inventory_GET';const listing=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/presidente/historico?kind=artifacts');await history().getByRole('button',{name:'Consultar histórico',exact:true}).nth(0).click();await observeGet(await listing,async()=>{const link=history().getByRole('link',{name:'Baixar PDF',exact:true});await link.waitFor();const rows=history().locator(':scope > ul').nth(1).locator('li');return{count:await rows.count(),text:await rows.first().innerText(),href:await link.getAttribute('href')};},d=>{assert.equal(d.count,1);assert.ok(d.text.includes(proof.artifact.artifactId)&&d.text.includes(proof.artifact.sha256));assert.equal(d.href,'/api/admin/presidente/documentos-proprios/'+proof.artifact.artifactId);},observe);await download(history().getByRole('link',{name:'Baixar PDF',exact:true}),'browser-history-own.pdf');check('history artifact and download bound to same bytes',true);
  await page.reload({waitUntil:'networkidle'});await selectReceipt();check('reload restores original request without new POST',await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).isDisabled()&&(await own().innerText()).includes(state.requestId));await recover();check('reload manual GET preserves artifact and bytes',true);await page.screenshot({path:run+'/own-browser.png',fullPage:true,mask:[page.locator('input[type="password"]')]});
  check('exactly one own-document POST',result.requests.filter(r=>r.method==='POST').length===1);check('no unexpected requests',result.blocked.length===0);check('no JavaScript errors',result.pageErrors.length===0);check('no console errors',result.consoleErrors.length===0);result.artifactId=state.artifactId;result.requestId=state.requestId;await context.close();result.exit=0;
 }catch(e){result.error=safeError(e);if(page&&!page.isClosed()){try{const statuses=await page.getByRole('heading',{name:'Documento da confirmação própria',exact:true}).locator('..').locator(':scope > [role="status"]').allTextContents();result.ownStatusAtFailure=safeError(statuses.join(' ')).slice(0,180);await page.screenshot({path:run+'/own-browser-failure.png',fullPage:true,mask:[page.locator('input[type="password"]')]});result.failureScreenshot={filename:'own-browser-failure.png',sha256:sha(fs.readFileSync(run+'/own-browser-failure.png'))};}catch(diagnosticError){result.diagnosticError=safeError(diagnosticError).slice(0,240);}}}finally{if(browser)try{await browser.close();closed=true;}catch(e){result.exit=1;result.closeError=safeError(e);}if(tmp)try{result.browserTmpRemoved=removeShortTmp(tmp,closed);}catch(e){result.exit=1;result.tmpError=safeError(e);}if(!result.browserTmpRemoved)result.exit=1;fs.writeFileSync(run+'/private-markers.json',JSON.stringify(markers),{mode:0o600});fs.writeFileSync(run+'/own-browser-result.json',JSON.stringify(result,null,2),{mode:0o600});}return result.exit;
}
module.exports={validateConfig,classifyRequest,socketBudget,verifyMetadata,verifyHistoryDocuments,observeGet,freshCompletion,verifyOwnDom,clickAfterObservationReady};if(require.main===module)execute(process.argv[2]).then(code=>process.exitCode=code).catch(e=>{console.error(safeError(e));process.exitCode=1;});
