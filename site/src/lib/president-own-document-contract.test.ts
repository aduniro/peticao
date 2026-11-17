import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnDocument, ownArtifactConsistent, ownHash, ownDocumentRequest, ownRequestDigest, type CapturedOwn, type OwnDocumentMetadata, type OwnDocumentRequest, type OwnPorts } from "./president-own-document-contract";

const request: OwnDocumentRequest = { requestId: "00000000-0000-4000-8000-000000000001", batchId: 1, receiptId: "00000000-0000-4000-8000-000000000002", expectedDocumentVersion: "a".repeat(64) };
const metadata: OwnDocumentMetadata = { source: "president-own", dispatchAllowed: false, icpBrasil: false, govBr: false, requestId: request.requestId, batchId: 1, receiptId: request.receiptId, documentVersion: request.expectedDocumentVersion, artifactId: null, sourceSha256: null, sha256: null, state: "pending", error: null, createdAt: "2026-11-10T10:00:00Z" };
const capture = { bytes: Buffer.from("%PDF-1.7 source fictitious"), snapshot: {}, canonical: "fixture", evidenceDigest: "b".repeat(64) } as CapturedOwn;
function fixture() {
  const effects: string[] = [];
  const ports: OwnPorts = {
    reserve: async () => { effects.push("reserve"); return { ok: true, existing: false, intentId: "00000000-0000-4000-8000-000000000003" }; },
    capture: async () => { effects.push("capture"); return capture; },
    render: async () => { effects.push("render"); return { bytes: Buffer.from("%PDF-1.7 rendered fictitious"), evidenceDigest: capture.evidenceDigest }; },
    complete: async () => { effects.push("complete-cas"); return { ok: true, document: { ...metadata, state: "completed" } }; },
    fail: async (_, reason) => { effects.push(reason); },
  };
  return { ports, effects };
}
test("strict request rejects injected proof, secrets, duplicate shape, getters and invalid IDs", () => {
  assert.deepEqual(ownDocumentRequest(request), request);
  for (const value of [null, [], { ...request, snapshot: capture }, { ...request, password: "do-not-store" }, { ...request, batchId: 0 }, { ...request, requestId: "not-a-uuid" }, { ...request, expectedDocumentVersion: "A".repeat(64) }, Object.create(request)]) assert.equal(ownDocumentRequest(value), null);
  const getter = { ...request }; Object.defineProperty(getter, "receiptId", { enumerable: true, get() { throw new Error("must not execute"); } }); assert.equal(ownDocumentRequest(getter), null);
});
test("context digest changes with batch/receipt/document, nonce is separate durable key", () => {
  assert.equal(ownRequestDigest(request), ownRequestDigest({ ...request, requestId: "00000000-0000-4000-8000-000000000005" }));
  for (const value of [{ ...request, batchId: 2 }, { ...request, receiptId: "00000000-0000-4000-8000-000000000006" }, { ...request, expectedDocumentVersion: "c".repeat(64) }]) assert.notEqual(ownRequestDigest(request), ownRequestDigest(value));
});
test("only first reserved intent captures/renders, then calls post-render CAS", async () => {
  const { ports, effects } = fixture(); assert.equal((await generateOwnDocument(request, ports)).ok, true);
  assert.deepEqual(effects, ["reserve", "capture", "render", "complete-cas"]);
});
test("replay pending/completed/failed returns metadata without rendering or retry", async () => {
  for (const state of ["pending", "completed", "failed"] as const) {
    const { ports, effects } = fixture(); ports.reserve = async () => ({ ok: true, existing: true, document: { ...metadata, state } });
    const result = await generateOwnDocument(request, ports); assert.equal(result.ok, true); assert.deepEqual(effects, []);
  }
});
test("reserve conflict and forbidden never capture or render", async () => {
  for (const error of ["forbidden", "conflict"] as const) { const { ports, effects } = fixture(); ports.reserve = async () => ({ ok: false, error }); assert.deepEqual(await generateOwnDocument(request, ports), { ok: false, error }); assert.deepEqual(effects, []); }
});
test("capture failure journals failure and does not render", async () => {
  const { ports, effects } = fixture(); ports.capture = async () => null;
  assert.deepEqual(await generateOwnDocument(request, ports), { ok: false, error: "conflict" }); assert.deepEqual(effects, ["reserve", "capture_unavailable"]);
});
test("renderer rejection, wrong digest and invalid bytes never reach persistence", async () => {
  for (const invalid of ["throws", "digest", "header", "length"]) {
    const { ports, effects } = fixture(); ports.render = async () => { if (invalid === "throws") throw new Error("already_signed_pdf"); return { bytes: invalid === "header" ? Buffer.from("not a PDF at all fictitious") : invalid === "length" ? Buffer.from("%PDF-") : Buffer.from("%PDF-1.7 fictitious render"), evidenceDigest: invalid === "digest" ? "c".repeat(64) : capture.evidenceDigest }; };
    assert.deepEqual(await generateOwnDocument(request, ports), { ok: false, error: "unavailable" }); assert.deepEqual(effects, ["reserve", "capture", "render_failed"]);
  }
});
test("revoked actor or changed context after rendering prevents successful completion", async () => {
  for (const error of ["forbidden", "conflict"] as const) {
    const { ports, effects } = fixture(); ports.complete = async () => { effects.push("complete-cas-denied"); return { ok: false, error }; };
    assert.deepEqual(await generateOwnDocument(request, ports), { ok: false, error }); assert.deepEqual(effects, ["reserve", "capture", "render", "complete-cas-denied"]);
  }
});

