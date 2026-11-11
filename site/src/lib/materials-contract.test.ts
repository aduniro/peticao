import test from "node:test";
import assert from "node:assert/strict";
import { materialContent, materialDigest, materialId, materialListQuery, materialMutation, materialRequestDigest, materialVersion } from "./materials-contract";
const requestId = "15151515-1515-4151-8151-151515151515", id = "16161616-1616-4161-8161-161616161616";
const content = () => ({ template: "poster-a4-v1" as const, assetKey: "adunir" as const, title: "Material fictício", body: "Texto\nem duas linhas", callToAction: "Ação fictícia", footer: "" });
test("structured content preserves Unicode/newlines and known keys only", () => {
  assert.deepEqual(materialContent(content()), content());
  assert.ok(materialContent({ ...content(), body: "Educação 🟢" }));
  for (const extra of ["html", "css", "script", "url", "path", "file", "authorId", "published"]) assert.equal(materialContent({ ...content(), [extra]: "unexpected" }), null);
});
test("HTML/control characters, invalid unicode and empty mandatory fields are refused", () => {
  for (const value of ["<script>alert(1)</script>", "<b>texto</b>", "x\u0000", "x\ud800", " "]) assert.equal(materialContent({ ...content(), title: value }), null);
});
test("templates/assets are closed identifiers rather than supplied executable paths", () => {
  for (const assetKey of ["../../secret", "/etc/passwd", "https://example.test/logo.png", "data:image/svg+xml,script", "unknown"]) assert.equal(materialContent({ ...content(), assetKey }), null);
  assert.equal(materialContent({ ...content(), template: "custom-html" }), null);
});
test("byte budgets include multibyte text and each template limit", () => {
  assert.ok(materialContent({ ...content(), title: "a".repeat(240) }));
  assert.equal(materialContent({ ...content(), title: "á".repeat(121) }), null);
  assert.equal(materialContent({ ...content(), template: "social-square-v1", body: "a".repeat(1401) }), null);
});
test("prototypes/getters/symbols are refused without invoking a getter", () => {
  let calls = 0; const v = { ...content() }; Object.defineProperty(v, "title", { enumerable: true, get() { calls++; return "x"; } });
  assert.equal(materialContent(v), null); assert.equal(calls, 0);
  assert.equal(materialContent(Object.assign(Object.create({ inherited: true }), content())), null);
  assert.equal(materialContent({ ...content(), [Symbol("extra")]: true }), null);
});
test("create/revise/archive require exact durable intent and CAS", () => {
  assert.ok(materialMutation({ operation: "create", requestId, content: content() }));
  assert.ok(materialMutation({ operation: "revise", requestId, materialId: id, expectedRevision: 1, content: content() }));
  assert.ok(materialMutation({ operation: "archive", requestId, materialId: id, expectedRevision: 1 }));
  for (const revision of [0, -1, 1.1, "1", 2147483647]) assert.equal(materialMutation({ operation: "archive", requestId, materialId: id, expectedRevision: revision }), null);
  assert.equal(materialMutation({ operation: "create", requestId, materialId: id, content: content() }), null);
  assert.equal(materialMutation({ operation: "archive", requestId, materialId: id, expectedRevision: 1, content: content() }), null);
});
test("malformed UUIDs and spoofed author/revision fields are refused", () => {
  for (const bad of ["../x", "UPPERCASE", "", null]) assert.equal(materialId(bad), false);
  assert.equal(materialMutation({ operation: "create", requestId, content: content(), authorId: 99 }), null);
});
test("canonical parsing makes key order irrelevant to content/request fingerprints", () => {
  const a = materialMutation({ operation: "create", requestId, content: content() })!;
  const b = materialMutation({ content: Object.fromEntries(Object.entries(content()).reverse()), requestId, operation: "create" })!;
  assert.equal(materialRequestDigest(a), materialRequestDigest(b));
  assert.notEqual(materialDigest(content()), materialDigest({ ...content(), body: "Alterado" }));
});
test("changing request payload or expected revision changes durable request fingerprint", () => {
  const a = materialMutation({ operation: "revise", requestId, materialId: id, expectedRevision: 1, content: content() })!;
  const b = materialMutation({ operation: "revise", requestId, materialId: id, expectedRevision: 2, content: content() })!;
  assert.notEqual(materialRequestDigest(a), materialRequestDigest(b));
});
function row() { return { id: requestId, material_id: id, ordinal: 2, content: Object.fromEntries(Object.entries(content()).reverse()), sha256: materialDigest(content()), archived: false, author_id: 7, created_at: new Date("2026-11-11T00:00:00.000Z"), unrelated_secret: "must not project" }; }
test("version projection checks exact content hash and strips noncontract columns", () => {
  const value = materialVersion(row()); assert.equal(value.authorId, 7); assert.equal(value.revision, 2); assert.equal(value.createdAt, "2026-11-11T00:00:00.000Z");
  assert.equal(Object.hasOwn(value, "unrelated_secret"), false); assert.equal(value.sha256, materialDigest(value.content));
});
test("damaged history metadata/hash never becomes a valid projected version", () => {
  for (const patch of [{ sha256: "f".repeat(64) }, { ordinal: 0 }, { author_id: 0 }, { archived: "false" }, { created_at: "invalid" }, { content: { ...content(), html: "x" } }]) assert.throws(() => materialVersion({ ...row(), ...patch }));
});
test("library filters use exact single-value archived and opaque UUID cursor", () => {
  assert.deepEqual(materialListQuery(new URLSearchParams()), { archived: false, before: null });
  assert.deepEqual(materialListQuery(new URLSearchParams({ archived: "1", before: id })), { archived: true, before: id });
  for (const query of ["archived=maybe", "archived=1&archived=0", "before=../x", "sort=sql", "before=" + id + "&before=" + id]) assert.equal(materialListQuery(new URLSearchParams(query)), null);
});
