import test from "node:test";
import assert from "node:assert/strict";
import { signatureExplorerSearch, signatureExplorerCapabilities, signatureExplorerSafeCount, validSignatureExplorerDate } from "./signature-explorer-admin-contract";
import { filtrosVazios, filtrosParaQuery, parseFiltros } from "./assinaturas-filtros";
test("explorer boundary rejects ambiguous numeric/date/sort/filter values without clamping", () => {
  const first = signatureExplorerSearch(new URLSearchParams()); assert.ok(first.ok); assert.equal(first.options.page, 1); assert.equal(first.options.limit, 50);
  for (const raw of ["pagina=1.2", "pagina=Infinity", "pagina=1e2", "pagina=0", "pagina=-1", "pagina=9007199254740992", "pagina=9007199254740991&limite=200", "limite=9", "limite=201", "limite=50&limite=100", "ordem=email", "dir=ASC", "formato=xml", "de=2026-02-30", "de=2025-02-29", "de=2026-11-10&ate=2026-11-09", "categoria=inexistente", "uf=XX", "cidade=1", "cpf=talvez", "capabilities.contacts=true", "q=a&q=b", "cargo=a,a"]) {
    assert.deepEqual(signatureExplorerSearch(new URLSearchParams(raw)), { ok: false, error: "invalid" }, raw);
  }
  assert.equal(signatureExplorerSearch(new URLSearchParams({ q: "x".repeat(81) })).ok, false);
  assert.equal(signatureExplorerSearch(new URLSearchParams({ instituicao: Array.from({ length: 201 }, (_, i) => "QA" + i).join(",") })).ok, false);
});
test("calendar and literals preserve valid legacy facets without SQL wildcard rewriting at the boundary", () => {
  assert.equal(validSignatureExplorerDate("2000-02-29"), true); assert.equal(validSignatureExplorerDate("1900-02-29"), false);
  const result = signatureExplorerSearch(new URLSearchParams({ q: "O'Nome %_\\", cargo: "cargo legado", regiao: "al,ff", cidade: "1100205", de: "2024-02-29", formato: "csv", ordem: "nome", dir: "asc" }));
  assert.ok(result.ok); assert.equal(result.options.filters.q, "O'Nome %_\\"); assert.deepEqual(result.options.filters.cargo, ["cargo legado"]); assert.equal(result.options.format, "csv");
});
test("contact capability derives only from server role and PostgreSQL counts cannot round", () => {
  for (const role of ["edicao", "exclusao", "total"]) assert.deepEqual(signatureExplorerCapabilities(role), { contacts: true });
  for (const role of ["leitura", "", "admin", "true"]) assert.deepEqual(signatureExplorerCapabilities(role), { contacts: false });
  assert.equal(signatureExplorerSafeCount("9007199254740991"), 9007199254740991);
  for (const n of ["9007199254740992", "1.2", "1e2", -1, NaN, Infinity]) assert.equal(signatureExplorerSafeCount(n), null);
});
test("facets containing commas and brackets roundtrip unchanged across legacy and strict consumers", () => {
  const filters = { ...filtrosVazios(), instituicao: ["Instituto QA, Campus Norte", "Outra instituição"], campus: ['[Unidade] "QA", Norte'], universidade: ["University, QA"] };
  const params = new URLSearchParams(filtrosParaQuery(filters));
  assert.deepEqual(parseFiltros(params), filters);
  const strict = signatureExplorerSearch(params); assert.ok(strict.ok); assert.deepEqual(strict.options.filters, filters);
  assert.equal(filtrosParaQuery({ categoria: ["servidor", "apoiador"] }), "categoria=servidor%2Capoiador");
  for (const value of ['["QA",1]', '["QA"', '[["QA"]]']) assert.equal(signatureExplorerSearch(new URLSearchParams({ instituicao: value, listas: "json" })).ok, false);
  const historical = new URLSearchParams({ universidade: '["QA"]' });
  assert.deepEqual(parseFiltros(historical).universidade, ['["QA"]']);
  const historicalStrict = signatureExplorerSearch(historical); assert.ok(historicalStrict.ok); assert.deepEqual(historicalStrict.options.filters.universidade, ['["QA"]']);
});
