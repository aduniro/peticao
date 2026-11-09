import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const users = await import("./admin-users"), M = await import("./admin-referral-management");
  const created = await users.criarUsuario({ email: "qa-management@example.test", nome: "QA Operator", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(created.ok);
  const session = await users.abrirSessao(created.usuario.id, "127.0.0.1"), actor = (await users.sessaoPorToken(session.token))!;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  const row = (await db.query("INSERT INTO referrers(code,manage_token_hash,label) VALUES('ABCDEFG','QA-SECRET-TOKEN-HASH','QA Original') RETURNING id")).rows[0];
  const input = (operation: "edit" | "archive" | "restore", version = "1", extra = {}) => ({ id: row.id, operation, version, requestId: randomUUID(), ...(operation === "edit" ? { label: "QA Alterado" } : {}), ...extra });
  return { db, users, M, actor, token: session.token, row, input };
}

test("label edit, archive and restoration preserve links, tokens, attribution and historical counts", async () => {
  const c = await setup("t_referral_manage_lifecycle");
  try {
    const ref = await import("./referrals");
    const s = (await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,ref_code) VALUES('QA Pessoa','qa@example.test','QA-HASH','apoiador','QA',now(),'confirmed','ABCDEFG') RETURNING id")).rows[0];
    const before = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows;
    const initial = await ref.referrerStats("ABCDEFG");
    const edit = await c.M.manageAdministrativeReferral(c.input("edit"), c.actor); assert.ok(edit.ok); assert.equal(edit.row.version, "2");
    const archived = await c.M.manageAdministrativeReferral(c.input("archive", "2"), c.actor); assert.ok(archived.ok); assert.ok(archived.row.archivedAt);
    assert.equal((await c.M.listAdministrativeReferrals(c.actor)).ok, true);
    const active = await c.M.listAdministrativeReferrals(c.actor), hidden = await c.M.listAdministrativeReferrals(c.actor, { filter: "archived" });
    assert.ok(active.ok && hidden.ok); assert.equal(active.rows.length, 0); assert.equal(hidden.rows.length, 1);
    assert.ok(await ref.referrerByCode("ABCDEFG")); assert.equal((await ref.allReferrerStats()).length, 1); assert.deepEqual(await ref.referrerStats("ABCDEFG"), initial);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows, before);
    const restored = await c.M.manageAdministrativeReferral(c.input("restore", "3"), c.actor); assert.ok(restored.ok); assert.equal(restored.row.version, "4"); assert.equal(restored.row.archivedAt, null);
    assert.equal((await c.db.query("SELECT manage_token_hash FROM referrers WHERE id=$1", [c.row.id])).rows[0].manage_token_hash, "QA-SECRET-TOKEN-HASH");
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 3); assert.ok((await c.db.verifyAuditChain()).ok);
    const audit = JSON.stringify((await c.db.query("SELECT data FROM audit_log WHERE event='admin_referral_managed'")).rows); assert.ok(!audit.includes("QA-SECRET-TOKEN-HASH"));
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0); assert.ok(s.id);
  } finally { await c.db._closeDbForTests(); }
});

test("same intent replays exact result after later edits; conflicting reuse and concurrent stale versions cannot overwrite", async () => {
  const c = await setup("t_referral_manage_concurrent");
  try {
    const one = c.input("edit"); const pair = await Promise.all([c.M.manageAdministrativeReferral(one, c.actor), c.M.manageAdministrativeReferral(one, c.actor)]); assert.ok(pair[0].ok); assert.deepEqual(pair[0], pair[1]);
    const later = await c.M.manageAdministrativeReferral(c.input("edit", "2", { label: "QA Mais Novo" }), c.actor); assert.ok(later.ok);
    assert.deepEqual(await c.M.manageAdministrativeReferral(one, c.actor), pair[0]);
    assert.deepEqual(await c.M.manageAdministrativeReferral({ ...one, label: "QA Divergente" }, c.actor), { ok: false, error: "conflict" });
    const competing = await Promise.all([c.M.manageAdministrativeReferral(c.input("edit", "3", { label: "QA Concorrente A" }), c.actor), c.M.manageAdministrativeReferral(c.input("edit", "3", { label: "QA Concorrente B" }), c.actor)]);
    assert.equal(competing.filter(r => r.ok).length, 1); assert.equal(competing.filter(r => !r.ok && r.error === "conflict").length, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 3);
  } finally { await c.db._closeDbForTests(); }
});

test("revoked accounts, identity, session, stepup and archival roles are rechecked before mutation or replay", async () => {
  const c = await setup("t_referral_manage_authorization");
  try {
    const input = c.input("archive");
    assert.deepEqual(await c.M.manageAdministrativeReferral(input, { ...c.actor, email: "wrong@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.deepEqual(await c.M.manageAdministrativeReferral(input, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [c.actor.sessaoId]);
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.manageAdministrativeReferral(input, c.actor), { ok: false, error: "forbidden" });
    const edited = await c.M.manageAdministrativeReferral(c.input("edit"), c.actor); assert.ok(edited.ok);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.listAdministrativeReferrals(c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]); await c.users.encerrarSessao(c.token); assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("edit", "2"), c.actor), { ok: false, error: "forbidden" });
  } finally { await c.db._closeDbForTests(); }
});

