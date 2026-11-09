import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.APPROVER_EMAIL = "qa-president@example.test";
process.env.BATCH_SIZE = "1";
delete process.env.PREVIEW_MODE;

async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const B = await import("./batches"), U = await import("./admin-users"), M = await import("./mail");
  const created = await U.criarUsuario({ email: "qa-manual-creator@example.test", nome: "QA Manual", nivel: "total", senha: "Ficticia-Criacao-Manual-2026" }); assert.ok(created.ok);
  const actor = { userId: created.usuario.id, email: created.usuario.email };
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Ficticia','qa-signer@example.test','QA-EMAIL-HASH','QA-CPF-HASH','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
  const dir = mkdtempSync(join(tmpdir(), "qa-batch-creator-")); process.env.MAIL_OUTBOX_DIR = dir;
  const close = async () => { await M.waitForBackgroundMail(); await db._closeDbForTests(); rmSync(dir, { recursive: true, force: true }); };
  return { db, B, U, actor, close };
}

test("criação manual pela rota exige Total/stepup e audita sessão real ignorando autor forjado", async () => {
  const c = await setup("t_batch_manual_creator_http");
  try {
    const route = await import("../app/api/admin/lotes/criar/route"), token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    const request = () => new NextRequest("http://localhost/api/admin/lotes/criar", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: `adm=${token}`, "content-type": "application/x-www-form-urlencoded" }, body: "userId=999999&por=forged%40example.test" });
    assert.equal((await route.POST(request())).status, 403); assert.equal((await c.db.query("SELECT 1 FROM batches")).rowCount, 0);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.actor.userId]);
    assert.equal((await route.POST(request())).status, 303);
    const events = (await c.db.query("SELECT data FROM audit_log WHERE event IN ('batch_created','batch_prepared') ORDER BY id")).rows.map(r => JSON.parse(r.data)); assert.equal(events.length, 2);
    for (const event of events) { assert.equal(event.source, "admin"); assert.equal(event.userId, c.actor.userId); assert.equal(event.por, c.actor.email); }
    assert.equal((await c.db.query("SELECT status FROM batches")).rows[0].status, "prepared"); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.close(); }
});

test("criação revalida o ator antes da reserva e antes de gravar PDF após revogação", async () => {
  const c = await setup("t_batch_manual_creator_revocation");
  try {
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]);
    await assert.rejects(c.B.createBatchForAdmin("final", c.actor), /Lote não está pronto/); assert.equal((await c.db.query("SELECT 1 FROM batches")).rowCount, 0);
    await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=$1", [c.actor.userId]);
    await assert.rejects(c.B.createBatchForAdmin("final", { ...c.actor, email: "forged@example.test" }), /Lote não está pronto/);
    await c.db.query(`CREATE FUNCTION qa_revoke_creator() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE admin_users SET ativo=false WHERE id=${c.actor.userId}; RETURN NEW; END $$; CREATE TRIGGER qa_revoke_creator BEFORE INSERT ON batches FOR EACH ROW EXECUTE FUNCTION qa_revoke_creator()`);
    await assert.rejects(c.B.createBatchForAdmin("final", c.actor), /Lote não está pronto/);
    const row = (await c.db.query("SELECT status,pdf,pdf_sha256 FROM batches")).rows[0]; assert.deepEqual(row, { status: "preparing", pdf: null, pdf_sha256: null });
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_prepared'")).rowCount, 0);
    const failed = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='batch_prepare_failed'")).rows[0].data); assert.equal(failed.userId, c.actor.userId); assert.equal(failed.source, "admin");
    assert.equal((await c.db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.close(); }
});

test("falha na auditoria da reserva manual reverte tudo e agendador tem autoria própria", async () => {
  const c = await setup("t_batch_manual_creator_rollback");
  try {
    await c.db.query("CREATE FUNCTION qa_creator_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_created' THEN RAISE EXCEPTION 'QA creator audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_creator_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_creator_audit_fault()");
    await assert.rejects(c.B.createBatchForAdmin("partial", c.actor), /QA creator audit fault/);
    assert.equal((await c.db.query("SELECT 1 FROM batches")).rowCount, 0); assert.equal((await c.db.query("SELECT batch_id FROM signatures")).rows[0].batch_id, null);
    await c.db.query("DROP TRIGGER qa_creator_audit_fault ON audit_log");
    assert.ok(await c.B.createBatch("partial"));
    for (const row of (await c.db.query("SELECT data FROM audit_log WHERE event IN ('batch_created','batch_prepared')")).rows) { const event = JSON.parse(row.data); assert.equal(event.source, "scheduler"); assert.ok(!("userId" in event)); assert.ok(!("por" in event)); }
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.close(); }
});
