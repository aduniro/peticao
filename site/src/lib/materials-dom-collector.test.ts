import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { assessMaterialLayout } from "./materials-layout";
import { collectMaterialLayout } from "./materials-dom-collector";

function fixture(copies = 1) {
  const style = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible", transform: "none", filter: "none",
    overflowX: "visible", overflowY: "visible", clipPath: "none", clip: "auto", maskImage: "none", textOverflow: "clip", webkitLineClamp: "none" };
  type Rect = { x: number; y: number; width: number; height: number };
  interface El {
    tagName: string; className: string; children: El[]; childNodes: { nodeType: number; nodeValue: string }[];
    style: typeof style; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number;
    geometry: Rect; hasAttribute: (name: string) => boolean; getBoundingClientRect(): Rect;
  }
  function element(tagName: string, className: string, children: El[] = []): El {
    return { tagName, className, children, childNodes: [] as { nodeType: number; nodeValue: string }[], style: { ...style },
      clientWidth: 100, clientHeight: 100, scrollWidth: 100, scrollHeight: 100,
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      hasAttribute: (name: string) => name === "data-material-panel" && tagName === "SECTION",
      getBoundingClientRect() { return this.geometry; } };
  }
  const panels = Array.from({ length: copies }, () => {
    const img = Object.assign(element("IMG", ""), { complete: true, naturalWidth: 100, naturalHeight: 40 });
    return element("SECTION", "panel", [element("DIV", "brand", [img]), element("H1", ""), element("P", "body"), element("P", "action"), element("P", "footer")]);
  });
  const sheet = element("MAIN", "sheet", panels), body = Object.assign(element("BODY", "", [sheet]), { firstElementChild: sheet });
  const document = { body, documentElement: element("HTML", ""), fonts: { status: "loaded" },
    querySelectorAll: (selector: string) => selector === "[data-material-sheet]" ? [sheet] : panels };
  const context = { document, window: { innerWidth: 850, innerHeight: 1200, devicePixelRatio: 1 }, performance: { now: () => 100 }, getComputedStyle: (el: El) => el.style };
  const run = () => runInNewContext(`(${collectMaterialLayout.toString()})()`, context) as ReturnType<typeof collectMaterialLayout>;
  return { context, sheet, panels, document, run };
}

