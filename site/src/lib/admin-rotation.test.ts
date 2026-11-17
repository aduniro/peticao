import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
delete process.env.ADMIN_GEOFENCE;
const INITIAL = "Cerrado!Runtime2026-First";
const NEW = "Floresta!Runtime2026-Next";

async function fixture(schema: string) {
  const db = await import("./db");
  await db._openForTests(schema);
  const users = await import("./admin-users");
  const admin = await import("./admin");
  const api = await import("./admin-api");
  const { NextRequest } = await import("next/server");
  const created = await users.criarUsuario({ email: "r4-owner@example.test", nome: "Pessoa QA R4",
    nivel: "total", senha: INITIAL, trocarSenha: true });
  assert.ok(created.ok);
  const session = await users.abrirSessao(created.usuario.id, "192.0.2.81");
  const actor = await users.sessaoPorToken(session.token);
  assert.ok(actor?.trocarSenha);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  const request = (path: string, fields?: Record<string, string>, cookie = session.token, origin = "http://localhost:3195") => {
    const form = fields ? new FormData() : undefined;
    for (const [key, value] of Object.entries(fields ?? {})) form!.set(key, value);
    return new NextRequest("http://localhost:3195" + path, { method: fields ? "POST" : "GET", body: form,
      headers: { host: "localhost:3195", origin, "x-forwarded-for": "192.0.2.81", cookie: `${admin.ADMIN_COOKIE}=${cookie}` } });
  };
  return { db, users, admin, api, request, user: created.usuario, token: session.token };
}

test("required rotation blocks real administrative mutation and reads despite stepup and forged client flags", async () => {
  const f = await fixture("t_admin_r4_rotation_gate");
  try {
    const target = await f.users.criarUsuario({ email: "r4-target@example.test", nome: "Pessoa Alvo QA", nivel: "leitura", senha: INITIAL });
    assert.ok(target.ok);
    const { POST } = await import("@/app/api/admin/usuarios/route");
    const denied = await POST(f.request("/api/admin/usuarios?permitirTroca=true", {
      acao: "desativar", id: String(target.usuario.id), permitirTroca: "true", trocarSenha: "false",
    }));
    assert.equal(denied.status, 403);
    const body = await denied.json();
    assert.equal(body.erro, "troca_senha_obrigatoria");
    assert.equal(body.contaUrl, "/admin/conta");
    assert.match(body.mensagem, /troque a sua senha/);
    assert.equal((await f.db.query("SELECT ativo FROM admin_users WHERE id=$1", [target.usuario.id])).rows[0].ativo, true);
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM audit_log WHERE event='admin_usuario_desativado'")).rows[0].n, 0);
    const read = await f.api.exigirNivel(f.request("/api/admin/painel"), "leitura");
    assert.equal(read?.status, 403);
    const { POST: account } = await import("@/app/api/admin/conta/route");
    const forged = await account(f.request("/api/admin/conta", { atual: INITIAL, nova: NEW, nova2: NEW }, f.token, "https://example.invalid"));
    assert.equal(forged.status, 403);
    assert.equal((await f.users.sessaoPorToken(f.token))?.trocarSenha, true);
    const missing = await f.api.exigirNivel(f.request("/api/admin/painel", undefined, "invalid-token"), "leitura");
    assert.equal(missing?.status, 401);
  } finally { await f.db._closeDbForTests(); }
});

test("own password change keeps the flag on failure or rollback, and redirects to login only after committed revocation", async () => {
  const f = await fixture("t_admin_r4_rotation_commit");
  try {
    const { POST } = await import("@/app/api/admin/conta/route");
    const change = () => POST(f.request("/api/admin/conta", { atual: INITIAL, nova: NEW, nova2: NEW }));
    const mismatch = await POST(f.request("/api/admin/conta", { atual: INITIAL, nova: NEW, nova2: "different" }));
    assert.match(mismatch.headers.get("location")!, /erro=diferentes/);
    assert.equal((await f.users.sessaoPorToken(f.token))?.trocarSenha, true);
    await f.db.query("CREATE FUNCTION r4_fail_password_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_senha_trocada' THEN RAISE EXCEPTION 'r4 rollback fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER r4_fail_password_commit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION r4_fail_password_commit()");
    await assert.rejects(change(), /r4 rollback fixture/);
    assert.equal((await f.users.sessaoPorToken(f.token))?.trocarSenha, true);
    assert.equal((await f.users.autenticar(f.user.email, INITIAL)).ok, true);
    await f.db.query("DROP TRIGGER r4_fail_password_commit ON audit_log");
    const success = await change();
    assert.equal(success.status, 303);
    assert.equal(new URL(success.headers.get("location")!).pathname, "/admin");
    assert.equal(new URL(success.headers.get("location")!).searchParams.get("msg"), "senha-alterada");
    assert.equal(success.cookies.get(f.admin.ADMIN_COOKIE)?.value, "");
    assert.equal(await f.users.sessaoPorToken(f.token), null);
    assert.equal((await f.db.query("SELECT trocar_senha FROM admin_users WHERE id=$1", [f.user.id])).rows[0].trocar_senha, false);
    assert.equal((await f.users.autenticar(f.user.email, NEW)).ok, true);
    const replay = await change();
    assert.equal(replay.status, 401);
    const reader = await f.users.criarUsuario({ email: "r4-reader@example.test", nome: "Leitura QA", nivel: "leitura", senha: NEW });
    assert.ok(reader.ok);
    const session = await f.users.abrirSessao(reader.usuario.id, "192.0.2.82");
    const level = await f.api.exigirNivel(f.request("/api/admin/usuarios", undefined, session.token), "total");
    assert.equal(level?.status, 403);
    assert.match((await level!.json()).erro, /nível de acesso/);
    assert.ok((await f.db.verifyAuditChain()).ok);
  } finally { await f.db._closeDbForTests(); }
});

