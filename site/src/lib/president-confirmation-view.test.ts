import test from "node:test";
import assert from "node:assert/strict";
import { confirmationOutcome, confirmationState, isPresidentToken, issuedChallengeView, postPresidentConfirmation, postPresidentRead, postPresidentIssue, presidentChallengeLink, presidentFieldErrors } from "./president-confirmation-view";

const token = "A".repeat(43), password = "FICTICIO0000", receiptId = "00000000-0000-4000-8000-000000000001";
const accepted = { ok: true, receiptId, assurance: "own-confirmation", icpBrasil: false, govBr: false };
const now = Date.parse("2026-11-09T12:00:00Z");

test("v1 token/password and date/CPF validation match the existing API without copying values to errors", () => {
  assert.equal(isPresidentToken(token), true);
  for (const value of ["A".repeat(42), "A".repeat(44), "https://example.test/", null]) assert.equal(isPresidentToken(value), false);
  const fields = { password: "short", cpf: "000.000.000-00", birthDate: "31/02/2000" };
  assert.deepEqual(presidentFieldErrors(fields, new Date(now)), { password: "invalid", cpf: "invalid", birthDate: "invalid" });
  assert.ok(!JSON.stringify(presidentFieldErrors(fields)).includes(fields.cpf));
  for (const birthDate of ["01/01/2000", "2000-01-01"]) assert.equal(presidentFieldErrors({ password, cpf: "00000000000", birthDate }, new Date(now)).birthDate, undefined);
  for (const birthDate of ["1899-11-30", "2999-01-01", "2000-02-31", "01/01/2000 EXTRA"]) assert.equal(presidentFieldErrors({ password, cpf: "00000000000", birthDate }, new Date(now)).birthDate, "invalid");
});

test("state prevents double submit, stale results, retry of uncertain result and post-success submission", () => {
  const first = confirmationState({ phase: "idle", requestId: 0 }, { type: "begin", requestId: 1 });
  assert.equal(first.phase, "submitting"); assert.equal(confirmationState(first, { type: "begin", requestId: 2 }), first);
  assert.equal(confirmationState(first, { type: "result", requestId: 0, result: { kind: "rejected" } }), first);
  for (const outcome of [{ kind: "uncertain" }, { kind: "confirmed", receiptId }] as const) {
    const end = confirmationState(first, { type: "result", requestId: 1, result: outcome });
    assert.equal(confirmationState(end, { type: "begin", requestId: 2 }), end);
  }
  const rejected = confirmationState(first, { type: "result", requestId: 1, result: { kind: "rejected" } });
  assert.equal(confirmationState(rejected, { type: "begin", requestId: 2 }).phase, "submitting");
  assert.equal(confirmationState(rejected, { type: "begin", requestId: 1 }), rejected);
});

test("only a complete own-confirmation receipt is displayed; no ICP/Gov.br inference", () => {
  assert.deepEqual(confirmationOutcome(200, accepted), { kind: "confirmed", receiptId });
  for (const body of [null, {}, { ...accepted, icpBrasil: true }, { ...accepted, govBr: true }, { ...accepted, assurance: "icp" }, { ...accepted, receiptId: "bad" }, { ...accepted, ok: false }]) assert.deepEqual(confirmationOutcome(200, body), { kind: "uncertain" });
  for (const status of [400, 403, 413, 415, 429]) assert.deepEqual(confirmationOutcome(status, null), { kind: "rejected" });
  assert.deepEqual(confirmationOutcome(409, { ok: false, error: "unavailable" }), { kind: "rejected" });
  assert.deepEqual(confirmationOutcome(503, { ok: false, error: "unavailable" }), { kind: "uncertain" });
});

test("transport sends exactly one same-origin POST and never persists or repeats after lost response", async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  // Deliberately invalid synthetic CPF: this test exercises transport only, no identity service.
  const input = { token, password, cpf: "000.000.000-00", birthDate: "2000-01-01" };
  const transport = (async (url, options) => { requests.push({ url: String(url), options: options! }); throw new Error("FICTITIOUS RESPONSE LOSS"); }) as typeof fetch;
  assert.deepEqual(await postPresidentConfirmation(input, transport), { kind: "uncertain" }); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/presidente/confirmar"); assert.equal(requests[0].options.cache, "no-store"); assert.equal(requests[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), { token, password, cpf: "00000000000", birthDate: input.birthDate });
  assert.equal(Object.keys(requests[0].options).some(k => /storage|log|retry/i.test(k)), false);
  assert.deepEqual(await postPresidentConfirmation({ ...input, token: "invalid" }, transport), { kind: "rejected" }); assert.equal(requests.length, 1);
});

