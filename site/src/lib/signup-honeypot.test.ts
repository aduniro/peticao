import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider } from "./cpf-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.TURNSTILE_SITE_KEY = "QA-SITE";
process.env.TURNSTILE_SECRET_KEY = "QA-SECRET";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-honeypot-${process.pid}`);
_setMxResolverForTests(async () => "ok");
const realFetch = globalThis.fetch;
const used = new Set<string>(); let checks = 0, unavailable = false, lookups = 0;
globalThis.fetch = (async (url: any, init: any) => {
  if (!String(url).includes("challenges.cloudflare.com")) return realFetch(url, init);
  checks++;
  if (unavailable) throw new Error("QA network unavailable");
  const token = new URLSearchParams(init.body).get("response") ?? "";
  const valid = token.startsWith("valid-") && !used.has(token); used.add(token);
  return { ok: true, json: async () => ({ success: valid }) } as Response;
}) as typeof fetch;
const cpf = "52998224725";
const form = (extra: object = {}) => ({ name: "Maria José da Silva", email: "qa-honey@gmail.com", cpf, category: "apoiador", city: "Porto Velho", uf: "RO", consent: true, website: "unintended autofill", turnstileToken: "valid-initial", ...extra });
const provider = mockProvider({ [cpf]: { nome: "MARIA JOSE DA SILVA", nasc: "15/08/1985", mae: "ANA DA SILVA" } });
const tracked = { name: provider.name, lookup: async (value: string) => { lookups++; return provider.lookup(value); } };
const ctx = { ip: "203.0.113.71" };
const countMail = () => { try { return readdirSync(process.env.MAIL_OUTBOX_DIR!).length; } catch { return 0; } };

test("honeypot recovery: campus correction, valid token, identity continuation and single registration", async () => {
  const db = await import("./db"); await db._openForTests("t_honeypot_recovery");
  const { handleSign } = await import("./sign-flow");
  const D = await import("./signup-diagnostics"); const { randomUUID } = await import("node:crypto");
  try {
    const invalidCampus = await handleSign(form({ category: "servidor", email: "qa@unir.br", institution: "UNIR", role: "docente", regionDeclared: true, campus: "", campusIbge: null }), ctx, tracked);
    assert.equal(invalidCampus.status, 422); assert.ok(invalidCampus.json.errors && (invalidCampus.json.errors as any).campus);
    assert.equal(checks, 0); assert.equal(lookups, 0);
    // A legitimate supporter is not discarded, and its token is not consumed twice.
    const trace = randomUUID();
    const first = await D.withSignupDiagnostics(trace, form(), p => handleSign(form(), ctx, p), tracked);
    assert.equal(first.json.identityRequired, true, JSON.stringify(first.json));
    assert.equal(checks, 1); assert.ok(first.json.securityProof); assert.equal(countMail(), 0);
    // An already-open old tab carries only ticket, not the new securityProof property.
    const second = await handleSign(form({ ticket: first.json.ticket, identity: { method: "nascimento", value: "15/08/1985" } }), ctx, tracked);
    assert.equal(second.json.ok, true, JSON.stringify(second.json)); assert.equal(checks, 1);
    assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 1); assert.equal(countMail(), 1);
    const meta = (await db.query("SELECT metadata FROM signup_diagnostics WHERE trace_id=$1", [trace])).rows[0].metadata;
    assert.ok(meta.marks.some((m: any) => m.code === "honeypot_detected"));
    assert.ok(meta.marks.some((m: any) => m.code === "honeypot_recovered"));
    assert.ok(!JSON.stringify(meta).includes("unintended autofill"));
    // A confirmed duplicate never creates a second signature or confirmation.
    await db.query("UPDATE signatures SET status='confirmed',confirmed_at=now()");
    await handleSign(form({ turnstileToken: "valid-duplicate" }), ctx, tracked);
    assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 1); assert.equal(countMail(), 1);
  } finally { await db._closeDbForTests(); rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true }); }
});

test("suspicious submission cannot fake success when security fails, expires, repeats or is unavailable", async () => {
  const db = await import("./db"); await db._openForTests("t_honeypot_rejected");
  const { handleSign } = await import("./sign-flow");
  try {
    const before = lookups;
    for (const token of ["", "invalid-token", "expired-token", "valid-initial"]) {
      const result = await handleSign(form({ turnstileToken: token }), ctx, tracked);
      assert.equal(result.status, 422); assert.equal(result.json.securityRetry, true); assert.equal(result.json.ok, undefined);
    }
    unavailable = true;
    assert.equal((await handleSign(form({ turnstileToken: "valid-unavailable" }), ctx, tracked)).json.securityRetry, true);
    unavailable = false;
    const siteKey = process.env.TURNSTILE_SITE_KEY; process.env.TURNSTILE_SITE_KEY = "";
    assert.equal((await handleSign(form({ turnstileToken: "valid-disabled" }), ctx, tracked)).json.securityRetry, true);
    process.env.TURNSTILE_SITE_KEY = siteKey;
    assert.equal(lookups, before); assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 0); assert.equal(countMail(), 0);
    // A forged proof does not skip verification or identity checks.
    const result = await handleSign(form({ ticket: "invalid", securityProof: "invalid", turnstileToken: "invalid-forgery", identity: { method: "nascimento", value: "15/08/1985" } }), ctx, tracked);
    assert.equal(result.json.securityRetry, true); assert.equal(lookups, before);
  } finally { unavailable = false; await db._closeDbForTests(); }
});

test("non-federal education domain remains rejected for servidor despite a valid challenge", async () => {
  const db = await import("./db"); await db._openForTests("t_honeypot_domain");
  const { handleSign } = await import("./sign-flow"); const I = await import("./institutional");
  try {
    assert.equal(await I.institutionalKind("qa@sou.ucpel.edu.br"), "ensino-edu-br");
    const before = lookups, challengeBefore = checks;
    const result = await handleSign(form({ category: "servidor", email: "qa@sou.ucpel.edu.br", institution: "UNIR", role: "docente", regionDeclared: true, campus: "Porto Velho", campusIbge: 1100205, turnstileToken: "valid-private-domain" }), ctx, tracked);
    assert.equal(result.status, 422); assert.ok((result.json.errors as any)?.email, JSON.stringify(result.json)); assert.equal(result.json.ok, undefined);
    assert.equal(checks, challengeBefore); assert.equal(lookups, before); assert.equal(countMail(), 0); assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 0);
    // A non-federal academic address can follow the supporter path, with CPF/identity still required.
    const supporter = form({ email: "qa@sou.ucpel.edu.br", turnstileToken: "valid-private-supporter" });
    const first = await handleSign(supporter, ctx, tracked);
    assert.equal(first.json.identityRequired, true, JSON.stringify(first.json)); assert.equal(countMail(), 0);
    const accepted = await handleSign({ ...supporter, ticket: first.json.ticket, securityProof: first.json.securityProof, identity: { method: "mae", value: "ANA DA SILVA" } }, ctx, tracked);
    assert.equal(accepted.json.ok, true, JSON.stringify(accepted.json)); assert.equal(countMail(), 1);
    assert.equal((await db.query("SELECT category FROM signatures")).rows[0].category, "apoiador");
  } finally { await db._closeDbForTests(); rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true }); }
});

test("servidor can correct campus and submit again with the same visible fields and a filled honeypot", async () => {
  const db = await import("./db"); await db._openForTests("t_honeypot_campus");
  const { handleSign } = await import("./sign-flow");
  try {
    const base = form({ category: "servidor", email: "qa-campus@unir.br", institution: "UNIR", role: "docente", regionDeclared: true, campus: "", campusIbge: null, turnstileToken: "valid-campus" });
    const before = checks;
    assert.equal((await handleSign(base, ctx, tracked)).status, 422);
    assert.equal(checks, before);
    const corrected = { ...base, campus: "Porto Velho", campusIbge: 1100205 };
    const result = await handleSign(corrected, ctx, tracked);
    assert.equal(result.json.ok, true, JSON.stringify(result.json)); assert.equal(checks, before + 1);
    const row = (await db.query("SELECT name,email,category,campus_ibge FROM signatures")).rows[0];
    assert.equal(row.name, base.name); assert.equal(row.email, base.email); assert.equal(row.category, "servidor");
    assert.equal(Number(row.campus_ibge), 1100205); assert.equal(countMail(), 1);
  } finally { await db._closeDbForTests(); rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true }); }
});

test("foreign university challenge is also consumed once and never invokes CPF", async () => {
  const db = await import("./db"); await db._openForTests("t_honeypot_foreign");
  const { handleSign } = await import("./sign-flow");
  try {
    const before = checks, beforeCpf = lookups;
    const result = await handleSign({ name: "Anna Beispiel", email: "qa@uni-heidelberg.de", category: "estrangeiro", country: "DE", university: "Universität Heidelberg", consent: true, website: "autofill", turnstileToken: "valid-foreign" }, ctx, null);
    assert.equal(result.json.ok, true, JSON.stringify(result.json)); assert.equal(checks, before + 1); assert.equal(lookups, beforeCpf);
    assert.equal((await db.query("SELECT category FROM signatures")).rows[0].category, "estrangeiro"); assert.equal(countMail(), 1);
  } finally { await db._closeDbForTests(); rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true }); globalThis.fetch = realFetch; }
});

test("new requests reject other public-sector domains while preserving historical signatures and curation", async () => {
  const db = await import("./db"); await db._openForTests("t_ifes_only_new");
  const { handleSign } = await import("./sign-flow");
  const { validateEmailField } = await import("./email-validate");
  const I = await import("./institutional");
  try {
    await db.query("INSERT INTO institutional_domains(domain,kind,status,source) VALUES('orgao-federal.example','federal','approved','manual'),('orgao-municipal.example','municipal','approved','manual'),('curadoria-outro.example','outro','approved','manual')"); I._clearDomainCache();
    await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status,confirmed_at,seq) VALUES('Pessoa Histórica','qa@orgao.gov.br','QA-LEGACY-HASH','QA-LEGACY-CPF','servidor','QA','2026-10-01T10:00:00Z','2026-10-01T10:00:00Z','confirmed','2026-10-01T10:10:00Z',11)");
    const before = JSON.stringify((await db.query("SELECT row_to_json(s) record FROM signatures s")).rows);
    const curationBefore = JSON.stringify((await db.query("SELECT row_to_json(d) record FROM institutional_domains d WHERE status='approved' ORDER BY domain")).rows);
    const priorLookups = lookups;
    for (const domain of ["orgao.gov.br", "camara.leg.br", "tribunal.jus.br", "orgao.mp.br", "orgao-federal.example", "orgao-municipal.example", "curadoria-outro.example", "sou.ucpel.edu.br"]) {
      const email = `qa@${domain}`;
      assert.equal((await validateEmailField(email, "servidor")).ok, false, domain);
      assert.equal((await validateEmailField(email, "apoiador")).ok, true, domain);
      const result = await handleSign(form({ category: "servidor", email, institution: "UNIR", role: "docente", regionDeclared: true, campus: "Porto Velho", campusIbge: 1100205, turnstileToken: "valid-public-sector" }), ctx, tracked);
      assert.equal(result.status, 422, domain); assert.ok((result.json.errors as any)?.email, JSON.stringify(result.json));
    }
    assert.equal(lookups, priorLookups); assert.equal(countMail(), 0);
    assert.equal(JSON.stringify((await db.query("SELECT row_to_json(s) record FROM signatures s")).rows), before);
    assert.equal(JSON.stringify((await db.query("SELECT row_to_json(d) record FROM institutional_domains d WHERE status='approved' ORDER BY domain")).rows), curationBefore);
  } finally { await db._closeDbForTests(); }
});
