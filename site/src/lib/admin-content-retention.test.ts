import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
const mail = () => ({ to: "qa-retention@example.test", subject: "QA subject", text: "QA-PRIVATE-BODY-AND-LINK", attachments: [{ filename: "qa.txt", content: Buffer.from("QA-PRIVATE-ATTACHMENT") }] });
async function setup() {
  const db = await import("./db"); await db._openForTests("t_admin_content_retention");
  return { db, A: await import("./mail/archive"), O: await import("./mail/outbox"), R: await import("./admin-content-retention"), D: await import("./contact-delivery") };
}
async function oldMail(c: Awaited<ReturnType<typeof setup>>) {
  const m = await c.A.prepareMessage(mail(), "admin", "transactional", { archive: { until: null } });
  await c.db.query("UPDATE mail_messages SET created_at=now()-interval '31 days',content_expires_at=now()+interval '90 days' WHERE id=$1", [m.id]);
  return m;
}

test("política limita conteúdo e anexos a30dias, inclusive pedidos internos sem prazo", async () => {
  const c = await setup();
  const beforeEnv = process.env.MAIL_ARCHIVE_RETENTION;
  try {
    const { archivePolicy } = await import("./mail/recorded");
    const { ADMIN_CONTENT_RETENTION_MS } = await import("./admin-retention-policy");
    process.env.MAIL_ARCHIVE_RETENTION = "30";
    const now = Date.now(), policy = archivePolicy(); assert.ok(policy);
    assert.ok(policy.until.getTime() >= now + ADMIN_CONTENT_RETENTION_MS);
    assert.ok(policy.until.getTime() <= Date.now() + ADMIN_CONTENT_RETENTION_MS);
    for (const value of ["90", "forever", "7", "invalid"]) { process.env.MAIL_ARCHIVE_RETENTION = value; assert.throws(archivePolicy, /archive_policy_invalid/); }
    delete process.env.MAIL_ARCHIVE_RETENTION; assert.equal(archivePolicy(), undefined);
    for (const until of [null, new Date(Date.now() + 90 * 86400000)]) {
      const m = await c.A.prepareMessage(mail(), "admin", "transactional", { archive: { until } });
      const row = (await c.db.query("SELECT content_expires_at,created_at FROM mail_messages WHERE id=$1", [m.id])).rows[0];
      assert.ok(new Date(row.content_expires_at).getTime() - new Date(row.created_at).getTime() <= ADMIN_CONTENT_RETENTION_MS + 1000);
      assert.equal((await c.A.archivedContent(m.id)).state, "stored");
    }
    const old = await oldMail(c);
    assert.deepEqual(await c.A.archivedContent(old.id), { state: "expired" });
    assert.ok((await c.db.query("SELECT content_cipher FROM mail_messages WHERE id=$1", [old.id])).rows[0].content_cipher);
  } finally { if (beforeEnv === undefined) delete process.env.MAIL_ARCHIVE_RETENTION; else process.env.MAIL_ARCHIVE_RETENTION = beforeEnv; await c.db._closeDbForTests(); }
});

