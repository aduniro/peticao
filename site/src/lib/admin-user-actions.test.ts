import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
process.env.MAIL_PROVIDER = "dev";
const PASSWORD = "Uma-Senha-Forte-2026";

test("gestão de usuários exige Total, origem e confirmação extra antes de qualquer efeito", async () => {
  const db = await import("./db");
  await db._openForTests("t_admin_user_actions");
  const U = await import("./admin-users");
  const { POST } = await import("../app/api/admin/usuarios/route");
  const { NextRequest } = await import("next/server");
  const { ADMIN_COOKIE } = await import("./admin");
  try {
    const accounts = [];
    for (const nivel of U.NIVEIS) {
      const created = await U.criarUsuario({ email: `${nivel}@actions.example`, nome: `Teste ${nivel}`, nivel, senha: PASSWORD });
      assert.ok(created.ok);
      accounts.push({ user: created.usuario, session: await U.abrirSessao(created.usuario.id, "127.0.0.1") });
    }
    const owner = accounts.find(a => a.user.nivel === "total")!;
    const target = accounts[0];
    const request = (token: string | undefined, data: Record<string, string>, origin = "http://localhost") => {
      const form = new FormData();
      for (const [key, value] of Object.entries(data)) form.set(key, value);
      return new NextRequest("http://localhost/api/admin/usuarios", { method: "POST", headers: { host: "localhost", origin, cookie: token ? `${ADMIN_COOKIE}=${token}` : "" }, body: form });
    };
    const snapshot = async () => (await db.query("SELECT * FROM admin_users ORDER BY id")).rows;
    const before = await snapshot();
    assert.equal((await POST(request(undefined, { acao: "nivel", id: String(target.user.id), nivel: "total" }))).status, 401);
    for (const account of accounts.filter(a => a !== owner)) {
      const response = await POST(request(account.session.token, { acao: "nivel", id: String(target.user.id), nivel: "total" }));
      assert.equal(response.status, 403);
    }
    for (const acao of ["criar", "nivel", "ativar", "desativar", "redefinir"]) {
      const response = await POST(request(owner.session.token, { acao, id: String(target.user.id), nivel: "total", email: "never-sent@example.org", nome: "Teste Convite" }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).erro, "stepup");
    }
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n, 0);
    const mailbox: string[] = [];
    await U.pedirStepup((await U.sessaoPorToken(owner.session.token))!, async m => { mailbox.push(m.text); });
    const code = /\b\d{6}\b/.exec(mailbox[0])![0];
    assert.ok((await U.confirmarStepup((await U.sessaoPorToken(owner.session.token))!, PASSWORD, code)).ok);
    assert.equal((await POST(request(owner.session.token, { acao: "nivel", id: String(target.user.id), nivel: "total" }, "https://other.example"))).status, 403);
    assert.deepEqual(await snapshot(), before);
    const success = await POST(request(owner.session.token, { acao: "nivel", id: String(target.user.id), nivel: "total", por: "forged@example.org" }));
    assert.equal(success.status, 303);
    assert.match(success.headers.get("location")!, /msg=nivel$/);
    assert.equal((await snapshot()).find(a => a.id === target.user.id).nivel, "total");
    const log = (await db.query("SELECT data FROM audit_log WHERE event='admin_usuario_nivel' ORDER BY id DESC LIMIT 1")).rows;
    assert.ok(log.length);
    assert.equal(JSON.parse(log[0].data).por, owner.user.email);
    await db.query("UPDATE admin_sessions SET stepup_ate=now()-interval '1 second' WHERE id=$1", [(await U.sessaoPorToken(owner.session.token))!.sessaoId]);
    const expired = await POST(request(owner.session.token, { acao: "desativar", id: String(target.user.id) }));
    assert.equal(expired.status, 403);
    assert.equal((await expired.json()).erro, "stepup");
    assert.ok((await snapshot()).find(a => a.id === target.user.id).ativo);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});
