import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

// Keep the original document, identity and dates even when audit persistence fails.
test("cancelar lote reverte o estado se a auditoria falhar e permite repetir sem perder o documento", async () => {
  const db = await import("./db");
  await db._openForTests("t_batch_cancel_audit_atomicity");
  const B = await import("./batches");
  try {
    const id = (await db.query(`INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,approval_code_hash)
      VALUES(1,'partial','prepared',0,1,'QA-IMMUTABLE-LIST',decode('255044462d51412d4f524947494e414c','hex'),'QA-PDF-HASH','QA-APPROVAL-HASH') RETURNING id`)).rows[0].id;
    const original = async () => (await db.query("SELECT row_to_json(b)::text data FROM batches b WHERE id=$1", [id])).rows[0];
    const before = await original();
    await db.query(`CREATE FUNCTION qa_fail_batch_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event='batch_cancelled' THEN RAISE EXCEPTION 'QA expected cancel audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_fail_batch_cancel_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_batch_cancel_audit()`);
    await assert.rejects(B.cancelBatch(id), /QA expected cancel audit failure/);
    assert.deepEqual(await original(), before, "audit failure must not commit cancellation or consume approval code");
    await db.query("DROP TRIGGER qa_fail_batch_cancel_audit ON audit_log");
    assert.equal(await B.cancelBatch(id), true);
    assert.equal(await B.cancelBatch(id), false);
    const after = (await db.query("SELECT status,approval_code_hash,list_hash,pdf_sha256,encode(pdf,'hex') pdf FROM batches WHERE id=$1", [id])).rows[0];
    assert.deepEqual(after, { status: "cancelled", approval_code_hash: null, list_hash: "QA-IMMUTABLE-LIST", pdf_sha256: "QA-PDF-HASH", pdf: "255044462d51412d4f524947494e414c" });
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='batch_cancelled'")).rows[0].n, 1);
    assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally {
    await db._closeDbForTests();
  }
});
