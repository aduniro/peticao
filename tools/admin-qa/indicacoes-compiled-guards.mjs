import assert from "node:assert/strict";
// Reused from president-own-history-compiled-extension.mjs: composed policies retain the effective security policy.
export function assertPrivateNoStore(value) {
  const directives = new Set(String(value ?? "").toLowerCase().split(",").map(v => v.trim()).filter(Boolean));
  assert.ok(directives.has("private") && directives.has("no-store"));
  assert.ok([...directives].every(v => ["private", "no-store", "max-age=0"].includes(v)), "no public/shared/positive-age caching directive is allowed");
}
export function assertPrivateSecurityHeaders(headers) {
  const referrer = String(headers["referrer-policy"] ?? "").toLowerCase().split(",").map(v => v.trim()).filter(Boolean);
  assert.ok(referrer.length && referrer.at(-1) === "no-referrer" && referrer.every(v => ["no-referrer", "strict-origin-when-cross-origin"].includes(v)));
  const sniff = String(headers["x-content-type-options"] ?? "").toLowerCase().split(",").map(v => v.trim()).filter(Boolean);
  assert.ok(sniff.length && sniff.every(v => v === "nosniff"));
}
export function assertPrivateHeaders(headers) { assertPrivateNoStore(headers["cache-control"]);assertPrivateSecurityHeaders(headers); }
