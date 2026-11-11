"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const SOURCE="f55595cd348c23ffe559dba2de9150259db9f1e7",ORIGIN="http://127.0.0.1:31390";
const CHROME="/home/barre/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",CHROME_SHA="481fea1516a1f2b76454664272f12cd9dd1f20117b21e1f1498e08bc7f872c00";
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
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
  const directory = api.mkdtempSync(path.join(parent, `r10-${nonce}-`));
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
  assert.match(path.basename(identity.directory), new RegExp(`^r10-${identity.nonce}-[A-Za-z0-9]{6}$`));
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
function privateJson(filename,max=1024*1024){const st=fs.lstatSync(filename);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o600&&st.nlink===1&&st.size<=max);assert.equal(fs.realpathSync(filename),filename);return JSON.parse(fs.readFileSync(filename,'utf8'));}
function spool(run){const dir=path.join(run,'mail-outbox'),s=fs.lstatSync(dir);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700);assert.equal(fs.realpathSync(dir),dir);const out={};for(const name of fs.readdirSync(dir)){assert.match(name,/^[A-Za-z0-9.-]+\.json$/);const p=path.join(dir,name);privateJson(p);out[name]=sha(fs.readFileSync(p));}return out;}
function readOtp(run,before){const after=spool(run),added=Object.keys(after).filter(x=>!Object.hasOwn(before,x));assert.equal(added.length,1);const message=privateJson(path.join(run,'mail-outbox',added[0]));assert.equal(message.to,'qa-approver@example.test');assert.ok(!message.attachments);const m=message.subject.match(/: (\d{6})$/);assert.ok(m);return m[1];}
function validateConfig(cfg,filename,cgroup){const run=path.dirname(filename);assert.match(run,/^\/mnt\/dev\/\.peticao-r0010-local-package-browser-qa-20261111\/runs\/[a-f0-9]{12}$/);assert.equal(filename,path.join(run,'browser-config.json'));assert.equal(cfg.run,run);assert.equal(cfg.sourceCommit,SOURCE);assert.equal(cfg.origin,ORIGIN);assert.equal(cfg.cgroup,cgroup);assert.ok(cgroup.startsWith('/user.slice/')&&cgroup.endsWith('/peticao-r0010-local-package-browser-qa-20261111.service'));assert.match(cfg.cookie,/^adm=[A-Za-z0-9_.~-]{16,4096}$/);assert.equal(cfg.syntheticSession,true);assert.equal(cfg.stepupSeeded,true);assert.deepEqual(cfg.packages.map(x=>x.batchId),[1,2]);for(const p of cfg.packages){assert.match(p.packageId,/^[a-f0-9-]{36}$/);for(const k of ['documentVersion','packageDigest'])assert.match(p[k],/^[a-f0-9]{64}$/);}assert.ok(Array.isArray(cfg.assetPaths)&&cfg.assetPaths.length>0);for(const p of cfg.assetPaths)assert.ok(p.startsWith('/_next/static/')||p.startsWith('/')&&!p.startsWith('/api/')&&!p.includes('..'));return run;}
function classifyRequest(rawUrl,method,body,headers,cfg,expected){const url=new URL(rawUrl);if(url.origin!==ORIGIN||url.username||url.password||url.hash)return 'external';
 if(method==='GET'||method==='HEAD'){
  if(cfg.assetPaths.includes(url.pathname)&&url.search==='')return 'allowed';
  if(url.pathname==='/api/admin/alertas'&&url.search==='')return 'allowed';
  if(url.pathname==='/admin/presidente'&&['1','2'].includes(url.searchParams.get('lote'))&&[...url.searchParams.keys()].every(x=>['lote','msg'].includes(x))&&url.searchParams.getAll('lote').length===1&&url.searchParams.getAll('msg').length<=1)return 'allowed';
  return 'unreviewed-get';
 }
 if(method!=='POST'||!expected)return 'mutation';
 if(url.pathname!==`/api/admin/lotes/${expected.batchId}/${expected.kind}`||url.search!=='?portal=presidente')return 'mutation';
 if(headers.origin!==ORIGIN||!(headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))return 'mutation';
 let referer;try{referer=new URL(headers.referer);}catch{return 'mutation';}if(referer.origin!==ORIGIN||referer.pathname!=='/admin/presidente'||referer.searchParams.get('lote')!==String(expected.batchId))return 'mutation';
 const form=new URLSearchParams(body||'');if([...form.keys()].some(k=>form.getAll(k).length!==1))return 'mutation';
 const pkg=cfg.packages.find(p=>p.batchId===expected.batchId);if(!pkg)return 'mutation';
 if(expected.kind==='codigo'){
  if([...form.keys()].sort().join(',')!=='expectedDocumentVersion,expectedPackageDigest,expectedPackageId,requestId'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(form.get('requestId')||'')||form.get('expectedDocumentVersion')!==pkg.documentVersion||form.get('expectedPackageId')!==pkg.packageId||form.get('expectedPackageDigest')!==pkg.packageDigest)return 'mutation';
 }else if(expected.kind==='aprovar'){if(form.size!==1||form.get('code')!==expected.code||!/^\d{6}$/.test(expected.code))return 'mutation';}
 else if(expected.kind==='conciliar'){if(form.size!==1||form.get('proof')!==expected.proof||!/^[a-f0-9]{64}$/.test(expected.proof))return 'mutation';}
 else return 'mutation';
 return 'allowed-post';
}
function admitRequest(url,method,body,headers,cfg,state){const kind=classifyRequest(url,method,body,headers,cfg,state.expected);if(kind==='allowed-post'){if(state.postConsumed)return 'duplicate-post';state.postConsumed=true;}return kind;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let markers=[];
function safeError(e){let s=String(e);for(const v of markers.filter(Boolean))s=s.split(v).join('[REDACTED]').split(encodeURIComponent(v)).join('[REDACTED]');return s.slice(0,2000);}
async function execute(filename){const cfg=privateJson(filename),cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::')).slice(3),run=validateConfig(cfg,filename,cg);markers=[cfg.cookie,cfg.cookie.slice(4)];assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,'1');
 const {chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');let browser,closed=false,tmp,admission={expected:null,postConsumed:false};
 const result={classification:'LOCAL_SYNTHETIC_PACKAGE_APPROVAL_RECONCILIATION_BROWSER',sourceCommit:SOURCE,syntheticSession:true,stepupSeeded:true,browserLoginUiTested:false,otpApprovalUiTested:false,realCertificateUsed:false,deployment:false,checks:[],requests:[],blocked:[],pageErrors:[],consoleErrors:[],exit:1,browserTmpRemoved:false};
 const check=(name,ok)=>{result.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 try{
  tmp=createShortTmp(path.basename(run));browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},env:{PATH:'/usr/bin:/bin',HOME:run+'/empty',TMPDIR:tmp.directory,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});result.browserVersion=browser.version();assert.match(result.browserVersion,/^145\./);
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',extraHTTPHeaders:{DNT:'1'}});check('fresh browser has no inherited cookies',(await context.cookies()).length===0);await context.addCookies([{name:'adm',value:cfg.cookie.slice(4),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());const kind=admitRequest(req.url(),req.method(),req.postData(),req.headers(),cfg,admission);if(!['allowed','allowed-post'].includes(kind)){result.blocked.push({method:req.method(),path:u.pathname,category:kind});return route.abort();}result.requests.push({method:req.method(),path:u.pathname,portal:u.searchParams.get('portal')||null});return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(safeError(e)));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safeError(m.text()));});
  async function submit(n,kind,secret){const form=page.locator(`form[action="/api/admin/lotes/${n}/${kind}?portal=presidente"]`);assert.equal(await form.count(),1);const button=form.getByRole('button',{name:kind==='codigo'?'Enviar código ao aprovador':kind==='aprovar'?'Aprovar e enviar':'Conferir aceites sem reenviar',exact:true});assert.equal(await button.isEnabled(),true);admission.expected={batchId:n,kind,...secret};admission.postConsumed=false;
   const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===ORIGIN+`/api/admin/lotes/${n}/${kind}?portal=presidente`);await Promise.all([page.waitForNavigation({waitUntil:'networkidle',timeout:30000}),button.click()]);const r=await response;assert.equal(r.status(),303);assert.equal(admission.postConsumed,true);admission.expected=null;const url=new URL(page.url());assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,'/admin/presidente');assert.equal(url.searchParams.get('lote'),String(n));return url.searchParams.get('msg');}
  for(const n of [1,2]){
   const response=await page.goto(ORIGIN+`/admin/presidente?lote=${n}`,{waitUntil:'networkidle'});check(`batch${n} selected authenticated portal`,response.status()===200);await page.getByRole('heading',{name:`Lote ${n} · parcial`,exact:true}).waitFor();
   const before=spool(run);const msg=await submit(n,'codigo');check(`batch${n} code requested through exact form`,msg==='Código enviado ao aprovador.');const code=readOtp(run,before);markers.push(code);const codeInput=page.locator(`form[action="/api/admin/lotes/${n}/aprovar?portal=presidente"] input[name="code"]`);assert.equal(await codeInput.getAttribute('maxlength'),'6');await codeInput.fill(code);
   const approvalMessage=await submit(n,'aprovar',{code});check(`batch${n} code cleared after redirect`,await page.locator('input[name="code"]').evaluateAll(nodes=>nodes.every(n=>n.value==='')));
   if(n===1){check('happy portal shows accepted batch',(await page.locator('main.v2-pagina dl').first().locator('dd').first().innerText())==='Aceite registrado');}
   else{check('fault portal displays reconciliation warning',approvalMessage==='Resultado do envio a conferir. Verifique o histórico antes de tentar outra ação.');const receipts=page.locator('section[aria-label="Comprovantes do lote"]');check('fault portal shows accepted transport',(await receipts.innerText()).includes('Aceito pelo transporte'));
    fs.writeFileSync(path.join(run,'browser-fault-ready.json'),JSON.stringify({nonce:path.basename(run),sourceCommit:SOURCE,phase:'accepted-fault-ui-rendered'}),{mode:0o600,flag:'wx'});const ack=path.join(run,'browser-fault-cleared.json'),deadline=Date.now()+15000;while(!fs.existsSync(ack)){assert.ok(Date.now()<deadline,'fixture fault removal timeout');await sleep(50);}const data=privateJson(ack);assert.deepEqual(data,{nonce:path.basename(run),sourceCommit:SOURCE,faultRemoved:true,acceptedJournalWithoutRecipient:true});
    const form=receipts.locator(`form[action="/api/admin/lotes/2/conciliar?portal=presidente"]`),proof=await form.locator('input[name="proof"]').inputValue();markers.push(proof);const reconciled=await submit(2,'conciliar',{proof});check('portal reconciliation confirms no repeated send',reconciled==='Aceites conferidos. Nenhum envio foi repetido.');check('reconciled portal shows accepted batch',(await page.locator('main.v2-pagina dl').first().locator('dd').first().innerText())==='Aceite registrado');
   }
   check(`batch${n} receipt accepted on final screen`,(await page.locator('section[aria-label="Comprovantes do lote"]').innerText()).includes('Aceito pelo transporte'));assert.equal(await page.locator('input[name="code"]').evaluateAll(nodes=>nodes.some(n=>n.value!=='')),false);
   await page.screenshot({path:path.join(run,`package-browser-${n}.png`),fullPage:true,mask:[page.locator('input[name="code"]')]});
  }
  check('exactly five reviewed POSTs occurred',result.requests.filter(r=>r.method==='POST').map(r=>r.path).join('|')==='/api/admin/lotes/1/codigo|/api/admin/lotes/1/aprovar|/api/admin/lotes/2/codigo|/api/admin/lotes/2/aprovar|/api/admin/lotes/2/conciliar');result.otpApprovalUiTested=true;check('no unexpected browser request',result.blocked.length===0);check('no page JavaScript error',result.pageErrors.length===0);check('no browser console error',result.consoleErrors.length===0);await context.close();result.exit=0;
 }catch(e){result.error=safeError(e);}finally{
  if(browser)try{await browser.close();closed=true;}catch(e){result.exit=1;result.closeError=safeError(e);}
  if(tmp)try{result.browserTmpRemoved=removeShortTmp(tmp,closed);}catch(e){result.exit=1;result.tmpCleanupError=safeError(e);}
  if(!result.browserTmpRemoved)result.exit=1;fs.writeFileSync(path.join(run,'private-markers.json'),JSON.stringify(markers),{mode:0o600});fs.writeFileSync(path.join(run,'package-browser-result.json'),JSON.stringify(result,null,2),{mode:0o600});
 }
 return result.exit;
}
module.exports={socketBudget,privateParent,createShortTmp,removeShortTmp,privateJson,spool,readOtp,validateConfig,classifyRequest,admitRequest};
if(require.main===module)execute(process.argv[2]).then(code=>process.exitCode=code).catch(e=>{console.error(safeError(e));process.exitCode=1;});
