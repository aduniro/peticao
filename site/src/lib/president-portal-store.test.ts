import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
delete process.env.PREVIEW_MODE;
const cpf="52998224725"; // Published algorithm example, fictitious identity/provider only.
const identity={cpf,birthDate:"2000-01-01"};
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function fixture(schema:string) {
  const db=await import("./db");await db._openForTests(schema);
  const S=await import("./president-portal-store"),U=await import("./admin-users"),C=await import("./cpf-check");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-owner@example.test','QA Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-responsible@example.test','Pessoa Responsavel QA','leitura','QA-NOT-A-LOGIN-HASH')");
  const session=await U.abrirSessao(1,"127.0.0.1");await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  const actor=(await U.sessaoPorToken(session.token))!;
  const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=Buffer.from(await pdf.save());
  const batch=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'final','prepared',0,1,$1,$2,$3,'none') RETURNING id",["a".repeat(64),bytes,digest(bytes)])).rows[0].id as number;
  const provider=C.mockProvider({[cpf]:{nome:"Pessoa Responsavel QA",nasc:"01/01/2000"}});
  const profile={responsibleId:2,cpf,whatsapp:"+5511999990000",enabled:true,expectedRevision:0};
  assert.deepEqual(await S.configurePresidentProfile(actor,profile),{ok:true,revision:1});
  const issue=async()=>{const r=await S.issueConfiguredPresidentChallenge(batch,actor,provider);assert.ok(r.ok);return r;};
  const documents=async()=>(await db.query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows;
  const noMail=async()=>assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);
  return{db,S,U,actor,session,batch,provider,profile,bytes,issue,documents,noMail};
}

