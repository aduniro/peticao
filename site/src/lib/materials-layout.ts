import { createHash } from "node:crypto";
import { MATERIAL_TEMPLATES, materialId, type MaterialContent } from "./materials-contract";

export const MATERIAL_LAYOUT_TOLERANCE = 1; // CSS pixel: fixed rounding allowance, never caller-configurable.
export const MATERIAL_LAYOUT_STABILITY = 0.25;
export const MATERIAL_BLOCKS = ["brand", "title", "body", "action", "footer"] as const;
export type LayoutRect = { x: number; y: number; width: number; height: number };
export type LayoutBox = { rect: LayoutRect; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number };
export type MaterialLayoutManifest = {
  version: 1; materialVersionId: string; template: MaterialContent["template"];
  contentSha256: string; htmlSha256: string; rendererSha256: string; assetSetSha256: string; fontSetSha256: string; browserSha256: string;
  media: "screen"; deviceScaleFactor: 1; viewport: { width: number; height: number };
};
export type MaterialPanelMetrics = {
  index: number; box: LayoutBox;
  blocks: { kind: typeof MATERIAL_BLOCKS[number]; box: LayoutBox; clipped: boolean }[];
  image: { complete: boolean; naturalWidth: number; naturalHeight: number; rect: LayoutRect };
};
export type MaterialLayoutSample = {
  timeMs: number; deviceScaleFactor: 1; viewport: { width: number; height: number };
  fontsReady: boolean; errors: string[]; sheet: LayoutBox; panels: MaterialPanelMetrics[];
};
export type LayoutReason = "invalid_manifest" | "invalid_samples" | "resources_unready" | "sample_errors" | "layout_unstable" |
  "sheet_mismatch" | "panel_mismatch" | "bounds_overflow" | "scroll_overflow" | "block_overlap" | "clipping";
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const finite = (v: unknown, min = 0, max = 32768): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
function object(v: unknown, keys: string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(v);
  if (Object.values(descriptors).some(d => !("value" in d)) || Object.keys(v).sort().join(",") !== keys.sort().join(",")) return null;
  return v as Record<string, unknown>;
}
function list(v: unknown, max: number): unknown[] | null {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || Object.getOwnPropertySymbols(v).length || v.length > max) return null;
  const d = Object.getOwnPropertyDescriptors(v);
  if (Object.keys(d).length !== v.length + 1) return null;
  const values: unknown[] = [];
  for (let i = 0; i < v.length; i++) { if (!d[i] || !("value" in d[i])) return null; values.push(d[i].value); }
  return values;
}
function rect(v: unknown): LayoutRect | null {
  const r = object(v, ["x", "y", "width", "height"]);
  return r && finite(r.x, -32768) && finite(r.y, -32768) && finite(r.width) && finite(r.height)
    ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}
