import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildDispersionCsv, DISPERSION_CSV_HEADERS } from "./dispersion-csv";
import type { DispersionAllRow } from "./dispersion-admin-contract";
const row = (id: number): DispersionAllRow => ({ id, name: "=Formula,\"Teste\"\nLinha", status: "confirmed", origin: "pessoal", attributionState: "personal", ownerId: 99, parentName: "Pai fora da página", generation: null, chainState: "cycle", invited: 2, invitedConfirmed: 1, reach: null, rootIssueId: 1, cycleSize: 2, email: "qa@example.invalid", category: "servidor", institution: "Instituição", emailDomain: "example.invalid", emailInstitution: null, emailDomainKind: null, emailDomainKindLabel: null, identityMethod: null, consentAt: "2026-11-10T12:00:00Z", confirmedAt: null, confirmSameVisitor: null, refCode: "TESTABC", orgLabel: null });
test("CSV preserves 19 columns, BOM, formula/quote/newline escaping, time zone and unknown generation", () => {
  const file = buildDispersionCsv([row(1)], 1), text = file.body.toString("utf8");
  assert.equal(DISPERSION_CSV_HEADERS.length, 19);
  assert.ok(text.startsWith("\uFEFF" + DISPERSION_CSV_HEADERS.join(",") + "\n"));
  assert.ok(text.includes('"\'=Formula,""Teste""\nLinha"'));
  assert.ok(text.includes('"10/11/2026 09:00:00"'));
  assert.ok(text.includes('"indicacao_pessoal","TESTABC","Pai fora da página","","2","1",""'));
  assert.equal(file.bytes, file.body.byteLength);
  assert.equal(file.sha256, createHash("sha256").update(file.body).digest("hex"));
  assert.equal(file.rows, 1);
});
test("CSV includes more than the old 50000 cap and rejects omissions/duplicates before responding", () => {
  const rows = Array.from({ length: 50001 }, (_, i) => ({ ...row(i + 1), name: "Pessoa " + (i + 1) }));
  const file = buildDispersionCsv(rows, rows.length);
  assert.equal(file.rows, 50001); assert.ok(file.body.toString("utf8").includes('"Pessoa 50001"'));
  assert.throws(() => buildDispersionCsv(rows, rows.length + 1), /incomplete/);
  assert.throws(() => buildDispersionCsv([row(1), row(1)], 2), /duplicate/);
  assert.equal(buildDispersionCsv([], 0).rows, 0);
});