test("malformed/lost success remains uncertain and a valid receipt reveals only its ID", async () => {
  for (const response of [new Response("<html>FICTITIOUS</html>"), Response.json({ ...accepted, receiptId: null })]) {
    assert.deepEqual(await postPresidentConfirmation({ token, password, cpf: "00000000000", birthDate: "2000-01-01" }, (async () => response) as typeof fetch), { kind: "uncertain" });
  }
  assert.deepEqual(await postPresidentConfirmation({ token, password, cpf: "00000000000", birthDate: "2000-01-01" }, (async () => Response.json({ ...accepted, ignored: "NEVER_DISPLAY" })) as typeof fetch), { kind: "confirmed", receiptId });
});

test("issue response is bounded, picked and tied to the issued document revision without trusting client clock", () => {
  const issued = { ok: true, id: receiptId, token, password, expiresAt: now + 600_000, documentVersion: "a".repeat(64), ignored: "NEVER_DISPLAY" };
  const picked = issuedChallengeView(issued); assert.ok(picked); assert.ok(!JSON.stringify(picked).includes("NEVER_DISPLAY"));
  assert.ok(issuedChallengeView({ ...issued, expiresAt: now - 1 }), "Server remains authoritative for expiry; client clock cannot discard a valid response");
  for (const body of [{ ...issued, expiresAt: 0 }, { ...issued, expiresAt: 8_640_000_000_000_001 }, { ...issued, token: "bad" }, { ...issued, password: "bad" }, { ...issued, documentVersion: "a".repeat(63) }]) assert.equal(issuedChallengeView(body), null);
});

test("links carry only opaque token, stay on trusted origin and never include password/CPF/birth", () => {
  assert.equal(presidentChallengeLink("https://example.test", token), "https://example.test/assinar-lote/" + token);
  assert.ok(presidentChallengeLink("http://127.0.0.1:3049", token));
  for (const origin of ["javascript:alert(1)", "https://user:pass@example.test", "https://example.test/path", "https://example.test?password=FICTITIOUS", "http://public.example.test"]) assert.equal(presidentChallengeLink(origin, token), null);
});


test("read contracts send only token/password, never identity values or a confirmation POST", async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  const transport = (async (url, options) => { requests.push({ url: String(url), options: options! }); return new Response("FICTITIOUS READ", { status: 200 }); }) as typeof fetch;
  for (const action of ["documento", "estado"] as const) assert.equal((await postPresidentRead(action, { token, password }, transport)).kind, "received");
  assert.deepEqual(requests.map(r => r.url), ["/api/presidente/documento", "/api/presidente/estado"]);
  for (const request of requests) { assert.equal(request.options.method, "POST"); assert.deepEqual(JSON.parse(String(request.options.body)), { token, password }); assert.equal(request.options.cache, "no-store"); assert.equal(request.url.includes(token), false); }
  const before = requests.length;
  assert.equal((await postPresidentRead("documento", { token, password: "bad" }, transport)).kind, "rejected"); assert.equal(requests.length, before);
  let calls = 0;
  assert.equal((await postPresidentRead("estado", { token, password }, (async () => { calls++; throw new Error("FICTITIOUS LOSS"); }) as typeof fetch)).kind, "uncertain"); assert.equal(calls, 1);
});

test("untrusted error objects cannot throw or reveal contents in the view parser", () => {
  assert.deepEqual(confirmationOutcome(409, { ok: false, error: { toString: null } }), { kind: "uncertain" });
  assert.deepEqual(confirmationOutcome(409, { ok: false, error: null }), { kind: "uncertain" });
});


test("admin issue is explicit, single-attempt, body-only batch ID and secret response picked once", async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  const body = { ok: true, id: receiptId, token, password, expiresAt: now + 600_000, documentVersion: "a".repeat(64) };
  const view = await postPresidentIssue(7, (async (url, options) => { requests.push({ url: String(url), options: options! }); return Response.json(body); }) as typeof fetch);
  assert.equal(view.kind, "issued"); assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/admin/presidente/desafio"); assert.deepEqual(JSON.parse(String(requests[0].options.body)), { batchId: 7 });
  let calls = 0;
  assert.deepEqual(await postPresidentIssue(7, (async () => { calls++; throw new Error("FICTITIOUS LOST ISSUE"); }) as typeof fetch), { kind: "uncertain" }); assert.equal(calls, 1);
  assert.deepEqual(await postPresidentIssue(0, (async () => { calls++; return Response.json(body); }) as typeof fetch), { kind: "rejected" }); assert.equal(calls, 1);
});
