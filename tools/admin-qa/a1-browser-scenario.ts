import { createServer } from "node:http";
import { GET as DOWNLOAD } from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/lotes/[id]/versoes/[versao]/route";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import {_openForTests,_closeDbForTests,query} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/db";
import {abrirSessao} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/admin-users";
import {createBatch,documentVersion,type ApprovalRow} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batches";
import {GET,POST} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/lotes/[id]/a1/route";
import {POST as CRON} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/cron/a1/route";
const root=process.env.QA_A1_E2E_OUTPUT_DIR!;
assert.ok(root && root.startsWith("/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-e2e-"));
const fixture=JSON.parse(readFileSync(process.env.QA_A1_E2E_FIXTURE!,"utf8"));
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 let httpServer: ReturnType<typeof createServer> | null = null;
 let browser: any, context: any, page: any, origin = "";
 let browserPosts = 0; const browserInputs: any[] = [], pageErrors: string[] = [];

 assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(new URL(process.env.DATABASE_URL!).port,"54377");assert.equal(process.env.APPROVER_EMAIL,"");assert.equal(process.env.RECIPIENTS,"");
 await _openForTests("t_a1_real_transport_e2e");
 try{
  await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-e2e@example.test','QA E2E','total','NOT-A-PASSWORD')");
  const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=now()+interval '9 minutes' WHERE user_id=1");
  await query("INSERT INTO settings(key,value)VALUES('batch_a1_policy_v1',$1)",[JSON.stringify(fixture.policy)]);
  const request=(id:number,method:string,body?:unknown)=>new NextRequest(`http://localhost/api/admin/lotes/${id}/a1`,{method,headers:{host:"localhost",origin:"http://localhost",cookie:"adm="+session.token,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cron=(secret=process.env.CRON_SECRET!)=>CRON(new NextRequest("http://localhost/api/cron/a1",{method:"POST",headers:{authorization:"Bearer "+secret}}));
  async function batch(number:number){
   await query("INSERT INTO signatures(name,email,email_hash,category,city,uf,text_version,consent_at,status,confirmed_at)VALUES($1,$2,$3,'apoiador','Porto Velho','RO','QA',now(),'confirmed',now())",['Pessoa Ficticia E2E '+number,`qa-e2e-${number}@example.test`,'QA-E2E-'+number]);
   const created=await createBatch('partial');assert.ok(created);return (await query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[created.id])).rows[0];
  }
  const component="/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/components/admin/A1Assinatura";
  writeFileSync(join(root,"ui-entry.tsx"),`import React from "react"; import {createRoot} from "react-dom/client"; import {A1PorLote} from "${component}";
createRoot(document.getElementById("root")!).render(<div className="adm v2 adm-solo"><div className="adm-content v2-main"><main className="v2-pagina"><section className="v2-secao"><A1PorLote batchId={Number(new URLSearchParams(location.search).get("batch"))} onPublished={sha=>{document.documentElement.dataset.publishedSha=sha;document.documentElement.dataset.publications=String(Number(document.documentElement.dataset.publications??0)+1);}} /></section></main></div></div>);`);
  const { build } = await import("/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules/esbuild/lib/main.js");
  await build({entryPoints:[join(root,"ui-entry.tsx")],outfile:join(root,"bundle.js"),bundle:true,tsconfig:"/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/tsconfig.json",platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
  const css=["globals.css","admin/admin.css","admin/v2.css"].map(n=>readFileSync(join("/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app",n),"utf8")).join("\n");
  httpServer=createServer(async(q,r)=>{try{
    const u=new URL(q.url!,origin);
    if(u.pathname==="/bundle.js"){r.setHeader("content-type","application/javascript");r.end(readFileSync(join(root,"bundle.js")));return;}
    if(u.pathname==="/style.css"){r.setHeader("content-type","text/css");r.end(css);return;}
    if(u.pathname==="/"){r.setHeader("content-type","text/html; charset=utf-8");r.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>');return;}
    const match=u.pathname.match(/^\/api\/admin\/lotes\/([1-9][0-9]*)\/(a1|versoes\/([a-f0-9-]+))$/);
    if(!match){r.statusCode=404;r.end();return;}
    const chunks:Buffer[]=[];let size=0;for await(const chunk of q){size+=chunk.length;if(size>32768)throw Error("qa_body_limit");chunks.push(chunk);}
    const body=Buffer.concat(chunks);const headers=new Headers();for(const [key,value] of Object.entries(q.headers)){if(typeof value==="string")headers.set(key,value);}
    const req=new NextRequest(u,{method:q.method,headers,...(body.length?{body}: {})});
    let response:Response;
    if(match[3])response=await DOWNLOAD(req,{params:{id:match[1],versao:match[3]}});
    else response=await(q.method==="POST"?POST:GET)(req,{params:{id:match[1]}});
    if(q.method==="POST"&&match[2]==="a1"){
      browserPosts++;browserInputs.push(JSON.parse(body.toString()));assert.ok([200,202].includes(response.status));
      // Admission persisted before intentionally losing this browser response.
      r.destroy();return;
    }
    r.writeHead(response.status,Object.fromEntries(response.headers));r.end(Buffer.from(await response.arrayBuffer()));
  }catch{r.statusCode=500;r.end();}});
  await new Promise<void>(resolve=>httpServer!.listen(0,"127.0.0.1",resolve));
  origin=`http://127.0.0.1:${(httpServer.address() as any).port}`;
  const { chromium }=await import("/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
  browser=await chromium.launch({headless:true,executablePath:"/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",args:["--disable-dev-shm-usage"]});
  context=await browser.newContext({viewport:{width:390,height:1000}});
  await context.addCookies([{name:"adm",value:session.token,url:origin,httpOnly:true,sameSite:"Lax"}]);
  page=await context.newPage();page.on("pageerror",(e:Error)=>pageErrors.push(e.message));
  await context.route("**/*",async(route:any)=>{assert.equal(new URL(route.request().url()).origin,origin,"browser egress forbidden");await route.continue();});
  async function uiSign(id:number){
    const count=browserPosts;await page.goto(origin+"?batch="+id);
    await page.getByRole("button",{name:"Assinar com certificado A1",exact:true}).click();
    const dialog=page.getByRole("dialog");await page.waitForFunction(()=>!(document.querySelector("dialog .fim button") as HTMLButtonElement).disabled);
    await dialog.getByRole("button",{name:"Assinar com certificado A1",exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
    await dialog.getByRole("alert").waitFor();writeFileSync(join(root,"browser-admission-observation.json"),JSON.stringify({browserPosts,browserInputs,jobs:(await query("SELECT id,request_id,state FROM batch_a1_jobs")).rows},null,2));assert.ok(browserPosts>count);const attempts=browserInputs.slice(count);assert.equal(new Set(attempts.map(i=>i.requestId)).size,1);assert.ok(attempts.every(i=>JSON.stringify(i)===JSON.stringify(attempts[0])));
    return browserInputs.at(-1);
  }
  const first=await batch(1);const original=Buffer.from(first.pdf!);const input=await uiSign(first.id);assert.equal(input.expectedDocumentVersion,documentVersion(first));const params={params:{id:String(first.id)}};
  const ready=await GET(request(first.id,'GET'),params);assert.equal(ready.status,200);assert.equal((await ready.json()).available,false);
  const job=await(await GET(new NextRequest(`http://localhost/api/admin/lotes/${first.id}/a1?requestId=${input.requestId}`,{headers:{host:'localhost',cookie:'adm='+session.token}}),params)).json();assert.equal(job.job.profileVersion,fixture.policy.profileVersion);
  const replayBefore=await POST(request(first.id,'POST',input),params);assert.equal(replayBefore.status,200);assert.equal((await replayBefore.json()).job.jobId,job.job.jobId);
  assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,0);
  assert.equal((await cron('invalid')).status,401);
  const signed=await cron();assert.equal(signed.status,200);const signedResult=await signed.json();assert.equal(signedResult.state,'succeeded');
  const after=(await query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[first.id])).rows[0];assert.deepEqual(after.pdf,original);assert.ok(after.signed_pdf);assert.equal(sha(after.signed_pdf),after.signed_pdf_sha256);assert.equal(after.approved_at,null);assert.equal(after.sent_at,null);
  const observed=await GET(request(first.id,'GET'),params);const latest=(await observed.json()).latestJob;assert.equal(latest.state,'succeeded');assert.equal(latest.requestId,input.requestId);assert.equal(latest.outputSha256,sha(after.signed_pdf));assert.ok(latest.outputVersionId);
  await page.getByRole("dialog").getByRole("button",{name:"Conferir assinatura",exact:true}).click();
  const link=page.getByRole("dialog").getByRole("link",{name:"Baixar PDF assinado"});await link.waitFor();
  const downloaded=await context.request.get(origin+await link.getAttribute("href"));assert.equal(downloaded.status(),200);assert.equal(sha(await downloaded.body()),after.signed_pdf_sha256);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.publishedSha),after.signed_pdf_sha256);
  const widths=[];for(const width of [360,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);widths.push(width);await page.screenshot({path:join(root,`a1-http-${width}.png`)});}
  assert.equal(new Set(browserInputs.map(i=>i.requestId)).size,1);
  const replayAfter=await POST(request(first.id,'POST',input),params);assert.equal(replayAfter.status,200);assert.equal((await replayAfter.json()).job.jobId,job.job.jobId);assert.equal((await (await cron()).json()).state,'empty');
  assert.equal((await query('SELECT 1 FROM batch_a1_jobs')).rowCount,1);assert.equal((await query('SELECT 1 FROM batch_a1_validations')).rowCount,1);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,1);
  await fetch(fixture.validatorControl,{method:'POST',headers:{authorization:'Bearer '+fixture.validatorToken,'content-type':'application/json'},body:JSON.stringify({mode:'wrong-policy'})}).then(r=>assert.equal(r.status,200));
  const second=await batch(2),secondInput=await uiSign(second.id);assert.equal(secondInput.expectedDocumentVersion,documentVersion(second));
  const rejected=await cron();assert.equal((await rejected.json()).state,'validation_failed');const rejectedBatch=(await query('SELECT signed_pdf,approved_at,sent_at FROM batches WHERE id=$1',[second.id])).rows[0];assert.deepEqual(rejectedBatch,{signed_pdf:null,approved_at:null,sent_at:null});
  await page.getByRole("dialog").getByRole("button",{name:"Conferir assinatura",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Falha na assinatura"}).waitFor();
  assert.equal(await page.getByRole("dialog").getByRole("link",{name:"Baixar PDF assinado"}).count(),0);assert.equal(new Set(browserInputs.map(i=>i.requestId)).size,2);assert.deepEqual(pageErrors,[]);
  assert.equal((await query('SELECT state FROM batch_a1_jobs WHERE batch_id=$1',[second.id])).rows[0].state,'failed');assert.equal((await (await cron()).json()).state,'empty');
  assert.equal((await query('SELECT 1 FROM batch_a1_validations')).rowCount,1);assert.equal((await query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends')).rowCount,0);
  const audit=await import('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/db');assert.ok((await audit.verifyAuditChain()).ok);
  const safe=JSON.stringify(latest);for(const forbidden of ['synthetic-password','leaseToken','pdfBase64','/certificates/'])assert.ok(!safe.includes(forbidden));
  const result={browserToActualApi:true,actualPostgres:true,adminComponent:true,renderHarness:"isolated-react-with-actual-api",browserPosts,logicalBrowserIntents:new Set(browserInputs.map(i=>i.requestId)).size,widths,pageErrors,ok:true,syntheticOnly:true,notIcpHomologation:true,mailProvider:'dev',realUnixBroker:true,realWorker:true,realSyntheticCryptography:true,validatorTrust:'synthetic-contract-simulation-only',profile:fixture.policy.profileVersion,successJobId:job.job.jobId,outputSha256:sha(after.signed_pdf),wrongPolicyBlocked:true,replaySignedVersions:1,approvals:0,mailMessages:0};
  writeFileSync(join(root,'scenario-result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:"wx"});console.log(JSON.stringify(result));
 }finally{if(browser)await browser.close();if(httpServer)await new Promise<void>(resolve=>httpServer!.close(()=>resolve()));await _closeDbForTests();}
}main();
