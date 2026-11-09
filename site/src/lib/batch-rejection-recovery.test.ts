import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.APPROVER_EMAIL = "qa-president@example.test";
delete process.env.PREVIEW_MODE;

async function setup(schema: string, recipients = "qa-rejected@example.test") {
  const db = await import("./db"); await db._openForTests(schema);
  const B = await import("./batches"), M = await import("./mail"), A = await import("./mail/archive");
  const actor = { userId: 1, email: "qa-retry-session@example.test" };
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Retry','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const dir = mkdtempSync(join(tmpdir(), "qa-batch-rejected-")), pdf = Buffer.from("%PDF-QA-FROZEN-REJECTION");
  process.env.RECIPIENTS = recipients; process.env.MAIL_OUTBOX_DIR = dir;
  const id = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'partial','prepared',0,1,'QA-FROZEN-LIST',$1,$2,'none') RETURNING id", [pdf, createHash("sha256").update(pdf).digest("hex")])).rows[0].id;
  const mails = () => readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const code = async () => { const before = new Set(readdirSync(dir)); await B.requestApprovalCode(id, actor); const fresh = readdirSync(dir).filter(f => !before.has(f)); assert.equal(fresh.length, 1); return JSON.parse(readFileSync(join(dir, fresh[0]), "utf8")).subject.match(/: (\d{6})$/)[1] as string; };
  const freeze = async () => (await db.query("SELECT pdf,pdf_sha256,list_hash,signature_kind,approved_at,approved_by FROM batches WHERE id=$1", [id])).rows[0];
  const reject = async (recipient: string) => {
    const message = (await db.query("SELECT id FROM mail_messages WHERE kind='lote' AND to_addr=$1", [recipient])).rows[0];
    const attempt = await A.beginAttempt(message.id, "dev", "QA <qa-sender@example.test>"); assert.ok(attempt.ok);
    assert.ok((await A.finishAttempt(attempt.id, "rejected", { errorCode: "provider_rejected" })).ok);
    return message.id as string;
  };
  const block = async (recipient: string) => db.query(`CREATE FUNCTION qa_no_recipient_transport() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_attempt_started' AND EXISTS(SELECT 1 FROM mail_messages WHERE id=(NEW.data::jsonb->>'messageId')::uuid AND kind='lote' AND to_addr='${recipient}') THEN RAISE EXCEPTION 'QA no transport admitted'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_no_recipient_transport BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_no_recipient_transport()`);
  const unblock = () => db.query("DROP TRIGGER qa_no_recipient_transport ON audit_log; DROP FUNCTION qa_no_recipient_transport()");
  const close = async () => { await M.waitForBackgroundMail(); await db._closeDbForTests(); rmSync(dir, { recursive: true, force: true }); };
  return { db, B, M, A, actor, id, dir, pdf, mails, code, freeze, reject, block, unblock, close };
}

test("rejeição conclusiva exige novo código e repete somente a mesma mensagem/documento", async () => {
  const c = await setup("t_batch_retry_rejected"), previousRetention = process.env.MAIL_ARCHIVE_RETENTION, previousReplyTo = process.env.MAIL_REPLY_TO;
  try {
    delete process.env.MAIL_REPLY_TO;
    process.env.MAIL_ARCHIVE_RETENTION = "30";
    const code = await c.code(); await c.block("qa-rejected@example.test");
    assert.deepEqual(await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), { ok: true, sent: 0, failed: 1 }); await c.unblock();
    const original = await c.freeze(), messageId = await c.reject("qa-rejected@example.test");
    await c.db.query("UPDATE mail_messages SET created_at=now()-interval '31 days' WHERE id=$1", [messageId]); assert.equal(await c.A.purgeArchivedContent(), 1);
    const content = async () => (await c.db.query("SELECT content_state,content_cipher,content_expires_at FROM mail_messages WHERE id=$1", [messageId])).rows[0];
    const expired = await content(); assert.equal(expired.content_state, "expired"); assert.equal(expired.content_cipher, null);
    process.env.MAIL_REPLY_TO = "qa-new-default@example.test";
    assert.equal((await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor)).ok, false);
    const retry = await c.code();
    const results = await Promise.all([c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor), c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor)]);
    assert.equal(results.filter(r => r.ok).length, 1); assert.equal(c.mails().filter(m => m.attachments?.length).length, 1);
    assert.deepEqual(await c.freeze(), original); assert.equal((await c.B.getBatch(c.id))!.status, "sent");
    assert.deepEqual(await content(), expired);
    assert.equal(c.mails().find(m => m.attachments?.length).replyTo, undefined);
    assert.deepEqual((await c.db.query("SELECT id,status FROM mail_messages WHERE kind='lote'")).rows, [{ id: messageId, status: "accepted" }]);
    assert.deepEqual((await c.db.query("SELECT state FROM mail_message_attempts WHERE message_id=$1 ORDER BY started_at", [messageId])).rows.map(r => r.state), ["rejected", "accepted"]);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_approved'")).rowCount, 1);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_retry_approved'")).rowCount, 1); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { if (previousRetention === undefined) delete process.env.MAIL_ARCHIVE_RETENTION; else process.env.MAIL_ARCHIVE_RETENTION = previousRetention; if (previousReplyTo === undefined) delete process.env.MAIL_REPLY_TO; else process.env.MAIL_REPLY_TO = previousReplyTo; await c.close(); }
});

