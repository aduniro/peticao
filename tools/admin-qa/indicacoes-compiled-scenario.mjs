/** DRAFT: run only through the pinned compiled wrapper after root integrates and freezes the build. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, writeFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertSignatureBootstrap } from "./indicacoes-compiled-bootstrap.mjs";
import { assertPrivateHeaders } from "./indicacoes-compiled-guards.mjs";
import { runIndicacoesCompiledUi } from "./indicacoes-compiled-ui.mjs";
const site=process.env.QA_SITE_DIR,output=process.env.QA_OUTPUT_DIR,commit=process.env.QA_EXPECTED_COMMIT;
assert.equal(site,"/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");assert.equal(process.cwd(),site);assert.equal(process.version,"v20.19.2");
assert.equal(process.env.DATABASE_URL,"postgres://peticao:peticao@127.0.0.1:54382/peticao");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.MAIL_PROVIDERS,"dev");assert.ok(!process.env.CRON_SECRET);
assert.equal(execFileSync("/usr/bin/git",["rev-parse","HEAD"],{cwd:site,encoding:"utf8"}).trim(),commit);
for(const key of["SECRETS_DIR","PETICAO_CONFIG_DIR","CREDENTIALS_DIRECTORY"])assert.equal(readdirSync(process.env[key]).length,0);
for(const key of["CPF_BRASIL_API_KEY","CPF_MOCK_DATA","CPF_FORCE_MOCK"])assert.ok(!process.env[key]);
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const runId=randomUUID();assert.ok(uuid(runId),"verify 8-4-4-4-12 UUID before any DB mutation");
const db=await import(pathToFileURL(site+"/src/lib/db.ts").href),U=await import(pathToFileURL(site+"/src/lib/admin-users.ts").href);
const base="http://127.0.0.1:3057",native="http://127.0.0.1:3058",delay=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>createHash("sha256").update(v).digest("hex");
let server,serverExit,serverLog,proxy,browser;const external=[],errors=[];const alphabet="23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const code=n=>{let v=n,s="";for(let i=0;i<7;i++){s=alphabet[v%alphabet.length]+s;v=Math.floor(v/alphabet.length);}return s;};
let stopPromise;
async function stop(){
 if(stopPromise)return stopPromise;
 stopPromise=(async()=>{
  const failures=[];
  const cleanup=async job=>{try{await job();}catch(error){failures.push(error);}};
  if(browser)await cleanup(()=>browser.close());
  if(proxy)await cleanup(async()=>{proxy.closeAllConnections();await new Promise((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()));});
  if(server)await cleanup(async()=>{const live=server.exitCode===null&&server.signalCode===null;if(live)server.kill("SIGTERM");const timer=setTimeout(()=>{if(server.exitCode===null&&server.signalCode===null)server.kill("SIGKILL");},10000);try{await serverExit;}finally{clearTimeout(timer);serverLog?.end();}});
  await cleanup(()=>db._closeDbForTests());
  if(failures.length)throw failures[0];
 })();return stopPromise;
}
let rejectFatal,originalFailure=null;
const fatal=new Promise((_,reject)=>{rejectFatal=reject;});void fatal.catch(()=>{});
const onFatal=error=>{originalFailure??=error;rejectFatal(originalFailure);};
const onSignal=()=>onFatal(new Error("QA interrupted; cleaning only owned resources"));
process.on("unhandledRejection",onFatal);process.on("uncaughtException",onFatal);process.on("SIGTERM",onSignal);process.on("SIGINT",onSignal);
async function run(){
 await db._openForTests("qa_indicacoes_compiled_browser");
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-ref-owner@example.test','QA Ref Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-ref-reader@example.test','QA Ref Reader','leitura','QA-NOT-A-LOGIN-HASH')");
 const ownerSession=await U.abrirSessao(1,"127.0.0.1"),readerSession=await U.abrirSessao(2,"127.0.0.1");await db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '15 minutes' WHERE user_id=1");const actor=await U.sessaoPorToken(ownerSession.token);assert.ok(actor);
 await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status)VALUES('QA Owner Marker','owner@example.test','QA-MARKER','apoiador','QA','QA','confirmed')");
 const codes=Array.from({length:1007},(_,i)=>code(i+1));await db.query("INSERT INTO referrers(code,manage_token_hash,label,display_name,signature_id,archived_at)SELECT x,'QA-SECRET-'||x,CASE WHEN ord=4 THEN NULL ELSE 'QA Organization '||ord END,CASE WHEN ord IN(1,3)THEN 'QA Personal' ELSE NULL END,CASE WHEN ord=2 THEN 1 ELSE NULL END,CASE WHEN ord=5 THEN now() ELSE NULL END FROM unnest($1::text[])WITH ORDINALITY t(x,ord)",[codes]);
 await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,ref_code)SELECT 'QA Referred '||n,'referred'||n||'@example.test','QA-REF-'||n,'apoiador','QA','QA','confirmed',($1::text[])[n] FROM generate_series(938,1007)n",[codes]);
 await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,ref_code)SELECT 'QA Detail '||n,'detail'||n||'@example.test','QA-DETAIL-'||n,CASE WHEN n%3=0 THEN 'servidor' WHEN n%3=1 THEN 'apoiador' ELSE 'estrangeiro' END,'QA','QA',CASE WHEN n<=80 THEN 'confirmed' ELSE 'pending' END,$1 FROM generate_series(1,125)n",[codes.at(-1)]);
 await db.query("INSERT INTO events(ts,visitor_id,type,ref_code,is_bot)VALUES('QA','shared','ref_visit',$1,false),('QA','shared','ref_visit',$1,false),('QA','other','ref_visit',$1,false),('QA','bot','ref_visit',$1,true),('QA','shared','ref_visit',$2,false),('QA','archived','ref_visit',$3,false)",[codes[0],codes[1],codes[4]]);
 const immutableBefore=(await db.query("SELECT id,code,manage_token_hash,display_name,signature_id FROM referrers ORDER BY id")).rows;
 const fixturesBeforeBootstrap=(await db.query("SELECT to_jsonb(s) value FROM signatures s ORDER BY id")).rows.map(r=>r.value);
 const env={...process.env,NODE_ENV:"production",PREVIEW_MODE:"0",APP_URL:base};
 serverLog=createWriteStream(output+"/next-server.log");server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3058"],{cwd:site,env});server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);serverExit=once(server,"exit");
 let ready=false;for(let n=0;n<160;n++){if(server.exitCode!==null)throw Error("Next stopped");try{ready=(await fetch(native+"/admin",{signal:AbortSignal.timeout(2000)})).status===200;}catch{}if(ready)break;await delay(250);}assert.ok(ready);
 proxy=createServer(async(req,res)=>{try{assert.ok(req.url?.startsWith("/")&&!req.url.startsWith("//"));const chunks=[];let n=0;for await(const part of req){n+=part.length;assert.ok(n<=4096);chunks.push(part);}const body=Buffer.concat(chunks),headers={...req.headers,"x-forwarded-host":req.headers.host,"x-forwarded-for":"127.0.0.1"};for(const k of["connection","accept-encoding","transfer-encoding"])delete headers[k];const response=await fetch(native+req.url,{method:req.method,headers,redirect:"manual",...(body.length?{body}:{})}),bytes=Buffer.from(await response.arrayBuffer()),outgoing=Object.fromEntries(response.headers);for(const k of["content-encoding","content-length","transfer-encoding","connection"])delete outgoing[k];outgoing["content-length"]=String(bytes.length);res.writeHead(response.status,outgoing);res.end(bytes);}catch(e){console.log(JSON.stringify({proxyFailure:e.name}));if(!res.headersSent)res.writeHead(502);res.end();}});await new Promise(r=>proxy.listen(3057,"127.0.0.1",r));
 // Warm the real authenticated handler: Next initializes this separate pool and performs its documented confirmed-id backfill.
 const warm=await fetch(base+"/api/admin/indicacoes/estatisticas?limit=1",{headers:{cookie:`adm=${ownerSession.token}`,origin:base,accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(15000)});
 assert.equal(warm.status,200);assertPrivateHeaders(Object.fromEntries(warm.headers));const warmData=await warm.json();assert.ok(warmData.ok&&warmData.totals.codes===1007);
 const fixturesAfterBootstrap=(await db.query("SELECT to_jsonb(s) value FROM signatures s ORDER BY id")).rows.map(r=>r.value);
 const bootstrapDelta=assertSignatureBootstrap(fixturesBeforeBootstrap,fixturesAfterBootstrap);
 writeFileSync(output+"/bootstrap-delta.json",JSON.stringify(bootstrapDelta,null,2));
 const peopleBefore=sha((await db.query("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text raw FROM signatures s")).rows[0].raw);
 const{chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM});
 const result=await runIndicacoesCompiledUi({browser,base,db,U,actor,ownerSession,readerSession,output,codes,uuid});
 assert.deepEqual((await db.query("SELECT id,code,manage_token_hash,display_name,signature_id FROM referrers ORDER BY id")).rows,immutableBefore);
 assert.equal(sha((await db.query("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text raw FROM signatures s")).rows[0].raw),peopleBefore);
 assert.equal((await db.query("SELECT (SELECT count(*) FROM mail_outbox)+(SELECT count(*) FROM mail_messages)+(SELECT count(*) FROM batch_sends) n")).rows[0].n,"0");assert.ok((await db.verifyAuditChain()).ok);
 writeFileSync(output+"/indicacoes-compiled-result.json",JSON.stringify({ok:true,commit,runId,compiledNextUi:true,realHandlersAndDatabase:true,noRealMail:true,verifiedBootstrapDelta:bootstrapDelta,fullSignatureInvariantAfterBootstrap:true,immutableReferralBindingsAndSignatures:true,...result},null,2));console.log(JSON.stringify({ok:true,compiledNextUi:true,groups:result.groups}));
}
try{await Promise.race([run(),fatal]);}
catch(error){originalFailure??=error;console.error(originalFailure);process.exitCode=1;}
finally{
 try{await stop();}catch(error){if(!originalFailure){originalFailure=error;console.error(error);}else console.error(JSON.stringify({cleanupFailure:error?.name??"Error",originalFailurePreserved:true}));process.exitCode=1;}
 finally{process.off("unhandledRejection",onFatal);process.off("uncaughtException",onFatal);process.off("SIGTERM",onSignal);process.off("SIGINT",onSignal);}
}
// Exit only after owned-resource cleanup; a failed UI promise may still own bounded polling/rate-window timers.
if(originalFailure)process.exit(1);