function artifactFixture() {
 const s = { version: 1, state: "consumed", method: "own-confirmation", receiptId: request.receiptId, challengeId: "00000000-0000-4000-8000-000000000003", batchId: 1, responsibleId: 2, documentVersion: request.expectedDocumentVersion, sourceSha256: "d".repeat(64), listHash: "e".repeat(64), accountFingerprint: "f".repeat(64), signerName: "Pessoa Fictícia", confirmedAt: "2026-11-10T10:00:00.000Z" };
 const canonical = JSON.stringify(s), bytes = Buffer.from("%PDF-1.7 rendered fictitious");
 return { id: "00000000-0000-4000-8000-000000000004", source: "president-own", batch_id: 1, challenge_id: s.challengeId, receipt_id: s.receiptId, document_version: s.documentVersion, source_sha256: s.sourceSha256, evidence_digest: ownHash("president-own-confirmation:v1:" + canonical), evidence_canonical: canonical, bytes, sha256: ownHash(bytes) };
}
test("historical artifact validator binds canonical proof to each stored column and output bytes", () => {
 const valid = artifactFixture(); assert.equal(ownArtifactConsistent(valid), true);
 for (const bad of [{ ...valid, batch_id: 2 }, { ...valid, challenge_id: request.receiptId }, { ...valid, receipt_id: valid.challenge_id }, { ...valid, document_version: "b".repeat(64) }, { ...valid, source_sha256: "b".repeat(64) }, { ...valid, source: "upload" }, { ...valid, bytes: Buffer.from("%PDF-1.7 corrupted content") }, { ...valid, sha256: "b".repeat(64) }]) assert.equal(ownArtifactConsistent(bad), false);
});
test("rehashed malformed canonical data is rejected rather than trusted by digest alone", () => {
 for (const patch of [{ state: "issued" }, { method: "govbr" }, { batchId: 2 }, { signerName: "Bad\u0000Name" }, { confirmedAt: "not-a-date" }, { password: "must-not-persist" }]) {
  const valid = artifactFixture(); const canonical = JSON.stringify({ ...JSON.parse(valid.evidence_canonical), ...patch });
  assert.equal(ownArtifactConsistent({ ...valid, evidence_canonical: canonical, evidence_digest: ownHash("president-own-confirmation:v1:" + canonical) }), false);
 }
});