test("recuperação não reenvia aceite anterior e ignora novos destinatários da configuração", async () => {
  const c = await setup("t_batch_retry_partial", "qa-first@example.test,qa-second@example.test");
  try {
    const code = await c.code(); await c.block("qa-second@example.test");
    assert.deepEqual(await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), { ok: true, sent: 1, failed: 1 }); await c.unblock(); await c.reject("qa-second@example.test");
    const accepted = (await c.db.query("SELECT row_to_json(s)::text raw FROM batch_sends s WHERE recipient='qa-first@example.test'")).rows;
    const document = await c.freeze(); process.env.RECIPIENTS = "qa-new-never-approved@example.test";
    const retry = await c.code(); assert.deepEqual(await c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor), { ok: true, sent: 1, failed: 0 });
    const attached = c.mails().filter(m => m.attachments?.length); assert.deepEqual(attached.map(m => m.to).sort(), ["qa-first@example.test", "qa-second@example.test"]);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM batch_sends s WHERE recipient='qa-first@example.test'")).rows, accepted); assert.deepEqual(await c.freeze(), document);
  } finally { await c.close(); }
});

test("incerteza continua bloqueada mesmo com novo pedido de código", async () => {
  const c = await setup("t_batch_retry_uncertain");
  try {
    const code = await c.code(), blocked = join(c.dir, "not-a-directory"); writeFileSync(blocked, "QA"); process.env.MAIL_OUTBOX_DIR = blocked;
    await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor); process.env.MAIL_OUTBOX_DIR = c.dir;
    const before = await c.freeze(); await assert.rejects(c.B.requestApprovalCode(c.id, c.actor), /Lote não está pronto/);
    assert.equal((await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor)).ok, false); assert.deepEqual(await c.freeze(), before);
    assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE m.kind='lote'")).rowCount, 1); assert.equal(c.mails().filter(m => m.attachments?.length).length, 0);
  } finally { await c.close(); }
});

test("nova admissão reverte com falha de auditoria e revalida o ator sem consumir o código", async () => {
  const c = await setup("t_batch_retry_audit_actor");
  try {
    const first = await c.code(); await c.block("qa-rejected@example.test");
    await c.B.approveAndSend(c.id, first, "qa-president@example.test", c.actor); await c.unblock();
    const retry = await c.code(), before = async () => (await c.db.query("SELECT row_to_json(b)::text raw FROM batches b WHERE id=$1", [c.id])).rows[0];
    const original = await before(), files = c.mails().length;
    await c.db.query("CREATE FUNCTION qa_retry_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_retry_approved' THEN RAISE EXCEPTION 'QA retry audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_retry_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_retry_fault()");
    await assert.rejects(c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor), /QA retry audit fault/); assert.deepEqual(await before(), original); assert.equal(c.mails().length, files);
    await c.db.query("DROP TRIGGER qa_retry_fault ON audit_log");
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]);
    assert.equal((await c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor)).ok, false); await assert.rejects(c.B.requestApprovalCode(c.id, c.actor), /Lote não está pronto/); assert.deepEqual(await before(), original);
    await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.B.approveAndSend(c.id, retry, "qa-president@example.test", c.actor), { ok: true, sent: 1, failed: 0 });
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_retry_approved'")).rowCount, 1); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.close(); }
});