function box(v: unknown): LayoutBox | null {
  const b = object(v, ["rect", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]), r = b && rect(b.rect);
  if (!b || !r || ![b.clientWidth, b.clientHeight, b.scrollWidth, b.scrollHeight].every(n => finite(n) && Number.isInteger(n))) return null;
  return { rect: r, clientWidth: b.clientWidth as number, clientHeight: b.clientHeight as number, scrollWidth: b.scrollWidth as number, scrollHeight: b.scrollHeight as number };
}
function viewport(v: unknown): { width: number; height: number } | null {
  const p = object(v, ["width", "height"]);
  return p && finite(p.width, 1, 8192) && finite(p.height, 1, 8192) && Number.isInteger(p.width) && Number.isInteger(p.height) ? { width: p.width, height: p.height } : null;
}
export function materialLayoutProfile(template: MaterialContent["template"]) {
  const square = template === "social-square-v1";
  return { copies: template === "flyer-mono-cut-v1" ? 4 : 1, width: square ? 1080 : 210 * 96 / 25.4,
    height: square ? 1080 : 297 * 96 / 25.4, viewport: square ? { width: 1080, height: 1080 } : { width: 850, height: 1200 } };
}
function manifest(v: unknown): MaterialLayoutManifest | null {
  const keys = ["version", "materialVersionId", "template", "contentSha256", "htmlSha256", "rendererSha256", "assetSetSha256", "fontSetSha256", "browserSha256", "media", "deviceScaleFactor", "viewport"];
  const m = object(v, keys), p = m && viewport(m.viewport);
  if (!m || !p || m.version !== 1 || !materialId(m.materialVersionId) || !MATERIAL_TEMPLATES.includes(m.template as MaterialContent["template"]) ||
      ![m.contentSha256, m.htmlSha256, m.rendererSha256, m.assetSetSha256, m.fontSetSha256, m.browserSha256].every(hash) || m.media !== "screen" || m.deviceScaleFactor !== 1) return null;
  const expected = materialLayoutProfile(m.template as MaterialContent["template"]).viewport;
  if (p.width !== expected.width || p.height !== expected.height) return null;
  return { version: 1, materialVersionId: m.materialVersionId, template: m.template as MaterialContent["template"], contentSha256: m.contentSha256 as string,
    htmlSha256: m.htmlSha256 as string, rendererSha256: m.rendererSha256 as string, assetSetSha256: m.assetSetSha256 as string,
    fontSetSha256: m.fontSetSha256 as string, browserSha256: m.browserSha256 as string, media: "screen", deviceScaleFactor: 1, viewport: p };
}
function panel(v: unknown, index: number): MaterialPanelMetrics | null {
  const p = object(v, ["index", "box", "blocks", "image"]), b = p && box(p.box), blocks = p && list(p.blocks, 5);
  const image = p && object(p.image, ["complete", "naturalWidth", "naturalHeight", "rect"]), imageRect = image && rect(image.rect);
  if (!p || p.index !== index || !b || !blocks || blocks.length !== 5 || !image || !imageRect || typeof image.complete !== "boolean" ||
      !finite(image.naturalWidth, 0, 16384) || !finite(image.naturalHeight, 0, 16384) || !Number.isInteger(image.naturalWidth) || !Number.isInteger(image.naturalHeight)) return null;
  const parsed = blocks.map((v, i) => { const r = object(v, ["kind", "box", "clipped"]), b = r && box(r.box); return r && r.kind === MATERIAL_BLOCKS[i] && b && typeof r.clipped === "boolean" ? { kind: MATERIAL_BLOCKS[i], box: b, clipped: r.clipped } : null; });
  if (parsed.some(b => b === null)) return null;
  return { index, box: b, blocks: parsed as MaterialPanelMetrics["blocks"], image: { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, rect: imageRect } };
}
function sample(v: unknown, copies: number): MaterialLayoutSample | null {
  const s = object(v, ["timeMs", "deviceScaleFactor", "viewport", "fontsReady", "errors", "sheet", "panels"]);
  const b = s && box(s.sheet), p = s && viewport(s.viewport), errors = s && list(s.errors, 8), panels = s && list(s.panels, 4);
  if (!s || !b || !p || !errors || !panels || panels.length !== copies || !finite(s.timeMs, 0, 3600000) || s.deviceScaleFactor !== 1 || typeof s.fontsReady !== "boolean" ||
      !errors.every(e => typeof e === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(e))) return null;
  const parsed = panels.map(panel); if (parsed.some(p => p === null)) return null;
  return { timeMs: s.timeMs, deviceScaleFactor: 1, viewport: p, fontsReady: s.fontsReady, errors: errors as string[], sheet: b, panels: parsed as MaterialPanelMetrics[] };
}
const near = (a: number, b: number, limit = MATERIAL_LAYOUT_TOLERANCE) => Math.abs(a - b) <= limit;
const contains = (a: LayoutRect, b: LayoutRect) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1;
const rectValues = (r: LayoutRect) => [r.x, r.y, r.width, r.height];
const boxValues = (b: LayoutBox) => [...rectValues(b.rect), b.clientWidth, b.clientHeight, b.scrollWidth, b.scrollHeight];
const values = (s: MaterialLayoutSample) => [...boxValues(s.sheet), s.viewport.width, s.viewport.height, ...s.panels.flatMap(p => [...boxValues(p.box), ...p.blocks.flatMap(b => boxValues(b.box)), ...rectValues(p.image.rect), p.image.naturalWidth, p.image.naturalHeight])];
const flags = (s: MaterialLayoutSample) => JSON.stringify([s.fontsReady, s.errors, s.panels.map(p => [p.image.complete, p.blocks.map(b => b.clipped)])]);

