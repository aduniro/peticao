import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.BATCH_SIZE = "1";
process.env.SIGNER = "none";

test("confirmação posterior à leitura da lista não recebe vínculo a um PDF que não a contém", async () => {
  const db = await import("./db"); await db._openForTests("t_batch_snapshot_reservation");
  const B = await import("./batches");
  try {
    await db.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at)
      VALUES('Pessoa Inicial QA','qa-before@example.test','QA-BEFORE-EMAIL','QA-BEFORE-CPF','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())`);
    // Reproduce the exact interleaving: a confirmation appears after rows were read,
    // but before the batch is inserted and its signatures are marked.
    await db.query(`CREATE FUNCTION qa_confirm_between_snapshot_and_marking() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.seq=1 THEN INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at)
      VALUES('Pessoa Posterior QA','qa-after@example.test','QA-AFTER-EMAIL','QA-AFTER-CPF','apoiador','Porto Velho','RO','QA',now(),'confirmed',now()); END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_confirm_between_snapshot_and_marking BEFORE INSERT ON batches FOR EACH ROW EXECUTE FUNCTION qa_confirm_between_snapshot_and_marking()`);
    const first = await B.createBatch("partial"); assert.ok(first); assert.equal(first.n_apoiador, 1);
    assert.equal((await db.query("SELECT batch_id FROM signatures WHERE email='qa-before@example.test'")).rows[0].batch_id, first.id);
    assert.equal((await db.query("SELECT batch_id FROM signatures WHERE email='qa-after@example.test'")).rows[0].batch_id, null, "a signer outside the document snapshot must remain eligible for the next batch");
    const original = (await db.query("SELECT pdf,pdf_sha256,list_hash,created_at FROM batches WHERE id=$1", [first.id])).rows[0];
    await db.query("DROP TRIGGER qa_confirm_between_snapshot_and_marking ON batches; DROP FUNCTION qa_confirm_between_snapshot_and_marking()");
    const next = await B.createBatch("partial"); assert.ok(next); assert.equal(next.n_apoiador, 2);
    assert.equal((await db.query("SELECT batch_id FROM signatures WHERE email='qa-after@example.test'")).rows[0].batch_id, next.id);
    assert.deepEqual((await db.query("SELECT pdf,pdf_sha256,list_hash,created_at FROM batches WHERE id=$1", [first.id])).rows[0], original);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});
