import test from "node:test";
import assert from "node:assert/strict";
import { problemaNaSenha } from "./senha";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

test("senha administrativa aceita oito caracteres sem retirar os demais critérios", () => {
  assert.equal(problemaNaSenha("R7!pZ2@x"), null);
  assert.equal(problemaNaSenha("R7!pZ2@"), "A senha precisa ter pelo menos 8 caracteres.");
  assert.equal(problemaNaSenha("R7!pZ2@x".repeat(26)), "A senha é longa demais (máximo 200 caracteres).");
  assert.equal(problemaNaSenha("aaaaaaaa"), "A senha tem caracteres repetidos demais.");
  assert.equal(problemaNaSenha("Pessoa@8", "pessoa@example.test"), "A senha não pode conter o seu e-mail.");
  assert.equal(problemaNaSenha("password1234"), "Essa senha é comum demais. Escolha outra.");
});

test("criar, trocar e redefinir senha aceitam oito, recusam sete e conservam revogações", async () => {
  const db = await import("./db"), U = await import("./admin-users");
  await db._openForTests("t_admin_password_minimum_eight");
  const initial = "R7!pZ2@x", changed = "T4#vQ9!m", reset = "N6@wY3$p";
  const email = "qa-password-boundary@example.test";
  try {
    assert.equal((await U.criarUsuario({ email, nome: "QA Password", nivel: "total", senha: initial.slice(0, 7) })).ok, false);
    assert.equal((await db.query("SELECT 1 FROM admin_users")).rowCount, 0);
    const created = await U.criarUsuario({ email, nome: "QA Password", nivel: "total", senha: initial });
    assert.ok(created.ok);
    const id = created.usuario.id;
    assert.ok((await U.autenticar(email, initial)).ok);
    const sessions = await Promise.all([U.abrirSessao(id, "127.0.0.1"), U.abrirSessao(id, "127.0.0.1")]);
    const before = (await db.query("SELECT senha_hash FROM admin_users WHERE id=$1", [id])).rows[0].senha_hash;
    assert.equal((await U.trocarMinhaSenha(id, initial, changed.slice(0, 7))).ok, false);
    assert.equal((await db.query("SELECT senha_hash FROM admin_users WHERE id=$1", [id])).rows[0].senha_hash, before);
    assert.ok(await U.sessaoPorToken(sessions[0].token));
    assert.deepEqual(await U.trocarMinhaSenha(id, initial, changed), { ok: true });
    for (const session of sessions) assert.equal(await U.sessaoPorToken(session.token), null);
    assert.ok((await U.autenticar(email, changed)).ok);
    const oldSession = await U.abrirSessao(id, "127.0.0.1");
    let link = "";
    await U.pedirReset(email, { origin: "https://qa.example.test", enviar: async mail => { link = mail.text; } });
    const token = /\/admin\/redefinir\?token=([A-Za-z0-9_-]+)/.exec(link)?.[1];
    assert.ok(token);
    assert.equal((await U.redefinirSenha(token, reset.slice(0, 7))).ok, false);
    assert.ok(await U.sessaoPorToken(oldSession.token));
    assert.deepEqual(await U.redefinirSenha(token, reset), { ok: true });
    assert.equal(await U.sessaoPorToken(oldSession.token), null);
    assert.ok((await U.autenticar(email, reset)).ok);
    assert.deepEqual(await U.redefinirSenha(token, initial), { ok: false, erro: "token_invalido" });
    assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});
