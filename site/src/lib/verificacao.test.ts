import test from "node:test";
import assert from "node:assert/strict";
import { verificarMailersend, verificarEmail } from "./verificacao";
import { _resetRodizio } from "./mail/rodizio";

const resp = (status: string, ok = true) => (async () => ({ ok, json: async () => ({ status }) })) as any;
test("MailerSend: só recusa com prova", async () => {
  const t = "tok";
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("valid"), token: t }), { ok: true });
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("mailbox_not_found"), token: t }), { ok: false, code: "email_not_found" });
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("syntax_error"), token: t }), { ok: false, code: "email_invalid" });
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("catch_all"), token: t }), { ok: true });
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("unknown"), token: t }), { ok: true });
  assert.deepEqual(await verificarMailersend("a@x.com", { fetchImpl: resp("x", false), token: t }), { ok: true, skipped: "indisponivel" });
  assert.deepEqual(await verificarMailersend("a@x.com", { token: null }), { ok: true, skipped: "desligado" });
});
test("rodízio da verificação: alterna os serviços e cai no outro se um estiver indisponível", async () => {
  _resetRodizio(); process.env.VERIFY_ROTATION = "reacher:1,mailersend:1"; delete process.env.REACHER_URL;
  const f = resp("valid"); const usados: string[] = [];
  for (let i = 0; i < 6; i++) usados.push((await verificarEmail("a@x.com", { fetchImpl: f, mailersendToken: "tok" })).servico);
  // Reacher sem REACHER_URL = "desligado" (indisponível) → sempre acaba no MailerSend
  assert.ok(usados.every((s) => s === "mailersend"));
  delete process.env.VERIFY_ROTATION; _resetRodizio();
  assert.equal((await verificarEmail("a@x.com")).servico, "reacher"); // sem a variável: comportamento antigo
});
