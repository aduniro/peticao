// Positive compiled-route contract. All identities, documents and delivery are fictitious.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3033");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349"); assert.equal(database.pathname, "/peticao");
assert.match(process.env.DATABASE_SCHEMA ?? "", /^qa_consolidation_batch_reservation_\d+$/);
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
assert.equal(process.env.APPROVER_EMAIL, "qa-president@example.test"); assert.equal(process.env.RECIPIENTS, "qa-authority@example.test");
assert.equal(process.env.SIGNER, "none"); assert.ok(process.env.MAIL_OUTBOX_DIR); assert.ok(process.env.QA_OUTPUT_DIR);
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um, tokens = [];
const pdf = Buffer.from("%PDF-QA-COMPILED-RESERVATION-ONLY"), pdfHash = createHash("sha256").update(pdf).digest("hex");
const messages = async () => Promise.all((await readdir(process.env.MAIL_OUTBOX_DIR)).map(async name => JSON.parse(await readFile(`${process.env.MAIL_OUTBOX_DIR}/${name}`, "utf8"))));
const post = (id, action, user, fields = {}, origin = base.origin) => fetch(new URL(`/api/admin/lotes/${id}/${action}`, base), {
  method: "POST", redirect: "manual", headers: { origin, cookie: user ? `adm=${user.token}` : "", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
});
const locationMessage = response => new URL(response.headers.get("location"), base).searchParams.get("msg");
const row = async id => (await db.query("SELECT row_to_json(b)::text raw FROM batches b WHERE id=$1", [id])).rows[0];
const seed = async seq => (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES($1,'partial','prepared',0,1,'QA-COMPILED-LIST',$2,$3,'none') RETURNING id", [seq, pdf, pdfHash])).rows[0].id;
try {
  const actor = async nivel => {
    const created = await U.criarUsuario({ email: `qa-reservation-${nivel}@example.test`, nome: "QA Documento", nivel, senha: "Ficticia-Reserva-Compilada-2026" }); assert.ok(created.ok);
    const token = (await U.abrirSessao(created.usuario.id, "127.0.0.1")).token; tokens.push(token); return { id: created.usuario.id, email: created.usuario.email, token };
  };
  const total = await actor("total"), editor = await actor("edicao"), reader = await actor("leitura");
  const id = await seed(1), untouched = await seed(2);
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,confirmed_at) VALUES('QA Signer Unchanged','qa-signer@example.test','QA-EMAIL-HASH','QA-CPF-HASH','apoiador','QA',now(),'confirmed',now())");
  const proof = async () => ({ signers: (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows, untouched: await row(untouched) });
  const before = await proof(), initial = await row(id);
  assert.equal((await post(id, "codigo", null)).status, 401);
  for (const user of [reader, editor]) for (const action of ["codigo", "aprovar", "cancelar"]) assert.equal((await post(id, action, user, { code: "000000" })).status, 403);
  assert.equal((await post(id, "codigo", total)).status, 403);
  assert.deepEqual(await row(id), initial);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [total.id]);
  const requested = await post(id, "codigo", total); assert.equal(requested.status, 303); assert.equal(locationMessage(requested), "Código enviado ao aprovador.");
  const codeMail = (await messages()).find(mail => mail.to === "qa-president@example.test" && mail.subject.includes("lote 1:"));
  const code = /Código de aprovação do lote 1: (\d{6})/.exec(codeMail?.text ?? "")?.[1]; assert.ok(code);
  const beforeExternal = await row(id);
  assert.equal((await post(id, "aprovar", total, { code }, "https://other.example.test")).status, 403);
  assert.deepEqual(await row(id), beforeExternal);
  const wrong = code === "000000" ? "999999" : "000000", invalid = await post(id, "aprovar", total, { code: wrong });
  assert.equal(invalid.status, 303); assert.equal(locationMessage(invalid), "Código incorreto.");
  assert.equal((await db.query("SELECT approved_at FROM batches WHERE id=$1", [id])).rows[0].approved_at, null);
  const replies = await Promise.all([post(id, "aprovar", total, { code, approvedBy: "forged@example.test", userId: "99999" }), post(id, "aprovar", total, { code })]);
  assert.ok(replies.every(response => response.status === 303));
  assert.equal(replies.filter(response => locationMessage(response) === "Enviado a 1 destinatário(s).").length, 1);
  const delivered = (await messages()).filter(mail => mail.to === "qa-authority@example.test" && mail.attachments?.length);
  assert.equal(delivered.length, 1); assert.equal(delivered[0].attachments[0].sha256, pdfHash);
  const approved = (await db.query("SELECT status,approved_by,pdf,pdf_sha256,approval_code_hash FROM batches WHERE id=$1", [id])).rows[0];
  assert.equal(approved.status, "sent"); assert.equal(approved.approved_by, "qa-president@example.test"); assert.equal(approved.approval_code_hash, null); assert.equal(approved.pdf_sha256, pdfHash); assert.deepEqual(approved.pdf, pdf);
  const approvals = (await db.query("SELECT data FROM audit_log WHERE event='batch_approved'")).rows.map(r => JSON.parse(r.data));
  assert.equal(approvals.length, 1); assert.equal(approvals[0].userId, total.id); assert.equal(approvals[0].por, total.email); assert.equal(approvals[0].approvedBy, "qa-president@example.test");
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE m.kind='lote' AND a.state='accepted'")).rows[0].n, 1);
  const settled = await row(id), fileCount = (await messages()).length;
  assert.equal((await post(id, "aprovar", total, { code })).status, 303);
  assert.equal((await post(id, "cancelar", total)).status, 303); assert.equal(locationMessage(await post(id, "codigo", total)), "Lote não está pronto para aprovação.");
  assert.deepEqual(await row(id), settled); assert.equal((await messages()).length, fileCount);
  const cancellable = await seed(3), cancellationBefore = await row(cancellable);
  await db.query("CREATE FUNCTION qa_compiled_cancel_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_cancelled' THEN RAISE EXCEPTION 'QA expected cancel audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_compiled_cancel_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_compiled_cancel_fault()");
  try { assert.equal((await post(cancellable, "cancelar", total)).status, 500); assert.deepEqual(await row(cancellable), cancellationBefore); }
  finally { await db.query("DROP TRIGGER qa_compiled_cancel_fault ON audit_log; DROP FUNCTION qa_compiled_cancel_fault()"); }
  assert.equal(locationMessage(await post(cancellable, "cancelar", total)), "Lote cancelado.");
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='batch_cancelled'")).rows[0].n, 1);
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [total.id]);
  assert.equal((await post(untouched, "codigo", total)).status, 403);
  assert.equal((await post(untouched, "cancelar", total)).status, 403);
  assert.deepEqual(await proof(), before); assert.ok((await db.verifyAuditChain()).ok);
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
  const report = { ok: true, compiledHttp: true, roleStepupAndOrigin: true, correctCodeRequired: true, concurrentApprovalOnce: true, attachmentHashPreserved: true, currentActorAudited: true, approverPreserved: true, duplicateCannotResend: true, approvedDocumentFrozen: true, cancellationAuditRollback: true, revokedRoleRejected: true, signaturesAndOtherDocumentPreserved: true, developmentMailOnly: true, noRetryQueue: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/batch-reservation.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
