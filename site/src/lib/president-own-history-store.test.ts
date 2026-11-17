import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { parseOwnHistory } from "./president-own-history-client";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const cpf = "52998224725"; // Public CPF algorithm example; fictitious provider/identity only.
const identity = { cpf, birthDate: "2000-01-01" };
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const ddl = async () => (await import("./president-own-document-schema")).PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL;
async function fixture(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  await db.query(await ddl());
  const S = await import("./president-portal-store"), O = await import("./president-own-document-store"), U = await import("./admin-users"), C = await import("./cpf-check");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-own-owner@example.test','QA Own Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-own-president@example.test','Pessoa Responsavel QA','leitura','QA-NOT-A-LOGIN-HASH')");
  const session = await U.abrirSessao(1, "127.0.0.1");
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  const actor = (await U.sessaoPorToken(session.token))!;
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]).drawText("FICTITIOUS OWN DOCUMENT QA", { x: 20, y: 370, size: 10 });
  const bytes = Buffer.from(await pdf.save());
  const batch = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'partial','prepared',0,1,0,$1,$2,$3,'none')RETURNING id", ["a".repeat(64), bytes, digest(bytes)])).rows[0].id as number;
  const provider = C.mockProvider({ [cpf]: { nome: "Pessoa Responsavel QA", nasc: "01/01/2000" } });
  assert.deepEqual(await S.configurePresidentProfile(actor, { responsibleId: 2, cpf, enabled: true, expectedRevision: 0 }), { ok: true, revision: 1 });
  const issued = await S.issueConfiguredPresidentChallenge(batch, actor, provider); assert.ok(issued.ok);
  const receipt = await S.confirmConfiguredPresidentChallenge({ ...issued, ...identity }, provider); assert.ok(receipt.ok);
  const input = (requestId = randomUUID()) => ({ requestId, batchId: batch, receiptId: receipt.receiptId, expectedDocumentVersion: issued.documentVersion });
  const source = async () => (await db.query("SELECT row_to_json(b)::text data FROM batches b ORDER BY id")).rows;
  const counts = async () => (await db.query("SELECT (SELECT count(*)::int FROM president_own_document_intents) intents,(SELECT count(*)::int FROM president_own_document_results) results,(SELECT count(*)::int FROM president_own_document_artifacts) artifacts")).rows[0] as { intents: number; results: number; artifacts: number };
  const noExternal = async () => {
    assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
    const journal = JSON.stringify((await db.query("SELECT data FROM audit_log UNION ALL SELECT row_to_json(t)::text FROM president_own_document_intents t UNION ALL SELECT row_to_json(t)::text FROM president_own_document_results t")).rows);
    for (const secret of [cpf, identity.birthDate, issued.token, issued.password]) assert.equal(journal.includes(secret), false);
    assert.ok((await db.verifyAuditChain()).ok);
  };
  return { db, S, O, U, actor, session, batch, bytes, issued, receipt, provider, input, source, counts, noExternal };
}

