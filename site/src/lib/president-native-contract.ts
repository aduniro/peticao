import { createHash } from "node:crypto";

/** A serialization contract, not an identity verifier or permission to sign/send. */
export type OwnConfirmationSnapshot = {
  version: 1; state: "consumed"; method: "own-confirmation";
  receiptId: string; challengeId: string; batchId: number; responsibleId: number;
  documentVersion: string; sourceSha256: string; listHash: string;
  accountFingerprint: string; signerName: string; confirmedAt: string;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const keys = ["version", "state", "method", "receiptId", "challengeId", "batchId", "responsibleId", "documentVersion", "sourceSha256", "listHash", "accountFingerprint", "signerName", "confirmedAt"].sort().join(",");
/** Only bytes already loaded by an authenticated durable adapter may be used for an actual PDF. */
export function freezeOwnConfirmation(snapshot: unknown, source: Buffer) {
  const invalid = { ok: false as const, error: "invalid_confirmation" as const };
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || Object.keys(snapshot).sort().join(",") !== keys || !Buffer.isBuffer(source) || source.length < 16 || source.length > 25 * 1024 * 1024 || source.subarray(0, 5).toString() !== "%PDF-") return invalid;
  // Persist only plain data: never evaluate an accessor while building an evidentiary record.
  if (Object.getPrototypeOf(snapshot) !== Object.prototype || Object.getOwnPropertySymbols(snapshot).length || Object.values(Object.getOwnPropertyDescriptors(snapshot)).some(d => !("value" in d))) return invalid;
  const s = snapshot as OwnConfirmationSnapshot;
  if (s.version !== 1 || s.state !== "consumed" || s.method !== "own-confirmation" || !uuid(s.receiptId) || !uuid(s.challengeId) || !id(s.batchId) || !id(s.responsibleId) || ![s.documentVersion, s.sourceSha256, s.listHash, s.accountFingerprint].every(hash) || sha(source) !== s.sourceSha256) return invalid;
  if (typeof s.signerName !== "string" || s.signerName.length < 2 || s.signerName.length > 200 || s.signerName.trim() !== s.signerName || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(s.signerName)) return invalid;
  if (typeof s.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.confirmedAt) || !Number.isFinite(Date.parse(s.confirmedAt)) || new Date(s.confirmedAt).toISOString() !== s.confirmedAt) return invalid;
  const value: Readonly<OwnConfirmationSnapshot> = Object.freeze({ version: 1, state: "consumed", method: "own-confirmation", receiptId: s.receiptId, challengeId: s.challengeId, batchId: s.batchId, responsibleId: s.responsibleId, documentVersion: s.documentVersion, sourceSha256: s.sourceSha256, listHash: s.listHash, accountFingerprint: s.accountFingerprint, signerName: s.signerName, confirmedAt: s.confirmedAt });
  const canonical = JSON.stringify(value), evidenceDigest = sha("president-own-confirmation:v1:" + canonical);
  return { ok: true as const, snapshot: value, canonical, evidenceDigest, requiresDurableConfirmation: true as const, dispatchAllowed: false as const, icpBrasil: false as const, govBr: false as const };
}