test("audit failure rolls back label, version, archive and intention together", async () => {
  const c = await setup("t_referral_manage_rollback");
  try {
    const before = (await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows;
    await c.db.query("CREATE FUNCTION fail_referral_manage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_referral_managed' THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_referral_manage BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_referral_manage()");
    await assert.rejects(c.M.manageAdministrativeReferral(c.input("archive"), c.actor), /QA audit failure/);
    assert.deepEqual((await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows, before); assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("personal referrals are excluded, invalid state and input cannot become arbitrary column edits", async () => {
  const c = await setup("t_referral_manage_validation");
  try {
    const person = (await c.db.query("INSERT INTO referrers(code,display_name) VALUES('HJKMNPQ','QA Pessoa') RETURNING id")).rows[0];
    assert.deepEqual(await c.M.manageAdministrativeReferral({ ...c.input("edit"), id: person.id }, c.actor), { ok: false, error: "not_found" });
    for (const patch of [{ version: "01" }, { version: "9223372036854775808" }, { requestId: "bad" }, { label: "x" }, { label: "a".repeat(81) }]) assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("edit", "1", patch), c.actor), { ok: false, error: "invalid" });
    assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("restore"), c.actor), { ok: false, error: "conflict" });
    const noop = await c.M.manageAdministrativeReferral(c.input("edit", "1", { label: "QA Original" }), c.actor); assert.ok(noop.ok); assert.equal(noop.changed, false); assert.equal(noop.row.version, "1");
    assert.deepEqual(await c.M.listAdministrativeReferrals(c.actor, { filter: "other" as "all" }), { ok: false, error: "invalid" });
  } finally { await c.db._closeDbForTests(); }
});

test("HTTP guards identity/origin/stepup, bounds input and returns conflicts without changing existing creation flow", async () => {
  const c = await setup("t_referral_manage_http");
  try {
    const { NextRequest } = await import("next/server"), api = await import("../app/api/admin/indicacoes/gestao/route");
    const req = (body: unknown, authenticated = true, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/indicacoes/gestao", { method: "POST", headers: { host: "localhost", origin, cookie: authenticated ? `adm=${c.token}` : "", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await api.POST(req(c.input("edit"), false))).status, 401);
    assert.equal((await api.POST(req(c.input("edit"), true, "http://other.test"))).status, 403);
    assert.equal((await api.POST(req({ ...c.input("edit"), code: "HJKMNPQ" }))).status, 400);
    assert.equal((await api.POST(req({ ...c.input("edit"), label: "a".repeat(5000) }))).status, 413);
    const input = c.input("edit"); const first = await api.POST(req(input)); assert.equal(first.status, 200); const content = await first.json();
    assert.deepEqual(await (await api.POST(req(input))).json(), content);
    assert.equal((await api.POST(req({ ...input, label: "QA Different" }))).status, 409);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]);
    assert.equal((await api.POST(req(c.input("archive", "2")))).status, 403);
    const read = await api.GET(new NextRequest("http://localhost/api/admin/indicacoes/gestao?filter=all", { headers: { host: "localhost", cookie: `adm=${c.token}` } })); assert.equal(read.status, 200); assert.equal((await read.json()).rows.length, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("administrative pagination keeps active and archived inventories separate without changing public statistics", async () => {
  const c = await setup("t_referral_manage_pages");
  try {
    await c.db.query("INSERT INTO referrers(code,label) VALUES('HJKMNPQ','QA Segundo'),('RSTUVWX','QA Terceiro')");
    await c.M.manageAdministrativeReferral(c.input("archive"), c.actor);
    const page = await c.M.listAdministrativeReferrals(c.actor, { filter: "all", limit: 2 }); assert.ok(page.ok); assert.equal(page.rows.length, 2); assert.ok(page.nextBefore);
    const next = await c.M.listAdministrativeReferrals(c.actor, { filter: "all", limit: 2, before: page.nextBefore! }); assert.ok(next.ok); assert.equal(next.rows.length, 1); assert.equal(next.nextBefore, null); assert.equal(next.rows[0].id, c.row.id);
    const active = await c.M.listAdministrativeReferrals(c.actor, { filter: "active" }); assert.ok(active.ok); assert.equal(active.rows.length, 2);
    const archived = await c.M.listAdministrativeReferrals(c.actor, { filter: "archived" }); assert.ok(archived.ok); assert.equal(archived.rows.length, 1);
    assert.equal((await (await import("./referrals")).allReferrerStats()).length, 3);
  } finally { await c.db._closeDbForTests(); }
});
