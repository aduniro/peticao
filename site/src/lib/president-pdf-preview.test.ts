import test from "node:test";
import assert from "node:assert/strict";
import { PRESIDENT_PDFJS_ASSET_ROOT, presidentPdfCanvasGeometry, presidentPdfPageNumber, presidentPdfPreviewOptions } from "./president-pdf-preview";

test("preview copies verified bytes and pins resource paths locally without PDF scripting/eval/XFA", () => {
  const original = new Uint8Array(32).fill(65), options = presidentPdfPreviewOptions(original);
  assert.notEqual(options.data.buffer, original.buffer);options.data.fill(0);assert.ok(original.every(n => n === 65));
  assert.equal(options.isEvalSupported, false);assert.equal(options.enableScripting, false);assert.equal(options.enableXfa, false);assert.equal(options.withCredentials, false);
  assert.equal(options.disableRange, true);assert.equal(options.disableStream, true);assert.equal(options.disableAutoFetch, true);
  for (const key of ["cMapUrl", "standardFontDataUrl", "wasmUrl", "iccUrl"] as const) assert.ok(options[key].startsWith(PRESIDENT_PDFJS_ASSET_ROOT + "/"));
  assert.equal("url" in options, false);assert.equal("httpHeaders" in options, false);assert.equal("password" in options, false);
  assert.throws(() => presidentPdfPreviewOptions(new Uint8Array(10)), /invalid_preview_bytes/);assert.throws(() => presidentPdfPreviewOptions(new Uint8Array(26 * 1024 * 1024)), /invalid_preview_bytes/);
});
test("canvas geometry fits narrow phones and caps pixel memory/high-DPI or pathological viewports", () => {
  for (const width of [1, 240, 320, 390, 768, 1280, 1920]) for (const ratio of [1, 2, 4, 12]) {
    const g = presidentPdfCanvasGeometry(595, 842, width, ratio);assert.ok(g.cssWidth <= width + 0.001);assert.ok(g.pixelWidth * g.pixelHeight <= 8_000_000);assert.ok(g.pixelWidth <= 16000 && g.pixelHeight <= 16000);assert.ok(g.pixelWidth >= 1 && g.pixelHeight >= 1);
  }
  const tall = presidentPdfCanvasGeometry(1, 100_000, 1200, 4);assert.ok(tall.cssHeight <= 10_000);assert.ok(tall.pixelWidth * tall.pixelHeight <= 8_000_000);
  for (const values of [[NaN, 10, 10, 1], [10, Infinity, 10, 1], [0, 10, 10, 1], [10, 10, -1, 1], [10, 10, 100, 0]]) assert.throws(() => presidentPdfCanvasGeometry(...values as [number, number, number, number]), /invalid_preview_viewport/);
});
test("page navigation stays within a bounded loaded document", () => {
  assert.equal(presidentPdfPageNumber(0, 3), 1);assert.equal(presidentPdfPageNumber(99, 3), 3);assert.equal(presidentPdfPageNumber(2, 3), 2);
  for (const [p, n] of [[1, 0], [1, 1001], [1.5, 3], [NaN, 3]]) assert.throws(() => presidentPdfPageNumber(p, n), /invalid_preview_page/);
});