test("store real persiste desafio/recibo único, sem segredos/PII de conferência ou mutação do PDF",async()=>{
  const c=await fixture("t_president_store_durable");
  try{
    const prior=(await c.db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value;
    assert.deepEqual(await c.S.configurePresidentProfile(c.actor,{responsibleId:2,enabled:true,expectedRevision:1}),{ok:true,revision:2});
    const preserved=JSON.parse((await c.db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value);
    assert.equal(preserved.whatsappCipher,JSON.parse(prior).whatsappCipher);assert.equal(preserved.cpfHash,JSON.parse(prior).cpfHash);
    const before=await c.documents(),issued=await c.issue();
    const profile=await c.S.readPresidentProfile(c.actor);assert.ok(profile.ok);assert.equal(profile.profile!.hasWhatsapp,true);assert.ok(!JSON.stringify(profile).includes("cpfHash"));
    const settings=(await c.db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value;
    assert.ok(!settings.includes(cpf));assert.ok(!settings.includes(c.profile.whatsapp));
    const stored=JSON.stringify((await c.db.query("SELECT * FROM president_challenges")).rows);assert.ok(!stored.includes(issued.token));assert.ok(!stored.includes(issued.password));
    const result=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(result.ok);assert.equal(result.icpBrasil,false);assert.equal(result.govBr,false);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    const row=(await c.db.query("SELECT state,receipt_id,confirmed_at,lease_token,attempts FROM president_challenges")).rows[0];assert.equal(row.state,"consumed");assert.equal(row.receipt_id,result.receiptId);assert.ok(row.confirmed_at);assert.equal(row.lease_token,null);assert.equal(row.attempts,1);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);
    const metadata=JSON.stringify((await c.db.query("SELECT data FROM audit_log UNION ALL SELECT row_to_json(x)::text data FROM president_challenges x")).rows);
    assert.ok(!metadata.includes(cpf));assert.ok(!metadata.includes(identity.birthDate));assert.ok(!metadata.includes(issued.token));assert.ok(!metadata.includes(issued.password));
    assert.deepEqual(await c.documents(),before);await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
  }finally{await c.db._closeDbForTests();}
});

test("senha errada limita cinco tentativas, expiração e provider ausente recusam",async()=>{
  const c=await fixture("t_president_store_limits");
  try{
    const initial=(await c.db.query("SELECT count(*)::int n FROM president_challenges")).rows[0].n;
    assert.equal((await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,null)).ok,false);assert.equal((await c.db.query("SELECT count(*)::int n FROM president_challenges")).rows[0].n,initial);
    const issued=await c.issue(),wrong=issued.password==="AAAAAAAAAAAA"?"BBBBBBBBBBBB":"AAAAAAAAAAAA";
    for(let n=0;n<5;n++)assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity,password:wrong},c.provider)).ok,false);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    assert.deepEqual((await c.db.query("SELECT state,attempts FROM president_challenges")).rows[0],{state:"rejected",attempts:5});
    const next=await c.issue();await c.db.query("UPDATE president_challenges SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[next.id]);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...next,...identity},c.provider)).ok,false);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...next,...identity},null)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("configuração tem CAS e edição/revogação do responsável ou dos bytes invalida desafio",async()=>{
  const c=await fixture("t_president_store_binding");
  try{
    assert.deepEqual(await c.S.configurePresidentProfile(c.actor,c.profile),{ok:false,error:"conflict"});
    const issued=await c.issue();await c.db.query("UPDATE admin_users SET nome='Nome alterado QA' WHERE id=2");assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    await c.db.query("UPDATE admin_users SET nome='Pessoa Responsavel QA' WHERE id=2");
    const changed=Buffer.from(c.bytes);changed[changed.length-1]^=1;await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3",[changed,digest(changed),c.batch]);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3",[c.bytes,digest(c.bytes),c.batch]);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=2");assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=2");
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1");assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=1");
    assert.deepEqual(await c.S.configurePresidentProfile(c.actor,{...c.profile,expectedRevision:1,enabled:false}),{ok:true,revision:2});
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);assert.equal((await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("concorrência/retomada de lease e revogação durante identidade revalidam antes de consumir",async()=>{
  const c=await fixture("t_president_store_concurrency");
  try{
    const issued=await c.issue();let release!:(v:Awaited<ReturnType<typeof c.provider.lookup>>)=>void;
    const gate=new Promise<Awaited<ReturnType<typeof c.provider.lookup>>>(resolve=>{release=resolve;});
    const first=c.S.confirmConfiguredPresidentChallenge({...issued,...identity},{name:"mock",lookup:async()=>gate});
    for(let n=0;n<100;n++){if((await c.db.query("SELECT state FROM president_challenges WHERE id=$1",[issued.id])).rows[0].state==="verifying")break;await new Promise(r=>setTimeout(r,10));}
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    await c.db.query("UPDATE president_challenges SET lease_until=now()-interval '1 second' WHERE id=$1",[issued.id]);
    const second=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(second.ok);
    release({nome:"Pessoa Responsavel QA",mae:null,nasc:"01/01/2000"});assert.equal((await first).ok,false);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);
    const revoked=await c.issue();let called=false;
    const revoking={name:"mock",lookup:async()=>{called=true;await c.db.query("UPDATE admin_users SET ativo=false WHERE id=2");return{nome:"Pessoa Responsavel QA",mae:null,nasc:"01/01/2000"};}};
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...revoked,...identity},revoking)).ok,false);assert.equal(called,true);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("falhas de auditoria revertem emissão e consumo; retomada não duplica recibos",async()=>{
  const c=await fixture("t_president_store_atomic");
  try{
    const fail=async(event:string)=>c.db.query(`CREATE FUNCTION qa_president_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'QA president audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_president_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_president_fault()`);
    const unfail=async()=>c.db.query("DROP TRIGGER qa_president_fault ON audit_log; DROP FUNCTION qa_president_fault()");
    const prior=await c.issue();await fail("president_challenge_issued");assert.equal((await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider)).ok,false);await unfail();
    assert.equal((await c.db.query("SELECT state FROM president_challenges WHERE id=$1",[prior.id])).rows[0].state,"issued");
    await fail("president_document_confirmed");assert.equal((await c.S.confirmConfiguredPresidentChallenge({...prior,...identity},c.provider)).ok,false);await unfail();
    const row=(await c.db.query("SELECT state,receipt_id FROM president_challenges WHERE id=$1",[prior.id])).rows[0];assert.deepEqual(row,{state:"verifying",receipt_id:null});
    await c.db.query("UPDATE president_challenges SET lease_until=now()-interval '1 second' WHERE id=$1",[prior.id]);assert.ok((await c.S.confirmConfiguredPresidentChallenge({...prior,...identity},c.provider)).ok);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);assert.ok((await c.db.verifyAuditChain()).ok);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("rotas protegidas exigem nível/stepup, limites/origem e confirmam com provider fictício",async()=>{
  const c=await fixture("t_president_store_http");
  process.env.CPF_FORCE_MOCK="1";process.env.CPF_MOCK_DATA=JSON.stringify({[cpf]:{nome:"Pessoa Responsavel QA",nasc:"01/01/2000"}});
  try{
    const P=await import("../app/api/admin/presidente/perfil/route"),I=await import("../app/api/admin/presidente/desafio/route"),C=await import("../app/api/presidente/confirmar/route");
    const req=(path:string,body:unknown,cookie=`adm=${c.session.token}`,origin="http://localhost")=>new NextRequest(`http://localhost${path}`,{method:"POST",headers:{host:"localhost",origin,cookie,"content-type":"application/json"},body:typeof body==="string"?body:JSON.stringify(body)});
    assert.equal((await I.POST(req("/api/admin/presidente/desafio",{batchId:c.batch},""))).status,401);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.equal((await I.POST(req("/api/admin/presidente/desafio",{batchId:c.batch}))).status,403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
    assert.equal((await P.POST(req("/api/admin/presidente/perfil","{"))).status,400);
    assert.equal((await P.POST(req("/api/admin/presidente/perfil","x".repeat(2049)))).status,413);
    assert.equal((await I.POST(req("/api/admin/presidente/desafio",{batchId:"1"}))).status,400);
    const documentVersion=(await c.issue()).documentVersion,profile=await c.S.readPresidentProfile(c.actor);assert.ok(profile.ok);assert.ok(profile.profile);
    const response=await I.POST(req("/api/admin/presidente/desafio",{batchId:c.batch,requestId:"00000000-0000-4000-8000-000000000100",expectedDocumentVersion:documentVersion,expectedProfileFingerprint:profile.profile.fingerprint}));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");const issued=await response.json();assert.ok(issued.ok);
    assert.equal((await C.POST(req("/api/presidente/confirmar",{...issued,...identity},"","https://evil.example.test"))).status,403);
    const confirmation={token:issued.token,password:issued.password,cpf:"529.982.247-25",birthDate:"01/01/2000"};
    const confirmed=await C.POST(req("/api/presidente/confirmar",confirmation,""));assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).icpBrasil,false);
    assert.equal((await C.POST(req("/api/presidente/confirmar",confirmation,""))).status,409);
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1");assert.equal((await I.POST(req("/api/admin/presidente/desafio",{batchId:c.batch}))).status,403);await c.noMail();
  }finally{delete process.env.CPF_FORCE_MOCK;delete process.env.CPF_MOCK_DATA;await c.db._closeDbForTests();}
});


