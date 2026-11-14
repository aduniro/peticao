import test from "node:test";
import assert from "node:assert/strict";
import { clearRateLimit, rateLimit } from "./ratelimit";

test("limpar o IP recuperado preserva outro IP, proteções globais e o limite de redefinição", () => {
  const keys = ["admin:192.0.2.21", "admin:192.0.2.22", "admin:global-tentativas", "admin:global-falhas", "admin-redefinir:192.0.2.21"];
  for (const key of keys) {
    assert.equal(rateLimit(key, 1, 900_000), true);
    assert.equal(rateLimit(key, 1, 900_000), false);
  }
  clearRateLimit(keys[0]);
  assert.equal(rateLimit(keys[0], 1, 900_000), true);
  assert.equal(rateLimit(keys[0], 1, 900_000), false);
  for (const key of keys.slice(1)) assert.equal(rateLimit(key, 1, 900_000), false);
  for (const key of keys) clearRateLimit(key);
});

test("limpar uma chave inexistente é idempotente e não afeta janelas existentes", () => {
  assert.equal(rateLimit("unrelated-reset-test", 1, 900_000), true);
  clearRateLimit("unknown-reset-test");
  clearRateLimit("unknown-reset-test");
  assert.equal(rateLimit("unrelated-reset-test", 1, 900_000), false);
  clearRateLimit("unrelated-reset-test");
});
