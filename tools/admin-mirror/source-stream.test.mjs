import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { collectSource, exportProgram } from "./source-stream.mjs";
import { digest, deltaDigest, validateContract } from "./snapshot.mjs";
const contract = [{ name: "signatures", columns: [{ name: "id", type: "integer" }], primaryKey: ["id"] }];
function stream(records, code = 0) {
  return () => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.kill = () => { proc.stdout.end(); proc.emit("close", 1, "SIGTERM"); };
    proc.stdin.on("finish", () => setImmediate(() => {
      for (const record of records) proc.stdout.write(JSON.stringify(record) + "\n");
      proc.stdout.end(); proc.emit("close", code, null);
    }));
    return proc;
  };
}
function records() {
  const rows = [{ id: 1 }];
  return [
    { type: "header", format: "peticao-admin-mirror/v1", capturedAt: "2026-11-08T06:00:00Z", contractHash: digest(contract), readOnly: true },
    { type: "row", table: "signatures", row: rows[0] },
    { type: "table", name: "signatures", count: 1, sha256: digest(rows) },
    { type: "complete" },
  ];
}
test("production metadata contract contains only approved tables and a syntactically valid exporter", () => {
  const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url)));
  validateContract(catalog);
  const program = exportProgram(catalog);
  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: program });
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert(program.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert(!program.includes("HASH_PEPPER"));
  assert(program.includes("CPF_CACHE_ENCRYPTION_KEY")); // consumed only inside the VPS process
});
test("complete source stream is verified without exposing row data to logs", async () => {
  const packet = await collectSource(contract, {}, stream(records()));
  assert.equal(packet.tables[0].count, 1);
  assert.deepEqual(packet.tables[0].rows, [{ id: 1 }]);
});
test("blob chunks are hashed before becoming reusable cached documents", async () => {
  const bytes = Buffer.from("fictitious PDF bytes"), hash = createHash("sha256").update(bytes).digest("hex");
  const input = records(); input.splice(1, 0,
    { type: "blob", hash, index: 0, data: bytes.toString("base64") },
    { type: "blob-complete", hash, bytes: bytes.length });
  const received = []; let complete = false;
  await collectSource(contract, { onBlob: async (id, chunk) => { assert.equal(id, hash); received.push(chunk); }, onBlobComplete: async () => { complete = true; } }, stream(input));
  assert.deepEqual(Buffer.concat(received), bytes); assert(complete);
  input[2].bytes++;
  await assert.rejects(collectSource(contract, { onBlob: async () => {} }, stream(input)), /BLOB_CHECKSUM/);
});
test("unchanged tables and verified append-only prefixes need no retransmission of old rows", async () => {
  const previous = { fingerprint: digest("fixture-fingerprint"), sha256: digest([{ id: 1 }]), count: 1, lastKey: [1] };
  const options = { knownTables: { signatures: previous }, onReuse: async () => {}, onRow: async () => {} };
  const header = records()[0];
  const reused = await collectSource(contract, options, stream([header, { type: "reuse", mode: "reuse", name: "signatures", ...previous, baseSha256: previous.sha256, baseCount: 1 }, { type: "complete" }]));
  assert.equal(reused.tables[0].mode, "reuse"); assert.equal(reused.tables[0].count, 1);
  const fields = { mode: "delta", baseSha256: previous.sha256, baseCount: 1, addedCount: 1, addedSha256: digest([{ id: 2 }]), count: 2 };
  const input = [header,
    { type: "delta", name: "signatures", baseSha256: previous.sha256, baseCount: 1 },
    { type: "row", table: "signatures", row: { id: 2 } },
    { type: "table", name: "signatures", ...fields, sha256: deltaDigest(fields), fingerprint: digest("new-fingerprint"), lastKey: [2] },
    { type: "complete" }];
  const delta = await collectSource(contract, options, stream(input));
  assert.equal(delta.tables[0].mode, "delta"); assert.equal(delta.tables[0].addedCount, 1); assert.equal(delta.tables[0].count, 2);
  input[1].baseCount = 5;
  await assert.rejects(collectSource(contract, options, stream(input)), /BASE_MISMATCH/);
});
test("interrupted SSH, missing footer, trailing rows and corruption cannot become a published packet", async () => {
  await assert.rejects(collectSource(contract, {}, stream(records(), 1)));
  await assert.rejects(collectSource(contract, {}, stream(records().slice(0, -1))));
  await assert.rejects(collectSource(contract, {}, stream([...records(), { type: "row", table: "signatures", row: { id: 2 } }])));
  const damaged = records(); damaged[2].sha256 = "bad";
  await assert.rejects(collectSource(contract, {}, stream(damaged)));
  await assert.rejects(collectSource(contract, { maxBytes: 10 }, stream(records())));
});
