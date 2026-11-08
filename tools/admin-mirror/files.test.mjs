import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileBatches } from "./files.mjs";
import { digest } from "./snapshot.mjs";
const spec = { name: "signatures", columns: [{ name: "id", type: "integer" }], primaryKey: ["id"] };
test("disk batches preserve data and reject incomplete, duplicate or corrupted files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mirror-fixture-"));
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: index + 1 }));
  const metadata = { count: rows.length, sha256: digest(rows) };
  async function collect() {
    const batches = [];
    for await (const batch of fileBatches(dir, spec, metadata)) batches.push(batch);
    return batches;
  }
  try {
    writeFileSync(join(dir, "signatures.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    const batches = await collect(); assert.equal(batches.length, 3); assert.deepEqual(batches.flat(), rows);
    writeFileSync(join(dir, "signatures.jsonl"), '{"id":1}\n');
    await assert.rejects(collect(), /CHECKSUM/);
    writeFileSync(join(dir, "signatures.jsonl"), '{"id":1}\n{"id":1}\n');
    await assert.rejects(collect(), /DUPLICATE/);
  } finally { rmSync(dir, { recursive: true }); }
});
test("cached document references are resolved only after verifying their SHA-256", async () => {
  const root = mkdtempSync(join(tmpdir(), "mirror-blob-fixture-")), dir = join(root, "capture");
  mkdirSync(dir); mkdirSync(join(root, "blobs"));
  const bytes = Buffer.from("fictitious PDF"), hash = createHash("sha256").update(bytes).digest("hex");
  const row = { id: 1, pdf: "blob:" + hash };
  const spec = { name: "batches", columns: [{ name: "id", type: "integer" }, { name: "pdf", type: "bytea" }], primaryKey: ["id"] };
  const meta = { count: 1, sha256: digest([row]) };
  const collect = async () => { const rows = []; for await (const batch of fileBatches(dir, spec, meta)) rows.push(...batch); return rows; };
  try {
    writeFileSync(join(dir, "batches.jsonl"), JSON.stringify(row) + "\n");
    writeFileSync(join(root, "blobs", hash + ".bin"), bytes);
    assert.equal((await collect())[0].pdf, "\\x" + bytes.toString("hex"));
    writeFileSync(join(root, "blobs", hash + ".bin"), "corrupted");
    await assert.rejects(collect(), /BLOB_CHECKSUM/);
  } finally { rmSync(root, { recursive: true }); }
});
