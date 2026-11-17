import test from "node:test";
import assert from "node:assert/strict";
import { mailDeliverySearch, mailDeliveryQuery, mailDeliveryTimestamp, mailDeliveryCount } from "./mail-delivery-admin-contract";

test("delivery parser preserves exact old filters, safe offset and explicit formatos without clamp", () => {
  const base = mailDeliverySearch(new URLSearchParams()); assert.ok(base.ok); assert.equal(base.options.page, 1); assert.equal(base.options.limit, 50);
  const parsed = mailDeliverySearch(new URLSearchParams({ busca: "José QA, Nome_100%", situacao: "aceito", cadastro: "aguardando", categoria: "servidor", provedor: "event-only", pagina: "2", limite: "200", formato: "csv" }));
  assert.ok(parsed.ok); assert.equal(parsed.format, "csv"); assert.equal(parsed.options.filters?.busca, "José QA, Nome_100%");
  const roundtrip = mailDeliverySearch(new URLSearchParams(mailDeliveryQuery(parsed.options))); assert.ok(roundtrip.ok); assert.deepEqual(roundtrip.options, parsed.options);
  for (const value of ["pagina=0", "pagina=1.1", "pagina=Infinity", "pagina=1e2", "pagina=9007199254740991&limite=200", "limite=0", "limite=201", "cadastro=invalid", "categoria=invalid", "situacao=spam", "provedor=x&provedor=y", "busca=a&busca=b", "actor=1", "formato=html"]) assert.equal(mailDeliverySearch(new URLSearchParams(value)).ok, false, value);
  assert.equal(mailDeliverySearch(new URLSearchParams({ busca: "a".repeat(81) })).ok, false);
});
test("delivery timestamps reuse pending microsecond normalization and counts never round bigint", () => {
  assert.equal(mailDeliveryTimestamp("2026-11-10T12:00:00.123456Z"), "2026-11-10T12:00:00.123456Z");
  assert.equal(mailDeliveryTimestamp("2026-11-10T12:00:00Z"), "2026-11-10T12:00:00.000000Z");
  assert.throws(() => mailDeliveryTimestamp("2026-02-30T12:00:00Z"));
  assert.equal(mailDeliveryCount("50001"), 50001); assert.equal(mailDeliveryCount("9007199254740992"), null);
});
