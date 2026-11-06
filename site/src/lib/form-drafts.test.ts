import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
const secret = "draft-encryption-fixture-exclusive-key-at-least-32";
const token = () => randomBytes(32).toString("base64url");
const input = (stage = "editing") => ({ optIn: true, stage, snapshot: { name: "Ana Souza", email: "ana@example.test", cpf: "529.982.247-25", category: "apoiador", city: "Cidade Fictícia", uf: "RO", consent: false, mother: "NEVER_STORE_MOTHER", birth: "01/01/1990", identity: { method: "mae", value: "NEVER_STORE" } }, mother: "NEVER_STORE", birth: "NEVER_STORE" });

test("rascunhos: whitelist, CPF só hash, campos de desafio ignorados e opção explícita", async () => {
  const { sanitizeFormDraft, formDraftsEnabled } = await import("./form-drafts");
  const { hmac } = await import("./security");
  delete process.env.FORM_DRAFTS_ENABLED; delete process.env.FORM_DRAFT_ENCRYPTION_KEY;
  assert.equal(formDraftsEnabled(), false);
  assert.throws(() => sanitizeFormDraft({ optIn: false }), /opt_in/);
  const safe = sanitizeFormDraft(input());
  assert.equal(safe.cpf_hash, hmac("52998224725"));
  assert.equal(safe.consent, false);
  assert.equal(safe.name, "Ana Souza");
  const serialized = JSON.stringify(safe);
  assert.ok(!serialized.includes("52998224725") && !serialized.includes("529.982.247-25"));
  assert.ok(!serialized.includes("NEVER_STORE") && !serialized.includes("1990"));
  const pasted = sanitizeFormDraft({ optIn: true, stage: "browser_invalid", invalidFields: ["cpf", "mother", "birth", "name"], snapshot: { name: "Pessoa 529.982.247-25", cpf: "529" } });
  assert.equal(pasted.name, "Pessoa [CPF omitido]");
  assert.deepEqual(pasted.invalid_fields, ["cpf", "name"]);
  assert.equal(pasted.cpf_hash, undefined);
  process.env.FORM_DRAFTS_ENABLED = "1"; process.env.FORM_DRAFT_ENCRYPTION_KEY = "short";
  assert.equal(formDraftsEnabled(), false);
});

