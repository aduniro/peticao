import test from "node:test";
import assert from "node:assert/strict";
import { assessMaterialLayout, materialLayoutProfile, type LayoutBox, type LayoutReason, type LayoutRect, type MaterialLayoutManifest, type MaterialLayoutSample } from "./materials-layout";

type Template = MaterialLayoutManifest["template"];
const A4 = { width: 793.7007874015749, height: 1122.5196850393702 };
function manifest(template: Template = "poster-a4-v1"): MaterialLayoutManifest {
  return { version: 1, materialVersionId: "11111111-1111-4111-8111-111111111111", template,
    contentSha256: "a".repeat(64), htmlSha256: "b".repeat(64), rendererSha256: "c".repeat(64), assetSetSha256: "d".repeat(64), fontSetSha256: "e".repeat(64), browserSha256: "f".repeat(64),
    media: "screen", deviceScaleFactor: 1, viewport: template === "social-square-v1" ? { width: 1080, height: 1080 } : { width: 850, height: 1200 } };
}
function box(rect: LayoutRect): LayoutBox {
  return { rect, clientWidth: Math.floor(rect.width), clientHeight: Math.floor(rect.height), scrollWidth: Math.floor(rect.width), scrollHeight: Math.floor(rect.height) };
}
function fixtures(template: Template = "poster-a4-v1"): [MaterialLayoutSample, MaterialLayoutSample] {
  const square = template === "social-square-v1", four = template === "flyer-mono-cut-v1", width = square ? 1080 : A4.width, height = square ? 1080 : A4.height;
  const first: MaterialLayoutSample = { timeMs: 100, deviceScaleFactor: 1, viewport: manifest(template).viewport, fontsReady: true, errors: [], sheet: box({ x: 0, y: 0, width, height }),
    panels: Array.from({ length: four ? 4 : 1 }, (_, index) => {
      const x = four ? (index % 2) * width / 2 : 0, y = four ? Math.floor(index / 2) * height / 2 : 0, w = width / (four ? 2 : 1), h = height / (four ? 2 : 1);
      const roles = ["brand", "title", "body", "action", "footer"] as const, tops = [20, 60, 120, 240, h - 40], heights = [30, 40, 100, 40, 20];
      return { index, box: box({ x, y, width: w, height: h }), blocks: roles.map((kind, i) => ({ kind, clipped: false, box: box({ x: x + 20, y: y + tops[i], width: w - 40, height: heights[i] }) })),
        image: { complete: true, naturalWidth: 600, naturalHeight: 100, rect: { x: x + 30, y: y + 25, width: 120, height: 20 } } };
    }) };
  const second = structuredClone(first); second.timeMs = 200; return [first, second];
}
function both(change: (s: MaterialLayoutSample) => void) { const samples = fixtures(); samples.forEach(change); return samples; }
function reason(code: LayoutReason, samples: unknown, input: unknown = manifest()) { const result = assessMaterialLayout(input, samples); assert.equal(result.fitPassed, false); assert.ok(result.reasons.includes(code), JSON.stringify(result)); assert.equal(result.exportReady, false); }

