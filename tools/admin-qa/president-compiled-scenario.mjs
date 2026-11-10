/** Draft: execute only through the frozen-build isolated runner after integration. */
import assert from 'node:assert/strict';
import { runPresidentAdminCompiledExtension } from "./president-admin-compiled-extension.mjs";
import { runPresidentOwnPdfExtension } from "./president-own-pdf-compiled-extension.mjs";
import { runPresidentCombinedA1Extension } from "./president-combined-a1-compiled-extension.mjs";
import { runPresidentRecoveryCompiledExtension } from "./president-recovery-compiled-extension.mjs";
import { runPresidentOwnHistoryCurrentExtension, runPresidentOwnHistoryHistoricalExtension } from "./president-own-history-compiled-extension.mjs";
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync,createWriteStream,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const site=process.env.QA_SITE_DIR,output=process.env.QA_OUTPUT_DIR,commit=process.env.QA_EXPECTED_COMMIT;
assert.equal(site,'/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site');assert.equal(process.cwd(),site);assert.equal(process.version,'v20.19.2');
assert.equal(process.env.DATABASE_URL,'postgres://peticao:peticao@127.0.0.1:54379/peticao');assert.equal(process.env.MAIL_PROVIDER,'dev');assert.equal(process.env.MAIL_PROVIDERS,'dev');
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:site,encoding:'utf8'}).trim(),commit);
assert.equal(readdirSync(process.env.SECRETS_DIR).length,0);assert.equal(readdirSync(process.env.PETICAO_CONFIG_DIR).length,0);
assert.ok(!process.env.CPF_BRASIL_API_KEY);assert.ok(!process.env.CPF_MOCK_DATA);assert.ok(!process.env.CPF_FORCE_MOCK);
const socketDir=mkdtempSync('/tmp/president-qa-'),socket=socketDir+'/identity.sock';
process.env.EGRESS_SOCKET=socket;process.env.CPF_VIA_BRIDGE='1';
const native='http://127.0.0.1:3056',base='http://127.0.0.1:3055',cpf='52998224725',name='Pessoa Responsavel QA';
const sha=b=>createHash('sha256').update(b).digest('hex');const delay=ms=>new Promise(r=>setTimeout(r,ms));
const db=await import(pathToFileURL(site+'/src/lib/db.ts').href),U=await import(pathToFileURL(site+'/src/lib/admin-users.ts').href),S=await import(pathToFileURL(site+'/src/lib/president-portal-store.ts').href),C=await import(pathToFileURL(site+'/src/lib/president-portal-contract.ts').href);
const P=await import(pathToFileURL(site+'/src/lib/batch-preparation.ts').href),H=await import(pathToFileURL(site+'/src/lib/batch-document-history.ts').href);
const require=createRequire(site+'/package.json'),{PDFDocument}=require('pdf-lib');
let server,serverExit,serverLog,proxy,bridge,browser;
const counts={state:0,document:0,confirm:0,identity:0,analytics:0,validator:0},pageErrors=[],blockedExternal=[];
let corruptFirstDocument=true,dropFirstConfirmation=true;
async function stop(){if(browser)await browser.close();if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}if(server){server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),10000);await serverExit;clearTimeout(timer);serverLog.end();}if(bridge){bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}await db._closeDbForTests();rmSync(socketDir,{recursive:true,force:true});}
try{
 await db._openForTests('qa_president_compiled_browser');
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-owner@example.test','QA Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-president@example.test',$1,'leitura','QA-NOT-A-LOGIN-HASH')",[name]);
 const session=await U.abrirSessao(1,'127.0.0.1');await db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '15 minutes'");
 const actor=await U.sessaoPorToken(session.token);assert.ok(actor);
 assert.deepEqual(await S.configurePresidentProfile(actor,{responsibleId:2,cpf,enabled:true,expectedRevision:0}),{ok:true,revision:1});
 const pdf=await PDFDocument.create();pdf.addPage([500,700]).drawText('QA PRESIDENT - FICTITIOUS DOCUMENT ONLY',{x:30,y:650,size:12});const bytes=Buffer.from(await pdf.save());
 const fixtureRows=[{id:1,name:'QA Pessoa',category:'apoiador',institution:null,role:null,city:'QA',uf:'RO'}];
 const listHash=sha(Buffer.from(JSON.stringify(fixtureRows))),id=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'partial','prepared',0,1,0,$1,$2,$3,'none')RETURNING id",[listHash,bytes,sha(bytes)])).rows[0].id;
 const frozen=P.freezePreparation(fixtureRows,{seq:1,kind:'partial',generatedAt:new Date().toISOString(),listHash,nServidor:0,nApoiador:1,nEstrangeiro:0,signedNote:'',signaturePreparation:'a1'},{kind:'scheduler'});
 await db.query('INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256)VALUES($1,$2,$3)',[id,frozen.snapshot,frozen.sha256]);
 await db.audit('batch_created',null,{batchId:id,snapshotSha256:frozen.sha256,source:'scheduler'});
 await db.tx(c=>H.appendDocumentVersion(c,{batchId:id,variant:'original',bytes,sha256:sha(bytes),listHash,signatureKind:'none',note:null,source:'prepared',authorId:actor.userId,recordedBy:actor.userId}));
 const source={batchId:id,seq:1,kind:'partial',listHash,originalPdf:bytes,signedPdf:null,signatureKind:'none'},documentVersion=C.presidentDocumentRevision(source);
 bridge=createServer((req,res)=>{assert.equal(req.method,'GET');if(req.url!=='/cpf/'+cpf){res.writeHead(404);res.end('{}');return;}counts.identity++;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({success:true,data:{CPF:cpf,NOME:name,NASC:'01/01/2000',NOME_MAE:'Pessoa Mae Ficticia QA'}}));});
 await new Promise(r=>bridge.listen(socket,r));
 const profile=await S.readPresidentProfile(actor);assert.ok(profile.ok&&profile.profile);
 const issuedRequestId=randomUUID();
 const issued=await S.issueConfiguredPresidentChallenge(id,actor,undefined,{requestId:issuedRequestId,expectedDocumentVersion:documentVersion,expectedProfileFingerprint:profile.profile.fingerprint});assert.ok(issued.ok);
 const env={...process.env,NODE_ENV:'production',PREVIEW_MODE:'0',PRESIDENT_OWN_ENABLED:'1',CPF_VIA_BRIDGE:'1',EGRESS_SOCKET:socket,APP_URL:base};
 serverLog=createWriteStream(output+'/next-server.log');server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3056'],{cwd:site,env});server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);serverExit=once(server,'exit');
 let ready=false;for(let n=0;n<160;n++){if(server.exitCode!==null)throw Error('Next stopped');try{ready=(await fetch(native+'/presidente',{signal:AbortSignal.timeout(2000)})).status===200;}catch{}if(ready)break;await delay(250);}assert.ok(ready,'Compiled external route is enabled');
 proxy=createServer(async(req,res)=>{try{
  assert.ok(req.url?.startsWith('/')&&!req.url.startsWith('//'));const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=4096);chunks.push(chunk);}const body=Buffer.concat(chunks),path=new URL(req.url,base).pathname;
  if(path==='/api/evento')counts.analytics++;
  if(path==='/qa-never-call-validator'){counts.validator++;res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
  if(path.startsWith('/api/presidente/')){assert.equal(req.method,'POST');assert.ok(!req.headers.cookie,'external credential transport must omit admin cookies');const type=path.split('/').at(-1);if(type==='estado')counts.state++;if(type==='documento')counts.document++;if(type==='confirmar')counts.confirm++;}
  const headers={...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-for':'127.0.0.1'};for(const key of ['connection','accept-encoding','transfer-encoding'])delete headers[key];
  const response=await fetch(native+req.url,{method:req.method,headers,redirect:'manual',...(body.length?{body}:{})}),data=Buffer.from(await response.arrayBuffer());
  if(path==='/api/presidente/confirmar'&&dropFirstConfirmation&&response.ok){dropFirstConfirmation=false;res.destroy();return;}
  const outgoing=Object.fromEntries(response.headers);for(const key of ['content-encoding','content-length','transfer-encoding','connection'])delete outgoing[key];
  if(path==='/api/presidente/documento'&&corruptFirstDocument&&response.ok){corruptFirstDocument=false;outgoing['x-document-sha256']='f'.repeat(64);}
  outgoing['content-length']=String(data.length);res.writeHead(response.status,outgoing);res.end(data);
 }catch(error){console.log(JSON.stringify({proxyFailure:error.name}));if(!res.headersSent)res.writeHead(502);res.end();}});await new Promise(r=>proxy.listen(3055,'127.0.0.1',r));
 const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE).href);browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,locale:'pt-BR'});
 // An admin cookie exists in the browser to prove the external fetch explicitly omits it.
 await context.addCookies([{name:'adm',value:session.token,url:base,httpOnly:true,sameSite:'Lax'}]);
 await context.route('**/*',route=>{const target=new URL(route.request().url());return target.hostname==='127.0.0.1'||target.protocol==='blob:'?route.continue():(blockedExternal.push(target.hostname),route.abort());});
 await context.addInitScript(() => { const original=window.fetch; window.__presidentConfirmationCalls=0; window.fetch=(...args)=>{const url=typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);if(new URL(url,location.origin).pathname === '/api/presidente/confirmar')window.__presidentConfirmationCalls++;return original.apply(window,args);}; });
 const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));const button=label=>page.getByRole('button',{name:label,exact:true});
 async function enter(){await page.locator('#president-token').fill(issued.token);await page.locator('#president-password').fill(issued.password);await button('Abrir documento').click();await button('Conferir situação').waitFor();}
 await page.goto(base+'/presidente');await enter();assert.ok(!page.url().includes(issued.token));
 await button('Abrir PDF para revisão').click();await page.getByRole('status').filter({hasText:'Não foi possível conferir o documento.'}).waitFor();assert.equal(await button('Confirmar assinatura').count(),0);
 await button('Abrir PDF para revisão').click();await button('Confirmar assinatura').waitFor();assert.equal(await button('Confirmar assinatura').isDisabled(),true);
 await page.getByRole('status').filter({hasText:'Prévia carregada.'}).waitFor();
 assert.equal(await page.locator('iframe,object,embed').count(),0);
 assert.ok(await page.locator('canvas').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let n=0;n<p.length;n+=4)if(p[n]<120&&p[n+1]<120&&p[n+2]<120)dark++;return dark>20;}),'Actual PDF pixels must be visible');
 const downloadWait=page.waitForEvent('download');await page.getByRole('link',{name:'Baixar PDF conferido',exact:true}).click();const downloaded=await downloadWait;await downloaded.saveAs(output+'/download-ficticio.pdf');
 assert.equal(sha(require('node:fs').readFileSync(output+'/download-ficticio.pdf')),sha(bytes));
 const widths=[320,390,768,992,1280,1920],shots=[];for(const width of widths){await page.setViewportSize({width,height:900});await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c&&c.parentElement?.getAttribute('aria-busy')==='false'&&Math.abs(parseFloat(c.style.width)-Math.floor(c.parentElement.getBoundingClientRect().width-2))<=2;});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page overflow '+width);const path=output+'/president-'+width+'.png';await page.screenshot({path,fullPage:true});shots.push({width,path});}
 // Reload must discard credentials, identity fields and the verified PDF.
 await page.reload();await page.locator('#president-token').waitFor();assert.equal(await page.locator('#president-token').inputValue(),'');assert.equal(await page.locator('#president-password').inputValue(),'');
 assert.equal(await page.locator('canvas,iframe').count(),0);await enter();await button('Abrir PDF para revisão').click();await button('Confirmar assinatura').waitFor();
 await page.getByRole('checkbox').check();await page.locator('#president-cpf').fill(cpf);await page.locator('#president-birth').fill('2000-01-01');await button('Confirmar assinatura').click();
 await page.getByRole('status').filter({hasText:'Não foi possível confirmar o resultado.'}).waitFor();assert.equal(await page.evaluate(()=>window.__presidentConfirmationCalls),1);assert.ok(counts.confirm>=1);const physicalConfirmationCalls=counts.confirm;await delay(500);assert.equal(await page.evaluate(()=>window.__presidentConfirmationCalls),1);assert.equal(counts.confirm,physicalConfirmationCalls);assert.equal(await button('Confirmar assinatura').isDisabled(),true);
 await button('Conferir situação').click();await page.getByText('Confirmação registrada',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.__presidentConfirmationCalls),1);assert.equal(counts.confirm,physicalConfirmationCalls);const row=(await db.query('SELECT state,receipt_id,attempts FROM president_challenges WHERE id=$1',[issued.id])).rows[0];assert.equal(row.state,'consumed');assert.ok(row.receipt_id);assert.equal(row.attempts,1);
 assert.equal(counts.identity,1);assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);assert.equal(counts.analytics,0);
 const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},url:location.href}));for(const secret of [issued.token,issued.password,cpf,'2000-01-01'])assert.ok(!storage.includes(secret));
 const sourceAfter=(await db.query('SELECT pdf,pdf_sha256,signed_pdf,approved_at,sent_at FROM batches WHERE id=$1',[id])).rows[0];assert.equal(sha(sourceAfter.pdf),sha(bytes));assert.equal(sourceAfter.signed_pdf,null);assert.equal(sourceAfter.approved_at,null);assert.equal(sourceAfter.sent_at,null);
 assert.equal((await db.query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends')).rowCount,0);assert.equal((await db.query('SELECT 1 FROM signatures')).rowCount,0);assert.ok((await db.verifyAuditChain()).ok);assert.equal(pageErrors.length,0);
 await button('Encerrar acesso').click();assert.equal(await page.locator('#president-token').inputValue(),'');
 const ownPdf = await runPresidentOwnPdfExtension({browser,base,sessionToken:session.token,actor,db,store:S,output,sourceBatchId:id,issued:{...issued,requestId:issuedRequestId},documentVersion,profileFingerprint:profile.profile.fingerprint,receiptId:row.receipt_id});
 const ownHistoryCurrent = await runPresidentOwnHistoryCurrentExtension({browser,base,actor,db,U,output,sourceBatchId:id,ownPdf});
 const combinedA1 = await runPresidentCombinedA1Extension({browser,base,sessionToken:session.token,actor,db,store:S,output,sourceBatchId:id,issued:{...issued,requestId:issuedRequestId},documentVersion,profileFingerprint:profile.profile.fingerprint,receiptId:row.receipt_id,ownPdf});
 console.log('Respecting real shared rate window before recovery mutations'); await delay(61_000);
 const recovery = await runPresidentRecoveryCompiledExtension({browser,base,sessionToken:session.token,actor,db,store:S,output,sourceBatchId:id,issued:{...issued,requestId:issuedRequestId},documentVersion,profileFingerprint:profile.profile.fingerprint,receiptId:row.receipt_id,ownPdf});
 console.log('Respecting real shared rate window before profile mutations'); await delay(61_000);
 const admin = await runPresidentAdminCompiledExtension({browser,base,sessionToken:session.token,actor,db,store:S,output,sourceBatchId:id});
 const ownHistoryHistorical = await runPresidentOwnHistoryHistoricalExtension({browser,base,actor,db,U,output,sourceBatchId:id,ownPdf});
 assert.equal(blockedExternal.length,0);assert.equal(counts.validator,0,'Admission/claim must never call the validator');
 const result={applicationConfirmationCalls:1,physicalConfirmationCalls,ownPdf,ownHistoryCurrent,combinedA1,recovery,admin,ownHistoryHistorical,ok:true,commit,compiledNextUi:true,bridge:'fictitious Unix socket using supported CPF_VIA_BRIDGE provider',nodeEnv:'production',previewMode:'0',mockGuardPreserved:true,counts,shots,pageErrors,blockedExternal,corruptedHashRefused:true,downloadExactBytes:true,reloadClearsCredentials:true,confirmationResponseLostRecoveredByState:true,noAutomaticConfirmationRetry:true,noRealMessages:true,noBatchMutation:true,noCredentialsInStorageOrUrl:true,realIdentityOrCryptoHomologation:false};
 writeFileSync(output+'/browser-result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ok:true,commit,counts,shots:shots.length}));
}finally{await stop();}
