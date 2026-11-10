import test from "node:test";
import assert from "node:assert/strict";
import { readBaseInventory, readBaseSelection, readBasePacketReview, uploadBase, validateBase, selectBase, prepareBasePacket, readBaseIntent } from "./petition-base-request";
const requestId = "11111111-1111-4111-8111-111111111111", artifactId = "22222222-2222-4222-8222-222222222222", selectionId = "33333333-3333-4333-8333-333333333333", validationId = "44444444-4444-4444-8444-444444444444";
const sha = "a".repeat(64), version = "b".repeat(64);
const artifact = { artifactId, sha256: sha, byteLength: 24, usableInPackage: false, lastValidationId: validationId };
const selection = { selectionId, revision: 1, validationId, artifactId, sha256: sha, petitionTextVersion: version, usableInPackage: false };
const packet = { packageId: requestId, batchId: 7, ordinal: 1, documentVersion: version, selectionId, baseArtifactId: artifactId, baseSha256: sha, batchSha256: sha, packageDigest: sha, approvalRequired: true, dispatchAllowed: false };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const mock = (value: unknown, status = 200) => (async () => response(value, status)) as typeof fetch;

test("base client reads only strict bounded metadata and never treats upload as dispatch permission", async () => {
  const good = await readBaseInventory(mock({ ok: true, hasMore: false, artifacts: [artifact] })); assert.equal(good.kind, "success");
  for (const value of [{ ok: true, artifacts: [artifact, artifact], hasMore: false }, { ok: true, artifacts: [{ ...artifact, usableInPackage: true }], hasMore: false }, { ok: true, artifacts: Array.from({ length: 21 }, () => artifact), hasMore: true }]) assert.equal((await readBaseInventory(mock(value))).kind, "uncertain");
  assert.equal((await readBaseSelection(mock({ ok: true, selection, currentBindingMatches: true }))).kind, "success");
  assert.equal((await readBaseSelection(mock({ ok: true, selection: null }))).kind, "success");
  assert.equal((await readBasePacketReview(7, mock({ ok: true, batchId: 7, documentVersion: version, configured: true, canPrepare: true, selectionId, latestPackage: packet }))).kind, "success");
  assert.equal((await readBasePacketReview(7, mock({ ok: true, batchId: 8 }))).kind, "uncertain");
});
test("explicit selection and package POSTs bind the expected revision and immutable identities", async () => {
  const input = { requestId, expectedRevision: 0, validationId, reviewedSha256: sha, expectedTextVersion: version };
  assert.equal((await selectBase(input, mock({ ok: true, selection, isCurrent: true }))).kind, "success");
  assert.equal((await selectBase(input, mock({ ok: true, selection: { ...selection, sha256: version }, isCurrent: true }))).kind, "uncertain");
  const intent = { requestId, batchId: 7, expectedDocumentVersion: version, expectedSelectionId: selectionId, expectedPackageRevision: 0 };
  let calls = 0;
  const fetcher = (async (path, init) => { calls++; assert.equal(path, "/api/admin/lotes/7/pacote"); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin"); const body = JSON.parse(String(init?.body)); assert.equal(body.batchId, undefined); assert.equal(body.requestId, requestId); return response({ ok: true, package: packet, isCurrent: true }); }) as typeof fetch;
  assert.equal((await prepareBasePacket(intent, fetcher)).kind, "success"); assert.equal(calls, 1);
  for (const changed of [{ ...packet, batchId: 8 }, { ...packet, ordinal: 2 }, { ...packet, dispatchAllowed: true }, { ...packet, documentVersion: sha }]) assert.equal((await prepareBasePacket(intent, mock({ ok: true, package: changed, isCurrent: true }))).kind, "uncertain");
});
test("lost responses and non-JSON pages never retry a POST or manufacture completion", async () => {
  const intent = { requestId, batchId: 7, expectedDocumentVersion: version, expectedSelectionId: selectionId, expectedPackageRevision: 0 };
  for (const failure of [async () => { throw new Error("QA network"); }, async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }), async () => response({ ok: false }, 503)]) {
    let calls = 0; const fetcher = (async () => { calls++; return failure(); }) as typeof fetch;
    assert.equal((await prepareBasePacket(intent, fetcher)).kind, "uncertain"); assert.equal(calls, 1);
  }
});
test("deadline covers a stalled body even if fetch ignores abort; stream size is bounded", async () => {
  let calls = 0, cancelled = false;
  const fetcher = (async () => { calls++; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  assert.equal((await readBaseInventory(fetcher, 20)).kind, "uncertain"); assert.equal(calls, 1); assert.equal(cancelled, true);
  assert.equal((await readBaseInventory((async () => new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } })) as typeof fetch)).kind, "uncertain");
  assert.equal((await readBaseInventory((async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } })) as typeof fetch)).kind, "uncertain");
});
test("GET recovery binds the original request and preserves an obsolete outcome as obsolete", async () => {
  let method: string | undefined;
  const fetcher = (async (path, init) => { assert.equal(path, "/api/admin/lotes/7/pacote?requestId=" + requestId); method = init?.method; return response({ ok: true, requestId, package: packet, isCurrent: false }); }) as typeof fetch;
  const result = await readBaseIntent("package", requestId, 7, fetcher); assert.equal(method, "GET"); assert.ok(result.kind === "success" && result.value.kind === "package"); assert.equal(result.value.isCurrent, false);
  assert.equal((await readBaseIntent("package", requestId, 7, mock({ ok: true, requestId: artifactId, package: packet, isCurrent: true }))).kind, "uncertain");
  assert.equal((await readBaseIntent("upload", requestId, 7, mock({ ok: true, requestId, ...artifact }))).kind, "success");
  assert.equal((await readBaseIntent("selection", requestId, 7, mock({ ok: true, requestId, selection, isCurrent: true }))).kind, "success");
  assert.deepEqual(await readBaseIntent("package", requestId, 7, mock({ ok: false, error: "not_found" }, 404)), { kind: "rejected", status: 404, error: "not_found" });
});
test("validation requires matching artifact, exact SHA and the dedicated gov.br method", async () => {
  const value = { ok: true, validationId, artifactId, sha256: sha, validationState: "valid", method: "gov-br-advanced", usableInPackage: false };
  assert.equal((await validateBase(artifactId, sha, mock(value))).kind, "success");
  for (const changed of [{ ...value, artifactId: requestId }, { ...value, sha256: version }, { ...value, method: "icp-brasil" }, { ...value, usableInPackage: true }]) assert.equal((await validateBase(artifactId, sha, mock(changed))).kind, "uncertain");
});
test("multipart upload carries only the file and request identity and checks returned bytes/hash", async () => {
  const file = new File(["%PDF-1.7 fixture1234567890"], "qa.pdf", { type: "application/pdf" });
  const fetcher = (async (_path, init) => { assert.equal(init?.method, "POST"); assert.ok(init?.body instanceof FormData); assert.deepEqual(Array.from(init.body.keys()).sort(), ["file", "requestId"]); assert.equal(new Headers(init.headers).has("content-type"), false); return response({ ok: true, ...artifact, byteLength: file.size }); }) as typeof fetch;
  assert.equal((await uploadBase(requestId, file, sha, fetcher)).kind, "success");
  assert.equal((await uploadBase(requestId, file, sha, mock({ ok: true, ...artifact, sha256: version, byteLength: file.size }))).kind, "uncertain");
  let calls = 0; assert.equal((await uploadBase("bad", file, sha, (async () => { calls++; return response({}); }) as typeof fetch)).kind, "rejected"); assert.equal(calls, 0);
});