test("three nominal templates pass with stable measurements but never authorize export", () => {
  for (const template of ["poster-a4-v1", "flyer-mono-cut-v1", "social-square-v1"] as const) {
    const result = assessMaterialLayout(manifest(template), fixtures(template)); assert.equal(result.fitPassed, true); assert.deepEqual(result.reasons, []); assert.equal(result.exportReady, false); assert.equal(result.scope, "screen-layout-only");
    assert.match(result.manifestSha256!, /^[a-f0-9]{64}$/); assert.match(result.samplesSha256!, /^[a-f0-9]{64}$/);
  }
  const p = materialLayoutProfile("poster-a4-v1"); assert.ok(Math.abs(p.width - A4.width) < 1e-8); assert.ok(Math.abs(p.height - A4.height) < 1e-8);
});
test("manifest is closed, versioned and binds known resources/profile rather than URL or paths", () => {
  for (const patch of [{ template: "unknown" }, { version: 2 }, { htmlSha256: "bad" }, { materialVersionId: "../x" }, { deviceScaleFactor: 2 }, { media: "print" }, { url: "https://example.test" }, { tolerance: 100 }, { viewport: { width: 1, height: 1 } }]) reason("invalid_manifest", fixtures(), { ...manifest(), ...patch });
});
test("exactly two ordered samples with all five roles and expected copy counts are required", () => {
  reason("invalid_samples", fixtures().slice(0, 1)); reason("invalid_samples", [...fixtures(), fixtures()[0]]);
  reason("invalid_samples", both(s => s.panels[0].blocks.pop())); reason("invalid_samples", both(s => s.panels[0].index = 1));
  const time = fixtures(); time[1].timeMs = time[0].timeMs; reason("invalid_samples", time);
  const wrong = fixtures("flyer-mono-cut-v1"); wrong.forEach(s => s.panels.pop()); reason("invalid_samples", wrong, manifest("flyer-mono-cut-v1"));
});
test("NaN, infinities, coercible strings and oversized numbers are rejected before arithmetic", () => {
  for (const n of [NaN, Infinity, -Infinity, 32769, "100"]) { const samples = fixtures(); (samples[0].sheet.rect as unknown as Record<string, unknown>).height = n; reason("invalid_samples", samples); }
});
test("unknown fields and sparse/getter arrays do not enter the metrics evaluator", () => {
  const extra = fixtures(); Object.assign(extra[0].panels[0].blocks[0], { script: "x" }); reason("invalid_samples", extra);
  const sparse = fixtures(); delete (sparse[0].panels[0].blocks as unknown[])[1]; reason("invalid_samples", sparse);
  let invoked = 0; const samples = fixtures(); Object.defineProperty(samples, "0", { get() { invoked++; return {}; } }); reason("invalid_samples", samples); assert.equal(invoked, 0);
  const input = manifest(); Object.defineProperty(input, "contentSha256", { get() { invoked++; return "a".repeat(64); }, enumerable: true }); reason("invalid_manifest", fixtures(), input); assert.equal(invoked, 0);
});
test("unready fonts, incomplete images and missing natural dimensions refuse fit", () => {
  for (const change of [(s: MaterialLayoutSample) => { s.fontsReady = false; }, (s: MaterialLayoutSample) => { s.panels[0].image.complete = false; }, (s: MaterialLayoutSample) => { s.panels[0].image.naturalWidth = 0; }]) reason("resources_unready", both(change));
});
test("reported page/resource errors never become a fit pass", () => reason("sample_errors", both(s => s.errors.push("page-error"))));
test("geometry must be stable even if each individual sheet remains within fit tolerance", () => {
  const samples = fixtures(); samples[1].panels[0].blocks[2].box.rect.x += 0.5; reason("layout_unstable", samples);
  const flags = fixtures(); flags[1].fontsReady = false; reason("layout_unstable", flags);
});
test("fixed stability allowance accepts small rounding without mutating any inputs", () => {
  const input = manifest(), samples = fixtures(); samples[1].panels[0].blocks[2].box.rect.x += 0.2; const before = JSON.stringify([input, samples]);
  assert.equal(assessMaterialLayout(input, samples).fitPassed, true); assert.equal(JSON.stringify([input, samples]), before);
});
test("wrong sheet size/origin/viewport and wrong panel grid are refused", () => {
  reason("sheet_mismatch", both(s => s.sheet.rect.width -= 5)); reason("sheet_mismatch", both(s => s.sheet.rect.x = -3)); reason("sheet_mismatch", both(s => s.viewport.width--));
  reason("panel_mismatch", both(s => s.panels[0].box.rect.height -= 5));
});
test("direct child outside panel or image outside brand is detected", () => {
  reason("bounds_overflow", both(s => s.panels[0].blocks[2].box.rect.x = -3));
  reason("bounds_overflow", both(s => s.panels[0].image.rect.y = 80));
});
test("child scroll overflow is detected even while all rectangles stay inside the sheet", () => {
  reason("scroll_overflow", both(s => s.panels[0].blocks[2].box.scrollHeight = 400)); reason("scroll_overflow", both(s => s.panels[0].blocks[1].box.scrollWidth = 5000));
});
test("semantic peer overlap/order cannot be hidden by a fitting outer panel", () => reason("block_overlap", both(s => s.panels[0].blocks[3].box.rect.y = 200)));
test("clipping or nonvisible required block is refused and an empty footer is permitted", () => {
  reason("clipping", both(s => s.panels[0].blocks[2].clipped = true)); reason("bounds_overflow", both(s => { s.panels[0].blocks[2].box = box({ ...s.panels[0].blocks[2].box.rect, height: 0 }); }));
  const emptyFooter = both(s => { s.panels[0].blocks[4].box = box({ ...s.panels[0].blocks[4].box.rect, height: 0 }); }); assert.equal(assessMaterialLayout(manifest(), emptyFooter).fitPassed, true);
});
test("one rejected panel rejects the whole four-cut sheet", () => {
  const samples = fixtures("flyer-mono-cut-v1"); samples.forEach(s => s.panels[3].blocks[2].box.scrollHeight = 500); reason("scroll_overflow", samples, manifest("flyer-mono-cut-v1"));
});
test("manifest and metrics hashes are deterministic and react to meaningful changes", () => {
  const a = assessMaterialLayout(manifest(), fixtures()), b = assessMaterialLayout({ ...manifest(), htmlSha256: "1".repeat(64) }, fixtures());
  assert.notEqual(a.manifestSha256, b.manifestSha256); assert.equal(a.samplesSha256, b.samplesSha256);
  const changed = fixtures(); changed.forEach(s => s.timeMs += 1); assert.notEqual(a.samplesSha256, assessMaterialLayout(manifest(), changed).samplesSha256);
});

test("a visible rectangle with impossible zero client/scroll dimensions is refused", () => {
  reason("scroll_overflow", both(s => { s.panels[0].blocks[2].box.clientHeight = 0; s.panels[0].blocks[2].box.scrollHeight = 0; }));
});
