import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.SIGNER = "none";
process.env.APPROVER_EMAIL = "qa-president@example.test";
delete process.env.PREVIEW_MODE;

async function fixture(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const B = await import("./batches"), U = await import("./admin-users");
  const creator = { userId: 1, email: "qa-creator@example.test" }, recovery = { userId: 2, email: "qa-recovery@example.test" };
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Creator','total','QA-NOT-A-LOGIN-HASH'),(2,$2,'QA Recovery','total','QA-NOT-A-LOGIN-HASH')", [creator.email, recovery.email]);
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Original QA','qa-original@example.test','QA-EMAIL','QA-CPF','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
  const fail = async (event: string) => db.query(`CREATE FUNCTION qa_preparation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'QA preparation audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_preparation_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_preparation_fault()`);
  const unfail = async () => db.query("DROP TRIGGER qa_preparation_fault ON audit_log; DROP FUNCTION qa_preparation_fault()");
  const reserve = async () => {
    await fail("batch_prepared"); await assert.rejects(B.createBatchForAdmin("final", creator), /QA preparation audit fault/); await unfail();
    return (await db.query<{ id: number }>("SELECT id FROM batches")).rows[0].id;
  };
  const snapshot = async () => (await db.query("SELECT snapshot,snapshot_sha256,reserved_at FROM batch_preparations ORDER BY batch_id")).rows;
  const documents = async () => (await db.query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows;
  const noMessages = async () => assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  return { db, B, U, creator, recovery, fail, unfail, reserve, snapshot, documents, noMessages };
}

test("snapshot é reservado atomicamente e retomada usa lista original sem avisar/enviar", async () => {
  const c = await fixture("t_preparation_frozen");
  try {
    const id = await c.reserve(), original = await c.snapshot(), frozen = JSON.parse(original[0].snapshot);
    assert.equal(frozen.rows[0].name, "Pessoa Original QA"); assert.equal(frozen.meta.nApoiador, 1);
    assert.equal(createHash("sha256").update(original[0].snapshot).digest("hex"), original[0].snapshot_sha256);
    await c.db.query("UPDATE signatures SET name='Nome alterado depois QA' WHERE id=1");
    await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Posterior QA','qa-later@example.test','QA-LATER-EMAIL','QA-LATER-CPF','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
    const beforeSigners = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: true });
    const prepared = (await c.db.query("SELECT status,pdf,pdf_sha256,n_apoiador,list_hash FROM batches WHERE id=$1", [id])).rows[0];
    assert.equal(prepared.status, "prepared"); assert.equal(prepared.n_apoiador, 1); assert.equal(prepared.list_hash, frozen.meta.listHash);
    assert.equal(prepared.pdf.subarray(0, 5).toString(), "%PDF-"); assert.equal(createHash("sha256").update(prepared.pdf).digest("hex"), prepared.pdf_sha256);
    assert.deepEqual(await c.snapshot(), original); assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows, beforeSigners);
    const preparedAudit = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='batch_prepared'")).rows[0].data);
    const recoveredAudit = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='batch_preparation_recovered'")).rows[0].data);
    assert.equal(preparedAudit.userId, c.creator.userId); assert.equal(preparedAudit.por, c.creator.email);
    assert.equal(recoveredAudit.userId, c.recovery.userId); assert.equal(recoveredAudit.por, c.recovery.email);
    const before = await c.documents(); assert.equal((await c.B.recoverBatchPreparation(id, c.recovery)).ok, false); assert.deepEqual(await c.documents(), before);
    await c.noMessages(); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("snapshot adulterado, método divergente e lote legado sem snapshot não são reconstruídos", async () => {
  const c = await fixture("t_preparation_integrity");
  try {
    const id = await c.reserve(), original = (await c.snapshot())[0], before = await c.documents();
    assert.deepEqual(await c.B.recoverBatchPreparation(id, { ...c.recovery, email: "qa-forged@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.recovery.userId]);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.recovery.userId]);
    for (const value of [0, -1, 1.5, NaN, 2147483648]) assert.deepEqual(await c.B.recoverBatchPreparation(value, c.recovery), { ok: false, error: "parameters" });
    await c.db.query("UPDATE batch_preparations SET snapshot='QA-CORRUPT' WHERE batch_id=$1", [id]);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "snapshot" });
    const changed = original.snapshot.replace("Pessoa Original QA", "Pessoa adulterada QA"), hash = createHash("sha256").update(changed).digest("hex");
    await c.db.query("UPDATE batch_preparations SET snapshot=$2,snapshot_sha256=$3 WHERE batch_id=$1", [id, changed, hash]);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "snapshot" });
    await c.db.query("UPDATE batch_preparations SET snapshot=$2,snapshot_sha256=$3 WHERE batch_id=$1", [id, original.snapshot, original.snapshot_sha256]);
    process.env.SIGNER = "qa-different-mode";
    try { assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "snapshot" }); } finally { process.env.SIGNER = "none"; }
    await c.db.query("DELETE FROM batch_preparations WHERE batch_id=$1", [id]);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "snapshot" });
    assert.deepEqual(await c.documents(), before); await c.noMessages();
  } finally { await c.db._closeDbForTests(); }
});

