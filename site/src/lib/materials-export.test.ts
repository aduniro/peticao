import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { materialDigest } from "./materials-contract";
import { renderMaterialPreview } from "./materials-render";
import { materialLayoutProfile, type MaterialLayoutSample } from "./materials-layout";
import { materialExportRequest, requireMaterialExportFit, materialExportReceipt, type MaterialExportRequest } from "./materials-export";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function input(format: "pdf" | "png" = "png"): MaterialExportRequest {
  const content = { template: "poster-a4-v1" as const, assetKey: "adunir" as const, title: "Fictional export", body: "Fictional content", callToAction: "Fictional action", footer: "" };
  return { schema: 1, exportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", format, savedVersionEvidenceSha256: "1".repeat(64),
    version: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", materialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", revision: 3, content, sha256: materialDigest(content), archived: false, authorId: 7, createdAt: "2026-11-11T00:00:00.000Z" } };
}
function resources(request = input()) { return { sourceCommit: "a".repeat(40), rendererSha256: "b".repeat(64), htmlSha256: hash(renderMaterialPreview(request.version.content).html), assetSetSha256: "c".repeat(64), fontSetSha256: "d".repeat(64), browserSha256: "e".repeat(64) }; }
function samples(): MaterialLayoutSample[] {
  const p = materialLayoutProfile("poster-a4-v1"), box = (x: number, y: number, width: number, height: number) => ({ rect: { x, y, width, height }, clientWidth: Math.floor(width), scrollWidth: Math.floor(width), clientHeight: Math.floor(height), scrollHeight: Math.floor(height) });
  const a: MaterialLayoutSample = { timeMs: 100, deviceScaleFactor: 1, viewport: p.viewport, fontsReady: true, errors: [], sheet: box(0, 0, p.width, p.height), panels: [{ index: 0, box: box(0, 0, p.width, p.height), blocks: (["brand", "title", "body", "action", "footer"] as const).map((kind, i) => ({ kind, clipped: false, box: box(10, 10 + i * 100, p.width - 20, 40) })), image: { complete: true, naturalWidth: 100, naturalHeight: 30, rect: { x: 10, y: 10, width: 100, height: 30 } } }] };
  const b = structuredClone(a); b.timeMs = 200; return [a, b];
}
function pngHeader() { const b = Buffer.alloc(45); Buffer.from([137,80,78,71,13,10,26,10]).copy(b); b.writeUInt32BE(13,8); b.write("IHDR",12);b.writeUInt32BE(794,16);b.writeUInt32BE(1123,20);return b; }
const pdf = Buffer.from("%PDF-1.7\nFICTITIOUS TEST HEADER ONLY; NOT A REAL PDF\n%%EOF\n");
test("closed exact version request preserves snapshot and source evidence without asserting auth", () => {
  const raw = input(); assert.deepEqual(materialExportRequest(raw), raw);
  for (const patch of [{ schema: 2 }, { format: "html" }, { url: "https://example.test" }, { exportId: "../x" }, { savedVersionEvidenceSha256: "bad" }]) assert.equal(materialExportRequest({ ...raw, ...patch }), null);
  assert.equal(materialExportRequest({ ...raw, version: { ...raw.version, sha256: "0".repeat(64) } }), null);
});
test("getters are not invoked and unsupported format objects are not coerced", () => {
  let calls = 0; const raw = input(); Object.defineProperty(raw, "format", { get() { calls++; return "pdf"; } }); assert.equal(materialExportRequest(raw), null); assert.equal(calls, 0);
  assert.equal(materialExportRequest({ ...input(), format: { toString() { calls++; return "pdf"; } } }), null); assert.equal(calls, 0);
});
test("stable complete screen geometry can admit PNG generation but never authorizes export", () => {
  const r = requireMaterialExportFit(input(), resources(), samples()); assert.equal(r.screen.fitPassed, true); assert.equal(r.printGeometry, null); assert.equal(r.exportReady, false);
});
test("PDF requires a distinct pair of print-media metrics", () => {
  const req = input("pdf"), p = resources(req); assert.throws(() => requireMaterialExportFit(req, p, samples()), /print_geometry_refused/);
  const fit = requireMaterialExportFit(req, p, samples(), samples()); assert.equal(fit.printGeometry?.fitPassed, true); assert.equal(fit.exportReady, false);
});
test("overflow, clipping, missing image or fonts always deny artifact admission", () => {
  for (const change of [(s: MaterialLayoutSample) => { s.panels[0].blocks[2].box.scrollHeight = 1000; }, (s: MaterialLayoutSample) => { s.panels[0].blocks[1].clipped = true; }, (s: MaterialLayoutSample) => { s.fontsReady = false; }, (s: MaterialLayoutSample) => { s.panels[0].image.complete = false; }]) {
    const s = samples(); s.forEach(change); assert.throws(() => requireMaterialExportFit(input(), resources(), s), /screen_fit_refused/);
  }
});
test("a passing screen cannot override overflow or instability in print media", () => {
  const req = input("pdf"), s = samples(); s[1].panels[0].blocks[2].box.rect.x += 5; assert.throws(() => requireMaterialExportFit(req, resources(req), samples(), s), /print_geometry_refused/);
});
test("resource provenance is closed and HTML bytes must be the controlled renderer output", () => {
  for (const p of [{ ...resources(), htmlSha256: "0".repeat(64) }, { ...resources(), browserSha256: "unknown" }, { ...resources(), extra: true }]) assert.throws(() => requireMaterialExportFit(input(), p, samples()), /html_integrity|resources_invalid/);
});
test("PNG candidate receipt binds exact version and computed artifact bytes; header check is not full decoding", () => {
  const req = input(), bytes = pngHeader(), receipt = materialExportReceipt(req, resources(), samples(), undefined, bytes);
  assert.equal(receipt.versionId, req.version.id); assert.equal(receipt.materialId, req.version.materialId); assert.equal(receipt.revision, 3); assert.equal(receipt.contentSha256, req.version.sha256);
  assert.equal(receipt.artifactSha256, createHash("sha256").update(bytes).digest("hex")); assert.equal(receipt.artifactBytes, 45); assert.equal(receipt.exportReady, false); assert.equal(receipt.status, "candidate-awaiting-format-and-visual-review");
});
test("malformed signature or wrong PNG dimensions are refused", () => {
  assert.throws(() => materialExportReceipt(input(), resources(), samples(), undefined, Buffer.alloc(50)), /png_signature/);
  const bytes = pngHeader();bytes.writeUInt32BE(2,16);assert.throws(() => materialExportReceipt(input(), resources(), samples(), undefined, bytes), /png_dimensions/);
});
test("PDF candidate is explicitly unqualified pending parser, pages, text and visual checks", () => {
  const req = input("pdf"), r = materialExportReceipt(req, resources(req), samples(), samples(), pdf);
  assert.equal(r.exportReady, false); assert.equal(r.pngDimensions, null); assert.equal(r.cryptographicSignature, "not-performed"); assert.equal(r.printGateScope, "fixed-numeric-layout-rules-on-print-media-not-pdf-fidelity");
  assert.throws(() => materialExportReceipt(req, resources(req), samples(), samples(), Buffer.from("%PDF-1.7 incomplete no closing marker")), /pdf_signature/);
});
test("a second format or altered snapshot has distinct immutable receipt identity", () => {
  const a = input(), b = { ...a, version: { ...a.version, revision: 4 } };
  assert.notEqual(materialExportReceipt(a,resources(),samples(),undefined,pngHeader()).versionSnapshotSha256, materialExportReceipt(b,resources(b),samples(),undefined,pngHeader()).versionSnapshotSha256);
});
test("artifact size is bounded and unexpected print metrics cannot enter PNG receipt", () => {
  assert.throws(() => materialExportReceipt(input(), resources(), samples(), undefined, Buffer.alloc(10)), /artifact_size/);
  assert.throws(() => requireMaterialExportFit(input(), resources(), samples(), samples()), /unexpected_print_samples/);
});
