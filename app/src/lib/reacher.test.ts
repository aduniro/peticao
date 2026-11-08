import test from "node:test";
import assert from "node:assert/strict";
import { judge, checkWithReacher, _clearReacherCache } from "./reacher";

const out = (o: object) => async () => ({ ok: true, status: 200, json: async () => o }) as never;

test("Reacher: só recusa com prova do SMTP; unknown/risky/catch-all/sem conexão passam", () => {
  const smtp = (x: object) => ({ can_connect_smtp: true, has_full_inbox: false, is_catch_all: false, is_deliverable: true, is_disabled: false, ...x });
  assert.deepEqual(judge({ is_reachable: "safe", smtp: smtp({}) }), { ok: true, skipped: undefined });
  assert.deepEqual(judge({ is_reachable: "invalid", smtp: smtp({ is_deliverable: false, is_disabled: true }) }), { ok: false, code: "email_not_found" });
  assert.deepEqual(judge({ is_reachable: "risky", smtp: smtp({ has_full_inbox: true }) }), { ok: false, code: "email_full" });
  assert.equal(judge({ is_reachable: "risky", smtp: smtp({ is_catch_all: true, is_deliverable: true }) }).ok, true); // catch-all aceita tudo: não prova nada
  assert.equal(judge({ is_reachable: "invalid", smtp: smtp({ is_catch_all: true, is_deliverable: false }) }).ok, true);
  // sem porta 25: can_connect_smtp=false → "unknown"; NUNCA bloqueia por isso
  assert.deepEqual(judge({ is_reachable: "unknown", smtp: { can_connect_smtp: false }, mx: { accepts_mail: true }, syntax: { is_valid_syntax: true } }), { ok: true, skipped: "sem_prova" });
  assert.equal(judge({ is_reachable: "invalid", smtp: { can_connect_smtp: false, is_disabled: false, is_deliverable: false } }).ok, true);
  // checagens que não dependem da porta 25
  assert.deepEqual(judge({ syntax: { is_valid_syntax: false } }), { ok: false, code: "email_invalid" });
  assert.deepEqual(judge({ misc: { is_disposable: true } }), { ok: false, code: "email_disposable" });
  assert.deepEqual(judge({ mx: { accepts_mail: false } }), { ok: false, code: "email_undeliverable" });
});

test("Reacher: desligado, fora do ar, lento e resposta de erro deixam passar; cabeçalho de segredo e cache", async () => {
  _clearReacherCache();
  assert.deepEqual(await checkWithReacher("a@b.org", { url: "" }), { ok: true, skipped: "desligado" });
  assert.deepEqual(await checkWithReacher("a@b.org", { url: "http://r", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), { ok: true, skipped: "indisponivel" });
  assert.deepEqual(await checkWithReacher("a@b.org", { url: "http://r", fetchImpl: (async () => ({ ok: false, status: 500 })) as never }), { ok: true, skipped: "indisponivel" });
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ is_reachable: "invalid", smtp: { can_connect_smtp: true, is_deliverable: false, is_disabled: true } }) }; }) as never;
  const r1 = await checkWithReacher("Nao.Existe@Exemplo.org", { url: "http://127.0.0.1:8080/", secret: "SEGREDO", fetchImpl: f });
  assert.deepEqual(r1, { ok: false, code: "email_not_found" });
  assert.equal(seen[0].url, "http://127.0.0.1:8080/v0/check_email");
  assert.equal((seen[0].init.headers as Record<string, string>)["x-reacher-secret"], "SEGREDO");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { to_email: "Nao.Existe@Exemplo.org" });
  await checkWithReacher("nao.existe@exemplo.org", { url: "http://127.0.0.1:8080", fetchImpl: f }); // mesma caixa (minúsculas): vem do cache
  assert.equal(seen.length, 1);
});
