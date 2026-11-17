import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
delete process.env.PREVIEW_MODE;
const cpf="52998224725";
const identity={cpf,birthDate:"2000-01-01"};
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function fixture(schema:string) {
  const db=await import("./db");await db._openForTests(schema);
  const S=await import("./president-portal-store"),U=await import("./admin-users"),C=await import("./cpf-check");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-owner@example.test','QA Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-president@example.test','Pessoa Responsavel QA','leitura','QA-NOT-A-LOGIN-HASH')");
  const session=await U.abrirSessao(1,"127.0.0.1");await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  const actor=(await U.sessaoPorToken(session.token))!;
  const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=Buffer.from(await pdf.save());
  const batch=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'final','prepared',0,1,$1,$2,$3,'none') RETURNING id",["a".repeat(64),bytes,digest(bytes)])).rows[0].id as number;
  const provider=C.mockProvider({[cpf]:{nome:"Pessoa Responsavel QA",nasc:"01/01/2000"}});
  assert.deepEqual(await S.configurePresidentProfile(actor,{responsibleId:2,cpf,enabled:true,expectedRevision:0}),{ok:true,revision:1});
  const issue=async()=>{const r=await S.issueConfiguredPresidentChallenge(batch,actor,provider);assert.ok(r.ok);return r;};
  const noMail=async()=>assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM signatures")).rowCount,0);
  return{db,S,actor,batch,provider,bytes,issue,noMail};
}

