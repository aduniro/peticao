import test from "node:test";
import assert from "node:assert/strict";
import { ownPdfDownloadPath, ownPdfIntent, ownPdfMetadata, ownPdfRequest, type OwnPdfIntent } from "./president-own-document-client";
const intent: OwnPdfIntent = { requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", batchId: 1, receiptId: "11111111-2222-4333-8444-555555555555", expectedDocumentVersion: "a".repeat(64) };
const artifactId = "22222222-3333-4444-8555-666666666666";
const metadata = (state = "completed") => ({ ok: true, document: { source: "president-own", dispatchAllowed: false, icpBrasil: false, govBr: false, requestId: intent.requestId, state, artifactId: state === "completed" ? artifactId : null, batchId: intent.batchId, receiptId: intent.receiptId, documentVersion: intent.expectedDocumentVersion, sha256: state === "completed" ? "b".repeat(64) : null, sourceSha256: state === "completed" ? "c".repeat(64) : null, error: state === "failed" ? "render_failed" : null, createdAt: "2026-11-10T10:00:00.000Z" } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("own PDF browser intent keeps only bounded exact context", () => {
  assert.deepEqual(ownPdfIntent(intent), intent);
  for (const value of [{ ...intent, token: "not-allowed" }, { ...intent, batchId: 0 }, { ...intent, receiptId: "bad" }, { ...intent, expectedDocumentVersion: "A".repeat(64) }, [], null]) assert.equal(ownPdfIntent(value), null);
});
test("own PDF metadata requires exact receipt, document, batch and nonce", () => {
  assert.ok(ownPdfMetadata(metadata(), intent));
  for (const patch of [{ requestId: artifactId }, { receiptId: artifactId }, { batchId: 2 }, { documentVersion: "f".repeat(64) }, { source: "icp-brasil" }, { dispatchAllowed: true }, { icpBrasil: true }, { govBr: true }, { createdAt: "bad" }]) assert.equal(ownPdfMetadata({ ok: true, document: { ...metadata().document, ...patch } }, intent), null);
});
test("own PDF metadata separates pending, failed and completed without fabricated download", () => {
  const pending = ownPdfMetadata(metadata("pending"), intent), failed = ownPdfMetadata(metadata("failed"), intent), completed = ownPdfMetadata(metadata(), intent);
  assert.ok(pending && failed && completed);
  assert.equal(ownPdfDownloadPath(pending), null); assert.equal(ownPdfDownloadPath(failed), null);
  assert.equal(ownPdfDownloadPath(completed), `/api/admin/presidente/documentos-proprios/${artifactId}`);
  for (const d of [{ ...metadata("pending").document, artifactId }, { ...metadata().document, sha256: null }, { ...metadata().document, error: "render_failed" }, { ...metadata("failed").document, error: null }]) assert.equal(ownPdfMetadata({ ok: true, document: d }, intent), null);
});
test("own PDF transport POST202 pending is success, same-origin and only one attempt", async () => {
  let calls = 0;
  const result = await ownPdfRequest("POST", intent, async (url, init) => {
    calls++; assert.equal(url, "/api/admin/presidente/documentos-proprios"); assert.equal(init?.method, "POST"); assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init.body)), intent); return json(metadata("pending"), 202);
  });
  assert.ok(result.ok); assert.equal(calls, 1);
});
test("own PDF GET recovery contains only request UUID and never a body", async () => {
  let calls = 0;
  const result = await ownPdfRequest("GET", intent.requestId, async (url, init) => { calls++; assert.equal(url, `/api/admin/presidente/documentos-proprios?requestId=${intent.requestId}`); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); return json(metadata()); });
  assert.ok(result.ok); assert.equal(calls, 1);
});
test("own PDF transport rejects invalid context before network", async () => {
  let calls = 0; const transport: typeof fetch = async () => { calls++; return json(metadata()); };
  assert.deepEqual(await ownPdfRequest("GET", intent, transport), { ok: false, kind: "invalid" });
  assert.deepEqual(await ownPdfRequest("POST", "https://other.test", transport), { ok: false, kind: "invalid" });
  assert.deepEqual(await ownPdfRequest("GET", `${intent.requestId}&token=secret`, transport), { ok: false, kind: "invalid" });
  assert.equal(calls, 0);
});
test("own PDF mutation response loss is uncertain without retry", async () => {
  let calls = 0; const result = await ownPdfRequest("POST", intent, async () => { calls++; throw new Error("lost response"); });
  assert.deepEqual(result, { ok: false, kind: "uncertain" }); assert.equal(calls, 1);
});
test("own PDF HTTP states are preserved for explicit recovery", async () => {
  for (const status of [401, 403, 404, 409, 429, 503]) assert.deepEqual(await ownPdfRequest("GET", intent.requestId, async () => new Response(null, { status })), { ok: false, kind: "http", status });
});
test("own PDF responses are bounded and require JSON objects", async () => {
  for (const response of [json([]), new Response("broken", { headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "text/html" } }), json({ giant: "x".repeat(17000) })]) assert.deepEqual(await ownPdfRequest("GET", intent.requestId, async () => response), { ok: false, kind: "invalid" });
});
test("own PDF fetch timeout aborts once; stalled body has same deadline", async () => {
  let calls = 0, signal: AbortSignal | null = null;
  const r = await ownPdfRequest("POST", intent, async (_url, init) => { calls++; signal = init?.signal ?? null; return new Promise<Response>(() => {}); }, 5);
  assert.deepEqual(r, { ok: false, kind: "uncertain" }); assert.equal(calls, 1); assert.equal((signal as AbortSignal | null)?.aborted, true);
  let cancelled = false;
  const stalled = await ownPdfRequest("GET", intent.requestId, async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }), 5);
  assert.deepEqual(stalled, { ok: false, kind: "uncertain" }); assert.equal(cancelled, true);
});