test("serializable callback needs no imported runtime and preserves DOM data", () => {
  const f = fixture(), before = JSON.stringify(f.context), sample = f.run();
  assert.equal(JSON.stringify(f.context), before);
  assert.equal(sample.panels.length, 1); assert.equal(sample.errors.length, 0);
  assert.deepEqual(Array.from(sample.panels[0].blocks, b => b.kind), ["brand", "title", "body", "action", "footer"]);
  assert.equal(sample.timeMs, 100); assert.equal(sample.fontsReady, true);
  assert.equal("manifestSha256" in sample, false); assert.equal("fitPassed" in sample, false);
});
test("four panels are measured individually", () => {
  const f = fixture(4); f.panels[3].scrollHeight = 151;
  const s = f.run(); assert.equal(s.panels.length, 4); assert.equal(s.panels[3].index, 3); assert.equal(s.panels[3].box.scrollHeight, 151);
});
test("wrong semantic tag, missing block and injected descendant are rejected", () => {
  let f = fixture(); f.panels[0].children[1].tagName = "SPAN"; assert.throws(f.run, /collector_invalid_structure/);
  f = fixture(); f.panels[0].children.pop(); assert.throws(f.run, /collector_invalid_structure/);
  f = fixture(); f.panels[0].children[2].children.push(f.sheet); assert.throws(f.run, /collector_invalid_structure/);
});
test("unexpected copies and visible stray text are rejected", () => {
  let f = fixture(2); assert.throws(f.run, /collector_invalid_structure/);
  f = fixture(); f.sheet.childNodes.push({ nodeType: 3, nodeValue: "unmeasured text" }); assert.throws(f.run, /collector_invalid_structure/);
});
test("block clipping is measured rather than silently accepted", () => {
  const f = fixture(); f.panels[0].children[2].style.overflowY = "hidden";
  assert.equal(f.run().panels[0].blocks[2].clipped, true);
});
test("mask, clamp and ellipsis are clipping", () => {
  for (const [property, value] of [["maskImage", "url(dummy)"], ["webkitLineClamp", "2"], ["textOverflow", "ellipsis"]] as const) {
    const f = fixture(); f.panels[0].children[2].style[property] = value;
    assert.equal(f.run().panels[0].blocks[2].clipped, true);
  }
});
test("ancestor clipping, hidden text and transforms become machine errors", () => {
  const f = fixture(); f.sheet.style.overflowX = "clip"; f.panels[0].children[1].style.opacity = "0"; f.panels[0].style.transform = "scale(.5)";
  assert.deepEqual(Array.from(f.run().errors).sort(), ["ancestor_clipping", "hidden_style", "unsupported_effect"]);
});
test("unloaded fonts and broken image remain visible in metrics", () => {
  const f = fixture(); f.document.fonts.status = "loading";
  Object.assign(f.panels[0].children[0].children[0], { complete: false, naturalWidth: 0 });
  const sample = f.run(); assert.equal(sample.fontsReady, false); assert.equal(sample.panels[0].image.complete, false); assert.equal(sample.panels[0].image.naturalWidth, 0);
});
test("non-finite geometry and fractional scroll metrics are rejected", () => {
  let f = fixture(); f.sheet.geometry.width = NaN; assert.throws(f.run, /collector_invalid_rect/);
  f = fixture(); f.panels[0].scrollWidth = 1.5; assert.throws(f.run, /collector_invalid_box/);
});
test("DPR drift, invalid viewport and excessive time are rejected", () => {
  let f = fixture(); f.context.window.devicePixelRatio = 2; assert.throws(f.run, /collector_invalid_environment/);
  f = fixture(); f.context.window.innerWidth = 9000; assert.throws(f.run, /collector_invalid_environment/);
  f = fixture(); f.context.performance.now = () => Infinity; assert.throws(f.run, /collector_invalid_environment/);
});

test("serialized metrics feed the unchanged assessor for poster and four-cut sheet", () => {
  for (const copies of [1, 4]) {
    const f = fixture(copies), width = 210 * 96 / 25.4, height = 297 * 96 / 25.4, columns = copies === 4 ? 2 : 1;
    const size = (el: typeof f.sheet, x: number, y: number, w: number, h: number) => {
      el.geometry = { x, y, width: w, height: h }; el.clientWidth = el.scrollWidth = Math.floor(w); el.clientHeight = el.scrollHeight = Math.floor(h);
    };
    size(f.sheet, 0, 0, width, height);
    f.panels.forEach((panel, i) => {
      const x = i % columns * width / columns, y = Math.floor(i / columns) * height / columns;
      size(panel, x, y, width / columns, height / columns);
      panel.children.forEach((block, b) => size(block, x, y + b * 80, width / columns, 40));
      size(panel.children[0].children[0], x, y, 100, 40);
    });
    const a = JSON.parse(JSON.stringify(f.run())), b = { ...a, timeMs: 101 };
    const manifest = { version: 1, materialVersionId: "11111111-1111-4111-8111-111111111111", template: copies === 4 ? "flyer-mono-cut-v1" : "poster-a4-v1",
      contentSha256: "a".repeat(64), htmlSha256: "b".repeat(64), rendererSha256: "c".repeat(64), assetSetSha256: "d".repeat(64), fontSetSha256: "e".repeat(64), browserSha256: "f".repeat(64),
      media: "screen", deviceScaleFactor: 1, viewport: { width: 850, height: 1200 } };
    const result = assessMaterialLayout(manifest, [a, b]);
    assert.equal(result.fitPassed, true, JSON.stringify(result.reasons)); assert.equal(result.exportReady, false);
  }
});

test("only the renderer grayscale filter is allowed for the logo", () => {
  const f = fixture(), img = f.panels[0].children[0].children[0];
  img.style.filter = "grayscale(1)"; assert.equal(f.run().errors.length, 0);
  img.style.filter = "opacity(0)"; assert.equal(f.run().errors.includes("unsupported_effect"), true);
});
