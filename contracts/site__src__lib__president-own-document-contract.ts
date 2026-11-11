import { createHash } from "node:crypto";
import type { OwnConfirmationSnapshot } from "./president-native-contract";

export const ownUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export const ownSha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const ownHash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export type OwnDocumentRequest = { requestId: string; batchId: number; receiptId: string; expectedDocumentVersion: string };
export function ownDocumentRequest(value: unknown): OwnDocumentRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d)) || Object.keys(value).sort().join(",") !== "batchId,expectedDocumentVersion,receiptId,requestId") return null;
  const v = value as OwnDocumentRequest;
  if (!ownUuid(v.requestId) || !ownUuid(v.receiptId) || !ownSha(v.expectedDocumentVersion) || !Number.isInteger(v.batchId) || v.batchId < 1 || v.batchId > 2147483647) return null;
  return Object.freeze({ requestId: v.requestId, batchId: v.batchId, receiptId: v.receiptId, expectedDocumentVersion: v.expectedDocumentVersion });
}
export const ownRequestDigest = (r: OwnDocumentRequest) => ownHash(JSON.stringify(["president-own-document-intent:v1", r.batchId, r.receiptId, r.expectedDocumentVersion]));
export type CapturedOwn = { bytes: Buffer; snapshot: Readonly<OwnConfirmationSnapshot>; canonical: string; evidenceDigest: string };
export type OwnDocumentMetadata = { source: "president-own"; dispatchAllowed: false; icpBrasil: false; govBr: false; requestId: string; state: "pending" | "completed" | "failed"; artifactId: string | null; batchId: number; receiptId: string; documentVersion: string; sha256: string | null; sourceSha256: string | null; error: string | null; createdAt: string };
export type OwnFailure = { ok: false; error: "parameters" | "forbidden" | "not_found" | "conflict" | "unavailable" };
export type OwnResult = OwnFailure | { ok: true; document: OwnDocumentMetadata };
export type OwnReservation = OwnFailure | { ok: true; existing: true; document: OwnDocumentMetadata } | { ok: true; existing: false; intentId: string };
export type OwnPorts = {
  reserve: (r: OwnDocumentRequest) => Promise<OwnReservation>;
  capture: (r: OwnDocumentRequest) => Promise<CapturedOwn | null>;
  render: (capture: CapturedOwn) => Promise<{ bytes: Buffer; evidenceDigest: string }>;
  complete: (r: OwnDocumentRequest, intentId: string, capture: CapturedOwn, pdf: Buffer) => Promise<OwnResult>;
  fail: (intentId: string, reason: "capture_unavailable" | "render_failed") => Promise<void>;
};
/** Orchestration only: durable adapter owns authorization, nonce and final CAS. */
export async function generateOwnDocument(input: unknown, ports: OwnPorts): Promise<OwnResult> {
  const request = ownDocumentRequest(input); if (!request) return { ok: false, error: "parameters" };
  const reservation = await ports.reserve(request); if (!reservation.ok) return reservation;
  if (reservation.existing) return { ok: true, document: reservation.document };
  const capture = await ports.capture(request);
  if (!capture) { await ports.fail(reservation.intentId, "capture_unavailable"); return { ok: false, error: "conflict" }; }
  let rendered;
  try {
    rendered = await ports.render(capture);
    if (!Buffer.isBuffer(rendered.bytes) || rendered.bytes.length < 16 || rendered.bytes.length > 25 * 1024 * 1024 || rendered.bytes.subarray(0, 5).toString() !== "%PDF-" || rendered.evidenceDigest !== capture.evidenceDigest) throw new Error("invalid_rendered_document");
  } catch {
    await ports.fail(reservation.intentId, "render_failed"); return { ok: false, error: "unavailable" };
  }
  // Reauthorization/CAS belongs inside this transaction, after expensive rendering.
  return ports.complete(request, reservation.intentId, capture, rendered.bytes);
}

export type OwnArtifactRecord = { id: string; source: string; batch_id: number; challenge_id: string; receipt_id: string; document_version: string; source_sha256: string; evidence_digest: string; evidence_canonical: string; bytes: Buffer; sha256: string };
/** Historical internal integrity only; never substitutes for consumed-receipt admission. */
export function ownArtifactConsistent(row: OwnArtifactRecord): boolean {
  if (!row || row.source !== "president-own" || !ownUuid(row.id) || !Number.isInteger(row.batch_id) || row.batch_id < 1 || row.batch_id > 2147483647 || !ownUuid(row.challenge_id) || !ownUuid(row.receipt_id) || ![row.document_version, row.source_sha256, row.evidence_digest, row.sha256].every(ownSha) || !Buffer.isBuffer(row.bytes) || row.bytes.length < 16 || row.bytes.length > 25 * 1024 * 1024 || row.bytes.subarray(0, 5).toString() !== "%PDF-" || ownHash(row.bytes) !== row.sha256 || typeof row.evidence_canonical !== "string" || Buffer.byteLength(row.evidence_canonical) > 4096 || ownHash("president-own-confirmation:v1:" + row.evidence_canonical) !== row.evidence_digest) return false;
  let s: OwnConfirmationSnapshot;
  try { s = JSON.parse(row.evidence_canonical); } catch { return false; }
  if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).sort().join(",") !== "accountFingerprint,batchId,challengeId,confirmedAt,documentVersion,listHash,method,receiptId,responsibleId,signerName,sourceSha256,state,version") return false;
  if (s.version !== 1 || s.state !== "consumed" || s.method !== "own-confirmation" || s.batchId !== row.batch_id || s.challengeId !== row.challenge_id || s.receiptId !== row.receipt_id || s.documentVersion !== row.document_version || s.sourceSha256 !== row.source_sha256 || !Number.isInteger(s.responsibleId) || s.responsibleId < 1 || s.responsibleId > 2147483647 || !ownSha(s.accountFingerprint) || !ownSha(s.listHash)) return false;
  if (typeof s.signerName !== "string" || s.signerName.length < 2 || s.signerName.length > 200 || s.signerName.trim() !== s.signerName || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(s.signerName) || typeof s.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.confirmedAt) || !Number.isFinite(Date.parse(s.confirmedAt)) || new Date(s.confirmedAt).toISOString() !== s.confirmedAt) return false;
  const canonical = JSON.stringify({ version: 1, state: "consumed", method: "own-confirmation", receiptId: s.receiptId, challengeId: s.challengeId, batchId: s.batchId, responsibleId: s.responsibleId, documentVersion: s.documentVersion, sourceSha256: s.sourceSha256, listHash: s.listHash, accountFingerprint: s.accountFingerprint, signerName: s.signerName, confirmedAt: s.confirmedAt });
  return canonical === row.evidence_canonical;
}
