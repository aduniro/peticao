import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

export type PresidentDocumentRevision = {
  batchId: number; seq: number; kind: "partial" | "final"; listHash: string;
  originalPdf: Uint8Array; signedPdf: Uint8Array | null; signatureKind: string | null;
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;
const digest = (key: string, purpose: string, value: string) => createHmac("sha256", key).update(`president-portal:v1:${purpose}:${value}`).digest("hex");
const MAX_AGE_MS = 10 * 60_000;
const LEASE_MS = 30_000;

/** Binds the challenge to exact stored bytes. It grants neither access nor a signature. */
export function presidentDocumentRevision(doc: PresidentDocumentRevision) {
  if (!validId(doc.batchId) || !validId(doc.seq) || !["partial", "final"].includes(doc.kind) || !/^[a-f0-9]{64}$/.test(doc.listHash) || !doc.originalPdf.length || doc.signedPdf?.length === 0) throw new Error("invalid_president_document");
  return hash(JSON.stringify(["president-document:v1", doc.batchId, doc.seq, doc.kind, doc.listHash, hash(doc.originalPdf), doc.signedPdf && hash(doc.signedPdf), doc.signatureKind]));
}

export type IssuedPresidentChallenge = {
  id: string; batchId: number; responsibleId: number; issuedBy: number;
  documentVersion: string; tokenHash: string; passwordHash: string;
  createdAt: number; expiresAt: number; maximumAttempts: 5;
};
export type PresidentChallengeClaim = { id: string; responsibleId: number; documentVersion: string };
/**
 * REQUIRED durable adapter, not implemented by this contract:
 * - issue: revalidate Total/stepup, configured responsible and exact document revision;
 * - claim: lock row, count attempts, check expiry/password (constant time),
 *   responsible/revision and acquire lease; takeover only after the old lease expires;
 * - finish: CAS lease + recheck expiry/responsible/revision; audit and consume atomically;
 * - no raw password, CPF or birth date persisted; no PDF/signature_kind changes or sends.
 */
export interface PresidentChallengeStore {
  issue(challenge: IssuedPresidentChallenge): Promise<boolean>;
  claim(input: { tokenHash: string; passwordHash: string; leaseId: string; now: number; leaseUntil: number }): Promise<PresidentChallengeClaim | null>;
  finish(input: { id: string; leaseId: string; documentVersion: string; now: number; verified: boolean }): Promise<{ receiptId: string } | null>;
}
export type PresidentIdentityVerifier = (input: { responsibleId: number; cpf: string; birthDate: string }) => Promise<boolean>;
type Runtime = { store: PresidentChallengeStore | null; key: string | null; clock?: () => number };
const unavailable = { ok: false as const, error: "unavailable" as const };

/** Credentials remain in POST bodies; expose neither raw value in URLs nor storage. */
export function presidentAccessHashes(input: { token: string; password: string }, key: string | null) {
  if (!key || Buffer.byteLength(key) < 32 || !/^[A-Za-z0-9_-]{43}$/.test(input.token) || !/^[A-Za-z0-9_-]{12}$/.test(input.password)) return null;
  const tokenHash = digest(key,"token",input.token);
  return { tokenHash,passwordHash:digest(key,"password",`${tokenHash}:${input.password}`) };
}

/** Creates a capability only after durable admission. No mail/provider dispatch exists here. */
export async function issuePresidentChallenge(input: { document: PresidentDocumentRevision; responsibleId: number; issuedBy: number }, runtime: Runtime) {
  if (!runtime.store || !runtime.key || Buffer.byteLength(runtime.key) < 32) return unavailable;
  if (!validId(input.responsibleId) || !validId(input.issuedBy)) return unavailable;
  let version: string;
  try { version = presidentDocumentRevision(input.document); } catch { return unavailable; }
  const now = (runtime.clock ?? Date.now)();
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - MAX_AGE_MS) return unavailable;
  const token = randomBytes(32).toString("base64url"), password = randomBytes(9).toString("base64url"), id = randomUUID();
  const tokenHash = digest(runtime.key, "token", token);
  const row: IssuedPresidentChallenge = { id, batchId: input.document.batchId, responsibleId: input.responsibleId, issuedBy: input.issuedBy, documentVersion: version, tokenHash, passwordHash: digest(runtime.key, "password", `${tokenHash}:${password}`), createdAt: now, expiresAt: now + MAX_AGE_MS, maximumAttempts: 5 };
  try {
    if (!(await runtime.store.issue(row))) return unavailable;
    return { ok: true as const, id, token, password, expiresAt: row.expiresAt, documentVersion: version };
  } catch { return unavailable; }
}

/** Confirms a challenge, not an ICP/Gov.br signature or permission to send. */
export async function confirmPresidentChallenge(input: { token: string; password: string; cpf: string; birthDate: string }, runtime: Runtime & { verifyIdentity: PresidentIdentityVerifier | null }) {
  if (!runtime.store || !runtime.key || Buffer.byteLength(runtime.key) < 32 || !runtime.verifyIdentity) return unavailable;
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token) || !/^[A-Za-z0-9_-]{12}$/.test(input.password) || !/^[0-9]{11}$/.test(input.cpf) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.birthDate)) return unavailable;
  const clock = runtime.clock ?? Date.now, now = clock(), leaseId = randomUUID();
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - LEASE_MS) return unavailable;
  const tokenHash = digest(runtime.key, "token", input.token);
  try {
    const claim = await runtime.store.claim({ tokenHash, passwordHash: digest(runtime.key, "password", `${tokenHash}:${input.password}`), leaseId, now, leaseUntil: now + LEASE_MS });
    if (!claim) return unavailable;
    let verified = false;
    try { verified = await runtime.verifyIdentity({ responsibleId: claim.responsibleId, cpf: input.cpf, birthDate: input.birthDate }) === true; } catch { /* No success inferred from an unavailable verifier. */ }
    const finishedAt = clock();
    if (!Number.isSafeInteger(finishedAt) || finishedAt < now) return unavailable;
    const result = await runtime.store.finish({ id: claim.id, leaseId, documentVersion: claim.documentVersion, now: finishedAt, verified });
    if (!verified || !result) return unavailable;
    return { ok: true as const, receiptId: result.receiptId, assurance: "own-confirmation" as const, icpBrasil: false as const, govBr: false as const };
  } catch { return unavailable; }
}
