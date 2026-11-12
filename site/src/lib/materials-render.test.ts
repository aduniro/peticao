import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderMaterialPreview } from "./materials-render";

const example = { template: "poster-a4-v1", assetKey: "adunir-andes", title: "Título & ação", body: "Linha 1\nLinha 2", callToAction: "Participe", footer: "Texto fictício" };

test("material preview preserves plain text, contains no scripts and pins its exact inline stylesheet", () => {
  const result = renderMaterialPreview(example);
  assert.ok(result.html.includes("Título &amp; ação"));
  assert.ok(result.html.includes("Linha 1\nLinha 2"));
  assert.doesNotMatch(result.html, /<script|<form|<iframe|\son[a-z]+=|https?:\/\//i);
  const style = result.html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style);
  assert.ok(result.html.includes(createHash("sha256").update(style).digest("base64")));
  assert.equal(result.copies, 1);
  assert.deepEqual(result.size, { width: 210, height: 297, unit: "mm" });
  assert.deepEqual(result.requiredAssets, ["/logos/adunir-andes.png"]);
});

test("material preview rejects executable markup, arbitrary assets and accessor inputs before rendering", () => {
  for (const changed of [{ body: "</p><script>alert(1)</script>" }, { assetKey: "https://example.org/logo" }, { template: "arbitrary" }]) {
    assert.throws(() => renderMaterialPreview({ ...example, ...changed }), /material_content_invalid/);
  }
  let invoked = false;
  const accessor = { ...example };
  Object.defineProperty(accessor, "title", { get: () => { invoked = true; return "wrong"; }, enumerable: true });
  assert.throws(() => renderMaterialPreview(accessor));
  assert.equal(invoked, false);
});

test("monochrome cut sheet repeats four complete panels and uses dashed cut lines", () => {
  const result = renderMaterialPreview({ ...example, template: "flyer-mono-cut-v1" });
  assert.equal(result.copies, 4);
  assert.equal(result.html.match(/data-material-panel/g)?.length, 4);
  assert.equal(result.html.match(/Linha 1\nLinha 2/g)?.length, 4);
  assert.ok(result.html.includes("grayscale(1)"));
  assert.ok(result.html.includes("dashed"));
});

test("square template has explicit pixel dimensions and oversized content is never silently truncated", () => {
  const result = renderMaterialPreview({ ...example, template: "social-square-v1", body: "x".repeat(1400) });
  assert.deepEqual(result.size, { width: 1080, height: 1080, unit: "px" });
  assert.ok(result.html.includes("x".repeat(1400)));
  assert.doesNotMatch(result.html, /overflow:hidden|line-clamp|text-overflow/);
  assert.equal(result.exportReady, false);
  assert.equal(result.overflowPolicy, "measure-every-panel-and-reject-export-on-overflow");
});
