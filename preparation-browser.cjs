"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const SOURCE='f55595cd348c23ffe559dba2de9150259db9f1e7',ORIGIN='http://127.0.0.1:31393';
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
  const directory = api.mkdtempSync(path.join(parent, `r13-${nonce}-`));
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
  assert.match(path.basename(identity.directory), new RegExp(`^r13-${identity.nonce}-[A-Za-z0-9]{6}$`));
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
function validateConfig(cfg,filename,cgroup){const run=path.dirname(filename);assert.match(run,/^\/mnt\/dev\/\.peticao-r0013-local-pdf-preparation-browser-qa-20261111\/runs\/[a-f0-9]{12}$/);assert.equal(filename,path.join(run,'browser-config.json'));assert.equal(cfg.run,run);assert.equal(cfg.sourceCommit,SOURCE);assert.equal(cfg.origin,ORIGIN);assert.equal(cfg.cgroup,cgroup);assert.ok(cgroup.startsWith('/user.slice/')&&cgroup.endsWith('/peticao-r0013-local-pdf-preparation-browser-qa-20261111.service'));assert.match(cfg.cookie,/^adm=[A-Za-z0-9_.~-]{16,4096}$/);assert.equal(cfg.syntheticSession,true);assert.equal(cfg.stepupSeeded,true);assert.ok(Array.isArray(cfg.assetPaths)&&cfg.assetPaths.length>0);return run;}
function classifyRequest(raw,method,body,headers,cfg,state){const u=new URL(raw);if(u.origin!==ORIGIN||u.username||u.password||u.hash)return'external';
 if(['GET','HEAD'].includes(method)){
  if(u.pathname==='/icon-192.png'&&u.search==='')return'allowed';
  if(cfg.assetPaths.includes(u.pathname)&&u.search==='')return'allowed';
  if(u.pathname==='/api/admin/alertas'&&u.search==='')return'allowed';
  if(u.pathname==='/admin/presidente'&&(u.search===''||u.searchParams.get('lote')==='1'&&u.searchParams.getAll('lote').length===1&&u.searchParams.getAll('msg').length<=1&&[...u.searchParams.keys()].every(k=>['lote','msg'].includes(k))))return'allowed';
  if(u.search===''){
   if(['/api/admin/lotes/1/pdf','/api/admin/lotes/1/versoes'].includes(u.pathname))return'allowed';
   if(state.versionId&&u.pathname==='/api/admin/lotes/1/versoes/'+state.versionId)return'allowed';
  }
  return'unreviewed-get';
 }
 if(method!=='POST'||u.pathname!=='/api/admin/lotes/criar'||u.search!=='?portal=presidente'||!state.armed||state.posted)return'mutation';
 if(headers.origin!==ORIGIN||!(headers['content-type']||'').startsWith('application/x-www-form-urlencoded')||new URLSearchParams(body||'').size!==0)return'mutation';
 let ref;try{ref=new URL(headers.referer);}catch{return'mutation';}if(ref.origin!==ORIGIN||ref.pathname!=='/admin/presidente'||ref.search!=='')return'mutation';
 state.posted=true;return'allowed-post';
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let markers=[];
function safeError(e){let s=String(e);for(const v of markers.filter(Boolean))s=s.split(v).join('[REDACTED]').split(encodeURIComponent(v)).join('[REDACTED]');return s.slice(0,2000);}
async function execute(filename){const cfg=privateJson(filename),cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(s=>s.startsWith('0::')).slice(3),run=validateConfig(cfg,filename,cg);markers=[cfg.cookie,cfg.cookie.slice(4)];assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,'1');const{chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');let browser,closed=false,tmp;const state={armed:false,posted:false,versionId:null};
 const result={classification:'LOCAL_MODERN_PDF_PREPARATION_BROWSER_SYNTHETIC_A1_RENDER_ONLY',sourceCommit:SOURCE,syntheticSession:true,stepupSeeded:true,browserLoginUiTested:false,realCertificateUsed:false,signingOrApprovalAttempted:false,referenceOriginTextOnly:'https://documents.example.org',referenceExternalNavigation:false,deployment:false,checks:[],requests:[],blocked:[],pageErrors:[],consoleErrors:[],exit:1,browserTmpRemoved:false};const check=(name,ok)=>{result.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 try{
  tmp=createShortTmp(path.basename(run));browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},env:{PATH:'/usr/bin:/bin',HOME:run+'/empty',TMPDIR:tmp.directory,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});result.browserVersion=browser.version();assert.match(result.browserVersion,/^145\./);
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true,serviceWorkers:'block',extraHTTPHeaders:{DNT:'1'}});check('fresh context has no inherited cookies',(await context.cookies()).length===0);await context.addCookies([{name:'adm',value:cfg.cookie.slice(4),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url()),kind=classifyRequest(req.url(),req.method(),req.postData(),req.headers(),cfg,state);if(!['allowed','allowed-post'].includes(kind)){result.blocked.push({method:req.method(),path:u.pathname,category:kind});return route.abort();}result.requests.push({method:req.method(),path:u.pathname});return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(safeError(e)));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safeError(m.text()));});
  const response=await page.goto(ORIGIN+'/admin/presidente',{waitUntil:'networkidle',timeout:45000});check('empty president portal authenticated',response.status()===200&&new URL(page.url()).pathname==='/admin/presidente');
  const form=page.locator('form[action="/api/admin/lotes/criar?portal=presidente"]'),button=form.getByRole('button',{name:'Fechar lote final agora',exact:true});assert.equal(await form.count(),1);check('native final button enabled',await button.isEnabled());
  state.armed=true;const posting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===ORIGIN+'/api/admin/lotes/criar?portal=presidente');await Promise.all([page.waitForNavigation({waitUntil:'networkidle',timeout:60000}),button.click()]);const posted=await posting;state.armed=false;const afterUrl=new URL(page.url());check('native final creation303',posted.status()===303&&state.posted&&afterUrl.pathname==='/admin/presidente'&&afterUrl.searchParams.get('lote')==='1'&&afterUrl.searchParams.get('msg')==='Lote final 1 criado.');
  await page.getByRole('heading',{name:'Lote 1 · final',exact:true}).waitFor();check('selected final document ready',(await page.locator('main.v2-pagina dl').first().locator('dd').first().innerText())==='PDF pronto');check('final creation button disabled',await page.locator('form[action="/api/admin/lotes/criar?portal=presidente"]').getByRole('button',{name:'Fechar lote final agora',exact:true}).isDisabled());
  fs.writeFileSync(path.join(run,'browser-created.json'),JSON.stringify({nonce:path.basename(run),sourceCommit:SOURCE,phase:'native-final-prepared'}),{mode:0o600,flag:'wx'});const ack=path.join(run,'browser-created-proof.json'),deadline=Date.now()+15000;while(!fs.existsSync(ack)){assert.ok(Date.now()<deadline,'prepared snapshot proof timeout');await sleep(50);}const proof=privateJson(ack);assert.equal(proof.nonce,path.basename(run));assert.equal(proof.sourceCommit,SOURCE);assert.equal(proof.snapshotVersion,2);assert.equal(proof.signaturePreparation,'a1');assert.equal(proof.preparedSignedNote,'');assert.match(proof.pdfSha256,/^[a-f0-9]{64}$/);assert.match(proof.historyVersionId,/^[a-f0-9-]{36}$/);assert.equal(proof.documentReference.url,'https://documents.example.org/api/documentos/referencia/'+proof.documentReference.id);state.versionId=proof.historyVersionId;check('modern A1 render and separate reference snapshot bound',true);
  async function downloadExact(link,name){const downloading=page.waitForEvent('download');await link.click();const download=await downloading;assert.equal(await download.failure(),null);const dest=path.join(run,'downloads',name);await download.saveAs(dest);const b=fs.readFileSync(dest);assert.equal(sha(b),proof.pdfSha256);assert.equal(b.length,proof.pdfBytes);assert.ok(b.equals(fs.readFileSync(path.join(run,'downloads/database.pdf'))));}
  await downloadExact(page.getByRole('link',{name:'Baixar PDF original',exact:true}),'browser-generated.pdf');check('original generated PDF download matches DB',true);
  const listing=page.waitForResponse(r=>r.url()===ORIGIN+'/api/admin/lotes/1/versoes'&&r.request().method()==='GET');await page.getByRole('button',{name:'Histórico',exact:true}).click();const meta=await listing;assert.equal(meta.status(),200);const json=await meta.json();assert.equal(json.versions.length,1);assert.equal(json.versions[0].id,proof.historyVersionId);assert.equal(json.versions[0].sha256,proof.pdfSha256);assert.equal(json.versions[0].source,'prepared');assert.equal(json.versions[0].variant,'original');const dialog=page.getByTestId('document-history');await dialog.locator('tbody tr').first().waitFor();check('one generated history version displayed',await dialog.locator('tbody tr').count()===1&&(await dialog.innerText()).includes(proof.pdfSha256));
  await downloadExact(dialog.getByRole('link',{name:'Baixar',exact:true}),'browser-history.pdf');check('history PDF download matches DB',true);await page.screenshot({path:path.join(run,'preparation-browser.png'),fullPage:true,mask:[page.locator('input[name="code"]')]});await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='Histórico');check('history closes and restores focus',!(await dialog.evaluate(el=>el.open)));
  check('exactly one reviewed creation POST',result.requests.filter(r=>r.method==='POST').length===1&&result.requests.some(r=>r.method==='POST'&&r.path==='/api/admin/lotes/criar'));check('no unexpected browser request',result.blocked.length===0);check('no page JavaScript error',result.pageErrors.length===0);check('no browser console error',result.consoleErrors.length===0);await context.close();result.exit=0;
 }catch(e){result.error=safeError(e);}finally{
  if(browser)try{await browser.close();closed=true;}catch(e){result.exit=1;result.closeError=safeError(e);}
  if(tmp)try{result.browserTmpRemoved=removeShortTmp(tmp,closed);}catch(e){result.exit=1;result.tmpCleanupError=safeError(e);}
  if(!result.browserTmpRemoved)result.exit=1;fs.writeFileSync(path.join(run,'private-markers.json'),JSON.stringify(markers),{mode:0o600});fs.writeFileSync(path.join(run,'preparation-browser-result.json'),JSON.stringify(result,null,2),{mode:0o600});
 }
 return result.exit;
}
module.exports={socketBudget,privateParent,createShortTmp,removeShortTmp,privateJson,validateConfig,classifyRequest};if(require.main===module)execute(process.argv[2]).then(code=>process.exitCode=code).catch(e=>{console.error(safeError(e));process.exitCode=1;});
