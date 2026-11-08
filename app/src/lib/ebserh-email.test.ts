import test from "node:test";
import assert from "node:assert/strict";
import { EBSERH } from "./server-email-policy";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider } from "./cpf-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("EBSERH preflight and signup share eligibility without widening government suffixes", async () => {
  const db = await import("./db");
  await db._openForTests("t_ebserh_email");
  const { validateEmailField } = await import("./email-validate");
  const { dominiosIfes } = await import("./email-sugestao");
  const { handleSign } = await import("./sign-flow");
  _setMxResolverForTests(async () => "ok");
  try {
    const count = async () => (await db.query<{ n: number }>("SELECT COUNT(*)::int n FROM institutional_domains")).rows[0].n;
    const before = await count();
    const known = await dominiosIfes();
    for (const domain of EBSERH.domains) {
      assert.ok(known.includes(domain));
      assert.deepEqual(await validateEmailField(`qa@${domain}`, "servidor"), { ok: true });
      assert.deepEqual(await validateEmailField(`qa@${domain}`, "apoiador"), { ok: false, code: "apoiador_institutional_email" });
    }
    for (const domain of ["saude.gov.br", "sub.ebserh.gov.br", "hubrasil.gov.br.evil.org", "sou.ucpel.edu.br"]) {
      assert.equal((await validateEmailField(`qa@${domain}`, "servidor")).ok, false, domain);
    }
    assert.equal(await count(), before, "email preflight never writes domain curation");
    for (const domain of EBSERH.domains) {
      const result = await handleSign({
        name: "Pessoa Fictícia Teste", email: `qa@${domain}`, cpf: "52998224725",
        category: "apoiador", city: "Porto Velho", uf: "RO", consent: true,
      }, { ip: "203.0.113.87" }, mockProvider({}));
      assert.equal(result.status, 422);
      assert.equal((result.json.errors as Record<string, string>).email, "apoiador_institutional_email");
    }
    _setMxResolverForTests(async () => "none");
    for (const domain of EBSERH.domains) {
      const result = await validateEmailField(`qa@${domain}`, "servidor");
      assert.equal(result.ok, false, "allowlist does not bypass missing MX");
    }
  } finally {
    _setMxResolverForTests(null);
    await db._closeDbForTests();
  }
});

test("new EBSERH servidor requests reach CPF validation while QA government-mail guard remains enforced", async () => {
  const db = await import("./db");
  await db._openForTests("t_ebserh_sign");
  const { handleSign } = await import("./sign-flow");
  const { institutionalKind } = await import("./institutional");
  const outbox = mkdtempSync(join(tmpdir(), "ebserh-fictitious-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
  _setMxResolverForTests(async () => "ok");
  let lookups = 0;
  try {
    for (const [i, domain] of EBSERH.domains.entries()) {
      const cpf = ["52998224725", "11144477735"][i];
      const fake = mockProvider({ [cpf]: { nome: "PESSOA FICTICIA TESTE" } });
      const provider = { name: fake.name, lookup: async (value: string) => { lookups++; return fake.lookup(value); } };
      const result = await handleSign({
        name: "Pessoa Fictícia Teste", email: `qa-sign@${domain}`, cpf,
        category: "servidor", institution: EBSERH.name, role: "tae", regionDeclared: false, consent: true,
      }, { ip: `203.0.113.${90 + i}` }, provider);
      assert.equal(result.status, 422, JSON.stringify(result.json));
      assert.equal(result.json.errorCode, "mail_blocked", "do not weaken the existing QA send guard");
      assert.equal(await institutionalKind(`qa-sign@${domain}`), "governo", "EBSERH is not relabeled as an IFES");
    }
    assert.equal(lookups, 2, "EBSERH email does not bypass CPF/name validation");
    const rows = (await db.query<{ email: string; email_domain_kind: string; institution: string }>(
      "SELECT email,email_domain_kind,institution FROM signatures ORDER BY email")).rows;
    assert.equal(rows.length, 0, "blocked QA delivery never leaves a partial signature");
  } finally {
    _setMxResolverForTests(null);
    await db._closeDbForTests();
    rmSync(outbox, { recursive: true, force: true });
  }
});