test("acesso externo exige os dois segredos; leitura mostra somente bytes/metadados vinculados sem consumir",async()=>{
  const c=await fixture("t_president_access_exact");
  try{
    const issued=await c.issue(),before=(await c.db.query("SELECT row_to_json(b)::text raw FROM batches b")).rows;
    const beforeChallenge=(await c.db.query("SELECT row_to_json(p)::text raw FROM president_challenges p")).rows;
    const state=await c.S.readConfiguredPresidentAccess(issued);assert.ok(state.ok);assert.equal(state.state,"issued");assert.equal(state.canConfirm,true);assert.equal(state.receipt,null);assert.ok(!("bytes"in state));
    assert.equal(state.document.documentVersion,issued.documentVersion);assert.equal(state.document.sha256,digest(c.bytes));
    const pdf=await c.S.readConfiguredPresidentAccess(issued,true);assert.ok(pdf.ok);assert.deepEqual(pdf.bytes,c.bytes);
    assert.deepEqual((await c.db.query("SELECT row_to_json(b)::text raw FROM batches b")).rows,before);
    assert.deepEqual((await c.db.query("SELECT row_to_json(p)::text raw FROM president_challenges p")).rows,beforeChallenge);
    const persisted=JSON.stringify((await c.db.query("SELECT data FROM audit_log UNION ALL SELECT row_to_json(p)::text data FROM president_challenges p")).rows);
    for(const secret of [issued.token,issued.password,cpf,identity.birthDate])assert.ok(!persisted.includes(secret));
    assert.ok(!JSON.stringify(state).includes("qa-president@"));assert.ok((await c.db.verifyAuditChain()).ok);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("senhas erradas compartilham limite de confirmação; desconhecidos e expiração falham fechados",async()=>{
  const c=await fixture("t_president_access_budget");
  try{
    const issued=await c.issue(),wrong=issued.password==="AAAAAAAAAAAA"?"BBBBBBBBBBBB":"AAAAAAAAAAAA";
    assert.equal((await c.S.readConfiguredPresidentAccess({...issued,token:"A".repeat(43)})).ok,false);
    const rejected=await Promise.all(Array.from({length:5},(_,i)=>c.S.readConfiguredPresidentAccess({...issued,password:wrong},i%2===0)));
    assert.ok(rejected.every(r=>!r.ok));
    assert.deepEqual((await c.db.query("SELECT state,attempts FROM president_challenges WHERE id=$1",[issued.id])).rows[0],{state:"rejected",attempts:5});
    assert.equal((await c.S.readConfiguredPresidentAccess(issued,true)).ok,false);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    const next=await c.issue();await c.db.query("UPDATE president_challenges SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[next.id]);
    assert.equal((await c.S.readConfiguredPresidentAccess(next,true)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("recibo consumido é recuperável sem repetir identidade nem aprovação; mudanças/revogação invalidam acesso",async()=>{
  const c=await fixture("t_president_access_receipt");
  try{
    const issued=await c.issue();const confirmed=await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider);assert.ok(confirmed.ok);
    // Only a fixture transition, never a transport: an approved/sent exact document
    // may retain the short-lived receipt, but cannot be confirmed again.
    await c.db.query("UPDATE batches SET status='sent',approved_at=$1 WHERE id=$2",[new Date().toISOString(),c.batch]);
    const state=await c.S.readConfiguredPresidentAccess(issued);assert.ok(state.ok);assert.equal(state.state,"consumed");
    assert.equal(state.canConfirm,false);assert.equal(state.receipt!.receiptId,confirmed.receiptId);assert.equal(state.receipt!.icpBrasil,false);assert.equal(state.receipt!.govBr,false);
    assert.equal((await c.S.confirmConfiguredPresidentChallenge({...issued,...identity},c.provider)).ok,false);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_document_confirmed'")).rowCount,1);
    await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3",[Buffer.from("%PDF-CHANGED"),digest(Buffer.from("%PDF-CHANGED")),c.batch]);
    assert.equal((await c.S.readConfiguredPresidentAccess(issued,true)).ok,false);
    await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3",[c.bytes,digest(c.bytes),c.batch]);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=2");assert.equal((await c.S.readConfiguredPresidentAccess(issued)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("consultar uma verificação em curso não cancela lease; falha de auditoria nunca retorna PDF",async()=>{
  const c=await fixture("t_president_access_lease");
  try{
    const issued=await c.issue();const K=await import("./president-portal-contract"),{config}=await import("./config");
    const hashes=K.presidentAccessHashes(issued,config.pepper())!;
    const now=Date.now();assert.ok(await c.S.postgresPresidentChallengeStore().claim({...hashes,leaseId:"00000000-0000-4000-8000-000000000001",now,leaseUntil:now+30000}));
    const previous=(await c.db.query("SELECT state,attempts,lease_token,lease_until FROM president_challenges WHERE id=$1",[issued.id])).rows[0];
    const status=await c.S.readConfiguredPresidentAccess(issued);assert.ok(status.ok);assert.equal(status.state,"verifying");assert.equal(status.canConfirm,false);
    assert.equal((await c.S.readConfiguredPresidentAccess({...issued,password:issued.password==="AAAAAAAAAAAA"?"BBBBBBBBBBBB":"AAAAAAAAAAAA"})).ok,false);
    assert.deepEqual((await c.db.query("SELECT state,attempts,lease_token,lease_until FROM president_challenges WHERE id=$1",[issued.id])).rows[0],previous);
    await c.db.query("UPDATE president_challenges SET lease_until=now()-interval '1 second' WHERE id=$1",[issued.id]);
    const resumable=await c.S.readConfiguredPresidentAccess(issued);assert.ok(resumable.ok);assert.equal(resumable.state,"verifying");assert.equal(resumable.canConfirm,true);
    assert.equal((await c.db.query("SELECT state,attempts,lease_token FROM president_challenges WHERE id=$1",[issued.id])).rows[0].lease_token,previous.lease_token);
    await c.db.query("CREATE FUNCTION qa_access_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='president_document_read' THEN RAISE EXCEPTION 'QA access audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_access_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_access_fault()");
    assert.equal((await c.S.readConfiguredPresidentAccess(issued,true)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("vínculo de leitura é revogado por mudanças de perfil, emitente, lista e bytes assinados",async()=>{
  const c=await fixture("t_president_access_binding");
  try{
    const issued=await c.issue();
    const cases:[string,unknown[],string,unknown[]][]=[
      ["UPDATE admin_users SET email='qa-changed@example.test' WHERE id=2",[],"UPDATE admin_users SET email='qa-president@example.test' WHERE id=2",[]],
      ["UPDATE admin_users SET nivel='edicao' WHERE id=1",[],"UPDATE admin_users SET nivel='total' WHERE id=1",[]],
      ["UPDATE batches SET list_hash=$1 WHERE id=$2",["b".repeat(64),c.batch],"UPDATE batches SET list_hash=$1 WHERE id=$2",["a".repeat(64),c.batch]],
      ["UPDATE batches SET signature_kind='externa-nao-validada' WHERE id=$1",[c.batch],"UPDATE batches SET signature_kind='none' WHERE id=$1",[c.batch]],
      ["UPDATE batches SET approved_at=$1 WHERE id=$2",[new Date().toISOString(),c.batch],"UPDATE batches SET approved_at=NULL WHERE id=$1",[c.batch]],
      ["UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2 WHERE id=$3",[Buffer.from("%PDF-OTHER"),digest(Buffer.from("%PDF-OTHER")),c.batch],"UPDATE batches SET signed_pdf=NULL,signed_pdf_sha256=NULL WHERE id=$1",[c.batch]],
    ];
    for(const [change,args,restore,restoreArgs]of cases){await c.db.query(change,args);assert.equal((await c.S.readConfiguredPresidentAccess(issued,true)).ok,false,change);await c.db.query(restore,restoreArgs);assert.ok((await c.S.readConfiguredPresidentAccess(issued)).ok);}
    await c.S.configurePresidentProfile(c.actor,{responsibleId:2,enabled:false,expectedRevision:1});
    assert.equal((await c.S.readConfiguredPresidentAccess(issued,true)).ok,false);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("POSTs externos têm origem/JSON/limites e download exato; nenhum segredo via GET",async()=>{
  const c=await fixture("t_president_access_http");
  try{
    const issued=await c.issue(),D=await import("../app/api/presidente/documento/route"),S=await import("../app/api/presidente/estado/route");
    const origin="https://petition.example.test";
    const req=(body:unknown,extra:Record<string,string>={})=>new NextRequest(origin+"/api/presidente/documento",{method:"POST",headers:{host:"petition.example.test",origin,"content-type":"application/json",...extra},body:JSON.stringify(body)});
    const credentials={token:issued.token,password:issued.password};
    const pdf=await D.POST(req(credentials));assert.equal(pdf.status,200);assert.equal(pdf.headers.get("content-type"),"application/pdf");assert.match(pdf.headers.get("content-disposition")!,/^attachment;/);
    assert.equal(pdf.headers.get("x-document-sha256"),digest(c.bytes));assert.equal(pdf.headers.get("referrer-policy"),"no-referrer");assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),c.bytes);
    const state=await S.POST(req(credentials));assert.equal(state.status,200);const data=await state.json();assert.equal(data.state,"issued");assert.ok(!("bytes"in data));
    assert.equal((await S.POST(req(credentials,{origin:"https://other.example.test"}))).status,403);
    assert.equal((await S.POST(req(credentials,{"content-type":"text/plain"}))).status,415);
    assert.equal((await S.POST(req({...credentials,cpf}))).status,400);
    assert.equal((await S.POST(req({token:"A".repeat(600),password:issued.password}))).status,413);
    assert.ok(!("GET"in D));assert.ok(!("GET"in S));await c.noMail();
    const unknown={token:"A".repeat(43),password:"A".repeat(12)};
    for(let i=0;i<12;i++)assert.equal((await(i%2?D:S).POST(req(unknown,{"x-forwarded-for":"198.51.100.90"}))).status,409);
    assert.equal((await D.POST(req(unknown,{"x-forwarded-for":"198.51.100.90"}))).status,429);
  }finally{await c.db._closeDbForTests();}
});