async function consumed(c:Awaited<ReturnType<typeof fixture>>){const issued=await c.issue(),receipt=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(receipt.ok);return{issued,receipt,input:{batchId:c.batch,receiptId:receipt.receiptId,expectedDocumentVersion:issued.documentVersion}};}
test("native capture loads only durable consumed evidence and preserves document, receipt and credentials",async t=>{
 const c=await fixture("t_native_capture_durable");try{
  const {issued,receipt,input}=await consumed(c),before=await c.documents(),state=(await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows;
  const captured=await c.S.capturePresidentOwnConfirmation(input,c.actor);assert.ok(captured.ok);assert.ok(captured.bytes.equals(c.bytes));assert.equal(captured.snapshot.receiptId,receipt.receiptId);assert.equal(captured.snapshot.signerName,'Pessoa Responsavel QA');assert.equal(captured.snapshot.sourceSha256,digest(c.bytes));assert.equal(captured.icpBrasil,false);assert.equal(captured.dispatchAllowed,false);assert.ok(Object.isFrozen(captured.snapshot));
  const publicMetadata=JSON.stringify({...captured,bytes:undefined});for(const secret of [issued.token,issued.password,cpf,identity.birthDate])assert.equal(publicMetadata.includes(secret),false);
  const now=Date.now();t.mock.method(Date,'now',()=>now+601000);const historical=await c.S.capturePresidentOwnConfirmation(input,c.actor);assert.ok(historical.ok,'consumed durable receipt survives the authentication challenge deadline');assert.equal(historical.evidenceDigest,captured.evidenceDigest);
  assert.deepEqual(await c.documents(),before);assert.deepEqual((await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows,state);await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
test("native capture refuses unconsumed, foreign, stale or unprivileged evidence without mutation",async()=>{
 const c=await fixture("t_native_capture_guards");try{
  const issued=await c.issue();const nonexistent={batchId:c.batch,receiptId:'00000000-0000-4000-8000-000000000001',expectedDocumentVersion:issued.documentVersion};assert.equal((await c.S.capturePresidentOwnConfirmation(nonexistent,c.actor)).ok,false);
  const receipt=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(receipt.ok);const input={...nonexistent,receiptId:receipt.receiptId};
  for(const bad of [{...input,batchId:c.batch+1},{...input,expectedDocumentVersion:'f'.repeat(64)},{...input,password:'NOT-ACCEPTED'}])assert.equal((await c.S.capturePresidentOwnConfirmation(bad,c.actor)).ok,false);
  assert.equal((await c.S.capturePresidentOwnConfirmation(input,null)).ok,false);await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1');assert.equal((await c.S.capturePresidentOwnConfirmation(input,c.actor)).ok,false);await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  await c.db.query("UPDATE admin_users SET nome='Outro Nome QA' WHERE id=2");assert.equal((await c.S.capturePresidentOwnConfirmation(input,c.actor)).ok,false);await c.db.query("UPDATE admin_users SET nome='Pessoa Responsavel QA' WHERE id=2");
  const altered=Buffer.concat([c.bytes,Buffer.from('modified')]);await c.db.query('UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3',[altered,digest(altered),c.batch]);assert.equal((await c.S.capturePresidentOwnConfirmation(input,c.actor)).ok,false);await c.db.query('UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3',[c.bytes,digest(c.bytes),c.batch]);
  await c.S.configurePresidentProfile(c.actor,{responsibleId:2,enabled:true,expectedRevision:1});assert.equal((await c.S.capturePresidentOwnConfirmation(input,c.actor)).ok,false);
  assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_own_confirmation_captured'")).rowCount,0);await c.noMail();
 }finally{await c.db._closeDbForTests();}
});
test("native capture cannot rewrite an existing signed source and returns no bytes after audit failure",async()=>{
 const c=await fixture("t_native_capture_signed_audit");try{
  const first=await consumed(c);await c.db.query("CREATE FUNCTION qa_native_capture_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='president_own_confirmation_captured' THEN RAISE EXCEPTION 'QA native audit'; END IF;RETURN NEW;END $$;CREATE TRIGGER qa_native_capture_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_native_capture_fault()");
  assert.deepEqual(await c.S.capturePresidentOwnConfirmation(first.input,c.actor),{ok:false,error:'unavailable'});await c.db.query('DROP TRIGGER qa_native_capture_fault ON audit_log');
  await c.db.query("UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2,signature_kind='externa-nao-validada' WHERE id=$3",[c.bytes,digest(c.bytes),c.batch]);
  const next=await consumed(c),before=await c.documents();assert.deepEqual(await c.S.capturePresidentOwnConfirmation(next.input,c.actor),{ok:false,error:'unavailable'});assert.deepEqual(await c.documents(),before);await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});


test("one president access intent cannot rotate credentials on a repeated or concurrent POST",async()=>{
 const c=await fixture("t_president_issue_intent_once");try{
  const V=await import('./president-portal-contract'),profile=await c.S.readPresidentProfile(c.actor);assert.ok(profile.ok);assert.ok(profile.profile);const intent={expectedProfileFingerprint:profile.profile.fingerprint,requestId:'00000000-0000-4000-8000-000000000101',expectedDocumentVersion:V.presidentDocumentRevision({batchId:c.batch,seq:1,kind:'final',listHash:'a'.repeat(64),originalPdf:c.bytes,signedPdf:null,signatureKind:'none'})};
  const results=await Promise.all([c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider,intent),c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider,intent)]);
  assert.equal(results.filter(r=>r.ok).length,1,'one identity must issue credentials only once, without replacing its first challenge');
  assert.equal((await c.db.query('SELECT 1 FROM president_challenges')).rowCount,1);const issued=results.find(r=>r.ok);assert.ok(issued);assert.ok(issued.ok);
  const before=(await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows;
  assert.equal((await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider,intent)).ok,false);assert.deepEqual((await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows,before);
  assert.ok((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,'the first credential remains usable');await c.noMail();
 }finally{await c.db._closeDbForTests();}
});


async function newAccessIntent(c:Awaited<ReturnType<typeof fixture>>,requestId:string){const V=await import('./president-portal-contract'),p=await c.S.readPresidentProfile(c.actor);assert.ok(p.ok);assert.ok(p.profile);return{requestId,expectedProfileFingerprint:p.profile.fingerprint,expectedDocumentVersion:V.presidentDocumentRevision({batchId:c.batch,seq:1,kind:'final',listHash:'a'.repeat(64),originalPdf:c.bytes,signedPdf:null,signatureKind:'none'})};}
test("request recovery never discloses credentials, resets guesses or changes the original identity",async()=>{
 const c=await fixture("t_president_issue_intent_recovery");try{
  const intent=await newAccessIntent(c,'00000000-0000-4000-8000-000000000102'),issued=await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider,intent);assert.ok(issued.ok);
  const wrong=issued.password==='AAAAAAAAAAAA'?'BBBBBBBBBBBB':'AAAAAAAAAAAA';assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity,password:wrong},c.provider)).ok,false);
  const before=(await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows;
  const recovered=await c.S.readPresidentChallengeRequest(intent.requestId,c.actor);assert.ok(recovered.ok);assert.equal(recovered.challengeId,issued.id);assert.equal(recovered.credentialsRecoverable,false);assert.equal(recovered.isCurrent,true);
  const payload=JSON.stringify(recovered);for(const secret of [issued.token,issued.password,cpf,identity.birthDate])assert.equal(payload.includes(secret),false);
  assert.equal((await c.S.issueConfiguredPresidentChallenge(c.batch,c.actor,c.provider,intent)).ok,false);assert.deepEqual((await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows,before);
  for(const command of ["UPDATE president_challenges SET request_id='00000000-0000-4000-8000-000000000199'","UPDATE president_challenges SET request_fingerprint=repeat('f',64)","UPDATE president_challenges SET document_version='changed'","UPDATE president_challenges SET expires_at=expires_at+interval '1 second'","DELETE FROM president_challenges","TRUNCATE president_challenges CASCADE"])await assert.rejects(c.db.query(command),/president_request_identity_immutable/);
  assert.deepEqual((await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows,before);
  const confirmation=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(confirmation.ok);
  const consumed=await c.S.readPresidentChallengeRequest(intent.requestId,c.actor);assert.ok(consumed.ok);assert.equal(consumed.state,'consumed');assert.equal(consumed.receiptId,confirmation.receiptId);await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
test("issuance HTTP requires document/profile intent; exact GET is private, actor scoped and inert",async()=>{
 const c=await fixture("t_president_issue_intent_http");process.env.CPF_FORCE_MOCK='1';process.env.CPF_MOCK_DATA=JSON.stringify({[cpf]:{nome:'Pessoa Responsavel QA',nasc:'01/01/2000'}});
 try{
  const I=await import('../app/api/admin/presidente/desafio/route'),intent=await newAccessIntent(c,'00000000-0000-4000-8000-000000000103'),path='http://localhost/api/admin/presidente/desafio',body={batchId:c.batch,...intent};
  const req=(method:string,url=path,data?:unknown,token=c.session.token)=>new NextRequest(url,{method,headers:{host:'localhost',origin:'http://localhost',cookie:'adm='+token,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  assert.equal((await I.POST(req('POST',path,{batchId:c.batch}))).status,400);assert.equal((await I.POST(req('POST',path,{...body,expectedProfileFingerprint:'f'.repeat(64)}))).status,409);assert.equal((await c.db.query('SELECT 1 FROM president_challenges')).rowCount,0);
  const created=await I.POST(req('POST',path,body));assert.equal(created.status,200);const issued=await created.json();assert.ok(issued.token);assert.equal((await I.POST(req('POST',path,body))).status,409);
  const rowState=async()=>(await c.db.query('SELECT row_to_json(p)::text data FROM president_challenges p')).rows;const before=await rowState(),recovered=await I.GET(req('GET',path+'?requestId='+intent.requestId));assert.equal(recovered.status,200);assert.equal(recovered.headers.get('cache-control'),'private, no-store');const result=await recovered.json();assert.equal(result.challengeId,issued.id);assert.equal(result.credentialsRecoverable,false);assert.equal(JSON.stringify(result).includes(issued.token),false);assert.equal(JSON.stringify(result).includes(issued.password),false);assert.deepEqual(await rowState(),before);
  const second=await c.U.abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=2;UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=2");assert.equal((await I.GET(req('GET',path+'?requestId='+intent.requestId,undefined,second.token))).status,404);
  assert.equal((await I.GET(req('GET',path+'?requestId='+intent.requestId+'&requestId='+intent.requestId))).status,400);assert.equal((await I.GET(req('GET',path+'?token='+issued.token))).status,400);assert.equal((await I.GET(req('GET',path+'?requestId='+intent.requestId,undefined,''))).status,401);
  await c.S.configurePresidentProfile(c.actor,{responsibleId:2,enabled:true,expectedRevision:1});const revoked=await c.S.readPresidentChallengeRequest(intent.requestId,c.actor);assert.ok(revoked.ok);assert.equal(revoked.state,'revoked');assert.equal(revoked.isCurrent,false);await c.noMail();
 }finally{delete process.env.CPF_FORCE_MOCK;delete process.env.CPF_MOCK_DATA;await c.db._closeDbForTests();}
});


test("contexto de emissão deriva versão dos bytes reais e não vaza documento/CPF",async()=>{
  const c=await fixture("t_president_issue_context");
  try {
    const r=await c.S.readPresidentIssueDocumentRevision(c.batch,c.actor);assert.ok(r.ok);
    assert.equal(r.document.batchId,c.batch);assert.equal(r.document.originalSha256,digest(c.bytes));
    assert.match(r.document.documentVersion,/^[a-f0-9]{64}$/);assert.equal(r.document.signedSha256,null);
    assert.ok(!JSON.stringify(r).includes(cpf));assert.ok(!JSON.stringify(r).includes("originalPdf"));
    const before=r.document.documentVersion;
    const changed=await PDFDocument.create();changed.addPage([201,200]);const bytes=Buffer.from(await changed.save());
    await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3",[bytes,digest(bytes),c.batch]);
    const next=await c.S.readPresidentIssueDocumentRevision(c.batch,c.actor);assert.ok(next.ok);assert.notEqual(next.document.documentVersion,before);
    await c.db.query("UPDATE batches SET pdf_sha256=$1 WHERE id=$2",["f".repeat(64),c.batch]);
    assert.equal((await c.S.readPresidentIssueDocumentRevision(c.batch,c.actor)).ok,false);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()-interval '1 minute' WHERE user_id=1");
    assert.deepEqual(await c.S.readPresidentIssueDocumentRevision(c.batch,c.actor),{ok:false,error:"forbidden"});
    await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
  } finally {await c.db._closeDbForTests();}
});
