import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const actor = { userId: 1, email: "qa-batch-session@example.test" };

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

// Keep the original document, identity and dates even when audit persistence fails.
test("cancelar lote reverte o estado se a auditoria falhar e permite repetir sem perder o documento", async () => {
  const db = await import("./db");
  await db._openForTests("t_batch_cancel_audit_atomicity");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const B = await import("./batches");
  try {
    const id = (await db.query(`INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,approval_code_hash)
      VALUES(1,'partial','prepared',0,1,'QA-IMMUTABLE-LIST',decode('255044462d51412d4f524947494e414c','hex'),'QA-PDF-HASH','QA-APPROVAL-HASH') RETURNING id`)).rows[0].id;
    const original = async () => (await db.query("SELECT row_to_json(b)::text data FROM batches b WHERE id=$1", [id])).rows[0];
    const before = await original();
    await db.query(`CREATE FUNCTION qa_fail_batch_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event='batch_cancelled' THEN RAISE EXCEPTION 'QA expected cancel audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_fail_batch_cancel_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_batch_cancel_audit()`);
    await assert.rejects(B.cancelBatch(id, actor), /QA expected cancel audit failure/);
    assert.deepEqual(await original(), before, "audit failure must not commit cancellation or consume approval code");
    await db.query("DROP TRIGGER qa_fail_batch_cancel_audit ON audit_log");
    assert.equal(await B.cancelBatch(id, actor), true);
    assert.equal(await B.cancelBatch(id, actor), false);
    const after = (await db.query("SELECT status,approval_code_hash,list_hash,pdf_sha256,encode(pdf,'hex') pdf FROM batches WHERE id=$1", [id])).rows[0];
    assert.deepEqual(after, { status: "cancelled", approval_code_hash: null, list_hash: "QA-IMMUTABLE-LIST", pdf_sha256: "QA-PDF-HASH", pdf: "255044462d51412d4f524947494e414c" });
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='batch_cancelled'")).rows[0].n, 1);
    assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally {
    await db._closeDbForTests();
  }
});

test("aprovações concorrentes do mesmo lote não repetem o anexo ao mesmo destinatário", async () => {
  const db = await import("./db");
  await db._openForTests("t_batch_approval_single_delivery");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const B = await import("./batches");
  const outbox = mkdtempSync(join(tmpdir(), "batch-approval-concurrency-"));
  const previousRecipients = process.env.RECIPIENTS, previousOutbox = process.env.MAIL_OUTBOX_DIR, previousApprover = process.env.APPROVER_EMAIL;
  process.env.RECIPIENTS = "qa-single-recipient@example.test";
  process.env.MAIL_OUTBOX_DIR = outbox;
  process.env.APPROVER_EMAIL = "qa-approver@example.test";
  let pending: Promise<Awaited<ReturnType<typeof B.approveAndSend>>[]> | undefined;
  try {
    const pdf = Buffer.from("%PDF-QA-CONCURRENCY-FICTITIOUS");
    const id = (await db.query(`INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind)
      VALUES(1,'partial','prepared',0,1,'QA-CONCURRENT-LIST',$1,$2,'none') RETURNING id`, [pdf, createHash("sha256").update(pdf).digest("hex")])).rows[0].id;
    await B.requestApprovalCode(id, actor);
    const approvalMail = readdirSync(outbox).map(name => JSON.parse(readFileSync(join(outbox, name), "utf8"))).find(mail => mail.to === "qa-approver@example.test");
    const code = /Código de aprovação do lote \d+: (\d{6})/.exec(approvalMail?.text ?? "")?.[1];
    assert.ok(code, "approval code must come from the real development email flow");
    await db.tx(async control => {
      await control.query("SELECT id FROM batches WHERE id=$1 FOR UPDATE", [id]);
      pending = Promise.all([B.approveAndSend(id, code, "qa-owner@example.test", actor), B.approveAndSend(id, code, "qa-owner@example.test", actor)]);
      const deadline = Date.now() + 750;
      let waiters = 0;
      do {
        await control.query("SELECT pg_stat_clear_snapshot()");
        waiters = (await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows[0].n;
        if (waiters >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 5));
      } while (Date.now() < deadline);
      assert.ok(waiters >= 2, "both approval requests must reach a database gate before releasing the document");
    });
    await pending;
    const deliveries = readdirSync(outbox).map(name => JSON.parse(readFileSync(join(outbox, name), "utf8"))).filter(mail => mail.to === "qa-single-recipient@example.test" && mail.attachments?.length);
    assert.equal(deliveries.length, 1, "one document and recipient must produce only one delivered envelope");
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_sends WHERE batch_id=$1 AND ok", [id])).rows[0].n, 1);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally {
    await pending?.catch(() => {});
    if (previousRecipients === undefined) delete process.env.RECIPIENTS; else process.env.RECIPIENTS = previousRecipients;
    if (previousOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR; else process.env.MAIL_OUTBOX_DIR = previousOutbox;
    if (previousApprover === undefined) delete process.env.APPROVER_EMAIL; else process.env.APPROVER_EMAIL = previousApprover;
    await db._closeDbForTests();
    rmSync(outbox, { recursive: true, force: true });
  }
});
