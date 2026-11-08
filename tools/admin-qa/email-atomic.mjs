// Real compiled HTTP routes; isolated fictitious data and no outbound mail.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.ok(process.env.QA_OUTPUT_DIR);
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), sm = await import("../../site/src/lib/security.ts"), mm = await import("../../site/src/lib/email-check.ts");
const db = dm.default ?? dm, U = um.default ?? um, S = sm.default ?? sm, M = mm.default ?? mm, tokens = [];
try {
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
  const actor = async nivel => {
    const r = await U.criarUsuario({ email: `qa-atomic-${nivel}@example.test`, nome: "QA Correção", nivel, senha: "QA-Atomic-Compiled-2026" }); assert.ok(r.ok);
    const token = (await U.abrirSessao(r.usuario.id, "127.0.0.1")).token; tokens.push(token); return { token, id: r.usuario.id };
  };
  const editor = await actor("edicao"), reader = await actor("leitura");
  const make = async n => (await db.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,seq,verify_code,token_hash) VALUES('QA Pessoa Fictícia',$1,$2,$3,'estrangeiro','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',$4,$5,$6) RETURNING id`, [`qa-old-${n}@example.test`, S.hmac(M.dedupEmail(`qa-old-${n}@example.test`)), `QA_CPF_${n}`, n + 700, `QA_VERIFY_${n}`, `QA_TOKEN_${n}`])).rows[0].id;
  const request = async (id, actor, body, origin = base.origin) => {
    const version = (await db.query("SELECT xmin::text version FROM signatures WHERE id=$1", [id])).rows[0]?.version;
    return fetch(new URL(`/api/admin/assinaturas/${id}/email`, base), { method: "PATCH", headers: { origin, cookie: actor ? `adm=${actor.token}` : "", "content-type": "application/json" }, body: JSON.stringify({ version, ...body }) });
  };
  const snapshot = async id => (await db.query("SELECT row_to_json(s)::text value FROM signatures s WHERE id=$1", [id])).rows[0].value;
  const evidence = async id => (await db.query("SELECT id,name,cpf_hash,category,text_version,consent_at,created_at,confirmed_at,seq,verify_code,token_hash FROM signatures WHERE id=$1", [id])).rows[0];
  const id = await make(1), before = await evidence(id);
  assert.equal((await request(id, null, { email: "qa-new@example.test" })).status, 401);
  assert.equal((await request(id, reader, { email: "qa-new@example.test" })).status, 403);
  assert.equal((await request(id, editor, { email: "qa-new@example.test" }, "https://other.invalid")).status, 403);
  assert.equal((await request(id, editor, {})).status, 400);
  const success = await request(id, editor, { email: "qa-new@example.test" }); assert.equal(success.status, 200); assert.equal((await success.json()).email, "qa-new@example.test");
  assert.deepEqual(await evidence(id), before);
  const audit = (await db.query("SELECT data FROM audit_log WHERE event='email_corrigido'")).rows; assert.equal(audit.length, 1); assert.equal(JSON.parse(audit[0].data).userId, editor.id);
  const second = await make(2); assert.equal((await request(second, editor, { email: "qa-new@example.test" })).status, 422);
  await db.query("UPDATE signatures SET status='confirmed',confirmed_at='2026-11-07T12:00:00Z' WHERE id=$1", [second]);
  const confirmed = await snapshot(second); assert.equal((await request(second, editor, { email: "qa-other@example.test" })).status, 422); assert.equal(await snapshot(second), confirmed);
  const conflict = await make(3); let pending;
  await db.tx(async c => {
    await c.query("SELECT id FROM signatures WHERE id=$1 FOR UPDATE", [conflict]);
    pending = request(conflict, editor, { email: "qa-conflict@example.test" });
    const deadline = Date.now() + 10000;
    while (true) {
      await c.query("SELECT pg_stat_clear_snapshot()");
      const waiting = await c.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT status,xmin::text AS version FROM signatures%'");
      if (waiting.rows[0].n > 0) break;
      assert.ok(Date.now() < deadline, "compiled route must reach the locked signer"); await new Promise(resolve => setTimeout(resolve, 25));
    }
    await c.query("UPDATE signatures SET institution='QA alteração concorrente' WHERE id=$1", [conflict]);
  });
  const conflicting = await pending; assert.equal(conflicting.status, 409); assert.equal((await conflicting.json()).code, "conflict");
  assert.equal((await db.query("SELECT email FROM signatures WHERE id=$1", [conflict])).rows[0].email, "qa-old-3@example.test");
  const failed = await make(4), original = await snapshot(failed);
  await db.query("CREATE FUNCTION qa_email_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='email_corrigido' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_email_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_email_audit_failure()");
  assert.equal((await request(failed, editor, { email: "qa-rollback@example.test" })).status, 500); assert.equal(await snapshot(failed), original);
  await db.query("DROP TRIGGER qa_email_audit_failure ON audit_log");
  assert.equal((await db.query("SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_log")).rowCount, 0); assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, compiledHttp: true, actualActors: true, permissions: true, csrf: true, conflict409: true, confirmedPreserved: true, auditAtomic: true, signerEvidencePreserved: true, noMail: true };
  await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true }); await writeFile(`${process.env.QA_OUTPUT_DIR}/email-atomic.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
