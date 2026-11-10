import test from "node:test";
import assert from "node:assert/strict";
import { CSV_HEADERS, parseSignatureExplorerCsv } from "./signature-explorer-compiled-csv.mjs";
const cell = s => '"' + s.replaceAll('"', '""') + '"';
const csv = row => Buffer.from("\uFEFF" + CSV_HEADERS.map(cell).join(",") + "\r\n" + row.map(cell).join(","));
test("compiled CSV verifier preserves eleven exact headers, BOM, commas, quotes and multiline fields", () => {
  const row = ['QA "Quoted", Person\nMultiline', "servidor", "Instituto QA, Campus Norte", "Docente", "", "[Unidade QA]", "", "", "confirmed", "2026-11-10", "2026-11-10"];
  assert.deepEqual(parseSignatureExplorerCsv(csv(row)), [row]);
});
test("compiled CSV verifier rejects malformed UTF8, missing columns and unclosed quotes", () => {
  assert.throws(() => parseSignatureExplorerCsv(Buffer.from([0xff])));
  assert.throws(() => parseSignatureExplorerCsv(csv(["only one"])));
  assert.throws(() => parseSignatureExplorerCsv(Buffer.from(CSV_HEADERS.map(cell).join(",") + '\r\n"not closed')));
});