test("lease ativa bloqueia concorrência e lease expirada admite somente um novo preparo", async () => {
  const c = await fixture("t_preparation_lease");
  try {
    const id = await c.reserve();
    await c.db.query("UPDATE batch_preparations SET lease_token='QA-OLD-WORKER',lease_until=now()+interval '5 minutes' WHERE batch_id=$1", [id]);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "busy" });
    await c.db.query("UPDATE batch_preparations SET lease_until=now()-interval '1 second' WHERE batch_id=$1", [id]);
    const results = await Promise.all([c.B.recoverBatchPreparation(id, c.recovery), c.B.recoverBatchPreparation(id, c.recovery)]);
    assert.equal(results.filter(r => r.ok).length, 1); assert.ok(results.filter(r => !r.ok).every(r => r.error === "busy" || r.error === "conflict"));
    const row = (await c.db.query("SELECT attempts,lease_token,lease_until FROM batch_preparations WHERE batch_id=$1", [id])).rows[0];
    assert.deepEqual(row, { attempts: 2, lease_token: null, lease_until: null });
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_preparation_recovered'")).rowCount, 1); await c.noMessages();
  } finally { await c.db._closeDbForTests(); }
});

test("worker atrasado não publica nem libera uma lease que já foi substituída", async () => {
  const c = await fixture("t_preparation_stale");
  try {
    const id = await c.reserve(), before = await c.documents();
    await c.db.query("CREATE FUNCTION qa_replace_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lease_token IS NOT NULL THEN NEW.lease_token='QA-NEWER-WORKER'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_replace_lease BEFORE UPDATE ON batch_preparations FOR EACH ROW EXECUTE FUNCTION qa_replace_lease()");
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "unavailable" });
    assert.equal((await c.db.query("SELECT lease_token FROM batch_preparations WHERE batch_id=$1", [id])).rows[0].lease_token, "QA-NEWER-WORKER");
    assert.deepEqual(await c.documents(), before); await c.noMessages();
  } finally { await c.db._closeDbForTests(); }
});

test("auditoria da recuperação é atômica e falha na reserva não deixa vínculo órfão", async () => {
  const c = await fixture("t_preparation_atomic");
  try {
    await c.fail("batch_created"); await assert.rejects(c.B.createBatchForAdmin("final", c.creator), /QA preparation audit fault/); await c.unfail();
    assert.equal((await c.db.query("SELECT 1 FROM batches UNION ALL SELECT 1 FROM batch_preparations")).rowCount, 0);
    assert.equal((await c.db.query("SELECT batch_id FROM signatures")).rows[0].batch_id, null);
    const id = await c.reserve(), before = await c.documents(), snapshot = await c.snapshot();
    await c.fail("batch_preparation_recovered"); assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: false, error: "unavailable" }); await c.unfail();
    assert.deepEqual(await c.documents(), before); assert.deepEqual(await c.snapshot(), snapshot);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_prepared'")).rowCount, 0);
    assert.equal((await c.db.query("SELECT lease_token FROM batch_preparations WHERE batch_id=$1", [id])).rows[0].lease_token, null);
    assert.deepEqual(await c.B.recoverBatchPreparation(id, c.recovery), { ok: true }); await c.noMessages(); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("rota de retomada exige Total/stepup, ignora autor forjado e retorna ao documento", async () => {
  const c = await fixture("t_preparation_http");
  try {
    const id = await c.reserve(), route = await import("../app/api/admin/lotes/[id]/preparar/route");
    const session = await c.U.abrirSessao(c.recovery.userId, "127.0.0.1");
    const request = (body = "") => new NextRequest(`http://localhost/api/admin/lotes/${id}/preparar?portal=presidente`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: `adm=${session.token}`, "content-type": "application/x-www-form-urlencoded" }, body });
    assert.equal((await route.POST(request(), { params: { id: String(id) } })).status, 403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.recovery.userId]);
    assert.equal((await route.POST(request("userId=1"), { params: { id: String(id) } })).status, 400);
    for (const nivel of ["leitura", "edicao", "exclusao"]) {
      await c.db.query("UPDATE admin_users SET nivel=$1 WHERE id=$2", [nivel, c.recovery.userId]);
      assert.equal((await route.POST(request(), { params: { id: String(id) } })).status, 403);
    }
    await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=$1", [c.recovery.userId]);
    const response = await route.POST(request(), { params: { id: String(id) } }); assert.equal(response.status, 303);
    const url = new URL(response.headers.get("location")!); assert.equal(url.pathname, "/admin/presidente"); assert.equal(url.searchParams.get("lote"), String(id));
    await c.noMessages();
  } finally { await c.db._closeDbForTests(); }
});
