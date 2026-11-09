import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const DOMAIN = "qa-federal.example";
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const users = await import("./admin-users"), M = await import("./admin-domain-catalog"), I = await import("./institutional");
  const created = await users.criarUsuario({ email: "qa-catalog@example.test", nome: "QA Operator", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(created.ok);
  const session = await users.abrirSessao(created.usuario.id, "127.0.0.1"), actor = (await users.sessaoPorToken(session.token))!;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  await db.query("INSERT INTO institutional_domains(domain,kind,institution,status,evidence_url,decided_by,source) VALUES($1,'ifes','QA Effective','approved','https://effective.example/evidence','QA Original','manual'),('rejected.qa-federal.example','outro',NULL,'rejected',NULL,'QA Original','manual')", [DOMAIN]);
  I._clearDomainCache();
  const input = (operation: "edit" | "archive" | "restore", version = "1", extra = {}) => ({ domain: DOMAIN, operation, version, requestId: randomUUID(), ...(operation === "edit" ? { metadata: { label: "QA Administrative", evidenceUrl: "https://admin.example/evidence" } } : {}), ...extra });
  const snapshot = async () => (await db.query("SELECT domain,kind,institution,source,status,seen_count,evidence_url,decided_by,created_at,updated_at,acronym,country FROM institutional_domains ORDER BY domain")).rows;
  return { db, users, M, I, actor, token: session.token, input, snapshot };
}

test("administrative overlay and archive preserve effective decision, unknown values, caches, precedence and signer metadata", async () => {
  const c = await setup("t_domain_catalog_preserve");
  try {
    await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,email_domain_kind,email_domain,email_institution) VALUES('QA Pessoa','qa@qa-federal.example','QA-HASH','servidor','QA',now(),'confirmed','ifes',$1,'QA Effective')", [DOMAIN]);
    await c.db.query("UPDATE institutional_domains SET admin_catalog='{\"futureKey\":{\"unknown\":null}}'::jsonb WHERE domain=$1", [DOMAIN]);
    const before = await c.snapshot(), signer = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows;
    const cache = await c.I.approvedDomains(); assert.equal(await c.I.institutionalKind("qa@" + DOMAIN), "ifes"); assert.equal(await c.I.institutionalKind("qa@rejected." + DOMAIN), null);
    const edit = await c.M.manageDomainCatalog(c.input("edit"), c.actor); assert.ok(edit.ok); assert.deepEqual(edit.row.metadata.futureKey, { unknown: null });
    const archived = await c.M.manageDomainCatalog(c.input("archive", "2"), c.actor); assert.ok(archived.ok);
    assert.equal(await c.I.approvedDomains(), cache, "Administrative catalog must not clear or replace effective cache");
    assert.equal(await c.I.institutionalKind("qa@" + DOMAIN), "ifes"); assert.equal(await c.I.institutionalKind("qa@rejected." + DOMAIN), null);
    const list = await c.M.listDomainCatalog(c.actor, { filter: "archived" }); assert.ok(list.ok); assert.equal(list.rows.length, 1); assert.equal(list.rows[0].effective.institution, "QA Effective"); assert.equal(list.rows[0].metadata.label, "QA Administrative");
    const restored = await c.M.manageDomainCatalog(c.input("restore", "3"), c.actor); assert.ok(restored.ok); assert.equal(restored.row.version, "4");
    assert.deepEqual(await c.snapshot(), before); assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows, signer);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { c.I._clearDomainCache(); await c.db._closeDbForTests(); }
});

test("concurrent CAS, original replay and request fingerprint preserve newer overlays", async () => {
  const c = await setup("t_domain_catalog_concurrent");
  try {
    const input = c.input("edit"), results = await Promise.all([c.M.manageDomainCatalog(input, c.actor), c.M.manageDomainCatalog(input, c.actor)]); assert.ok(results[0].ok); assert.deepEqual(results[0], results[1]);
    const pair = await Promise.all([c.M.manageDomainCatalog(c.input("edit", "2", { metadata: { label: "QA Next A", evidenceUrl: null } }), c.actor), c.M.manageDomainCatalog(c.input("archive", "2"), c.actor)]);
    assert.equal(pair.filter(r => r.ok).length, 1); assert.equal(pair.filter(r => !r.ok && r.error === "conflict").length, 1);
    assert.deepEqual(await c.M.manageDomainCatalog(input, c.actor), results[0]); assert.deepEqual(await c.M.manageDomainCatalog({ ...input, operation: "archive", metadata: undefined }, c.actor), { ok: false, error: "conflict" });
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_domain_catalog_requests")).rows[0].n, 2);
  } finally { await c.db._closeDbForTests(); }
});