test("valid recovery token remains usable with a pending-rotation cookie; invalid, expired and replay tokens do not unlock", async () => {
  const f = await fixture("t_admin_r4_rotation_recovery");
  try {
    const { POST } = await import("@/app/api/admin/redefinir/route");
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await f.db.query("INSERT INTO admin_reset(user_id,token_hash,expira_em) VALUES($1,$2,now()-interval '1 minute')", [f.user.id, hash]);
    const reset = (value: string) => POST(f.request("/api/admin/redefinir", { token: value, senha: NEW, senha2: NEW }));
    const invalid = await reset(randomBytes(32).toString("base64url"));
    assert.match(invalid.headers.get("location")!, /erro=token/);
    const expired = await reset(token);
    assert.match(expired.headers.get("location")!, /erro=token/);
    assert.equal((await f.users.sessaoPorToken(f.token))?.trocarSenha, true);
    await f.db.query("UPDATE admin_reset SET expira_em=now()+interval '30 minutes' WHERE token_hash=$1", [hash]);
    const valid = await reset(token);
    assert.match(valid.headers.get("location")!, /msg=senha-redefinida/);
    assert.equal(await f.users.sessaoPorToken(f.token), null);
    assert.equal((await f.users.autenticar(f.user.email, NEW)).ok, true);
    const replay = await reset(token);
    assert.match(replay.headers.get("location")!, /erro=token/);
  } finally { await f.db._closeDbForTests(); }
});

test("simultaneous password changes commit once and cannot reuse the revoked session", async () => {
  const f = await fixture("t_admin_r4_rotation_race");
  try {
    const { POST } = await import("@/app/api/admin/conta/route");
    const alternatives = [NEW, "Horizonte!Runtime2026-Other"];
    const responses = await Promise.all(alternatives.map(nova =>
      POST(f.request("/api/admin/conta", { atual: INITIAL, nova, nova2: nova }))));
    const winners = responses.map((response, index) => ({ response, index })).filter(({ response }) => {
      const location = response.headers.get("location");
      return !!location && new URL(location).searchParams.get("msg") === "senha-alterada";
    });
    assert.equal(winners.length, 1);
    const loser = responses[1 - winners[0].index];
    assert.ok(loser.status === 401 || (loser.status === 303 && /erro=atual/.test(loser.headers.get("location") ?? "")));
    assert.equal((await f.users.autenticar(f.user.email, alternatives[winners[0].index])).ok, true);
    assert.equal(await f.users.sessaoPorToken(f.token), null);
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM audit_log WHERE event='admin_senha_trocada'")).rows[0].n, 1);
    assert.equal((await f.db.query("SELECT nivel,trocar_senha FROM admin_users WHERE id=$1", [f.user.id])).rows[0].nivel, "total");
    assert.ok((await f.db.verifyAuditChain()).ok);
  } finally { await f.db._closeDbForTests(); }
});

test("real legacy and qualified preview session readers preserve their existing guards", async () => {
  const db = await import("./db");
  await db._openForTests("t_admin_r4_rotation_compat");
  const previous = { password: process.env.ADMIN_PASSWORD, preview: process.env.PREVIEW_MODE, noPassword: process.env.ADMIN_NO_PASSWORD };
  try {
    process.env.ADMIN_PASSWORD = INITIAL;
    delete process.env.PREVIEW_MODE;
    delete process.env.ADMIN_NO_PASSWORD;
    const A = await import("./admin");
    const API = await import("./admin-api");
    const { NextRequest } = await import("next/server");
    const request = (cookie: string) => new NextRequest("http://localhost:3195/api/admin/painel", {
      headers: { host: "localhost:3195", origin: "http://localhost:3195", "x-forwarded-for": "192.0.2.89", cookie: `${A.ADMIN_COOKIE}=${cookie}` },
    });
    const legacy = A.adminToken();
    assert.equal((await API.quemAge(request(legacy)))?.legado, true);
    assert.equal(await API.exigirNivel(request(legacy), "leitura"), null);
    assert.equal((await API.exigirNivel(request(legacy), "total", 120, { stepup: true }))?.status, 403);
    process.env.PREVIEW_MODE = "1";
    process.env.ADMIN_NO_PASSWORD = "1";
    assert.equal((await API.quemAge(request("")))?.preview, true);
    assert.equal(await API.exigirNivel(request(""), "total", 120, { stepup: true }), null);
    delete process.env.ADMIN_NO_PASSWORD;
    assert.equal((await API.exigirNivel(request(""), "leitura"))?.status, 401);
  } finally {
    for (const [key, value] of Object.entries({ ADMIN_PASSWORD: previous.password, PREVIEW_MODE: previous.preview, ADMIN_NO_PASSWORD: previous.noPassword })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db._closeDbForTests();
  }
});