// Deliberately synthetic rows exercise seek pagination, never signer admission.
async function seeds(c: Awaited<ReturnType<typeof fixture>>, count: number) {
  for (let n = 0; n < count; n++) await c.db.query(`INSERT INTO president_challenges(id,batch_id,responsible_id,issued_by,profile_revision,responsible_fingerprint,document_version,token_hash,password_hash,state,attempts,created_at,expires_at,receipt_id,confirmed_at)
    SELECT $1,batch_id,responsible_id,issued_by,profile_revision,responsible_fingerprint,document_version,$2,password_hash,'consumed',1,
      '2026-11-01 00:00:00+00'::timestamptz + $3::int * interval '1 microsecond','2026-11-01 00:05:00+00'::timestamptz,$4,'2026-11-01 00:00:01+00'::timestamptz FROM president_challenges WHERE receipt_id=$5`,
    [randomUUID(), digest(`fake-history-token-${n}`), n, randomUUID(), c.receipt.receiptId]);
}
test("history preserves microsecond seek ordering across concurrent inserts without credential metadata", async () => {
  const c = await fixture("t_own_history_seek");
  try {
    await seeds(c, 43); const first = await c.S.listPresidentConsumedReceipts(c.batch, c.actor);assert.ok(first.ok);assert.equal(first.receipts.length, 20);assert.equal(first.hasMore, true);
    assert.ok(parseOwnHistory(first, "receipts", c.batch));assert.ok(first.receipts.every(r => r.isCurrent));
    const next = await c.S.issueConfiguredPresidentChallenge(c.batch, c.actor, c.provider);assert.ok(next.ok);
    assert.ok((await c.S.confirmConfiguredPresidentChallenge({ ...next, ...identity }, c.provider)).ok);
    const second = await c.S.listPresidentConsumedReceipts(c.batch, c.actor, first.nextCursor!);assert.ok(second.ok);assert.equal(second.receipts.length,20);
    const third = await c.S.listPresidentConsumedReceipts(c.batch,c.actor,second.nextCursor!);assert.ok(third.ok);assert.equal(third.receipts.length,4);assert.equal(third.hasMore,false);
    const all=[...first.receipts,...second.receipts,...third.receipts];assert.equal(new Set(all.map(r=>r.challengeId)).size,44);
    assert.equal(all.filter(r=>r.createdAt.startsWith("2026-11-01")).length,43);
    assert.ok(all.some(r=>r.createdAt.endsWith("000001Z")));assert.ok(all.some(r=>r.createdAt.endsWith("000042Z")));
    for(const secret of [cpf,identity.birthDate,c.issued.token,c.issued.password,"password_hash","token_hash","responsible_fingerprint"])assert.equal(JSON.stringify(all).includes(secret),false);
    await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});
test("history remains readable after profile change and expiry; current status never authorizes generation",async()=>{
  const c=await fixture("t_own_history_profile");
  try {
    const made=await c.O.createPresidentOwnDocument(c.input(),c.actor);assert.ok(made.ok);assert.ok(made.document.artifactId);
    const before=await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor);assert.ok(before.ok);assert.equal(before.documents.length,1);assert.ok(parseOwnHistory(before,"artifacts",c.batch));
    assert.deepEqual(await c.S.configurePresidentProfile(c.actor,{responsibleId:2,enabled:false,expectedRevision:1}),{ok:true,revision:2});
    const receipts=await c.S.listPresidentConsumedReceipts(c.batch,c.actor);assert.ok(receipts.ok);assert.equal(receipts.receipts.length,1);assert.equal(receipts.receipts[0].isCurrent,false);
    const after=await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor);assert.ok(after.ok);assert.deepEqual(after.documents,before.documents);
    const pdf=await c.O.readPresidentOwnDocumentPdf(made.document.artifactId,c.actor);assert.ok(pdf.ok);assert.equal(digest(pdf.bytes),made.document.sha256);
    const refused=await c.O.createPresidentOwnDocument(c.input(),c.actor);assert.ok(!refused.ok || refused.document.state!=="completed");await c.noExternal();
  }finally{await c.db._closeDbForTests();}
});
test("history authorization, scoped cursor and audit failure fail closed",async()=>{
 const c=await fixture("t_own_history_auth");
 try{
  for(const run of [()=>c.S.listPresidentConsumedReceipts(c.batch,null),()=>c.O.listPresidentOwnDocumentArtifacts(c.batch,null)])assert.deepEqual(await run(),{ok:false,error:"forbidden"});
  assert.deepEqual(await c.S.listPresidentConsumedReceipts(c.batch,c.actor,randomUUID()),{ok:false,error:"parameters"});
  assert.deepEqual(await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor,randomUUID()),{ok:false,error:"parameters"});
  await c.db.query("UPDATE admin_sessions SET stepup_ate=now()-interval '1 second' WHERE user_id=1");
  assert.deepEqual(await c.S.listPresidentConsumedReceipts(c.batch,c.actor),{ok:false,error:"forbidden"});assert.deepEqual(await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor),{ok:false,error:"forbidden"});
  await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  await c.db.query("CREATE FUNCTION qa_history_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'qa failure';END;$$; CREATE TRIGGER qa_history_audit_fail BEFORE INSERT ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION qa_history_audit_fail()");
  assert.deepEqual(await c.S.listPresidentConsumedReceipts(c.batch,c.actor),{ok:false,error:"unavailable"});assert.deepEqual(await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor),{ok:false,error:"unavailable"});
 }finally{await c.db._closeDbForTests();}
});
test("history route exact GET queries and auth, no POST handler",async()=>{
 const c=await fixture("t_own_history_http");
 try{
  const R=await import("../app/api/admin/lotes/[id]/presidente/historico/route");assert.equal("POST" in R,false);
  const req=(q:string,cookie=`adm=${c.session.token}`)=>new NextRequest(`http://localhost/api/admin/lotes/${c.batch}/presidente/historico${q}`,{headers:{host:"localhost",origin:"http://localhost",cookie}});
  const ctx={params:{id:String(c.batch)}};
  for(const q of ["","?kind=receipts&kind=artifacts","?kind=receipts&cursor=","?kind=receipts&token=x","?kind=unknown","?kind=artifacts&cursor=bad"])assert.equal((await R.GET(req(q),ctx)).status,400,q);
  const ok=await R.GET(req("?kind=receipts"),ctx);assert.equal(ok.status,200);assert.equal(ok.headers.get("cache-control"),"private, no-store");assert.ok(parseOwnHistory(await ok.json(),"receipts",c.batch));
  assert.equal((await R.GET(req("?kind=artifacts",""),ctx)).status,401);await c.noExternal();
 }finally{await c.db._closeDbForTests();}
});
test("artifact inventory uses DB microseconds and metadata does not bypass download integrity",async()=>{
 const c=await fixture("t_own_history_artifact_seek");
 try{
  const made=await c.O.createPresidentOwnDocument(c.input(),c.actor);assert.ok(made.ok);assert.ok(made.document.artifactId);
  for(let n=0;n<22;n++)await c.db.query(`INSERT INTO president_own_document_artifacts(id,batch_id,challenge_id,receipt_id,document_version,source_sha256,evidence_digest,evidence_canonical,bytes,sha256,created_by,created_at)
    SELECT $1,batch_id,challenge_id,receipt_id,document_version,source_sha256,$2,evidence_canonical,bytes,sha256,created_by,'2026-11-01 00:00:00+00'::timestamptz + $3::int*interval '1 microsecond' FROM president_own_document_artifacts WHERE id=$4`,[randomUUID(),digest(`synthetic-pagination-evidence-${n}`),n,made.document.artifactId]);
  const first=await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor);assert.ok(first.ok);assert.equal(first.documents.length,20);assert.equal(first.hasMore,true);assert.ok(parseOwnHistory(first,"artifacts",c.batch));
  const second=await c.O.listPresidentOwnDocumentArtifacts(c.batch,c.actor,first.nextCursor!);assert.ok(second.ok);assert.equal(second.documents.length,3);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.documents,...second.documents].map(r=>r.artifactId)).size,23);assert.ok(second.documents.some(r=>r.createdAt.endsWith("000001Z")));
  // Clones deliberately have a mismatched evidence digest. Listing is metadata only; verified download refuses.
  assert.deepEqual(await c.O.readPresidentOwnDocumentPdf(second.documents[0].artifactId,c.actor),{ok:false,error:"unavailable"});await c.noExternal();
 }finally{await c.db._closeDbForTests();}
});
