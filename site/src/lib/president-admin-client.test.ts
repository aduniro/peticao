import test from "node:test";
import assert from "node:assert/strict";
import { presidentAdminRequest } from "./president-admin-client";
const requestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("admin transport: one POST, exact intent, same-origin credentials and no redirects", async () => {
  let calls = 0;
  const input = { requestId, batchId: 1 };
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "/api/admin/presidente/desafio");
    assert.equal(init?.method, "POST"); assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.equal(init.referrerPolicy, "no-referrer");
    assert.deepEqual(JSON.parse(String(init.body)), input);
    return json({ ok: true, id: requestId });
  };
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/desafio", "POST", input, transport), { ok: true, data: { ok: true, id: requestId } });
  assert.equal(calls, 1);
});
test("admin transport: exact GET recovery has no request body", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => { calls++; assert.equal(url, `/api/admin/presidente/desafio?requestId=${requestId}`); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); return json({ ok: true }); };
  assert.ok((await presidentAdminRequest(`/api/admin/presidente/desafio?requestId=${requestId}`, "GET", undefined, transport)).ok);
  assert.equal(calls, 1);
});
test("admin transport: allowlist and bounded body reject before network", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return json({ ok: true }); };
  for (const path of ["https://other.test/api/admin/presidente/perfil", "/api/presidente/estado", "/api/admin/presidente/desafio?requestId=bad", `/api/admin/presidente/desafio?requestId=${requestId}&token=secret`, "/api/admin/presidente/perfil#fragment"]) assert.deepEqual(await presidentAdminRequest(path, "GET", undefined, transport), { ok: false, kind: "invalid" });
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/perfil", "GET", {}, transport), { ok: false, kind: "invalid" });
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/perfil", "POST", { cpf: "x".repeat(2050) }, transport), { ok: false, kind: "invalid" });
  assert.equal(calls, 0);
});
test("admin transport: lost mutation response is uncertain with no automatic retry", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error("response lost"); };
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/desafio", "POST", { requestId }, transport), { ok: false, kind: "uncertain" });
  assert.equal(calls, 1);
});
test("admin transport: HTTP failure remains distinguishable from absent recovery", async () => {
  for (const status of [401, 403, 404, 409, 429, 503]) {
    let calls = 0;
    assert.deepEqual(await presidentAdminRequest(`/api/admin/presidente/desafio?requestId=${requestId}`, "GET", undefined, async () => { calls++; return new Response(null, { status }); }), { ok: false, kind: "http", status });
    assert.equal(calls, 1);
  }
});
test("admin transport: malformed/oversized and non-JSON responses are rejected", async () => {
  for (const response of [new Response("{}", { headers: { "content-type": "text/html" } }), new Response("{", { headers: { "content-type": "application/json" } }), json([]), json({ data: "x".repeat(17000) }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "999999" } })]) assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/perfil", "GET", undefined, async () => response), { ok: false, kind: "invalid" });
});
test("admin transport: nonresponsive fetch returns within deadline and aborts", async () => {
  let calls = 0; let signal: AbortSignal | null = null;
  const transport: typeof fetch = async (_url, init) => { calls++; signal = init?.signal ?? null; return new Promise<Response>(() => {}); };
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/desafio", "POST", { requestId }, transport, 5), { ok: false, kind: "uncertain" });
  assert.equal(calls, 1); assert.equal((signal as AbortSignal | null)?.aborted, true);
});
test("admin transport: stalled response body is bounded by the same deadline", async () => {
  let cancelled = false;
  const transport: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
  assert.deepEqual(await presidentAdminRequest("/api/admin/presidente/desafio", "POST", { requestId }, transport, 5), { ok: false, kind: "uncertain" });
  assert.equal(cancelled, true);
});
