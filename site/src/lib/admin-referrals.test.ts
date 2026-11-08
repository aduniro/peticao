import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const U = await import("./admin-users");
  const user = await U.criarUsuario({ email: "qa-referral-editor@example.test", nome: "QA Referral Editor", nivel: "edicao", senha: "QA-Referral-Strong-2026" });
  assert.ok(user.ok);
  return { db, U, actor: { userId: user.usuario.id, email: user.usuario.email }, create: (await import("./admin-referrals")).createAdministrativeReferrer };
}

test("administrative referral and its named audit commit together without signer or mail writes", async () => {
  const c = await setup("t_admin_referrals_success");
  try {
    const result = await c.create("  QA Canal  ", c.actor); assert.ok(result.ok);
    const referrer = (await c.db.query("SELECT code,label,manage_token_hash,signature_id FROM referrers")).rows[0];
    assert.equal(referrer.code, result.code); assert.equal(referrer.label, "QA Canal"); assert.equal(referrer.signature_id, null);
    assert.match(referrer.manage_token_hash, /^[a-f0-9]{64}$/);
    const event = (await c.db.query("SELECT data FROM audit_log WHERE event='referrer_created'")).rows[0];
    assert.deepEqual(JSON.parse(event.data), { code: result.code, label: "QA Canal", por: c.actor.email, userId: c.actor.userId });
    assert.ok(!event.data.includes(referrer.manage_token_hash)); assert.ok((await c.db.verifyAuditChain()).ok);
    assert.equal((await c.db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("failed audit rolls back the referral instead of leaving an unaudited code", async () => {
  const c = await setup("t_admin_referrals_audit");
  try {
    await c.db.query("CREATE FUNCTION fail_referral_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='referrer_created' THEN RAISE EXCEPTION 'QA audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_referral_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_referral_audit()");
    await assert.rejects(c.create("QA Rollback", c.actor), /QA audit unavailable/);
    assert.equal((await c.db.query("SELECT 1 FROM referrers")).rowCount, 0);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='referrer_created'")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("current account, role and identity are rechecked before referral allocation", async () => {
  const c = await setup("t_admin_referrals_revoked");
  try {
    assert.deepEqual(await c.create("QA Wrong Actor", { ...c.actor, email: "other@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.create("QA Downgraded", c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='edicao',ativo=false WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.create("QA Disabled", c.actor), { ok: false, error: "forbidden" });
    assert.equal((await c.db.query("SELECT 1 FROM referrers")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("code collision retries inside a valid transaction and creates exactly one audit", async () => {
  const c = await setup("t_admin_referrals_collision");
  try {
    await c.db.query("INSERT INTO referrers(code,manage_token_hash,label) VALUES('ABCDEFG','QA-existing-hash','QA Existing')");
    let attempts = 0;
    const result = await c.create("QA New", c.actor, { code: () => ++attempts === 1 ? "ABCDEFG" : "HJKMNPQ" });
    assert.ok(result.ok); assert.equal(result.code, "HJKMNPQ"); assert.equal(attempts, 2);
    assert.equal((await c.db.query("SELECT 1 FROM referrers")).rowCount, 2);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='referrer_created'")).rowCount, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("referral HTTP keeps existing redirect and messages while denying anonymous and reading accounts", async () => {
  const c = await setup("t_admin_referrals_http");
  try {
    const { NextRequest } = await import("next/server"), { POST } = await import("../app/api/admin/indicacoes/route"), { ADMIN_COOKIE } = await import("./admin");
    const { token } = await c.U.abrirSessao(c.actor.userId, "127.0.0.1");
    const request = (authenticated: boolean, label: string, requestId: string = randomUUID()) => new NextRequest("http://localhost/api/admin/indicacoes", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: authenticated ? `${ADMIN_COOKIE}=${token}` : "", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ label, requestId }) });
    assert.equal((await POST(request(false, "QA Anonymous"))).status, 401);
    const invalid = await POST(request(true, "x")); assert.equal(invalid.status, 303);
    assert.equal(new URL(invalid.headers.get("location")!).searchParams.get("msg"), "Informe um nome para o código (ex.: Sindicato X).");
    assert.equal((await POST(request(true, "QA HTTP", ""))).status, 400);
    const requestId = randomUUID();
    const result = await POST(request(true, "QA HTTP", requestId)); assert.equal(result.status, 303);
    assert.match(new URL(result.headers.get("location")!).searchParams.get("msg")!, /^Código criado: [2-9A-HJKMNP-Z]{7}$/);
    assert.equal(new URL(result.headers.get("location")!).searchParams.get("completedRequestId"), requestId);
    const before = (await c.db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q")).rows;
    const replay = await Promise.all([POST(request(true, "QA HTTP", requestId)), POST(request(true, "QA HTTP", requestId))]);
    assert.ok(replay.every(r => r.headers.get("location") === result.headers.get("location")));
    assert.equal((await POST(request(true, "QA Different", requestId))).status, 409);
    assert.deepEqual((await c.db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q")).rows, before);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='referrer_created'")).rowCount, 1);
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]);
    assert.equal((await POST(request(true, "QA Reader"))).status, 403);
    assert.equal((await c.db.query("SELECT 1 FROM referrers")).rowCount, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("mesma intenção concorrente cria um único código e não renova os metadados na repetição", async () => {
  const c = await setup("t_admin_referrals_intent");
  const requestId = "00000000-0000-4000-8000-000000000001";
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () => c.create("QA Same Intent", c.actor, { requestId })));
    assert.ok(results.every(r => r.ok));
    const good = results.filter(r => r.ok); assert.equal(new Set(good.map(r => r.code)).size, 1);
    assert.equal(good.filter(r => !r.existing).length, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM referrers")).rows[0].n, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='referrer_created'")).rows[0].n, 1);
    const before = (await c.db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q")).rows;
    const replay = await c.create("  QA Same Intent  ", c.actor, { requestId }); assert.ok(replay.ok && replay.existing);
    assert.deepEqual((await c.db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q")).rows, before);
    assert.deepEqual(await c.create("QA Different Intent Body", c.actor, { requestId }), { ok: false, error: "conflict" });
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("intenção é vinculada à conta atual e falha de auditoria reverte a reserva", async () => {
  const c = await setup("t_admin_referrals_intent_audit");
  const requestId = "00000000-0000-4000-8000-000000000002";
  try {
    await c.db.query("CREATE FUNCTION fail_intent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='referrer_created' THEN RAISE EXCEPTION 'QA intent audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_intent_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_intent_audit()");
    await assert.rejects(c.create("QA Rollback Intent", c.actor, { requestId }), /QA intent audit failure/);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM referrers")).rows[0].n, 0);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_requests")).rows[0].n, 0);
    await c.db.query("DROP TRIGGER fail_intent_audit ON audit_log");
    const created = await c.create("QA Rollback Intent", c.actor, { requestId }); assert.ok(created.ok);
    const second = await c.U.criarUsuario({ email: "second-editor@example.test", nome: "Editor Dois QA", nivel: "edicao", senha: "QA-Other-Referral-Strong-2026" }); assert.ok(second.ok);
    const own = await c.create("QA Rollback Intent", { userId: second.usuario.id, email: second.usuario.email }, { requestId }); assert.ok(own.ok);
    assert.notEqual(own.code, created.code);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.create("QA Rollback Intent", c.actor, { requestId }), { ok: false, error: "forbidden" });
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_requests")).rows[0].n, 2);
  } finally { await c.db._closeDbForTests(); }
});

test("intenção malformada não cria código nem metadados", async () => {
  const c = await setup("t_admin_referrals_intent_parameters");
  try {
    for (const requestId of ["", "wrong-id", "00000000-0000-0000-0000-000000000000"]) assert.deepEqual(await c.create("QA Intent", c.actor, { requestId }), { ok: false, error: "request" });
    assert.equal((await c.db.query("SELECT count(*)::int n FROM referrers")).rows[0].n, 0);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_requests")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});
