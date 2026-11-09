// Compiled HTTP fixture. Identity is MOCK; this is neither ICP nor Gov.br homologation.
import assert from "node:assert/strict";
import { spawn,execFileSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream,writeFileSync,readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const commit=process.env.QA_EXPECTED_COMMIT,site=process.env.QA_SITE_DIR,output=process.env.QA_OUTPUT_DIR;
assert.equal(commit,"1b9ffd7faf9d4a4d1d475b651058d3b47cce7463");
assert.equal(site,"/mnt/dev/peticao/.cache/admin-integration/candidate-president-access-http-1b9ffd7-20261109/site");
assert.equal(process.cwd(),site);assert.equal(execFileSync("git",["rev-parse","HEAD"],{cwd:site,encoding:"utf8"}).trim(),commit);
assert.equal(process.version,"v20.19.2");assert.equal(process.env.DEV_DB_PORT,"54368");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.CPF_FORCE_MOCK,"1");
assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.MAIL_PROVIDERS,"dev");assert.equal(process.env.SIGNER,"none");
const base="http://127.0.0.1:3049";assert.equal(process.env.QA_BASE_URL,base);
const [db,U,S,K,C]=await Promise.all(["db","admin-users","president-portal-store","president-portal-contract","cpf-check"].map(n=>import(pathToFileURL(`${site}/src/lib/${n}.ts`).href)));
assert.equal(C.defaultProvider()?.name,"mock");
const {PDFDocument}=createRequire(`${site}/package.json`)("pdf-lib");
const digest=b=>createHash("sha256").update(b).digest("hex");
const cpf="52998224725",identity={cpf,birthDate:"2000-01-01"},proofs=[],capabilities=[];
let server,serverExit,serverLog,confirmPosts=0,reads=0;
await db._openForTests("qa_president_access_compiled");
const pause=()=>db.query("INSERT INTO settings(key,value) VALUES('sending_enabled','false') ON CONFLICT(key) DO UPDATE SET value='false'");
const selectChallenge=id=>db.query("SELECT state,attempts,lease_token,lease_until,receipt_id,confirmed_at FROM president_challenges WHERE id=$1",[id]).then(r=>r.rows[0]);
const batchState=()=>db.query("SELECT id,status,approved_at,pdf_sha256,signed_pdf_sha256,signature_kind,list_hash FROM batches ORDER BY id").then(r=>r.rows);
const assertNoMail=async()=>{
 assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM signatures")).rowCount,0);
 let files=[];try{files=readdirSync(process.env.MAIL_OUTBOX_DIR);}catch{}assert.equal(files.length,0);
};
function request(endpoint,body,options={}){
 assert.ok(["documento","estado","confirmar"].includes(endpoint));
 const headers={origin:base,"content-type":"application/json","x-forwarded-for":options.ip??"198.51.100.50",...options.headers};
 if(options.noOrigin)delete headers.origin;
 if(endpoint==="confirmar")confirmPosts++;else reads++;
 return fetch(`${base}/api/presidente/${endpoint}`,{method:options.method??"POST",headers,body:options.method==="GET"?undefined:options.raw??JSON.stringify(body),redirect:"manual",signal:AbortSignal.timeout(20000)});
}
async function json(endpoint,body,status=200,options={}){const r=await request(endpoint,body,options);assert.equal(r.status,status,`${endpoint}: expected ${status}`);return r.json();}
const creds=issued=>({token:issued.token,password:issued.password});
const wrong=issued=>({...creds(issued),password:issued.password==="AAAAAAAAAAAA"?"BBBBBBBBBBBB":"AAAAAAAAAAAA"});
function noPii(value,issued){
 const raw=JSON.stringify(value);for(const secret of [cpf,identity.birthDate,"Pessoa Responsavel QA","qa-president@example.test",issued.token,issued.password])assert.ok(!raw.includes(secret));
 assert.ok(!("bytes"in value));assert.deepEqual(Object.keys(value).sort(),["canConfirm","document","expiresAt","ok","receipt","state"].sort());
 assert.deepEqual(Object.keys(value.document).sort(),["batchId","byteLength","documentVersion","kind","seq","sha256"].sort());
}
try{
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-owner@example.test','QA Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-president@example.test','Pessoa Responsavel QA','leitura','QA-NOT-A-LOGIN-HASH'),(3,'qa-editor@example.test','QA Editor','edicao','QA-NOT-A-LOGIN-HASH')");
 const ownerSession=await U.abrirSessao(1,"127.0.0.1"),editorSession=await U.abrirSessao(3,"127.0.0.1");
 const actor=()=>U.sessaoPorToken(ownerSession.token);
 assert.equal((await S.configurePresidentProfile(await actor(),{responsibleId:2,cpf,enabled:true,expectedRevision:0})).ok,false);
 await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes'");
 assert.equal((await S.configurePresidentProfile(await U.sessaoPorToken(editorSession.token),{responsibleId:2,cpf,enabled:true,expectedRevision:0})).ok,false);
 assert.deepEqual(await S.configurePresidentProfile(await actor(),{responsibleId:2,cpf,enabled:true,expectedRevision:0}),{ok:true,revision:1});
 const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=Buffer.from(await pdf.save());
 const batch=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'final','prepared',0,1,$1,$2,$3,'none') RETURNING id",["a".repeat(64),bytes,digest(bytes)])).rows[0].id;
 const issue=async()=>{const result=await S.issueConfiguredPresidentChallenge(batch,await actor(),C.defaultProvider());assert.ok(result.ok);capabilities.push(result);return result;};
 assert.equal((await S.issueConfiguredPresidentChallenge(batch,await U.sessaoPorToken(editorSession.token),C.defaultProvider())).ok,false);
 await pause();
 serverLog=createWriteStream(`${output}/server.log`);server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3049"],{env:{...process.env}});server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);serverExit=once(server,"exit");
 let ready=false;for(let n=0;n<120;n++){if(server.exitCode!==null)throw new Error("Fixture server stopped before readiness");try{ready=(await request("estado",null,{method:"GET"})).status===405;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 let issued=await issue(),beforeChallenge=await selectChallenge(issued.id),beforeBatch=await batchState();
 let response=await request("documento",creds(issued));assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"application/pdf");assert.match(response.headers.get("content-disposition"),/^attachment;/);assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(response.headers.get("x-content-type-options"),"nosniff");
 assert.equal(response.headers.get("referrer-policy").split(",").at(-1).trim(),"no-referrer");assert.match(response.headers.get("content-security-policy"),/sandbox; default-src 'none'/);assert.equal(response.headers.get("x-document-sha256"),digest(bytes));assert.equal(response.headers.get("x-document-version"),issued.documentVersion);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 let state=await json("estado",creds(issued));noPii(state,issued);assert.equal(state.state,"issued");assert.equal(state.canConfirm,true);assert.equal(state.receipt,null);assert.equal(state.document.sha256,digest(bytes));assert.deepEqual(await selectChallenge(issued.id),beforeChallenge);assert.deepEqual(await batchState(),beforeBatch);await assertNoMail();
 proofs.push("Compiled password-bound POST reads return exact immutable PDF/hash/version and whitelisted metadata; no state consumption or mail");
 for(const endpoint of ["documento","estado"]){
  const ip=endpoint==="documento"?"198.51.100.51":"198.51.100.52";
  for(const options of [{noOrigin:true},{headers:{origin:"https://other.example.test"}},{headers:{origin:"invalid"}}])assert.equal((await request(endpoint,creds(issued),{...options,ip})).status,403);
  assert.equal((await request(endpoint,creds(issued),{ip,headers:{"content-type":"text/plain"}})).status,415);
  for(const raw of ["{","[]",JSON.stringify({...creds(issued),cpf}),JSON.stringify({token:issued.token,password:42})])assert.equal((await request(endpoint,null,{ip,raw})).status,400);
  assert.equal((await request(endpoint,null,{ip,raw:"A".repeat(513)})).status,413);
  assert.equal((await request(endpoint,null,{ip,method:"GET"})).status,405);
 }
 const unknown={token:"A".repeat(43),password:"A".repeat(12)},ip="198.51.100.53";
 for(let n=0;n<12;n++)await json(n%2?"documento":"estado",unknown,409,{ip});
 assert.equal((await request("documento",unknown,{ip})).status,429);
 proofs.push("Origin, POST-only, JSON shape/body bound and shared access-route IP budget enforced over real HTTP");
 issued=await issue();const bad=wrong(issued),budgetIp="198.51.100.54";
 for(let n=0;n<4;n++)await json(n%2?"documento":"estado",bad,409,{ip:budgetIp});
 await json("confirmar",{...bad,...identity},409,{ip:budgetIp});
 let rejected=await selectChallenge(issued.id);assert.equal(rejected.state,"rejected");assert.equal(rejected.attempts,5);
 await json("estado",creds(issued),409,{ip:budgetIp});await json("confirmar",{...creds(issued),...identity},409,{ip:budgetIp});assert.deepEqual(await selectChallenge(issued.id),rejected);
 issued=await issue();await db.query("UPDATE president_challenges SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[issued.id]);
 await json("estado",creds(issued),409,{ip:"198.51.100.55"});await json("documento",creds(issued),409,{ip:"198.51.100.55"});
 proofs.push("Five wrong passwords across document/state/confirm share one persisted budget; rejected and expired capabilities fail closed");
 issued=await issue();const {config}=await import(pathToFileURL(`${site}/src/lib/config.ts`).href),hashes=K.presidentAccessHashes(issued,config.pepper());
 const now=Date.now();assert.ok(await S.postgresPresidentChallengeStore().claim({...hashes,leaseId:"00000000-0000-4000-8000-000000000001",now,leaseUntil:now+30000}));
 let lease=await selectChallenge(issued.id);state=await json("estado",creds(issued),200,{ip:"198.51.100.56"});noPii(state,issued);assert.equal(state.state,"verifying");assert.equal(state.canConfirm,false);
 await json("estado",wrong(issued),409,{ip:"198.51.100.56"});assert.deepEqual(await selectChallenge(issued.id),lease);
 await db.query("UPDATE president_challenges SET lease_until=now()-interval '1 second' WHERE id=$1",[issued.id]);lease=await selectChallenge(issued.id);
 state=await json("estado",creds(issued),200,{ip:"198.51.100.56"});assert.equal(state.state,"verifying");assert.equal(state.canConfirm,true);assert.deepEqual(await selectChallenge(issued.id),lease);
 const beforeConfirmPosts=confirmPosts;response=await request("confirmar",{...creds(issued),...identity},{ip:"198.51.100.57"});assert.equal(response.status,200);await response.body.cancel();
 // The client discards the successful response body. Recover via state only.
 const consumed=await selectChallenge(issued.id);assert.equal(consumed.state,"consumed");assert.ok(consumed.receipt_id);assert.ok(consumed.confirmed_at);
 state=await json("estado",creds(issued),200,{ip:"198.51.100.57"});noPii(state,issued);assert.equal(state.state,"consumed");assert.equal(state.canConfirm,false);assert.equal(state.receipt.receiptId,consumed.receipt_id);assert.equal(state.receipt.assurance,"own-confirmation");assert.equal(state.receipt.icpBrasil,false);assert.equal(state.receipt.govBr,false);assert.equal(confirmPosts,beforeConfirmPosts+1);
 assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);
 response=await request("documento",creds(issued),{ip:"198.51.100.57"});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.deepEqual(await selectChallenge(issued.id),consumed);assert.deepEqual(await batchState(),beforeBatch);await assertNoMail();
 proofs.push("Live/expired leases drive server canConfirm without cancelling lease; MOCK identity consumes once and receipt recovers after discarded response without a second confirm POST or PII");
 // Audit failure rolls back access rather than exposing binary bytes.
 await db.query("CREATE FUNCTION qa_access_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='president_document_read' THEN RAISE EXCEPTION 'QA access audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_access_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_access_fault()");
 const auditBefore=(await db.query("SELECT id,hash FROM audit_log ORDER BY id")).rows;
 await json("documento",creds(issued),409,{ip:"198.51.100.58"});assert.deepEqual((await db.query("SELECT id,hash FROM audit_log ORDER BY id")).rows,auditBefore);assert.deepEqual(await selectChallenge(issued.id),consumed);
 await db.query("DROP TRIGGER qa_access_fault ON audit_log; DROP FUNCTION qa_access_fault()");
 const fresh=await issue();assert.deepEqual(await S.configurePresidentProfile(await actor(),{responsibleId:2,enabled:false,expectedRevision:1}),{ok:true,revision:2});
 const revoked=await selectChallenge(fresh.id);assert.equal(revoked.state,"revoked");
 for(const challenge of [fresh,issued]){await json("estado",creds(challenge),409,{ip:"198.51.100.59"});await json("documento",creds(challenge),409,{ip:"198.51.100.59"});}
 assert.deepEqual(await selectChallenge(fresh.id),revoked);assert.deepEqual(await selectChallenge(issued.id),consumed);assert.deepEqual(await batchState(),beforeBatch);
 assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);
 const auditAfter=(await db.query("SELECT id,hash FROM audit_log WHERE id<=$1 ORDER BY id",[auditBefore.at(-1).id])).rows;assert.deepEqual(auditAfter,auditBefore);assert.ok((await db.verifyAuditChain()).ok);await assertNoMail();await pause();
 const persisted=JSON.stringify((await db.query("SELECT data FROM audit_log UNION ALL SELECT row_to_json(p)::text data FROM president_challenges p")).rows);
 for(const secret of [cpf,identity.birthDate,...capabilities.flatMap(c=>[c.token,c.password])])assert.ok(!persisted.includes(secret));
 proofs.push("Audit failure exposes no PDF and rolls back; profile revocation denies issued and consumed reads while preserving receipt, batch bytes/state and prior audit chain");
 const proof={commit,node:process.version,passed:true,proofs,identityProvider:"mock",cryptoHomologation:false,icp:false,govBr:false,mailSent:0,confirmPosts,accessRequests:reads,documentSha256:digest(bytes),documentBytes:bytes.length,pausedAtEnd:true};
 writeFileSync(`${output}/president-access-proof.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({passed:true,proofGroups:proofs.length,identityProvider:"mock",mailSent:0}));
}finally{
 await pause().catch(()=>{});if(server){server.kill("SIGTERM");const timer=setTimeout(()=>server.kill("SIGKILL"),10000);await serverExit;clearTimeout(timer);serverLog.end();}
 await db._closeDbForTests();
}