/** Validates measurements, not their producer. No DOM, I/O, authorization or export occurs. */
export function assessMaterialLayout(rawManifest: unknown, rawSamples: unknown) {
  const reasons = new Set<LayoutReason>(), m = manifest(rawManifest);
  const result = (manifestSha256: string | null = null, samplesSha256: string | null = null) => ({ fitPassed: reasons.size === 0, exportReady: false as const, scope: "screen-layout-only" as const,
    reasons: [...reasons], manifestSha256, samplesSha256, toleranceCssPx: MATERIAL_LAYOUT_TOLERANCE, stabilityCssPx: MATERIAL_LAYOUT_STABILITY });
  if (!m) { reasons.add("invalid_manifest"); return result(); }
  const profile = materialLayoutProfile(m.template), raw = list(rawSamples, 2), samples = raw?.map(v => sample(v, profile.copies));
  const digest = createHash("sha256").update(JSON.stringify(m)).digest("hex");
  if (!samples || samples.length !== 2 || samples.some(s => s === null)) { reasons.add("invalid_samples"); return result(digest); }
  const [a, b] = samples as [MaterialLayoutSample, MaterialLayoutSample];
  if (b.timeMs <= a.timeMs) reasons.add("invalid_samples");
  const av = values(a), bv = values(b);
  if (flags(a) !== flags(b) || av.some((n, i) => !near(n, bv[i], MATERIAL_LAYOUT_STABILITY))) reasons.add("layout_unstable");
  for (const s of [a, b]) {
    if (!s.fontsReady || s.panels.some(p => !p.image.complete || p.image.naturalWidth < 1 || p.image.naturalHeight < 1)) reasons.add("resources_unready");
    if (s.errors.length) reasons.add("sample_errors");
    const sheet = s.sheet.rect;
    if (s.viewport.width !== m.viewport.width || s.viewport.height !== m.viewport.height || !near(sheet.x, 0) || !near(sheet.y, 0) || !near(sheet.width, profile.width) || !near(sheet.height, profile.height)) reasons.add("sheet_mismatch");
    const checkBox = (b: LayoutBox) => {
      if (b.rect.width > 1 && b.clientWidth === 0 || b.rect.height > 1 && b.clientHeight === 0 || b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 || b.clientWidth > b.rect.width + 1 || b.clientHeight > b.rect.height + 1 || b.scrollWidth < b.clientWidth || b.scrollHeight < b.clientHeight) reasons.add("scroll_overflow");
    };
    checkBox(s.sheet);
    for (const p of s.panels) {
      const cols = profile.copies === 4 ? 2 : 1, rows = cols, expected = { x: sheet.x + (p.index % cols) * sheet.width / cols, y: sheet.y + Math.floor(p.index / cols) * sheet.height / rows, width: sheet.width / cols, height: sheet.height / rows };
      if (rectValues(p.box.rect).some((n, i) => !near(n, rectValues(expected)[i]))) reasons.add("panel_mismatch");
      checkBox(p.box);
      if (!contains(sheet, p.box.rect)) reasons.add("bounds_overflow");
      for (const [i, block] of p.blocks.entries()) {
        checkBox(block.box);
        if (!contains(p.box.rect, block.box.rect) || block.box.rect.width <= 0 || i < 4 && block.box.rect.height <= 0) reasons.add("bounds_overflow");
        if (block.clipped) reasons.add("clipping");
        if (i && p.blocks[i - 1].box.rect.y + p.blocks[i - 1].box.rect.height > block.box.rect.y + 1) reasons.add("block_overlap");
      }
      if (!contains(p.blocks[0].box.rect, p.image.rect) || p.image.rect.width <= 0 || p.image.rect.height <= 0) reasons.add("bounds_overflow");
    }
  }
  return result(digest, createHash("sha256").update(JSON.stringify([a, b])).digest("hex"));
}
