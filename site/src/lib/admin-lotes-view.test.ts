import test from "node:test";
import assert from "node:assert/strict";
import type { Batch } from "./batches";
import { selectedBatch, batchStatusLabel, hasSignedBatchPdf, batchCountLabel } from "./admin-lotes-view";

const fixture = (id: number, seq = id): Batch => ({ id, seq, kind: "partial", status: "prepared", runtime_owner: "v2", n_servidor: 9, n_apoiador: 2, n_estrangeiro: 1, list_hash: "a".repeat(64), pdf_sha256: "b".repeat(64), signature_kind: "none", approved_at: null, sent_at: null, created_at: "2026-11-16T00:00:00.000Z" });

test("selection uses the exact listed batch id, never its sequence or another document", () => {
  const first = fixture(7, 900), second = { ...fixture(42, 901), pdf_sha256: "c".repeat(64) }, values = [first, second];
  assert.equal(selectedBatch(values, "7"), first);
  assert.equal(selectedBatch(values, "42"), second);
  assert.equal(selectedBatch(values, "900"), null);
  assert.equal(selectedBatch(values, "8"), null);
  assert.equal(selectedBatch([], "7"), null);
  assert.equal(second.pdf_sha256, "c".repeat(64));
});

test("ambiguous, malformed and out-of-range selections never fall back to another batch", () => {
  const values = [fixture(7)];
  for (const input of [undefined, null, 7, ["7"], ["7", "42"], "", "0", "07", "7.0", "-7", " 7", "7 ", "2147483648", "7 OR 1=1", "<script>", "constructor"]) assert.equal(selectedBatch(values, input), null);
  const maximum = fixture(2147483647);
  assert.equal(selectedBatch([maximum], "2147483647"), maximum);
});

test("display translations do not turn unknown or inherited property names into successful states", () => {
  assert.equal(batchStatusLabel("prepared"), "Preparado");
  assert.equal(batchStatusLabel("failed"), "Falha");
  assert.equal(batchStatusLabel("sent"), "Enviado");
  assert.equal(batchStatusLabel("cancelled"), "Cancelado");
  for (const value of ["unexpected", "constructor", "__proto__", "toString"]) assert.equal(batchStatusLabel(value), "Estado não reconhecido");
});

test("signed download visibility preserves the original rule independently of state", () => {
  for (const signature_kind of [null, "", "none"]) assert.equal(hasSignedBatchPdf({ signature_kind }), false);
  for (const signature_kind of ["icp-brasil", "externa-nao-validada", "other-existing-kind"]) assert.equal(hasSignedBatchPdf({ signature_kind }), true);
});

test("missing legacy counts remain distinct from zero and do not crash the list", () => {
  assert.equal(batchCountLabel(0), "0");
  assert.equal(batchCountLabel(9000), "9.000");
  for (const value of [undefined, null, NaN, Infinity]) assert.equal(batchCountLabel(value), "—");
});
