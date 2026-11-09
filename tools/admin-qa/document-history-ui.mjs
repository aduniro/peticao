import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL(process.env.QA_BASE_URL ?? "http://invalid"), database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.equal(base.origin,"http://127.0.0.1:3036");assert.equal(database.hostname,"127.0.0.1");assert.equal(database.port,"54356");assert.equal(database.pathname,"/peticao");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");
const output=process.env.QA_OUTPUT_DIR;assert.ok(output);await mkdir(output,{recursive:true});
const [db,U,H]=await Promise.all([import("../../site/src/lib/db.ts"),import("../../site/src/lib/admin-users.ts"),import("../../site/src/lib/batch-document-history.ts")]).then(xs=>xs.map(x=>x.default??x));
const { PDFDocument }=await import("../../site/node_modules/pdf-lib/es/index.js").catch(()=>import("../../site/node_modules/pdf-lib/cjs/index.js")).then(x=>x.default??x);
const sha=b=>createHash("sha256").update(b).digest("hex");
const pdf=async(label)=>{const d=await PDFDocument.create();d.addPage().drawText(label);return Buffer.from(await d.save());};
let browser;const tokens=[];
try{
 assert.equal((await db.query("SELECT count(*)::int n FROM signatures")).rows[0].n,0);
 const actors={};
 for(const role of ["leitura","edicao","exclusao","total"]){const created=await U.criarUsuario({email:`qa-history-${role}@example.test`,nome:`QA ${role}`,nivel:role,senha:"QA-Tests-2026-Ficticia"});assert.ok(created.ok);const session=await U.abrirSessao(created.usuario.id,"127.0.0.1");tokens.push(session.token);actors[role]={id:created.usuario.id,email:created.usuario.email,token:session.token};}
 const current=await pdf("QA current original");const batch=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(42,'partial','prepared',0,0,$1,$2,$3,'none') RETURNING id",["b".repeat(64),current,sha(current)])).rows[0].id;
 const versions=[];
 await db.tx(async c=>{for(let ordinal=1;ordinal<=54;ordinal++){const bytes=await pdf(`QA historical version ${ordinal}`),variant=ordinal%2?"original":"signed";const r=await H.appendDocumentVersion(c,{batchId:batch,variant,bytes,sha256:sha(bytes),listHash:"b".repeat(64),signatureKind:ordinal===1?null:variant==="signed"?"externa-nao-validada":"none",note:"QA NEVER SHOW PRIVATE NOTE",source:ordinal===1?"legacy-observed":variant==="signed"?"upload":"prepared",authorId:ordinal===1?null:actors.total.id,recordedBy:actors.total.id});versions.push({...r,bytes,sha256:sha(bytes),variant});}});
 const listing=`/api/admin/lotes/${batch}/versoes`;
 const fetchAs=(path,token)=>fetch(new URL(path,base),{headers:{cookie:token?`adm=${token}`:""}});
 assert.equal((await fetchAs(listing)).status,401);
 for(const role of ["leitura","edicao","exclusao"]){assert.equal((await fetchAs(listing,actors[role].token)).status,403);assert.equal((await fetchAs(`${listing}/${versions[0].id}`,actors[role].token)).status,403);}
 assert.equal((await fetchAs(listing,actors.total.token)).status,403);
 await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1",[actors.total.id]);
 const snap=async()=>(await db.query("SELECT 'batch' kind,row_to_json(b)::text data FROM batches b UNION ALL SELECT 'version',row_to_json(v)::text FROM batch_document_versions v UNION ALL SELECT 'signature',row_to_json(s)::text FROM signatures s UNION ALL SELECT 'queue',row_to_json(q)::text FROM mail_outbox q UNION ALL SELECT 'message',row_to_json(m)::text FROM mail_messages m ORDER BY kind,data")).rows;
 const before=await snap();const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM});
 const results=[];
 for(const width of [320,390,768,992,1280,1920]){
  const context=await browser.newContext({viewport:{width,height:950},acceptDownloads:true});await context.addCookies([{name:"adm",value:actors.total.token,url:base.origin}]);
  const page=await context.newPage(),errors=[],writes=[],external=[],badHttp=[];let historyRequests=0,downloadRequests=0;
  page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{const u=new URL(r.url());if(!["GET","HEAD"].includes(r.method()))writes.push(r.url());if(u.origin!==base.origin)external.push(r.url());if(u.pathname===listing)historyRequests++;if(u.pathname.startsWith(listing+"/"))downloadRequests++;});
  page.on("response",r=>{if(r.status()>=400)badHttp.push({url:r.url(),status:r.status()});});
  const rows=()=>page.getByTestId("document-history").locator(".table-scroll > table > tbody > tr");
  const waitRows=async n=>{await page.waitForFunction(n=>document.querySelector('[data-testid="document-history"]')?.querySelector("table")?.tBodies[0]?.rows.length===n,n);};
  try{
   assert.equal((await page.goto(new URL(`/admin/presidente?lote=${batch}`,base).href)).status(),200);const trigger=page.getByRole("button",{name:"Histórico",exact:true});await trigger.waitFor();assert.equal(historyRequests,0);assert.equal(downloadRequests,0);
   await trigger.click();await waitRows(50);const modal=page.getByTestId("document-history");assert.equal(await modal.evaluate(x=>x.open),true);assert.equal(downloadRequests,0);assert.ok(!(await modal.innerText()).includes("QA NEVER SHOW"));
   let fault=false;
   if(width===390)await page.route(`**${listing}?antes=5`,async route=>{if(!fault){fault=true;await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});}else await route.continue();});
   await modal.getByRole("button",{name:"Mais antigos",exact:true}).click();
   if(width===390){await modal.getByRole("alert").waitFor();assert.equal(await rows().count(),50);await modal.getByRole("button",{name:"Mais antigos",exact:true}).click();}
   await waitRows(54);assert.equal(await modal.getByRole("button",{name:"Mais antigos",exact:true}).count(),0);
   assert.equal((await rows().last().locator("td").nth(5).innerText()).split("\n")[0],"—");assert.ok((await rows().last().innerText()).includes("Histórico anterior"));
   const wrapper=modal.locator(".table-scroll"),metrics=await wrapper.evaluate(x=>({client:x.clientWidth,scroll:x.scrollWidth,table:x.querySelector("table").getBoundingClientRect().width}));assert.ok(metrics.table>=1079);assert.ok(metrics.scroll>metrics.client);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
   await modal.getByRole("button",{name:"Atualizar",exact:true}).click();await waitRows(50);
   const shot=`${output}/history-president-${width}.png`;await modal.screenshot({path:shot});
   const downloadEvent=page.waitForEvent("download");await rows().first().getByRole("link",{name:"Baixar",exact:true}).click();const download=await downloadEvent;const bytes=await readFile(await download.path());assert.deepEqual(bytes,versions.at(-1).bytes);assert.equal(sha(bytes),versions.at(-1).sha256);assert.equal(download.suggestedFilename(),`lote-${batch}-versao-54-signed.pdf`);assert.equal(downloadRequests,1);
   await page.keyboard.press("Escape");await page.waitForFunction(()=>!document.querySelector('[data-testid="document-history"]')?.open);await page.waitForFunction(()=>document.activeElement?.textContent==="Histórico");
   const requested=historyRequests;assert.equal((await page.goto(new URL("/admin/lotes",base).href)).status(),200);await page.getByRole("button",{name:"Histórico",exact:true}).waitFor();assert.equal(historyRequests,requested);
   await page.getByRole("button",{name:"Histórico",exact:true}).click();await waitRows(50);assert.equal(downloadRequests,1);const lots=`${output}/history-lotes-${width}.png`;await page.getByTestId("document-history").screenshot({path:lots});await page.getByRole("button",{name:"Fechar",exact:true}).click();
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.deepEqual(badHttp.filter(x=>!(width===390&&x.status===503&&x.url.endsWith("?antes=5"))),[]);
   results.push({width,metadataRequests:historyRequests,explicitDownloads:downloadRequests,metrics,president:shot,lotes:lots,keyboardAndPagination:true,failedPagePreserved:width===390?true:"not_injected"});
  }catch(error){await page.screenshot({path:`${output}/failure-${width}.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/failure-${width}.json`,JSON.stringify({width,errors,writes,external,badHttp,historyRequests,downloadRequests,dialogs:await page.getByTestId("document-history").evaluateAll(xs=>xs.map(x=>({open:x.open,text:x.innerText}))),body:await page.locator("body").innerText()},null,2));throw error;}finally{await context.close();}
 }
 assert.deepEqual(await snap(),before,"History UI must preserve exact batch/version/signature/mail state");const audit=(await db.query("SELECT event,count(*)::int n FROM audit_log WHERE event IN ('batch_document_versions_listed','batch_document_version_downloaded') GROUP BY event ORDER BY event")).rows;assert.ok(audit.every(x=>x.n>0));
 const report={ok:true,base:base.origin,widths:results,realCompiledUi:true,downloadBytesAndHash:true,serverRoleAndStepup:true,sourceRecordsPreserved:true,noBrowserPost:true,noExternalBrowserRequests:true,audit};await writeFile(`${output}/history-ui.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();for(const token of tokens)await U.encerrarSessao(token);await db._closeDbForTests();}
