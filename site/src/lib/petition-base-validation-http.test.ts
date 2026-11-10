import test from "node:test";
import assert from "node:assert/strict";
import { postBoundedValidationPdf } from "./petition-base-validation-http";
const input = { url: "http://127.0.0.1:1/qa", token: null, bytes: Buffer.from("%PDF-1.7 synthetic") };
const response = (value: Response) => (async () => value) as typeof fetch;
test("adapter transport bounds response bytes and rejects malformed UTF8, JSON, HTTP and content-type", async () => {
  for (const value of [new Response("{}", { status: 503, headers: { "content-type": "application/json" } }), new Response("{}"), new Response("bad", { headers: { "content-type": "application/json" } }), new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "999999" } }), new Response(" ".repeat(65_537), { headers: { "content-type": "application/json" } })]) assert.equal(await postBoundedValidationPdf(input, response(value)), null);
  assert.deepEqual(await postBoundedValidationPdf(input, response(new Response('{"ok":true}', { headers: { "content-type": "application/json" } }))), { ok: true });
});
test("deadline covers fetch and a stalled body, even when the transport ignores AbortSignal", async () => {
  let calls = 0, cancelled = false;
  const hang = (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch;
  assert.equal(await postBoundedValidationPdf(input, hang, 5), null); assert.equal(calls, 1);
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  assert.equal(await postBoundedValidationPdf(input, response(new Response(body, { headers: { "content-type": "application/json" } })), 5), null); assert.equal(cancelled, true);
});
