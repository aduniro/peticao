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
let markers=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));function safeError(e){let s=String(e);for(const v of markers.filter(Boolean))s=s.split(v).join('[REDACTED]').split(encodeURIComponent(v)).join('[REDACTED]');return s.slice(0,2000);}
async function execute(filename){const cfg=privateJson(filename),cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(s=>s.startsWith('0::')).slice(3),run=validateConfig(cfg,filename,cg);markers=[cfg.cookie,cfg.cookie.slice(4)];assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,'1');const{chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');let browser,tmp,closed=false;const state={armed:false,posted:false,requestId:null,artifactId:null};
 const result={sourceCommit:SOURCE,classification:'LOCAL_OWN_CONFIRMATION_BROWSER_WITH_SEEDED_IDENTITY',identityPreconditionSeeded:true,externalIdentityVerified:false,A1OperationTested:false,approvalOrSendAttempted:false,browserLoginUiTested:false,checks:[],requests:[],blocked:[],pageErrors:[],consoleErrors:[],exit:1,browserTmpRemoved:false};const check=(name,ok)=>{result.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 try{
  tmp=createShortTmp(path.basename(run));browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},env:{PATH:'/usr/bin:/bin',HOME:run+'/empty',TMPDIR:tmp.directory,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});assert.match(browser.version(),/^145\./);
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true,serviceWorkers:'block'});check('fresh context without inherited cookies',(await context.cookies()).length===0);await context.addCookies([{name:'adm',value:cfg.cookie.slice(4),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url()),kind=classifyRequest(req.url(),req.method(),req.postData(),req.headers(),cfg,state);if(!['allowed','allowed-post'].includes(kind)){result.blocked.push({method:req.method(),path:u.pathname,kind});return route.abort();}result.requests.push({method:req.method(),path:u.pathname});return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(safeError(e)));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safeError(m.text()));});
  function history(){return page.getByRole('heading',{name:'Histórico de confirmações e documentos próprios',exact:true}).locator('..');}function own(){return page.getByRole('heading',{name:'Documento da confirmação própria',exact:true}).locator('..');}
  async function selectReceipt(){const response=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/presidente/historico?kind=receipts');await history().getByRole('button',{name:'Consultar histórico',exact:true}).nth(0).click();const r=await response;assert.equal(r.status(),200);const v=await r.json();assert.equal(v.receipts.length,1);assert.equal(v.receipts[0].receiptId,cfg.receiptId);assert.equal(v.receipts[0].isCurrent,true);await history().getByRole('button',{name:'Preparar documento desta confirmação',exact:true}).click();await own().waitFor();}
  const response=await page.goto(ORIGIN+'/admin/presidente?lote=1',{waitUntil:'networkidle'});check('authenticated own portal ready',response.status()===200);await selectReceipt();check('seeded compatible receipt selected',await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).isEnabled());
  state.armed=true;const posting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===ORIGIN+'/api/admin/presidente/documentos-proprios');await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).click();const posted=await posting;state.armed=false;assert.equal(posted.status(),200);const value=await posted.json(),doc=verifyMetadata(value,cfg,state.requestId);state.artifactId=doc.artifactId;check('own artifact created by one native POST',state.posted&&/^[a-f0-9-]{36}$/.test(state.artifactId));
  await own().getByText('PDF da confirmação disponível.',{exact:true}).waitFor();fs.writeFileSync(run+'/own-created.json',JSON.stringify({nonce:path.basename(run),sourceCommit:SOURCE,requestId:state.requestId,artifactId:state.artifactId}),{mode:0o600,flag:'wx'});const ack=run+'/own-created-proof.json',deadline=Date.now()+15000;while(!fs.existsSync(ack)){assert.ok(Date.now()<deadline,'own DB proof timeout');await pause(50);}const proof=privateJson(ack);assert.equal(proof.nonce,path.basename(run));assert.equal(proof.sourceCommit,SOURCE);assert.equal(proof.artifact.artifactId,state.artifactId);assert.equal(proof.artifact.requestId,state.requestId);assert.equal(proof.artifact.sourceSha256,cfg.sourceSha256);assert.equal(doc.sha256,proof.artifact.sha256);
  async function recover(){const pending=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/presidente/documentos-proprios?requestId='+state.requestId);await own().getByRole('button',{name:'Conferir geração do PDF',exact:true}).click();const r=await pending;assert.equal(r.status(),200);const v=verifyMetadata(await r.json(),cfg,state.requestId);assert.equal(v.artifactId,state.artifactId);assert.equal(v.sha256,proof.artifact.sha256);assert.equal(v.createdAt,doc.createdAt);}
  async function download(link,name){const pending=page.waitForEvent('download');await link.click();const d=await pending;assert.equal(await d.failure(),null);const dest=run+'/downloads/'+name;await d.saveAs(dest);const data=fs.readFileSync(dest);assert.equal(sha(data),proof.artifact.sha256);assert.ok(data.equals(fs.readFileSync(run+'/downloads/own-database.pdf')));}
  await recover();check('manual same UUID recovery returns same artifact',true);await download(own().getByRole('link',{name:'Baixar PDF da confirmação',exact:true}),'browser-own.pdf');check('own download bytes match DB',true);
  const listing=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===ORIGIN+'/api/admin/lotes/1/presidente/historico?kind=artifacts');await history().getByRole('button',{name:'Consultar histórico',exact:true}).nth(0).click();const list=await(await listing).json();verifyHistoryDocuments(list,cfg,proof.artifact);await download(history().getByRole('link',{name:'Baixar PDF',exact:true}),'browser-history-own.pdf');check('history artifact and download bound to same bytes',true);
  await page.reload({waitUntil:'networkidle'});await selectReceipt();check('reload restores original request without new POST',await own().getByRole('button',{name:'Gerar PDF da confirmação',exact:true}).isDisabled()&&(await own().innerText()).includes(state.requestId));await recover();check('reload manual GET preserves artifact and bytes',true);await page.screenshot({path:run+'/own-browser.png',fullPage:true,mask:[page.locator('input[type="password"]')]});
  check('exactly one own-document POST',result.requests.filter(r=>r.method==='POST').length===1);check('no unexpected requests',result.blocked.length===0);check('no JavaScript errors',result.pageErrors.length===0);check('no console errors',result.consoleErrors.length===0);result.artifactId=state.artifactId;result.requestId=state.requestId;await context.close();result.exit=0;
 }catch(e){result.error=safeError(e);}finally{if(browser)try{await browser.close();closed=true;}catch(e){result.exit=1;result.closeError=safeError(e);}if(tmp)try{result.browserTmpRemoved=removeShortTmp(tmp,closed);}catch(e){result.exit=1;result.tmpError=safeError(e);}if(!result.browserTmpRemoved)result.exit=1;fs.writeFileSync(run+'/private-markers.json',JSON.stringify(markers),{mode:0o600});fs.writeFileSync(run+'/own-browser-result.json',JSON.stringify(result,null,2),{mode:0o600});}return result.exit;
}
module.exports={validateConfig,classifyRequest,socketBudget,verifyMetadata,verifyHistoryDocuments};if(require.main===module)execute(process.argv[2]).then(code=>process.exitCode=code).catch(e=>{console.error(safeError(e));process.exitCode=1;});
