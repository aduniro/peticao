import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.APPROVER_EMAIL = "qa-president@example.test";
process.env.RECIPIENTS = "qa-authority@example.test";
delete process.env.PREVIEW_MODE;
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const B = await import("./batches"), M = await import("./mail");
  const actor = { userId: 1, email: "qa-session@example.test" };
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const dir = mkdtempSync(join(tmpdir(), "qa-batch-reservation-")); process.env.MAIL_OUTBOX_DIR = dir;
  const pdf = Buffer.from("%PDF-1.7 QA ORIGINAL\n" + "% QA padding\n".repeat(30) + "%%EOF\n");
  const id = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'partial','prepared',0,1,'QA-LIST',$1,$2,'none') RETURNING id", [pdf, digest(pdf)])).rows[0].id;
  const snapshot = async () => (await db.query("SELECT row_to_json(b)::text raw FROM batches b WHERE id=$1", [id])).rows[0];
  const code = async () => { await B.requestApprovalCode(id, actor); return readdirSync(dir).map(f => JSON.parse(readFileSync(join(dir, f), "utf8"))).find(m => /Código para aprovar/.test(m.subject)).subject.match(/: (\d{6})$/)[1] as string; };
  const fault = async (event: string) => db.query(`CREATE FUNCTION qa_batch_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'QA audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_batch_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_batch_fault()`);
  const close = async () => { await M.waitForBackgroundMail(); await db._closeDbForTests(); rmSync(dir, { recursive: true, force: true }); delete process.env.ICP_VALIDATOR_URL; };
  return { db, B, M, actor, id, pdf, dir, code, snapshot, fault, close };
}
function signed(original: Buffer) {
  const body = (n: number) => `\n9999 0 obj\n<</Type/Sig/SubFilter/adbe.pkcs7.detached/ByteRange[0 100 200 ${String(n - 200).padStart(10, "0")}]/Contents<00>>>\nendobj\n%%EOF\n`;
  const padding = Buffer.from("\n%" + "QA".repeat(128) + "\n");
  const size = original.length + padding.length + Buffer.byteLength(body(500));
  assert.ok(size > 200, "fixture must have a nonnegative final ByteRange length");
  return Buffer.concat([original, padding, Buffer.from(body(size))]);
}

test("anexação e auditoria são atômicas; bytes e código sobrevivem à falha", async () => {
  const c = await setup("t_batch_attachment_rollback");
  try {
    await c.code(); const before = await c.snapshot(); await c.fault("signed_pdf_attached");
    await assert.rejects(c.B.attachSignedPdf(c.id, signed(c.pdf), "qa-president@example.test", c.actor), /QA audit fault/);
    assert.deepEqual(await c.snapshot(), before);
    await c.db.query("DROP TRIGGER qa_batch_fault ON audit_log");
    assert.ok((await c.B.attachSignedPdf(c.id, signed(c.pdf), "qa-president@example.test", c.actor)).ok);
    const row = (await c.db.query("SELECT pdf,signed_pdf,approval_code_hash,signature_kind FROM batches WHERE id=$1", [c.id])).rows[0];
    assert.deepEqual(row.pdf, c.pdf); assert.deepEqual(row.signed_pdf, signed(c.pdf)); assert.equal(row.approval_code_hash, null); assert.equal(row.signature_kind, "externa-nao-validada");
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.close(); }
});

