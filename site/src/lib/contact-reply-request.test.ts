import test from "node:test";
import assert from "node:assert/strict";
import { requestContactReply } from "./contact-reply-request";
const payload = { contactId: 7, modo: "enviar", assunto: "Assunto QA", corpo: "Mensagem fictícia preservada", selo: "same-intent", nova: false };

test("reply deadline aborts a pending explicit POST without retry or modifying intent", async () => {
  const before = structuredClone(payload); let calls = 0; let signal: AbortSignal | undefined;
  const fetcher = (async (url, init) => {
    calls++; assert.equal(url, "/api/admin/contato/responder"); assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin"); assert.deepEqual(JSON.parse(String(init?.body)), before);
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  }) as typeof fetch;
  await assert.rejects(requestContactReply(fetcher, payload, 10), { name: "AbortError" });
  assert.equal(signal?.aborted, true); assert.equal(calls, 1); assert.deepEqual(payload, before);
});

test("deadline remains active while response body is being read", async () => {
  let calls = 0, bodyStarted = false;
  const fetcher = (async (_url, init) => {
    calls++; const signal = init?.signal as AbortSignal;
    return { json: () => { bodyStarted = true; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Body aborted", "AbortError")), { once: true })); } } as Response;
  }) as typeof fetch;
  await assert.rejects(requestContactReply(fetcher, payload, 10), { name: "AbortError" });
  assert.equal(bodyStarted, true); assert.equal(calls, 1);
});

test("lost result after simulated server acceptance never causes a second POST", async () => {
  let accepted = 0; let calls = 0;
  const fetcher = (async () => { calls++; accepted++; throw new TypeError("Failed to fetch"); }) as typeof fetch;
  await assert.rejects(requestContactReply(fetcher, payload, 100), /Failed to fetch/);
  assert.equal(accepted, 1); assert.equal(calls, 1); assert.equal(payload.selo, "same-intent");
});

test("success keeps response contract and clears the abort timer", async () => {
  let signal: AbortSignal | undefined;
  const fetcher = (async (_url, init) => { signal = init?.signal as AbortSignal; return Response.json({ ok: true, texto: "na-fila", card: "agendado" }); }) as typeof fetch;
  const result = await requestContactReply(fetcher, payload, 10);
  assert.equal(result.response.status, 200); assert.deepEqual(result.value, { ok: true, texto: "na-fila", card: "agendado" });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(signal?.aborted, false);
});

test("HTTP errors and malformed JSON preserve existing caller classification without retry", async () => {
  let calls = 0;
  const http = await requestContactReply((async () => { calls++; return Response.json({ erro: "stepup" }, { status: 403 }); }) as typeof fetch, payload);
  assert.equal(http.response.status, 403); assert.equal(http.value.erro, "stepup");
  const invalid = await requestContactReply((async () => { calls++; return new Response("{"); }) as typeof fetch, payload);
  assert.deepEqual(invalid.value, {}); assert.equal(calls, 2);
});