test("account, identity, role and current session confirmation protect both original requests and replay", async () => {
  const c = await setup("t_domain_catalog_auth");
  try {
    const input = c.input("archive"), accepted = await c.M.manageDomainCatalog(input, c.actor); assert.ok(accepted.ok);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.deepEqual(await c.M.manageDomainCatalog(input, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [c.actor.sessaoId]);
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.manageDomainCatalog(input, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='total',ativo=false WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.listDomainCatalog(c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.manageDomainCatalog(input, { ...c.actor, email: "wrong@example.test" }), { ok: false, error: "forbidden" });
    await c.users.encerrarSessao(c.token); assert.deepEqual(await c.M.manageDomainCatalog(input, c.actor), { ok: false, error: "forbidden" });
  } finally { await c.db._closeDbForTests(); }
});

test("audit failure rolls back overlay, archive, version and intention", async () => {
  const c = await setup("t_domain_catalog_audit");
  try {
    const before = (await c.db.query("SELECT row_to_json(d)::text raw FROM institutional_domains d ORDER BY domain")).rows;
    await c.db.query("CREATE FUNCTION fail_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_domain_catalog_managed' THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_catalog_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_catalog_audit()");
    await assert.rejects(c.M.manageDomainCatalog(c.input("archive"), c.actor), /QA audit failure/);
    assert.deepEqual((await c.db.query("SELECT row_to_json(d)::text raw FROM institutional_domains d ORDER BY domain")).rows, before); assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_domain_catalog_requests")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("input is metadata-only and evidence URLs are parsed without fetching or accepting executable schemes", async () => {
  const c = await setup("t_domain_catalog_input");
  try {
    for (const evidenceUrl of ["javascript:alert(1)", "file:///tmp/qa", "https://user:password@example.test", "not-url"]) assert.deepEqual(await c.M.manageDomainCatalog(c.input("edit", "1", { metadata: { label: "QA Valid", evidenceUrl } }), c.actor), { ok: false, error: "invalid" });
    assert.deepEqual(await c.M.manageDomainCatalog(c.input("edit", "1", { metadata: { label: "QA Valid", evidenceUrl: null, status: "approved" } }), c.actor), { ok: false, error: "invalid" });
    assert.deepEqual(await c.M.manageDomainCatalog(c.input("edit", "1", { domain: "missing.example" }), c.actor), { ok: false, error: "not_found" });
    assert.deepEqual(await c.M.manageDomainCatalog(c.input("restore"), c.actor), { ok: false, error: "conflict" });
    const accepted = await c.M.manageDomainCatalog(c.input("edit", "1", { metadata: { label: null, evidenceUrl: "http://evidence.example/source" } }), c.actor); assert.ok(accepted.ok);
  } finally { await c.db._closeDbForTests(); }
});

test("existing domain writers can update counters/decisions without resetting overlay or turning archive into revocation", async () => {
  const c = await setup("t_domain_catalog_existing_writers");
  try {
    await c.M.manageDomainCatalog(c.input("edit"), c.actor);
    await c.M.manageDomainCatalog(c.input("archive", "2"), c.actor);
    const before = (await c.db.query("SELECT admin_catalog,admin_catalog_version,admin_archived_at FROM institutional_domains WHERE domain=$1", [DOMAIN])).rows;
    await c.I.decideDomain(DOMAIN, "rejected", { kind: "outro", institution: "QA Decision Changed", by: c.actor.email, actor: c.actor });
    assert.deepEqual((await c.db.query("SELECT admin_catalog,admin_catalog_version,admin_archived_at FROM institutional_domains WHERE domain=$1", [DOMAIN])).rows, before);
    const listed = await c.M.listDomainCatalog(c.actor, { filter: "archived" }); assert.ok(listed.ok); assert.equal(listed.rows[0].effective.status, "rejected"); assert.equal(listed.rows[0].metadata.label, "QA Administrative");
    await c.M.manageDomainCatalog(c.input("restore", "3"), c.actor);
    assert.equal((await c.db.query("SELECT status FROM institutional_domains WHERE domain=$1", [DOMAIN])).rows[0].status, "rejected");
    await c.db.query("INSERT INTO institutional_domains(domain,status,source,admin_catalog) VALUES('qa-pending.example','pending','visitante','{\"label\":\"QA Preserve\"}')");
    await c.I.notePendingDomain("qa-pending.example");
    const pending = (await c.db.query("SELECT seen_count,admin_catalog,admin_catalog_version FROM institutional_domains WHERE domain='qa-pending.example'")).rows[0]; assert.equal(pending.seen_count, 1); assert.equal(pending.admin_catalog.label, "QA Preserve"); assert.equal(pending.admin_catalog_version, "1");
  } finally { c.I._clearDomainCache(); await c.db._closeDbForTests(); }
});

test("catalog HTTP keeps effective fields immutable, enforces origin/role and separates filtered pages", async () => {
  const c = await setup("t_domain_catalog_http");
  try {
    const { NextRequest } = await import("next/server"), api = await import("../app/api/admin/dominios/catalogo/route");
    const request = (body: unknown, auth = true, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/dominios/catalogo", { method: "POST", headers: { host: "localhost", origin, cookie: auth ? `adm=${c.token}` : "", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await api.POST(request(c.input("edit"), false))).status, 401);
    assert.equal((await api.POST(request(c.input("edit"), true, "http://other.test"))).status, 403);
    for (const forbidden of ["status", "kind", "institution", "source"]) assert.equal((await api.POST(request({ ...c.input("edit"), [forbidden]: "changed" }))).status, 400);
    assert.equal((await api.POST(request({ ...c.input("edit"), metadata: { label: "x".repeat(5000), evidenceUrl: null } }))).status, 413);
    const original = c.input("edit"), response = await api.POST(request(original)); assert.equal(response.status, 200); const result = await response.json(); assert.deepEqual(await (await api.POST(request(original))).json(), result);
    assert.equal((await api.POST(request({ ...original, metadata: { label: "QA Different", evidenceUrl: null } }))).status, 409);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.equal((await api.POST(request(c.input("archive", "2")))).status, 403);
    const read = (query: string) => api.GET(new NextRequest("http://localhost/api/admin/dominios/catalogo?" + query, { headers: { host: "localhost", cookie: `adm=${c.token}` } }));
    const first = await read("filter=all&limit=1"); assert.equal(first.status, 200); const page = await first.json(); assert.equal(page.rows.length, 1); assert.ok(page.nextAfter); assert.ok(page.rows[0].effective);
    const next = await (await read("filter=all&limit=1&after=" + encodeURIComponent(page.nextAfter))).json(); assert.notEqual(next.rows[0].domain, page.rows[0].domain);
    assert.equal((await read("filter=all&limit=101")).status, 400);
  } finally { await c.db._closeDbForTests(); }
});