test("validador atrasado não anexa após cancelamento nem sobrescreve revisão concorrente", async () => {
  const c = await setup("t_batch_attachment_stale"), originalFetch = globalThis.fetch;
  let release = () => {}, attaching: Promise<Awaited<ReturnType<typeof c.B.attachSignedPdf>>> | undefined;
  try {
    process.env.ICP_VALIDATOR_URL = "https://qa-validator.example.test";
    const { checkSignedPdf } = await import("./signed-pdf"); assert.ok(checkSignedPdf(c.pdf, signed(c.pdf)).ok);
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
    globalThis.fetch = (async () => { entered(); await held; return Response.json({ valid: true, cnpj: "15883671000115" }); }) as typeof fetch;
    attaching = c.B.attachSignedPdf(c.id, signed(c.pdf), "qa-president@example.test", c.actor);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([started, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("QA validator not reached")), 3000); })]); }
    finally { clearTimeout(deadline); }
    assert.ok(await c.B.cancelBatch(c.id, c.actor)); const cancelled = await c.snapshot(); release();
    assert.equal((await attaching).ok, false); assert.deepEqual(await c.snapshot(), cancelled);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='signed_pdf_attached'")).rowCount, 0);
  } finally { release(); try { await attaching; } finally { globalThis.fetch = originalFetch; await c.close(); } }
});

test("aprovação/auditoria reverte antes do transporte; código vincula bytes e classificação", async () => {
  const c = await setup("t_batch_admission_rollback");
  try {
    const code = await c.code(), before = await c.snapshot(), files = readdirSync(c.dir).length;
    await c.fault("batch_approved"); await assert.rejects(c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), /QA audit fault/);
    assert.deepEqual(await c.snapshot(), before); assert.equal(readdirSync(c.dir).length, files);
    await c.db.query("DROP TRIGGER qa_batch_fault ON audit_log");
    await c.db.query("UPDATE batches SET list_hash='QA-OTHER-LIST' WHERE id=$1", [c.id]);
    assert.deepEqual(await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), { ok: false, reason: "Código incorreto." });
    assert.equal(readdirSync(c.dir).length, files); assert.equal((await c.db.query("SELECT approved_at FROM batches WHERE id=$1", [c.id])).rows[0].approved_at, null);
  } finally { await c.close(); }
});

test("falha de persistência após aceite mantém journal aceito e impede segunda saída", async () => {
  const c = await setup("t_batch_accepted_persistence_fault");
  try {
    const code = await c.code(); await c.fault("batch_recipient_result");
    await assert.rejects(c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), /QA audit fault/);
    assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE kind='lote'")).rows[0].status, "accepted");
    assert.equal((await c.db.query("SELECT 1 FROM batch_sends")).rowCount, 0);
    const before = await c.snapshot(), files = readdirSync(c.dir).length;
    assert.equal((await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor)).ok, false);
    await assert.rejects(c.B.requestApprovalCode(c.id, c.actor), /Lote não está pronto/);
    assert.equal(await c.B.cancelBatch(c.id, c.actor), false);
    assert.equal((await c.B.attachSignedPdf(c.id, signed(c.pdf), "qa-president@example.test", c.actor)).ok, false);
    assert.deepEqual(await c.snapshot(), before); assert.equal(readdirSync(c.dir).length, files);
    assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE m.kind='lote'")).rowCount, 1);
  } finally { await c.close(); }
});

test("resultado incerto não autoriza repetição; journal e documento permanecem congelados", async () => {
  const c = await setup("t_batch_uncertain");
  try {
    const code = await c.code(), blocked = join(c.dir, "qa-not-a-directory"); writeFileSync(blocked, "QA"); process.env.MAIL_OUTBOX_DIR = blocked;
    assert.deepEqual(await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), { ok: true, sent: 0, failed: 1 });
    const message = (await c.db.query("SELECT id,status FROM mail_messages WHERE kind='lote'")).rows[0]; assert.equal(message.status, "indeterminate");
    const before = await c.snapshot(); process.env.MAIL_OUTBOX_DIR = c.dir;
    assert.equal((await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor)).ok, false);
    await assert.rejects(c.B.requestApprovalCode(c.id, c.actor), /Lote não está pronto/);
    assert.deepEqual(await c.snapshot(), before);
    assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1", [message.id])).rowCount, 1);
    assert.equal((await c.db.query("SELECT 1 FROM mail_outbox")).rowCount, 0);
    assert.deepEqual((await c.db.query("SELECT error FROM batch_sends")).rows.map(r => r.error), ["transport_uncertain"]);
  } finally { await c.close(); }
});

