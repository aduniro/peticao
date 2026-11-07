import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
(process.env as Record<string,string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
async function setup() {
  const db = await import("./db"); await db._openForTests("t_signup_diagnostics");
  const D = await import("./signup-diagnostics"); return { db, D };
}
const body = { name: "Ana da Silva", email: "qa-contact@example.test", cpf: "52998224725", consent: true, category: "apoiador", identity: { method: "mae", value: "NEVER_INPUT_MOTHER" }, birth: "NEVER_INPUT_BIRTH", turnstileToken: "NEVER_TOKEN" };
const registry = { nome: "ANA DA SILVA", mae: "NEVER_API_MOTHER", nasc: "1990-01-01", sexo: "F" };

test("browser diagnostics reject personal values and hashes; only fixed event identifiers are accepted", async () => {
  const { parseBrowserDiagnostic } = await import("./signup-diagnostics");
  const valid = { trace: randomUUID(), event: "field_touched", field: "email", category: "apoiador" };
  assert.ok(parseBrowserDiagnostic(valid));
  for (const extra of [{ email: "qa@example.test" }, { cpf: "52998224725" }, { mother_hash: "hash" }, { snapshot: {} }, { name: "Ana" }]) assert.equal(parseBrowserDiagnostic({ ...valid, ...extra }), null);
  assert.equal(parseBrowserDiagnostic({ ...valid, field: ["cpf"] }), null);
  assert.equal(parseBrowserDiagnostic({ ...valid, trace: "invalid" }), null);
});

test("learning reasons distinguish word boundaries, ordering and insufficient words without storing tokens", async () => {
  const { explainName } = await import("./signup-diagnostics");
  assert.equal(explainName("JOAO SANTOS", "Joao San Tos").reason, "word_boundaries");
  assert.equal(explainName("JOAO SANTOS", "JoaoSantos").reason, "word_boundaries");
  assert.equal(explainName("JOAO SILVA SANTOS", "Santos Silva Joao").reason, "word_order");
  assert.equal(explainName("JOAO SILVA SOUZA SANTOS", "Joao Santos").reason, "insufficient_words");
  assert.ok(!JSON.stringify(explainName("JOAO SANTOS", "Joao San Tos")).toLowerCase().includes("joao"));
});

test("server diagnostics encrypt submitted contacts and never retain CPF, name, identity or registry values", async () => {
  const c = await setup();
  try {
    const answer = await c.D.withSignupDiagnostics(randomUUID(), body, async p => { assert.ok(await p!.lookup(body.cpf)); c.D.diagnosticMark("identity", "name_mismatch", "mae"); return { status: 422, json: { errors: { cpf: "cpf_invalid" } } }; }, { name: "mock", lookup: async () => registry });
    assert.equal(answer.status, 422);
    const rows = (await c.db.query("SELECT row_to_json(d)::text data FROM signup_diagnostics d")).rows; assert.equal(rows.length, 1);
    for (const value of [body.email, body.name, body.cpf, registry.nome, registry.mae, registry.nasc, "NEVER_INPUT", "NEVER_TOKEN"]) assert.ok(!rows[0].data.includes(value), value);
    const meta = await c.D.readSignupDiagnostics(10, false); assert.equal(meta[0].email, undefined); assert.equal(meta[0].email_cipher, undefined);
    assert.equal((await c.D.readSignupDiagnostics(10, true))[0].email, body.email);
    assert.equal((await c.db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("no contact is stored without consent or from browser telemetry; duplicate is explicitly classified", async () => {
  const c = await setup();
  try {
    await c.D.withSignupDiagnostics(randomUUID(), { ...body, consent: false }, async () => ({ status: 422, json: { errors: { consent: "consent_required" } } }), null);
    await c.D.withSignupDiagnostics(randomUUID(), body, async () => { c.D.diagnosticMark("submission", "duplicate"); return { status: 200, json: { ok: true } }; }, null);
    const browser = c.D.parseBrowserDiagnostic({ trace: randomUUID(), event: "page_exit" }); assert.ok(browser); await c.D.persistDiagnostic(browser);
    const rows = (await c.db.query("SELECT source,classification,email_cipher FROM signup_diagnostics ORDER BY ts")).rows;
    assert.equal(rows[0].email_cipher, null); assert.equal(rows[1].classification, "duplicate"); assert.equal(rows[2].email_cipher, null);
  } finally { await c.db._closeDbForTests(); }
});

test("a diagnostic write failure cannot turn signup success into failure", async () => {
  const c = await setup();
  try {
    await c.D.persistDiagnostic({ trace: randomUUID(), source: "server", classification: "fixture", category: null, status: 200, ms: 1, metadata: {} });
    await c.db.query("CREATE FUNCTION fail_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA'; END $$; CREATE TRIGGER fail_diagnostic BEFORE INSERT ON signup_diagnostics FOR EACH ROW EXECUTE FUNCTION fail_diagnostic()");
    const expected = { status: 200, json: { ok: true } };
    assert.deepEqual(await c.D.withSignupDiagnostics(randomUUID(), body, async () => expected, null), expected);
  } finally { await c.db._closeDbForTests(); }
});

test("expiration excludes contact reads before cleanup and purge preserves live records", async () => {
  const c = await setup();
  try {
    for (let i = 0; i < 2; i++) await c.D.withSignupDiagnostics(randomUUID(), body, async () => ({ status: 422, json: {} }), null);
    await c.db.query("UPDATE signup_diagnostics SET expires_at=now()-interval '1 second' WHERE id=(SELECT id FROM signup_diagnostics LIMIT 1)");
    assert.equal((await c.D.readSignupDiagnostics(10, true)).length, 1); assert.equal(await c.D.purgeSignupDiagnostics(), 1);
    assert.equal((await c.db.query("SELECT 1 FROM signup_diagnostics")).rowCount, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("concurrent diagnostic scopes remain independent and frontend never reads field values", async () => {
  const c = await setup();
  try {
    await Promise.all(["match", "mismatch"].map(code => c.D.withSignupDiagnostics(randomUUID(), body, async () => { await new Promise(r => setTimeout(r, 10)); c.D.diagnosticMark("name", code, "nome"); return { status: 422, json: {} }; }, null)));
    const rows = (await c.db.query("SELECT metadata,learning_index FROM signup_diagnostics")).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every(r => r.metadata.marks.length === 1)); assert.notEqual(rows[0].learning_index, rows[1].learning_index);
    const code = readFileSync(new URL("../components/FormDiagnostics.tsx", import.meta.url), "utf8"); assert.ok(!code.includes(".value") && !code.includes("FormData"));
  } finally { await c.db._closeDbForTests(); }
});
