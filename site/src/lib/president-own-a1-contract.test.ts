import test from "node:test";
import assert from "node:assert/strict";
import { ownHash, type OwnArtifactRecord } from "./president-own-document-contract";
import { ownAwareA1Intent, ownAwareA1Fingerprint, selectOwnAwareA1Input, frozenOwnA1InputMatches, type OwnA1CurrentContext, type OwnAwareA1Intent, type FrozenOwnA1Input } from "./president-own-a1-contract";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const source = Buffer.from("%PDF-1.7 source fictitious prepared"), appended = Buffer.from("%PDF-1.7 final fictitious with own confirmation page");
const current: OwnA1CurrentContext = { batchId: 1, a1DocumentVersion: "a".repeat(64), presidentDocumentVersion: "b".repeat(64), listHash: "c".repeat(64), originalVersionId: uuid(1), originalSha256: ownHash(source), originalBytes: source, hasSignedPdf: false, signatureKind: null };
const intent: OwnAwareA1Intent = { batchId: 1, requestId: uuid(2), expectedDocumentVersion: current.a1DocumentVersion, expectedPolicyRevision: 1 };
function artifact(patch: Record<string, unknown> = {}): OwnArtifactRecord {
 const evidence = { version: 1, state: "consumed", method: "own-confirmation", receiptId: uuid(3), challengeId: uuid(4), batchId: 1, responsibleId: 2, documentVersion: current.presidentDocumentVersion, sourceSha256: current.originalSha256, listHash: current.listHash, accountFingerprint: "d".repeat(64), signerName: "Pessoa Fictícia", confirmedAt: "2026-11-10T10:00:00.000Z", ...patch };
 const canonical = JSON.stringify(evidence);
 return { id: uuid(5), source: "president-own", batch_id: evidence.batchId, challenge_id: evidence.challengeId, receipt_id: evidence.receiptId, document_version: evidence.documentVersion, source_sha256: evidence.sourceSha256, evidence_digest: ownHash("president-own-confirmation:v1:" + canonical), evidence_canonical: canonical, bytes: appended, sha256: ownHash(appended) };
}
const combined = () => ({ ...intent, expectedOwnArtifactId: uuid(5) });

test("explicit optional selector: rejects null, empty, injected credential paths and getters", () => {
 assert.deepEqual(ownAwareA1Intent(intent), intent); assert.deepEqual(ownAwareA1Intent(combined()), combined());
 for (const bad of [{ ...intent, expectedOwnArtifactId: null }, { ...intent, expectedOwnArtifactId: undefined }, { ...intent, expectedOwnArtifactId: "" }, { ...intent, pfxPath: "/not-a-request-field" }, { ...intent, batchId: 0 }]) assert.equal(ownAwareA1Intent(bad), null);
 const getter = { ...combined() }; Object.defineProperty(getter, "expectedOwnArtifactId", { enumerable: true, get() { throw new Error("must not evaluate"); } }); assert.equal(ownAwareA1Intent(getter), null);
});
test("default preserves original selection and legacy request fingerprint even when own artifact exists", () => {
 const selected = selectOwnAwareA1Input(intent, current, artifact()); assert.equal(selected.ok, true); if (!selected.ok) return;
 assert.equal(selected.input.kind, "original"); assert.equal(selected.input.ownArtifactId, null); assert.deepEqual(selected.input.bytes, source);
 assert.equal(ownAwareA1Fingerprint(intent), ownHash(JSON.stringify([intent.batchId, intent.requestId, intent.expectedDocumentVersion, intent.expectedPolicyRevision])));
 assert.notEqual(ownAwareA1Fingerprint(combined()), ownAwareA1Fingerprint(intent));
 assert.notEqual(ownAwareA1Fingerprint(combined()), ownAwareA1Fingerprint({ ...combined(), expectedOwnArtifactId: uuid(6) }));
});
test("combined selects exact final own bytes without conflating A1 and president revisions", () => {
 assert.notEqual(current.a1DocumentVersion, current.presidentDocumentVersion);
 const selected = selectOwnAwareA1Input(combined(), current, artifact()); assert.equal(selected.ok, true); if (!selected.ok) return;
 assert.equal(selected.input.kind, "president-own"); assert.deepEqual(selected.input.bytes, appended); assert.equal(selected.input.sha256, ownHash(appended));
 assert.equal(selected.input.a1DocumentVersion, current.a1DocumentVersion); assert.equal(selected.input.signingAuthorized, false); assert.equal(selected.input.requiresTransactionalAdmission, true);
 selected.input.bytes[0] = 0; assert.equal(appended[0], 37);
});
test("explicit missing/wrong own ID never falls back to original or latest own artifact", () => {
 for (const a of [null, { ...artifact(), id: uuid(6) }]) assert.deepEqual(selectOwnAwareA1Input(combined(), current, a), { ok: false, error: "document_conflict" });
});
test("combined rejects source bytes drift, batch drift, proof/revision/list drift and corrupt artifact", () => {
 const candidates = [artifact({ batchId: 2 }), artifact({ documentVersion: current.a1DocumentVersion }), artifact({ sourceSha256: "e".repeat(64) }), artifact({ listHash: "e".repeat(64) }), { ...artifact(), bytes: Buffer.from("%PDF-1.7 corrupted own document") }];
 for (const a of candidates) assert.equal(selectOwnAwareA1Input(combined(), current, a).ok, false);
 for (const c of [{ ...current, originalBytes: Buffer.from("%PDF-1.7 changed original bytes") }, { ...current, a1DocumentVersion: "e".repeat(64) }, { ...current, hasSignedPdf: true }, { ...current, signatureKind: "icp-brasil" }]) assert.equal(selectOwnAwareA1Input(combined(), c, artifact()).ok, false);
});
test("default retains original-only semantics for existing batch signature, combined refuses reserialization", () => {
 const signed = { ...current, hasSignedPdf: true, signatureKind: "icp-brasil" };
 assert.equal(selectOwnAwareA1Input(intent, signed, artifact()).ok, true);
 assert.equal(selectOwnAwareA1Input(combined(), signed, artifact()).ok, false);
});
test("history bridge must preserve exact own bytes, source, receipt artifact and prepared original", () => {
 const result = selectOwnAwareA1Input(combined(), current, artifact()); assert.equal(result.ok, true); if (!result.ok) return;
 const frozen: FrozenOwnA1Input = { id: uuid(7), batch_id: 1, source: "president-own", variant: "signed", signature_kind: "own-confirmation", bytes: Buffer.from(appended), sha256: ownHash(appended), list_hash: current.listHash, ownArtifactId: uuid(5), originalVersionId: current.originalVersionId };
 assert.equal(frozenOwnA1InputMatches(result.input, frozen), true);
 for (const patch of [{ batch_id: 2 }, { source: "upload" }, { source: "prepared" }, { variant: "original" }, { signature_kind: "icp-brasil" }, { ownArtifactId: uuid(6) }, { originalVersionId: uuid(6) }, { sha256: "e".repeat(64) }, { bytes: source }]) assert.equal(frozenOwnA1InputMatches(result.input, { ...frozen, ...patch }), false);
});