test("revogação durante validação ICP impede anexação e mudança de papel impede cancelar/aprovar", async () => {
  const c = await setup("t_batch_actor_revocation"), originalFetch = globalThis.fetch;
  let release = () => {}, attaching: Promise<Awaited<ReturnType<typeof c.B.attachSignedPdf>>> | undefined;
  try {
    const code = await c.code(), before = await c.snapshot();
    process.env.ICP_VALIDATOR_URL = "https://qa-validator.example.test";
    const { checkSignedPdf } = await import("./signed-pdf"); assert.ok(checkSignedPdf(c.pdf, signed(c.pdf)).ok);
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
    globalThis.fetch = (async () => { entered(); await held; return Response.json({ valid: true, cnpj: "15883671000115" }); }) as typeof fetch;
    attaching = c.B.attachSignedPdf(c.id, signed(c.pdf), "qa-president@example.test", c.actor);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([started, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("QA validator not reached")), 3000); })]); }
    finally { clearTimeout(deadline); }
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); release();
    assert.equal((await attaching).ok, false); assert.deepEqual(await c.snapshot(), before);
    await c.db.query("UPDATE admin_users SET ativo=true,nivel='edicao' WHERE id=$1", [c.actor.userId]);
    assert.equal(await c.B.cancelBatch(c.id, c.actor), false);
    assert.equal((await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor)).ok, false);
    await assert.rejects(c.B.requestApprovalCode(c.id, c.actor), /Lote não está pronto/);
    assert.deepEqual(await c.snapshot(), before);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event IN ('signed_pdf_attached','batch_cancelled','batch_approved')")).rowCount, 0);
  } finally { release(); try { await attaching; } finally { globalThis.fetch = originalFetch; await c.close(); } }
});

test("identidade estável conserva aceite e retenção em replay sem novo transporte nem nova autoria", async () => {
  const c = await setup("t_batch_stable_message"), previousRetention = process.env.MAIL_ARCHIVE_RETENTION;
  try {
    process.env.MAIL_ARCHIVE_RETENTION = "30";
    const code = await c.code(); assert.deepEqual(await c.B.approveAndSend(c.id, code, "qa-president@example.test", c.actor), { ok: true, sent: 1, failed: 0 });
    const approved = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='batch_approved'")).rows[0].data);
    assert.equal(approved.userId, c.actor.userId); assert.equal(approved.por, c.actor.email); assert.equal(approved.approvedBy, "qa-president@example.test");
    const files = readdirSync(c.dir), mail = files.map(f => JSON.parse(readFileSync(join(c.dir, f), "utf8"))).find(m => m.attachments?.length);
    const { at: _at, attachments, ...envelope } = mail;
    const frozen = { ...envelope, attachments: attachments.map((a: { filename: string }) => ({ filename: a.filename, content: c.pdf, contentType: "application/pdf" })) };
    const security = await import("./security"), key = `batch-send:v1:${c.id}:${digest(c.pdf)}:${security.hmac(mail.to)}`;
    const rows = async () => (await c.db.query("SELECT row_to_json(m)::text raw FROM mail_messages m WHERE kind='lote'")).rows;
    const before = await rows(), document = await c.snapshot();
    assert.equal(await c.M.sendMail(frozen, "lote", { queue: false, singleAttempt: true, messageKey: key }), "sent");
    assert.deepEqual(await rows(), before); assert.deepEqual(await c.snapshot(), document); assert.deepEqual(readdirSync(c.dir), files);
    assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE m.kind='lote'")).rowCount, 1);
  } finally { if (previousRetention === undefined) delete process.env.MAIL_ARCHIVE_RETENTION; else process.env.MAIL_ARCHIVE_RETENTION = previousRetention; await c.close(); }
});
