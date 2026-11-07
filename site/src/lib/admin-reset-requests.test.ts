import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.MAIL_PROVIDERS;
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const PASSWORD = "Uma-Senha-Forte-2026";
async function setup() {
  const db = await import("./db");
  await db._openForTests("t_admin_reset_requests");
  const U = await import("./admin-users");
  const created = await U.criarUsuario({ email: "reset@example.test", nome: "Pessoa Fictícia", nivel: "total", senha: PASSWORD });
  assert.ok(created.ok);
  const session = await U.abrirSessao(created.usuario.id, "127.0.0.1");
  return { db, U, user: created.usuario, session };
}

test("pedidos de redefinição e convite concorrentes compartilham quota sem alterar senha ou sessão", async () => {
  const c = await setup();
  try {
    const before = (await c.db.query("SELECT * FROM admin_users")).rows;
    const messages: string[] = [];
    const results = await Promise.all(Array.from({ length: 9 }, (_, index) => c.U.pedirReset(c.user.email, { origin: "https://site.test", convite: index % 2 === 0, enviar: async mail => { messages.push(mail.text); } })));
    assert.equal(results.filter(r => r.estado === "sent").length, 3);
    assert.equal(results.filter(r => r.estado === "skipped" && r.motivo === "quota").length, 6);
    assert.equal(messages.length, 3);
    const tokens = messages.map(text => /token=([A-Za-z0-9_-]+)/.exec(text)![1]);
    assert.equal(new Set(tokens).size, 3);
    const rows = (await c.db.query("SELECT token_hash,expira_em,criado_em FROM admin_reset")).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => !tokens.includes(row.token_hash)));
    assert.ok(rows.every(row => new Date(row.expira_em) > new Date(row.criado_em)));
    assert.deepEqual((await c.db.query("SELECT * FROM admin_users")).rows, before);
    assert.ok(await c.U.sessaoPorToken(c.session.token));
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("reserva de redefinição e auditoria são atômicas antes de qualquer transporte", async () => {
  const c = await setup();
  try {
    let attempts = 0;
    await c.db.query(`CREATE FUNCTION fail_reset_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_reset_reservado' THEN RAISE EXCEPTION 'reset reservation failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_reset_reservation BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reset_reservation();`);
    await assert.rejects(c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => { attempts++; } }), /reset reservation failure/);
    assert.equal(attempts, 0);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n, 0);
    await c.db.query("DROP TRIGGER fail_reset_reservation ON audit_log");
    await assert.rejects(c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => { attempts++; throw new Error("possible provider failure"); } }), /possible provider failure/);
    assert.equal(attempts, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_reset_reservado'")).rows[0].n, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_reset_pedido'")).rows[0].n, 0);
    assert.ok(await c.U.sessaoPorToken(c.session.token));
  } finally { await c.db._closeDbForTests(); }
});

test("resultado interno distingue aceite, fila e ausência de envio; não promete entrega", async () => {
  const c = await setup();
  try {
    assert.deepEqual(await c.U.pedirReset("missing@example.test", { origin: "https://site.test", enviar: async () => assert.fail("must not send") }), { estado: "skipped", motivo: "unavailable" });
    assert.deepEqual(await c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => "queued" }), { estado: "queued" });
    assert.deepEqual(await c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => "sent" }), { estado: "sent" });
    const events = (await c.db.query("SELECT data FROM audit_log WHERE event='admin_reset_pedido' ORDER BY id")).rows.map(row => JSON.parse(row.data));
    assert.deepEqual(events.map(row => row.estado), ["queued", "sent"]);
    await assert.rejects(c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => "unexpected" }), /Unexpected/);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_reset_pedido'")).rows[0].n, 2);
  } finally { await c.db._closeDbForTests(); }
});

test("esqueci a senha mantém resposta pública uniforme sem expor resultado interno", async () => {
  const c = await setup();
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const secretFixture = mkdtempSync(join(tmpdir(), "peticao-reset-secrets-fixture-"));
  const previous = { dir: process.env.SECRETS_DIR, siteKey: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY };
  try {
    process.env.SECRETS_DIR = secretFixture;
    process.env.TURNSTILE_SITE_KEY = "";
    process.env.TURNSTILE_SECRET_KEY = "";
    const { POST } = await import("../app/api/admin/esqueci/route");
    const { NextRequest } = await import("next/server");
    const request = (email: string) => {
      const body = new FormData(); body.set("email", email);
      return new NextRequest("http://localhost/api/admin/esqueci", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "x-forwarded-for": "10.18.2.1" }, body });
    };
    const noAccount = await POST(request("missing@example.test"));
    for (let index = 0; index < 3; index++) await c.U.pedirReset(c.user.email, { origin: "https://site.test", enviar: async () => {} });
    const quota = await POST(request(c.user.email));
    await c.db.query("UPDATE admin_reset SET criado_em=now()-interval '2 hours'");
    await c.db.query(`CREATE FUNCTION fail_public_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_reset_reservado' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_public_reset BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_public_reset();`);
    const failure = await POST(request(c.user.email));
    for (const response of [noAccount, quota, failure]) {
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "http://localhost/admin?msg=reset-enviado");
      assert.equal(await response.text(), "");
    }
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n, 3);
  } finally {
    for (const [key, value] of [["SECRETS_DIR", previous.dir], ["TURNSTILE_SITE_KEY", previous.siteKey], ["TURNSTILE_SECRET_KEY", previous.secret]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    rmSync(secretFixture, { recursive: true, force: true });
    await c.db._closeDbForTests();
  }
});
