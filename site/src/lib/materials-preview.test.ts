import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { materialDigest, type MaterialVersion } from "./materials-contract";
import { materialPreviewQuery, prepareMaterialPreview, type ReadMaterialPreviewHistory } from "./materials-preview";
const id = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222", headId = "33333333-3333-4333-8333-333333333333";
const actor = { userId: 7, sessaoId: 19, email: "qa@example.test" };
function version(revision = 4, vid = versionId, title = "Historical & original") : MaterialVersion {
  const content = { template: "poster-a4-v1" as const, assetKey: "adunir" as const, title, body: "Fictional body", callToAction: "Fictional action", footer: "" };
  return { id: vid, materialId: id, revision, content, sha256: materialDigest(content), archived: false, authorId: 7, createdAt: "2026-11-11T00:00:00.000Z" };
}
const query = (revision = 4, vid = versionId) => new URLSearchParams({ versionId: vid, revision: String(revision) });
function reader(versions = [version()], current = version(9, headId, "Head content")) {
  const calls: unknown[][] = [];
  const read: ReadMaterialPreviewHistory = async (...args) => { calls.push(args); return { ok: true, current, versions, nextBefore: null }; };
  return { read, calls };
}
test("exact historical version is rendered once and head stays separately labeled as observed", async () => {
  const { read, calls } = reader(), result = await prepareMaterialPreview(id, query(), actor, read);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], [id, actor, 5]);
  assert.ok(result.html.includes("Historical &amp; original")); assert.ok(!result.html.includes("Head content"));
  assert.equal(result.headers["x-material-version-id"], versionId); assert.equal(result.headers["x-material-version-revision"], "4");
  assert.equal(result.headers["x-material-observed-head-version-id"], headId); assert.equal(result.headers["x-material-observed-head-revision"], "9");
  assert.equal(result.headers["x-material-preview-scope"], "exact-historical-version");
});
test("maximum supported revision uses null cursor without integer overflow", async () => {
  const v = version(2147483646), { read, calls } = reader([v], v);
  assert.equal((await prepareMaterialPreview(id, query(v.revision), actor, read)).ok, true);
  assert.deepEqual(calls[0], [id, actor, null]);
});
test("closed query rejects missing, duplicated, extra and noncanonical values", () => {
  for (const s of ["", `versionId=${versionId}`, "revision=4", `${query()}&revision=4`, `${query()}&versionId=${versionId}`, `${query()}&extra=x`, `versionId=${versionId}&revision=04`, `versionId=${versionId}&revision=4.0`, `versionId=${versionId}&revision=2147483647`, `versionId=${versionId}&revision=-1`, "versionId=bad&revision=1"]) assert.equal(materialPreviewQuery(new URLSearchParams(s)), null, s);
});
test("invalid request never performs a history read", async () => {
  const { read, calls } = reader(); assert.deepEqual(await prepareMaterialPreview("bad", query(), actor, read), { ok: false, error: "parameters" });
  assert.deepEqual(await prepareMaterialPreview(id, new URLSearchParams(), actor, read), { ok: false, error: "parameters" }); assert.equal(calls.length, 0);
});
test("version ID and revision must both match; head is never a fallback", async () => {
  for (const versions of [[], [version(3)], [version(4, headId)]]) {
    const { read } = reader(versions); assert.deepEqual(await prepareMaterialPreview(id, query(), actor, read), { ok: false, error: "not_found" });
  }
});
test("store disabled, forbidden and not-found results are preserved, including actor null", async () => {
  for (const error of ["disabled", "forbidden", "not_found"] as const) {
    let called = false; const read: ReadMaterialPreviewHistory = async (_id, who) => { called = true; assert.equal(who, null); return { ok: false, error }; };
    assert.deepEqual(await prepareMaterialPreview(id, query(), null, read), { ok: false, error }); assert.equal(called, true);
  }
});
test("history exceptions do not disclose internals", async () => {
  assert.deepEqual(await prepareMaterialPreview(id, query(), actor, async () => { throw new Error("private connection details"); }), { ok: false, error: "unavailable" });
});
test("duplicate target, cross-material and excessive history fail closed", async () => {
  for (const versions of [[version(), version()], [{ ...version(), materialId: headId }], Array.from({ length: 51 }, () => version())]) {
    assert.deepEqual(await prepareMaterialPreview(id, query(), actor, reader(versions).read), { ok: false, error: "unavailable" });
  }
});
test("selected content digest and head integrity are checked before headers or rendering", async () => {
  assert.deepEqual(await prepareMaterialPreview(id, query(), actor, reader([{ ...version(), sha256: "0".repeat(64) }]).read), { ok: false, error: "unavailable" });
  assert.deepEqual(await prepareMaterialPreview(id, query(), actor, reader([version()], { ...version(9, headId), materialId: headId }).read), { ok: false, error: "unavailable" });
});
test("headers prohibit scripts/forms/network, bind exact CSS hash and disable caching", async () => {
  const result = await prepareMaterialPreview(id, query(), actor, reader().read); assert.equal(result.ok, true); if (!result.ok) return;
  const css = /<style>([\s\S]*?)<\/style>/.exec(result.html)![1], hash = createHash("sha256").update(css).digest("base64"), h = result.headers;
  for (const part of ["default-src 'none'", "script-src 'none'", "form-action 'none'", "connect-src 'none'", "frame-ancestors 'self'", "img-src 'self'", `style-src 'sha256-${hash}'`]) assert.ok(h["content-security-policy"].includes(part), part);
  assert.equal(h["cache-control"], "private, no-store"); assert.equal(h["x-content-type-options"], "nosniff"); assert.equal(h["x-frame-options"], "SAMEORIGIN"); assert.equal(h["referrer-policy"], "no-referrer");
  assert.equal(h["x-material-content-sha256"], version().sha256); assert.equal(/<script|<form|<iframe/i.test(result.html), false);
});
test("archiving does not erase a permitted exact historical preview", async () => {
  const v = { ...version(), archived: true }; assert.equal((await prepareMaterialPreview(id, query(), actor, reader([v], v).read)).ok, true);
});
