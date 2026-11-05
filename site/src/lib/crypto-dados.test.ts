import test from "node:test";
import assert from "node:assert/strict";
import { cifrar, decifrar, impressao } from "./crypto-dados";
import { tokenAdminValido, adminToken } from "./admin";

test("AES-GCM: ida e volta, contexto e adulteração", () => {
  const c = cifrar("+5569999990000", "wa:1");
  assert.ok(!c.includes("5569"));
  assert.equal(decifrar(c, "wa:1"), "+5569999990000");
  assert.equal(decifrar(c, "wa:2"), null);
  assert.equal(decifrar(c.slice(0, -2) + "xx", "wa:1"), null);
  assert.notEqual(cifrar("a"), cifrar("a"));
  assert.equal(impressao("a"), impressao("a"));
});

test("sessão admin expira e não pode ser estendida", () => {
  const t = adminToken();
  assert.ok(tokenAdminValido(t));
  assert.ok(!tokenAdminValido(t, Date.now() + 5 * 3600_000));
  const [e, s] = t.split(".");
  assert.ok(!tokenAdminValido(`${Number(e) + 3600_000}.${s}`));
  assert.ok(!tokenAdminValido("lixo"));
  assert.ok(!tokenAdminValido(undefined));
});
