import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { readContactDraft, writeContactDraft } from "./contact-drafts";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const input = { assunto: "QA rascunho José", corpo: "QA-PRIVATE-DRAFT: texto parcial\n\nNão enviar." };
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const U = await import("./admin-users");
  const actors = [];
  for (const n of [1, 2]) {
    const user = await U.criarUsuario({ email: `qa-draft-${n}@example.test`, nome: `QA Autor ${n}`, nivel: "total", senha: "Ficticia-Rascunho-2026" }); assert.ok(user.ok);
    actors.push({ userId: user.usuario.id, email: user.usuario.email });
  }
  const contacts = (await db.query("INSERT INTO contact_messages(name,email,kind,message,created_at) VALUES('QA original','qa-contact@example.test','duvida','QA RECEIVED UNCHANGED','2026-11-08T10:00:00.123456Z'),('QA outro','qa-other@example.test','duvida','QA OTHER',now()) RETURNING id")).rows;
  return { db, U, actor: actors[0], other: actors[1], id: contacts[0].id as number, otherId: contacts[1].id as number };
}

test("rascunho compartilhado cifra texto, informa autor/revisão e não altera contato ou envia", async () => {
  const c = await setup("t_draft_shared");
  try {
    const original = (await c.db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows;
    assert.deepEqual(await readContactDraft(c.id, c.actor), { ok: true, draft: { revision: 0, state: "empty", input: null, author: null, updatedAt: null, expiresAt: null } });
    const saved = await writeContactDraft(c.id, 0, input, c.actor); assert.ok(saved.ok); assert.equal(saved.draft.revision, 1);
    const read = await readContactDraft(c.id, c.other); assert.ok(read.ok); assert.deepEqual(read.draft.input, input); assert.equal(read.draft.author, "QA Autor 1");
    const second = await writeContactDraft(c.id, 1, { ...input, corpo: "QA outro autor" }, c.other); assert.ok(second.ok); assert.equal(second.draft.revision, 2); assert.equal(second.draft.author, "QA Autor 2");
    assert.equal(second.draft.expiresAt, saved.draft.expiresAt, "salvar não renova o limite30dias");
    const stored = JSON.stringify((await c.db.query("SELECT * FROM contact_drafts")).rows);
    assert.ok(!stored.includes(input.corpo)); assert.ok(!stored.includes(input.assunto)); assert.match(stored, /v1\./);
    assert.equal((await readContactDraft(c.otherId, c.actor)).ok, true);
    assert.deepEqual((await c.db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows, original);
    assert.equal((await c.db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
    assert.ok(!JSON.stringify((await c.db.query("SELECT data FROM audit_log")).rows).includes("QA-PRIVATE-DRAFT")); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("duas abas não sobrescrevem a mesma revisão e descarte conserva tombstone", async () => {
  const c = await setup("t_draft_concurrent");
  try {
    const results = await Promise.all([writeContactDraft(c.id, 0, input, c.actor), writeContactDraft(c.id, 0, { ...input, corpo: "QA concorrente" }, c.other)]);
    assert.equal(results.filter(r => r.ok).length, 1); assert.ok(results.some(r => !r.ok && r.error === "conflict"));
    assert.deepEqual(await writeContactDraft(c.id, 0, input, c.actor), { ok: false, error: "conflict", revision: 1 });
    const discarded = await writeContactDraft(c.id, 1, null, c.actor); assert.ok(discarded.ok); assert.equal(discarded.draft.state, "discarded"); assert.equal(discarded.draft.input, null); assert.equal(discarded.draft.revision, 2);
    assert.equal((await c.db.query("SELECT content_cipher FROM contact_drafts")).rows[0].content_cipher, null);
    assert.deepEqual(await writeContactDraft(c.id, 1, input, c.other), { ok: false, error: "conflict", revision: 2 });
    const next = await writeContactDraft(c.id, 2, input, c.other); assert.ok(next.ok); assert.equal(next.draft.revision, 3);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_drafts")).rows[0].n, 1); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("autoria atual e auditoria são obrigatórias: falhas revertem cifra, revisão e descarte", async () => {
  const c = await setup("t_draft_rollback");
  try {
    assert.ok((await writeContactDraft(c.id, 0, input, c.actor)).ok);
    const snapshot = async () => (await c.db.query("SELECT row_to_json(d)::text raw FROM contact_drafts d")).rows;
    const before = await snapshot();
    await c.db.query("CREATE FUNCTION qa_draft_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('contact_draft_saved','contact_draft_discarded') THEN RAISE EXCEPTION 'QA draft audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_draft_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_draft_audit_fault()");
    await assert.rejects(writeContactDraft(c.id, 1, { ...input, corpo: "QA edit" }, c.actor), /QA draft audit fault/); assert.deepEqual(await snapshot(), before);
    await assert.rejects(writeContactDraft(c.id, 1, null, c.actor), /QA draft audit fault/); assert.deepEqual(await snapshot(), before);
    await c.db.query("DROP TRIGGER qa_draft_audit_fault ON audit_log");
    for (const change of ["nivel='edicao'", "nivel='total',ativo=false"]) {
      await c.db.query(`UPDATE admin_users SET ${change} WHERE id=$1`, [c.actor.userId]);
      assert.deepEqual(await readContactDraft(c.id, c.actor), { ok: false, error: "forbidden" });
      assert.deepEqual(await writeContactDraft(c.id, 1, null, c.actor), { ok: false, error: "forbidden" });
    }
    assert.deepEqual(await writeContactDraft(c.id, 1, null, { ...c.other, email: "forged@example.test" }), { ok: false, error: "forbidden" }); assert.deepEqual(await snapshot(), before);
  } finally { await c.db._closeDbForTests(); }
});

test("expiração oculta corpo antes do cron, expurga atomicamente e exige nova revisão", async () => {
  const c = await setup("t_draft_expiry");
  try {
    const R = await import("./admin-content-retention"); assert.ok((await writeContactDraft(c.id, 0, input, c.actor)).ok);
    await c.db.query("UPDATE contact_drafts SET expires_at=now()-interval '1 second' WHERE contact_id=$1", [c.id]);
    const expired = await readContactDraft(c.id, c.actor); assert.ok(expired.ok); assert.equal(expired.draft.state, "expired"); assert.equal(expired.draft.input, null);
    await c.db.query("CREATE FUNCTION qa_draft_expiry_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_content_expired' THEN RAISE EXCEPTION 'QA draft expiry fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_draft_expiry_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_draft_expiry_fault()");
    await assert.rejects(R.purgeAdminContent(), /QA draft expiry fault/); assert.ok((await c.db.query("SELECT content_cipher FROM contact_drafts")).rows[0].content_cipher);
    await c.db.query("DROP TRIGGER qa_draft_expiry_fault ON audit_log");
    assert.equal((await R.purgeAdminContent()).drafts, 1); assert.equal((await R.purgeAdminContent()).drafts, 0);
    assert.equal((await c.db.query("SELECT content_cipher FROM contact_drafts")).rows[0].content_cipher, null);
    assert.deepEqual(await writeContactDraft(c.id, 1, input, c.other), { ok: false, error: "conflict", revision: 2 });
    const renewed = await writeContactDraft(c.id, 2, input, c.other); assert.ok(renewed.ok); assert.equal(renewed.draft.revision, 3);
    const delta = Date.parse(renewed.draft.expiresAt!) - Date.now(); assert.ok(delta > 29.99 * 86400000 && delta <= 30 * 86400000);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("falha de decifragem conserva a cifra e distingue rascunho indisponível de vazio", async () => {
  const c = await setup("t_draft_unavailable");
  try {
    assert.ok((await writeContactDraft(c.id, 0, input, c.actor)).ok);
    await c.db.query("UPDATE contact_drafts SET content_cipher='QA-CIPHER-UNAVAILABLE' WHERE contact_id=$1", [c.id]);
    const before = (await c.db.query("SELECT row_to_json(d)::text raw FROM contact_drafts d")).rows;
    const result = await readContactDraft(c.id, c.actor); assert.ok(result.ok); assert.equal(result.draft.state, "unavailable"); assert.equal(result.draft.input, null); assert.equal(result.draft.revision, 1);
    assert.deepEqual((await c.db.query("SELECT row_to_json(d)::text raw FROM contact_drafts d")).rows, before);
    assert.equal((await c.db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("API de rascunho exige sessão/Total/stepup/origem, limita corpo e não aceita autor do cliente", async () => {
  const c = await setup("t_draft_http");
  try {
    const route = await import("../app/api/admin/contato/rascunho/route"), token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    const req = (body?: string, cookie = `adm=${token}`, origin = "http://localhost", qs = `contato=${c.id}`) => new NextRequest(`http://localhost/api/admin/contato/rascunho?${qs}`, { method: body === undefined ? "GET" : "POST", headers: { host: "localhost", origin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });
    assert.equal((await route.GET(req(undefined, ""))).status, 401); assert.equal((await route.GET(req())).status, 403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.actor.userId]);
    assert.equal((await route.GET(req(undefined, undefined, "https://elsewhere.example.test"))).status, 403);
    for (const qs of ["", "contato=01", `contato=${c.id}&contato=${c.id}`, `contato=${c.id}&payload=1`]) assert.equal((await route.GET(req(undefined, undefined, undefined, qs))).status, 400);
    const response = await route.POST(req(JSON.stringify({ contactId: c.id, revision: 0, input }))); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal((await route.POST(req(JSON.stringify({ contactId: c.id, revision: 0, input })))).status, 409);
    assert.equal((await route.POST(req(JSON.stringify({ contactId: c.id, revision: 1, input, userId: c.other.userId })))).status, 400);
    assert.equal((await route.POST(req("x".repeat(32769)))).status, 413);
    const data = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='contact_draft_saved'")).rows[0].data); assert.equal(data.userId, c.actor.userId);
    await c.db.query("CREATE FUNCTION qa_draft_read_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contact_draft_read' THEN RAISE EXCEPTION 'QA draft read fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_draft_read_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_draft_read_fault()");
    const failed = await route.GET(req()); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes(input.corpo));
    assert.equal((await c.db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});
