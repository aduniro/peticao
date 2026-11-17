import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { renderPresidentConfirmation } from "./president-native-pdf";
import type { OwnConfirmationSnapshot } from "./president-native-contract";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const doc = await PDFDocument.create(); doc.addPage([595, 842]);
  const bytes = Buffer.from(await doc.save());
  const snapshot: OwnConfirmationSnapshot = {
    version: 1, state: "consumed", method: "own-confirmation",
    receiptId: "00000000-0000-4000-8000-000000000001", challengeId: "00000000-0000-4000-8000-000000000002",
    batchId: 1, responsibleId: 2, documentVersion: "a".repeat(64), sourceSha256: digest(bytes),
    listHash: "b".repeat(64), accountFingerprint: "c".repeat(64),
    signerName: "Pessoa Responsável Fictícia", confirmedAt: "2026-11-10T08:00:00.000Z",
  };
  return { doc, bytes, snapshot };
}

test("página de confirmação conserva fonte e acrescenta uma página sem declarar ICP", async () => {
  const f = await fixture(), before = Buffer.from(f.bytes);
  const result = await renderPresidentConfirmation(f.bytes, f.snapshot);
  assert.deepEqual(f.bytes, before);
  assert.equal(result.sourcePages, 1);
  const originalLoaded = await PDFDocument.load(f.bytes), outputLoaded = await PDFDocument.load(result.bytes);
  assert.equal(outputLoaded.getPageCount(), 2);
  assert.equal(outputLoaded.getPage(0).node.toString(), originalLoaded.getPage(0).node.toString());
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest(result.bytes), f.snapshot.sourceSha256);
});

test("hash/recibo inconsistentes e PDFs com assinatura são recusados antes de reserializar", async () => {
  const f = await fixture();
  await assert.rejects(renderPresidentConfirmation(f.bytes, { ...f.snapshot, sourceSha256: "f".repeat(64) }), /invalid_own_confirmation/);
  await assert.rejects(renderPresidentConfirmation(f.bytes, { ...f.snapshot, state: "issued" as "consumed" }), /invalid_own_confirmation/);
  f.doc.context.register(f.doc.context.obj({ Type: PDFName.of("Sig"), ByteRange: [0, 1, 2, 3], Contents: PDFString.of("FICTITIOUS") }));
  const signed = Buffer.from(await f.doc.save());
  await assert.rejects(renderPresidentConfirmation(signed, { ...f.snapshot, sourceSha256: digest(signed) }), /already_signed_pdf/);
});

test("wrapping preserves long Unicode tokens while every line fits its measured box", async () => {
  const { wrapPresidentText } = await import("./president-native-pdf");
  const measure = (s: string) => Array.from(s).length * 10;
  const name = "W".repeat(200);
  const lines = wrapPresidentText(name, 507, measure);
  assert.equal(lines.join(""), name);
  assert.ok(lines.every(line => measure(line) <= 507));
  assert.deepEqual(wrapPresidentText("Álvaro da Silva", 70, measure), ["Álvaro", "da", "Silva"]);
  assert.deepEqual(wrapPresidentText("😀😀😀", 20, measure), ["😀😀", "😀"]);
  assert.throws(() => wrapPresidentText("W", 5, measure), /invalid_confirmation_layout/);
});

test("nested direct signature dictionaries cannot be reserialized", async () => {
  for (const method of ["type", "field", "byteRange"]) {
    const f = await fixture();
    const signature = method === "type" ? { Type: PDFName.of("Sig") } : method === "field" ? { FT: PDFName.of("Sig") } : { ByteRange: [0, 1, 2, 3] };
    f.doc.getPage(0).node.set(PDFName.of("Annots"), f.doc.context.obj([{ Nested: signature }]));
    const source = Buffer.from(await f.doc.save());
    await assert.rejects(renderPresidentConfirmation(source, { ...f.snapshot, sourceSha256: digest(source) }), /already_signed_pdf/);
  }
});

test("rendering is deterministic and reads frozen inputs across asynchronous font/PDF operations", async () => {
  const f = await fixture();
  const first = await renderPresidentConfirmation(f.bytes, f.snapshot);
  const second = await renderPresidentConfirmation(f.bytes, { ...f.snapshot });
  assert.deepEqual(first.bytes, second.bytes);
  const pending = renderPresidentConfirmation(f.bytes, f.snapshot);
  f.snapshot.signerName = "Outro nome que não pertence ao recibo";
  f.snapshot.confirmedAt = "2026-11-11T08:00:00.000Z";
  f.bytes.fill(0);
  const third = await pending;
  assert.deepEqual(first.bytes, third.bytes);
});

test("a maximum-length unbroken name fits; unsupported glyphs fail before delivering unreadable confirmation", async () => {
  const f = await fixture();
  const rendered = await renderPresidentConfirmation(f.bytes, { ...f.snapshot, signerName: "W".repeat(200) });
  assert.equal((await PDFDocument.load(rendered.bytes)).getPageCount(), 2);
  await assert.rejects(renderPresidentConfirmation(f.bytes, { ...f.snapshot, signerName: "Pessoa 🧪" }), /unsupported_confirmation_glyph/);
});


test("signature type/field stored through indirect name references is refused", async () => {
  for (const key of ["Type", "FT"]) {
    const f = await fixture();
    const name = f.doc.context.register(PDFName.of("Sig"));
    f.doc.getPage(0).node.set(PDFName.of("Annots"), f.doc.context.obj([{ [key]: name }]));
    const source = Buffer.from(await f.doc.save());
    await assert.rejects(renderPresidentConfirmation(source, { ...f.snapshot, sourceSha256: digest(source) }), /already_signed_pdf/);
  }
});
