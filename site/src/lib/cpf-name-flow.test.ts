import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_PROVIDERS = "dev";
process.env.MAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "cpf-name-flow-"));
process.env.SECRETS_DIR = "/nao-existe-cpf-name-test";
process.env.TURNSTILE_SITE_KEY = "";

test("fluxo: nome parcial institucional exige desafio; erro de nome não é compensado pelo nascimento", async () => {
  const db = await import("./db"); await db._openForTests("t_cpf_name_flow");
  const { handleSign } = await import("./sign-flow");
  const { _setMxResolverForTests } = await import("./email-check");
  const { cachedCpfProvider } = await import("./cpf-cache");
  const { verifyIdentity, verifyCpfName, resetIdentityAttempts } = await import("./identity");
  const cpf = "52998224725";
  const registry = { nome: "ANA PAULA DE SOUZA LIMA", mae: "HELENA MARIA SOUZA", nasc: "01/02/1990" };
  let calls = 0;
  const provider = cachedCpfProvider({ name: "fixture", async lookup() { calls++; return registry; } });
  const form = { name: "Ana Souza", email: "ana@unir.br", cpf, category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true };
  const ctx = { ip: "10.23.1.1" };
  const originalFetch = globalThis.fetch;
  let robotChecks = 0;
  process.env.TURNSTILE_SITE_KEY = "fixture-site-key";
  process.env.TURNSTILE_SECRET_KEY = "fixture-secret-key";
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    robotChecks++;
    return new Response(JSON.stringify({ success: robotChecks === 1 }));
  }) as typeof fetch;
  Object.assign(form, { turnstileToken: "fixture-single-use-token" });
  const count = async () => (await db.query("SELECT count(*)::int n FROM signatures")).rows[0].n;
  _setMxResolverForTests(async () => "ok");
  try {
    const start = await handleSign(form, ctx, provider);
    assert.equal(start.json.identityRequired, true);
    assert.deepEqual(start.json.methods, ["mae", "nascimento"]);
    assert.equal(await count(), 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM identity_attempts")).rows[0].n, 0);
    const badTicket = await handleSign({ ...form, identity: { method: "nascimento", value: "01/02/1990" } }, ctx, provider);
    assert.equal(badTicket.status, 400);
    const challenge = { ...form, ticket: start.json.ticket, identity: { method: "nascimento", value: "02/02/1990" } };
    const wrongDate = await handleSign(challenge, ctx, provider);
    assert.equal(wrongDate.json.identityCode, "mismatch");
    assert.equal(await count(), 0);
    const ok = await handleSign({ ...challenge, identity: { method: "nascimento", value: "01/02/1990" } }, ctx, provider);
    assert.equal(ok.json.ok, true);
    const saved = (await db.query("SELECT name,cpf_name_check,identity_method,status FROM signatures")).rows[0];
    assert.deepEqual(saved, { name: "Ana Souza", cpf_name_check: "match", identity_method: "nascimento", status: "pending" });
    assert.equal(calls, 1, "tentativas reutilizam o retorno cadastral em cache");

    assert.equal(robotChecks, 1, "ticket válido evita consumir novamente o token antirrobô");
    process.env.TURNSTILE_SITE_KEY = "";
    delete process.env.TURNSTILE_SECRET_KEY;
    globalThis.fetch = originalFetch;

    // Even a correct challenge cannot rescue incompatible names.
    const supporter = { ...form, name: "Ana Carla Lima", email: "ana@gmail.com", category: "apoiador", city: "Porto Velho", uf: "RO" };
    const first = await handleSign(supporter, ctx, provider);
    const rejected = await handleSign({ ...supporter, ticket: first.json.ticket, identity: { method: "mae", value: registry.mae } }, ctx, provider);
    assert.equal((rejected.json.errors as Record<string, string>).name, "name_cpf_mismatch");
    assert.equal(await count(), 1, "cadastro existente não foi substituído pelo nome divergente");

    await resetIdentityAttempts(cpf);
    assert.deepEqual(await verifyCpfName({ cpf, declaredName: "Paula Lima", provider }), { ok: false, reason: "identity_required" });
    assert.equal((await verifyIdentity({ cpf, declaredName: "Paula Lima", method: "mae", value: registry.mae, provider })).ok, true);
    for (let n = 0; n < 5; n++) {
      const r = await verifyIdentity({ cpf, declaredName: "Ana Carla Lima", method: "nascimento", value: registry.nasc, provider });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "name_mismatch");
    }
    const locked = await verifyIdentity({ cpf, declaredName: registry.nome, method: "mae", value: registry.mae, provider });
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.reason, "locked");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.TURNSTILE_SITE_KEY = "";
    delete process.env.TURNSTILE_SECRET_KEY;
    _setMxResolverForTests(null); await db._closeDbForTests();
    rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true });
  }
});