test("rascunhos: cifragem, limite40, ordem, revogação e prazo absoluto30dias", async () => {
  process.env.FORM_DRAFTS_ENABLED = "1"; process.env.FORM_DRAFT_ENCRYPTION_KEY = secret;
  const db = await import("./db"); await db._openForTests("t_form_drafts");
  const { saveFormDraft, decryptFormDraft, withdrawFormDraft, purgeExpiredFormDrafts, FORM_DRAFT_EVENT_LIMIT } = await import("./form-drafts");
  const { sha256 } = await import("./security");
  const id = token(), now = Date.now();
  try {
    assert.deepEqual(await saveFormDraft(id, 1, input("opt_in"), now), { saved: true });
    assert.deepEqual(await saveFormDraft(id, 1, input(), now + 100), { saved: false });
    for (let i = 2; i <= 44; i++) await saveFormDraft(id, i, input(), now + i * 100);
    const row = (await db.query("SELECT * FROM form_draft_cache WHERE draft_hash=$1", [sha256(id)])).rows[0];
    assert.ok(!JSON.stringify(row).includes("Ana Souza") && !JSON.stringify(row).includes("52998224725"));
    assert.ok(!JSON.stringify(row).includes(id));
    const decoded = decryptFormDraft(row.payload, sha256(id));
    assert.equal(decoded?.events.length, FORM_DRAFT_EVENT_LIMIT);
    assert.equal(decoded?.events.at(-1)?.sequence, 44);
    assert.equal(decoded?.events.at(-1)?.snapshot.name, "Ana Souza");
    assert.equal(new Date(row.expires_at).getTime(), now + 30 * 86400_000);
    assert.equal(decryptFormDraft(row.payload, sha256(token())), null);
    assert.deepEqual(await saveFormDraft(id, 45, input(), now + 31 * 86400_000), { saved: false });
    await withdrawFormDraft(id, now + 1000);
    assert.equal((await db.query("SELECT count(*)::int n FROM form_draft_cache")).rows[0].n, 0);
    assert.deepEqual(await saveFormDraft(id, 46, input(), now + 2000), { saved: false });
    await saveFormDraft(token(), 1, input(), now);
    delete process.env.FORM_DRAFTS_ENABLED;
    assert.equal(await purgeExpiredFormDrafts(now + 31 * 86400_000), 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM form_draft_revocations")).rows[0].n, 0);
  } finally { await db._closeDbForTests(); delete process.env.FORM_DRAFTS_ENABLED; delete process.env.FORM_DRAFT_ENCRYPTION_KEY; }
});

test("rascunhos: endpoint exige origem, corpo limitado, opt-in e recurso disponível", async () => {
  process.env.APP_URL = "http://localhost:3000";
  const { POST } = await import("../app/api/form-draft/route");
  const { NextRequest } = await import("next/server");
  const { FORM_DRAFT_BODY_LIMIT } = await import("./form-drafts");
  const request = (data: unknown, origin = "http://localhost:3000", type = "application/json") => new NextRequest("http://localhost:3000/api/form-draft", { method: "POST", headers: { origin, "content-type": type }, body: typeof data === "string" ? data : JSON.stringify(data) });
  assert.equal((await POST(request({}, "https://evil.example"))).status, 403);
  assert.equal((await POST(request({}, "http://localhost:3000", "application/x-www-form-urlencoded"))).status, 415);
  assert.equal((await POST(request("x".repeat(FORM_DRAFT_BODY_LIMIT + 1)))).status, 413);
  delete process.env.FORM_DRAFTS_ENABLED;
  assert.equal((await POST(request({ token: token(), sequence: 1, ...input() }))).status, 503);
  process.env.FORM_DRAFTS_ENABLED = "1"; process.env.FORM_DRAFT_ENCRYPTION_KEY = secret;
  assert.equal((await POST(request({ token: token(), sequence: 1, optIn: false }))).status, 400);
  assert.equal((await POST(request({ token: "bad", sequence: 1, ...input() }))).status, 400);
  delete process.env.FORM_DRAFTS_ENABLED; delete process.env.FORM_DRAFT_ENCRYPTION_KEY;
});

test("rascunhos: cliente não recebe desafios nem modifica avisos existentes", () => {
  const component = readFileSync(new URL("../components/FormDraftCapture.tsx", import.meta.url), "utf8");
  assert.ok(component.includes('process.env.NEXT_PUBLIC_FORM_DRAFTS === "1"'));
  assert.ok(component.includes("if (!available || completed || !active.current || !token.current) return"));
  assert.ok(!component.includes("sessionStorage"));
  assert.ok(component.includes("loadDraftCapability(storage.current)"));
  const form = readFileSync(new URL("../components/SignForm.tsx", import.meta.url), "utf8");
  assert.ok(form.includes('<input type="checkbox" name="consent" /> <span>{foreign ? consentForeign : consentBr}</span>'));
  assert.ok(form.includes('{foreign ? t("f.privacyForeign") : t("f.privacy")}'));
});

test("rascunhos: concorrência entre salvamento e retirada não restaura dados", async () => {
  process.env.FORM_DRAFTS_ENABLED = "1"; process.env.FORM_DRAFT_ENCRYPTION_KEY = secret;
  const db = await import("./db"); await db._openForTests("t_form_draft_races");
  const { saveFormDraft, withdrawFormDraft } = await import("./form-drafts");
  const id = token();
  try {
    await Promise.all([saveFormDraft(id, 1, input()), withdrawFormDraft(id), saveFormDraft(id, 2, input("hidden"))]);
    assert.equal((await db.query("SELECT count(*)::int n FROM form_draft_cache")).rows[0].n, 0);
    assert.deepEqual(await saveFormDraft(id, 3, input()), { saved: false });
  } finally { await db._closeDbForTests(); delete process.env.FORM_DRAFTS_ENABLED; delete process.env.FORM_DRAFT_ENCRYPTION_KEY; }
});

test("rascunhos: POST de beacon e retirada aceitos sem expor qualquer dado", async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.FORM_DRAFTS_ENABLED = "1"; process.env.FORM_DRAFT_ENCRYPTION_KEY = secret;
  const db = await import("./db"); await db._openForTests("t_form_draft_beacon");
  const { POST } = await import("../app/api/form-draft/route");
  const { NextRequest } = await import("next/server");
  const id = token();
  const req = (body: unknown) => new NextRequest("http://localhost:3000/api/form-draft", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "text/plain" }, body: JSON.stringify(body) });
  try {
    const result = await POST(req({ token: id, sequence: 1, ...input("hidden") }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, saved: true });
    assert.equal((await POST(req({ token: id, action: "withdraw" }))).status, 200);
    assert.equal((await db.query("SELECT count(*)::int n FROM form_draft_cache")).rows[0].n, 0);
  } finally { await db._closeDbForTests(); delete process.env.FORM_DRAFTS_ENABLED; delete process.env.FORM_DRAFT_ENCRYPTION_KEY; }
});
