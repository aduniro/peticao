import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
delete process.env.ADMIN_NO_PASSWORD; delete process.env.PREVIEW_MODE;
async function setup() {
  const db = await import("./db"); await db._openForTests("t_email_editor_version");
  const U = await import("./admin-users"), E = await import("./assinaturas-email");
  const actor = await U.criarUsuario({ email: "editor-version@example.test", nome: "Editor QA", nivel: "edicao", senha: "QA-Version-Editor-2026" }); assert.ok(actor.ok);
  const id = (await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,seq,verify_code) VALUES('Pessoa QA','old@example.test','QA-OLD-HASH','QA-CPF-HASH','estrangeiro','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',801,'QA-CODE') RETURNING id")).rows[0].id;
  const version = async () => (await db.query("SELECT xmin::text version FROM signatures WHERE id=$1", [id])).rows[0].version as string;
  return { db, U, E, id, version, actor: { userId: actor.usuario.id, email: actor.usuario.email } };
}

test("versão apresentada ao editor impede sobrescrever mudança anterior à chamada", async () => {
  const c = await setup();
  try {
    const oldVersion = await c.version();
    await c.db.query("UPDATE signatures SET institution='QA versão mais recente' WHERE id=$1", [c.id]);
    const latest = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s WHERE id=$1", [c.id])).rows;
    const result = await c.E.corrigirEmail(c.id, "new@example.test", c.actor, oldVersion);
    assert.deepEqual(result, { ok: false, erro: "Não foi possível salvar.", code: "conflict" });
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s WHERE id=$1", [c.id])).rows, latest);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='email_corrigido'")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("lista leva a versão lida e cada salvamento devolve a próxima versão", async () => {
  const c = await setup();
  try {
    await c.db.query("INSERT INTO mail_log(ts,kind,provider,to_addr,status) VALUES('2000-01-01T00:00:00Z','geral','dev','metadata@example.test','failed')");
    const { semEmailEntregue } = await import("./mail/painel");
    const listed = (await semEmailEntregue()).find(r => r.id === c.id); assert.ok(listed);
    assert.equal(listed.version, await c.version());
    const evidence = async () => (await c.db.query("SELECT id,name,cpf_hash,category,consent_at,created_at,confirmed_at,seq,verify_code FROM signatures WHERE id=$1", [c.id])).rows;
    const before = await evidence();
    const first = await c.E.corrigirEmail(c.id, "first@example.test", c.actor, listed.version); assert.ok(first.ok);
    assert.equal(first.version, await c.version()); assert.notEqual(first.version, listed.version);
    const second = await c.E.corrigirEmail(c.id, "second@example.test", c.actor, first.version); assert.ok(second.ok);
    assert.equal(second.version, await c.version()); assert.notEqual(second.version, first.version);
    assert.deepEqual(await evidence(), before);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("API exige a versão da página e devolve409 para rascunho obsoleto", async () => {
  const c = await setup();
  try {
    const { NextRequest } = await import("next/server");
    const { PATCH } = await import("../app/api/admin/assinaturas/[id]/email/route");
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    let ip = 10;
    const request = (body: unknown) => new NextRequest(`http://localhost/api/admin/assinaturas/${c.id}/email`, { method: "PATCH", headers: { host: "localhost", origin: "http://localhost", cookie: `adm=${token}`, "content-type": "application/json", "x-forwarded-for": `10.31.0.${ip++}` }, body: JSON.stringify(body) });
    const params = { params: { id: String(c.id) } };
    for (const version of [undefined, "", 1, "-1", "1;DROP", "99999999999"]) assert.equal((await PATCH(request({ email: "new@example.test", version }), params)).status, 409);
    const oldVersion = await c.version();
    await c.db.query("UPDATE signatures SET email='other-editor@example.test' WHERE id=$1", [c.id]);
    assert.equal((await PATCH(request({ email: "stale@example.test", version: oldVersion }), params)).status, 409);
    assert.equal((await c.db.query("SELECT email FROM signatures WHERE id=$1", [c.id])).rows[0].email, "other-editor@example.test");
    const fresh = await PATCH(request({ email: "fresh@example.test", version: await c.version() }), params); assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).version, await c.version());
  } finally { await c.db._closeDbForTests(); }
});

test("sugestões em lote preservam linha obsoleta e aplicam somente a versão atual", async () => {
  const c = await setup();
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async d => d === "unir.bf" ? "none" : "ok");
  try {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("../app/api/admin/assinaturas/lote/route");
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    const second = (await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,created_at) VALUES('Pessoa QA Dois','qa-fresh@unir.bf','QA-SECOND-HASH','estrangeiro','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z') RETURNING id,xmin::text version")).rows[0];
    const request = (body: unknown) => new NextRequest("http://localhost/api/admin/assinaturas/lote", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: `adm=${token}`, "content-type": "application/json", "x-forwarded-for": "10.31.1.1" }, body: JSON.stringify(body) });
    assert.equal((await POST(request({ acao: "sugestoes", ids: [c.id, second.id] }))).status, 409);
    const versions = { [c.id]: await c.version(), [second.id]: second.version };
    await c.db.query("UPDATE signatures SET institution='QA edição posterior' WHERE id=$1", [c.id]);
    const before = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s WHERE id=$1", [c.id])).rows;
    const response = await POST(request({ acao: "sugestoes", ids: [c.id, second.id], versions })); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.aplicados, 1); assert.equal(result.falhas, 1);
    assert.equal(result.resultados[0].r.code, "conflict"); assert.equal(result.resultados[1].r.email, "qa-fresh@unir.br");
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s WHERE id=$1", [c.id])).rows, before);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { _setMxResolverForTests(null); await c.db._closeDbForTests(); }
});
