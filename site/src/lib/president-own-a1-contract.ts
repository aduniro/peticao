import { ownArtifactConsistent, ownHash, ownSha, ownUuid, type OwnArtifactRecord } from "./president-own-document-contract";

/** expectedDocumentVersion remains the A1/batches revision, NOT presidentDocumentRevision. */
export type OwnAwareA1Intent = { batchId: number; requestId: string; expectedDocumentVersion: string; expectedPolicyRevision: number; expectedOwnArtifactId?: string };
export function ownAwareA1Intent(value: unknown): OwnAwareA1Intent | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))) return null;
  const v = value as OwnAwareA1Intent;
  const keys = Object.keys(v).sort().join(",");
  if (!["batchId,expectedDocumentVersion,expectedPolicyRevision,requestId", "batchId,expectedDocumentVersion,expectedOwnArtifactId,expectedPolicyRevision,requestId"].includes(keys) || !Number.isInteger(v.batchId) || v.batchId < 1 || v.batchId > 2147483647 || !ownUuid(v.requestId) || !ownSha(v.expectedDocumentVersion) || !Number.isInteger(v.expectedPolicyRevision) || v.expectedPolicyRevision < 1 || v.expectedPolicyRevision > 2147483647 || Object.hasOwn(v, "expectedOwnArtifactId") && !ownUuid(v.expectedOwnArtifactId)) return null;
  return Object.freeze({ batchId: v.batchId, requestId: v.requestId, expectedDocumentVersion: v.expectedDocumentVersion, expectedPolicyRevision: v.expectedPolicyRevision, ...(v.expectedOwnArtifactId === undefined ? {} : { expectedOwnArtifactId: v.expectedOwnArtifactId }) });
}
/** Existing original-only nonce fingerprints are byte-for-byte preserved. */
export function ownAwareA1Fingerprint(intent: OwnAwareA1Intent) {
  const legacy = [intent.batchId, intent.requestId, intent.expectedDocumentVersion, intent.expectedPolicyRevision];
  return ownHash(JSON.stringify(intent.expectedOwnArtifactId === undefined ? legacy : ["batch-a1-own:v1", ...legacy, intent.expectedOwnArtifactId]));
}
export type OwnA1CurrentContext = {
  batchId: number; a1DocumentVersion: string; presidentDocumentVersion: string; listHash: string;
  originalVersionId: string; originalSha256: string; originalBytes: Buffer;
  hasSignedPdf: boolean; signatureKind: string | null;
};
export type FrozenOwnA1Input = {
  id: string; batch_id: number; source: string; variant: string; signature_kind: string | null;
  sha256: string; list_hash: string; bytes: Buffer;
  ownArtifactId: string; originalVersionId: string;
};
type SelectedInput = { batchId: number; kind: "original" | "president-own"; bytes: Buffer; sha256: string; byteLength: number; originalVersionId: string; ownArtifactId: string | null; listHash: string; a1DocumentVersion: string; requiresTransactionalAdmission: true; signingAuthorized: false };
const conflict = { ok: false as const, error: "document_conflict" as const };
/** Integrity/selection only. Authorization, receipt/profile CAS and policy stay inside DB admission/claim/finish. */
export function selectOwnAwareA1Input(input: unknown, current: OwnA1CurrentContext, ownArtifact?: OwnArtifactRecord | null): { ok: false; error: "parameters" | "document_conflict" } | { ok: true; input: SelectedInput } {
  const intent = ownAwareA1Intent(input); if (!intent) return { ok: false, error: "parameters" };
  if (!current || current.batchId !== intent.batchId || current.a1DocumentVersion !== intent.expectedDocumentVersion || typeof current.hasSignedPdf !== "boolean" || ![current.a1DocumentVersion, current.presidentDocumentVersion, current.originalSha256, current.listHash].every(ownSha) || !ownUuid(current.originalVersionId) || !Buffer.isBuffer(current.originalBytes) || current.originalBytes.length < 16 || current.originalBytes.length > 25 * 1024 * 1024 || current.originalBytes.subarray(0, 5).toString() !== "%PDF-" || ownHash(current.originalBytes) !== current.originalSha256) return conflict;
  const common = { batchId: current.batchId, originalVersionId: current.originalVersionId, listHash: current.listHash, a1DocumentVersion: current.a1DocumentVersion, requiresTransactionalAdmission: true as const, signingAuthorized: false as const };
  if (intent.expectedOwnArtifactId === undefined) return { ok: true, input: { ...common, kind: "original", ownArtifactId: null, bytes: Buffer.from(current.originalBytes), sha256: current.originalSha256, byteLength: current.originalBytes.length } };
  // An explicit combined request never falls back to the original or to a newer artifact.
  if (!ownArtifact || intent.expectedOwnArtifactId !== ownArtifact.id || current.hasSignedPdf || ![null, "", "none"].includes(current.signatureKind) || !ownArtifactConsistent(ownArtifact) || ownArtifact.batch_id !== current.batchId || ownArtifact.document_version !== current.presidentDocumentVersion || ownArtifact.source_sha256 !== current.originalSha256) return conflict;
  const evidence = JSON.parse(ownArtifact.evidence_canonical);
  if (evidence.listHash !== current.listHash) return conflict;
  return { ok: true, input: { ...common, kind: "president-own", ownArtifactId: ownArtifact.id, bytes: Buffer.from(ownArtifact.bytes), sha256: ownArtifact.sha256, byteLength: ownArtifact.bytes.length } };
}
/** Verify the immutable history bridge rather than reading a current/later PDF at claim time. */
export function frozenOwnA1InputMatches(selected: SelectedInput, frozen: FrozenOwnA1Input): boolean {
  return selected.kind === "president-own" && ownUuid(frozen.id) && frozen.batch_id === selected.batchId && frozen.source === "president-own" && frozen.variant === "signed" && frozen.signature_kind === "own-confirmation" && frozen.ownArtifactId === selected.ownArtifactId && frozen.originalVersionId === selected.originalVersionId && frozen.list_hash === selected.listHash && frozen.sha256 === selected.sha256 && Buffer.isBuffer(frozen.bytes) && frozen.bytes.length === selected.byteLength && frozen.bytes.equals(selected.bytes) && ownHash(frozen.bytes) === frozen.sha256;
}
