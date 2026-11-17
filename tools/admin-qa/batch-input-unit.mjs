import test from "node:test";
import assert from "node:assert/strict";
import { batchId, readBatchFields, readBatchMultipart, BATCH_PDF_BYTES, BATCH_MULTIPART_BYTES } from "../../site/src/lib/batch-http-input.ts";

test("IDs de lote são inteiros decimais positivos no limite PostgreSQL", () => {
  for (const input of ["", "0", "-1", "NaN", "1.2", "1e0", " 1", "01", "2147483648", "99999999999999999999"]) assert.equal(batchId(input), null);
  assert.equal(batchId("1"), 1); assert.equal(batchId("2147483647"), 2147483647);
});

test("multipart conta bytes reais e cancela fluxo acima do limite mesmo com header menor", async () => {
  assert.equal(BATCH_PDF_BYTES, 25 * 1024 * 1024); assert.equal(BATCH_MULTIPART_BYTES, BATCH_PDF_BYTES + 64 * 1024);
  let cancelled = false, sent = 0; const chunk = new Uint8Array(64 * 1024);
  const body = new ReadableStream({ pull(controller) { if (sent > BATCH_MULTIPART_BYTES + 4 * 1024 * 1024) { controller.close(); return; } controller.enqueue(chunk); sent += chunk.byteLength; }, cancel() { cancelled = true; } });
  assert.deepEqual(await readBatchMultipart({ headers: new Headers({ "content-type": "multipart/form-data; boundary=QA", "content-length": "1" }), body }), { ok: false, status: 413 });
  assert.ok(cancelled); assert.ok(sent <= BATCH_MULTIPART_BYTES + 2 * chunk.byteLength);
});

test("header grande é recusado antes de consumir corpo e multipart válido preserva bytes", async () => {
  let accessed = false;
  assert.deepEqual(await readBatchMultipart({ headers: new Headers({ "content-type": "multipart/form-data; boundary=QA", "content-length": String(BATCH_MULTIPART_BYTES + 1) }), get body() { accessed = true; throw new Error("must not consume body"); } }), { ok: false, status: 413 }); assert.equal(accessed, false);
  const form = new FormData(); form.append("file", new Blob(["%PDF-FICTITIOUS-QA"], { type: "application/pdf" }), "qa.pdf");
  const result = await readBatchMultipart(new Request("http://localhost", { method: "POST", body: form })); assert.ok(result.ok);
  const file = result.form.get("file"); assert.ok(file && typeof file !== "string"); assert.equal(file.name, "qa.pdf"); assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "%PDF-FICTITIOUS-QA");
});

test("campos existentes continuam aceitos com limite e UTF-8 inválido é recusado", async () => {
  const valid = await readBatchFields(new Request("http://localhost", { method: "POST", body: "code=123456&userId=999", headers: { "content-type": "application/x-www-form-urlencoded" } })); assert.ok(valid.ok); assert.equal(valid.form.get("code"), "123456");
  assert.deepEqual(await readBatchFields(new Request("http://localhost", { method: "POST", body: "x".repeat(1025) })), { ok: false, status: 413 });
  assert.deepEqual(await readBatchFields(new Request("http://localhost", { method: "POST", body: new Uint8Array([255]) })), { ok: false, status: 400 });
});