test("expurgo remove cópias e anexos sem apagar metadados, contatos, assinaturas ou PDFs", async () => {
  const c = await setup();
  try {
    const old = await oldMail(c);
    const recent = await c.A.prepareMessage(mail(), "admin", "transactional", { archive: { until: null } });
    for (const status of ["sent", "pending"]) {
      const id = await c.O.enqueueMail(mail(), "admin", "QA reason");
      await c.db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days',status=$2,sent_at=CASE WHEN $2='sent' THEN now()-interval '30 days' ELSE NULL END WHERE id=$1", [id, status]);
    }
    const contact = (await c.db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA','qa-contact@example.test','duvida','QA original contact retained') RETURNING id")).rows[0].id;
    for (const [round, state] of [[1, "accepted"], [2, "prepared"]] as const) await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,payload,criada_em,due_at,ok) VALUES($1,$2,'texto','qa-owner@example.test','QA subject',$3,$4,now()-interval '31 days',now()-interval '1 day',$5)", [contact, round, state, JSON.stringify({ to: mail().to, subject: mail().subject, text: mail().text }), state === "accepted"]);
    await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status,confirmed_at,seq) VALUES('QA Signer','qa-signer@example.test','QA-HASH-E','QA-HASH-CPF','apoiador','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','confirmed','2026-10-01T00:10:00Z',17)");
    await c.db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf) VALUES(1,'partial','prepared',0,1,'QA-LIST',decode('25504446','hex'))");
    const proof = async () => (await c.db.query("SELECT 'signer' kind,row_to_json(s)::text raw FROM signatures s UNION ALL SELECT 'batch',row_to_json(b)::text FROM batches b UNION ALL SELECT 'contact',row_to_json(c)::text FROM contact_messages c ORDER BY kind,raw")).rows;
    const before = await proof();
    const outboxBefore = (await c.db.query("SELECT id,to_addr,kind,created_at,sent_at,attempts FROM mail_outbox ORDER BY id")).rows;
    const repliesBefore = (await c.db.query("SELECT id,contact_id,rodada,versao,por,assunto,criada_em FROM contact_replies ORDER BY id")).rows;
    assert.deepEqual(await c.R.purgeAdminContent(), { messages: 1, outbox: 2, replies: 2, drafts: 0 });
    assert.equal((await c.db.query("SELECT content_cipher FROM mail_messages WHERE id=$1", [old.id])).rows[0].content_cipher, null);
    assert.equal((await c.A.archivedContent(recent.id)).state, "stored");
    const queues = (await c.db.query("SELECT status,payload,last_error FROM mail_outbox ORDER BY id")).rows;
    assert.deepEqual(queues.map(r => r.payload), [{}, {}]); assert.deepEqual(queues.map(r => r.status), ["sent", "failed"]);
    assert.equal(queues[1].last_error, "content_expired");
    assert.deepEqual((await c.db.query("SELECT id,to_addr,kind,created_at,sent_at,attempts FROM mail_outbox ORDER BY id")).rows, outboxBefore);
    assert.deepEqual((await c.db.query("SELECT id,contact_id,rodada,versao,por,assunto,criada_em FROM contact_replies ORDER BY id")).rows, repliesBefore);
    const replies = (await c.db.query("SELECT estado,payload,error_code,ok FROM contact_replies ORDER BY id")).rows;
    assert.deepEqual(replies.map(r => r.payload), [null, null]); assert.deepEqual(replies.map(r => r.estado), ["accepted", "rejected"]);
    assert.equal(replies[0].ok, true); assert.equal(replies[1].error_code, "content_expired");
    assert.deepEqual(await proof(), before);
    assert.deepEqual(await c.R.purgeAdminContent(), { messages: 0, outbox: 0, replies: 0, drafts: 0 });
    const audit = JSON.stringify((await c.db.query("SELECT data FROM audit_log")).rows);
    assert.ok(!audit.includes(mail().text)); assert.ok(!audit.includes("QA-PRIVATE-ATTACHMENT")); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("falha na auditoria do expurgo reverte também a exclusão do arquivo cifrado", async () => {
  const c = await setup();
  try {
    await oldMail(c);
    const id = await c.O.enqueueMail(mail(), "admin", "QA reason");
    await c.db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days' WHERE id=$1", [id]);
    const proof = async () => (await c.db.query("SELECT 'message' kind,row_to_json(m)::text raw FROM mail_messages m UNION ALL SELECT 'queue',row_to_json(q)::text FROM mail_outbox q ORDER BY kind,raw")).rows;
    const before = await proof();
    await c.db.query(`CREATE FUNCTION fail_retention_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_content_expired' THEN RAISE EXCEPTION 'QA retention audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_retention_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_retention_audit()`);
    await assert.rejects(c.R.purgeAdminContent(), /QA retention audit failure/); assert.deepEqual(await proof(), before);
    await c.db.query("DROP TRIGGER fail_retention_audit ON audit_log");
    assert.deepEqual(await c.R.purgeAdminContent(), { messages: 1, outbox: 1, replies: 0, drafts: 0 });
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("workers não despacham conteúdo vencido mesmo antes do expurgo", async () => {
  const c = await setup();
  try {
    const id = await c.O.enqueueMail(mail(), "admin", "QA reason");
    await c.db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days',next_attempt_at=now()-interval '1 minute' WHERE id=$1", [id]);
    let sends = 0;
    const result = await c.O.drainOutbox(async () => { sends++; return "sent"; }); assert.equal(result.tried, 0);
    const contact = (await c.db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA','qa@example.test','duvida','QA') RETURNING id")).rows[0].id;
    const reply = (await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,payload,criada_em,due_at) VALUES($1,1,'texto','qa-owner@example.test','QA','prepared',$2,now()-interval '31 days',now()-interval '1 day') RETURNING id", [contact, JSON.stringify({ to: mail().to, subject: mail().subject, text: mail().text })])).rows[0].id;
    await c.D.dispatchContactReply(reply, { enviar: async () => { sends++; return "sent"; } }); assert.equal(sends, 0);
    assert.deepEqual(await c.R.purgeAdminContent(), { messages: 0, outbox: 1, replies: 1, drafts: 0 });
  } finally { await c.db._closeDbForTests(); }
});

test("aceite iniciado antes do prazo conserva o resultado sem restaurar o conteúdo expurgado", async () => {
  const c = await setup();
  let release!: () => void;
  try {
    const id = await c.O.enqueueMail(mail(), "admin", "QA reason");
    await c.db.query("UPDATE mail_outbox SET next_attempt_at=now()-interval '1 minute' WHERE id=$1", [id]);
    let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const draining = c.O.drainOutbox(async () => { start(); await gate; return "sent"; });
    await started;
    await c.db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days' WHERE id=$1", [id]);
    try { assert.deepEqual(await c.R.purgeAdminContent(), { messages: 0, outbox: 1, replies: 0, drafts: 0 }); }
    finally { release(); }
    assert.equal((await draining).sent, 1);
    const row = (await c.db.query("SELECT status,payload,sent_at FROM mail_outbox WHERE id=$1", [id])).rows[0];
    assert.equal(row.status, "sent"); assert.deepEqual(row.payload, {}); assert.ok(row.sent_at);
  } finally { release?.(); await c.db._closeDbForTests(); }
});
