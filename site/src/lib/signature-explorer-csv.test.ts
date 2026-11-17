import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSignatureExplorerCsv, SIGNATURE_EXPLORER_CSV_HEADERS } from "./signature-explorer-csv";
import type { SignatureExplorerLine } from "./signature-explorer-admin-contract";
const line = (id: number): SignatureExplorerLine => ({ id, nome: '="QA",\nLinha', categoria: "servidor", instituicao: "QA", cargo: "Docente", regiao: "Amazônia Legal", campus: "QA Campus", cidadeUf: "", pais: "", status: "pending", criada: "2026-11-10T00:00:00.123Z", confirmada: null, cpf: true, whatsapp: "DO-NOT-EXPORT-CONTACT", waConfirmado: true });
test("explorer CSV preserves exact 11 columns and excludes contact while protecting quotes and formulas", () => {
  const csv = buildSignatureExplorerCsv([line(1)], 1), text = csv.body.toString("utf8");
  assert.equal(SIGNATURE_EXPLORER_CSV_HEADERS.length, 11);
  assert.ok(text.startsWith('\uFEFF"Nome","Categoria","Instituição"'));
  assert.ok(text.includes('\r\n"\'=""QA"",\nLinha"'));
  assert.equal(text.includes("DO-NOT-EXPORT-CONTACT"), false);
  assert.equal(csv.sha256, createHash("sha256").update(csv.body).digest("hex")); assert.equal(csv.bytes, csv.body.length);
});
test("explorer CSV retains row20001 and refuses partial/duplicate sources", () => {
  const rows = Array.from({ length: 20001 }, (_, i) => ({ ...line(i + 1), nome: "QA " + (i + 1) }));
  const csv = buildSignatureExplorerCsv(rows, rows.length); assert.equal(csv.rows, 20001); assert.ok(csv.body.toString("utf8").includes('"QA 20001"'));
  assert.throws(() => buildSignatureExplorerCsv(rows, 20002), /incomplete/);
  assert.throws(() => buildSignatureExplorerCsv([line(1), line(1)], 2), /invalid/);
  assert.equal(buildSignatureExplorerCsv([], 0).rows, 0);
});
