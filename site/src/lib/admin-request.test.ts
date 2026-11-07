import test from "node:test";
import assert from "node:assert/strict";
import { adminJsonRequest } from "./admin-request";

test("admin request uses one same-origin attempt and returns network failure without throwing or retrying", async () => {
  let calls = 0;
  const result = await adminJsonRequest("/api/admin/assinaturas/1/email", "PATCH", { email: "qa@example.test" }, async (url, options) => {
    calls++; assert.equal(url, "/api/admin/assinaturas/1/email"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.cache, "no-store"); assert.equal(options?.method, "PATCH"); assert.deepEqual(JSON.parse(String(options?.body)), { email: "qa@example.test" });
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(result, { ok: false }); assert.equal(calls, 1);
});

test("admin request never treats an error HTTP response or malformed success body as success", async () => {
  for (const response of [Response.json({ ok: true }, { status: 500 }), Response.json(null), Response.json([]), new Response("<html>proxy error</html>", { status: 502 }), Response.json({ email: "qa@example.test" })]) {
    assert.equal((await adminJsonRequest("/api/admin/assinaturas/1/email", "PATCH", {}, async () => response)).ok, false);
  }
  const conflict = await adminJsonRequest("/api/admin/assinaturas/1/email", "PATCH", {}, async () => Response.json({ ok: false, erro: "Não foi possível salvar.", code: "conflict" }, { status: 409 }));
  assert.equal(conflict.code, "conflict"); assert.equal(conflict.erro, "Não foi possível salvar.");
});

test("admin request preserves a valid successful response without adding a body for an empty POST", async () => {
  const result = await adminJsonRequest("/api/admin/assinaturas/1/reenviar", "POST", undefined, async (_, options) => {
    assert.equal(options?.body, undefined); return Response.json({ ok: true, envio: "queued" });
  });
  assert.deepEqual(result, { ok: true, envio: "queued" });
});
