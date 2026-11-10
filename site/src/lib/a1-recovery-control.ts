import type { A1AvailabilityObservation, A1JobObservation, A1JobViewState, A1SigningIntent } from "./a1-job-view";
import type { A1HttpResult } from "./a1-request";
import { a1UiContextKey, a1UiIntent, a1UiJobMatchesMode, type A1UiContext } from "./a1-ui-context";

export const A1_RECOVERY_PROOF_MS = 60_000;
export type A1ResetProof = { contextKey: string; intent: A1SigningIntent; reason: "not_found" | "terminal"; observedJobId: string | null; observedJobRevision: number | null; availability: Extract<A1AvailabilityObservation, { ok: true }>; observedAt: number };
const active = (job: A1JobObservation | null | undefined) => !!job && ["queued", "running", "validating"].includes(job.state);
const terminal = (job: A1JobObservation) => ["failed", "stale", "cancelled"].includes(job.state);
const clock = (value: number) => Number.isFinite(value) && value >= 0;
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const key = (context: A1UiContext) => a1UiContextKey(context) ?? JSON.stringify([context.batchId, context.ownArtifactId ?? null, context.documentRevision ?? null]);
export function a1RecoveryIntent(state: A1JobViewState, context: A1UiContext): A1SigningIntent | null {
  if (state.intent) return a1UiIntent(state.intent, context);
  const job = state.job;
  return job && a1UiJobMatchesMode(job, context) ? a1UiIntent({ batchId: job.batchId, requestId: job.requestId, expectedDocumentVersion: job.documentVersion, expectedPolicyRevision: job.policyRevision, ...(context.ownArtifactId == null ? {} : { expectedOwnArtifactId: context.ownArtifactId }) }, context) : null;
}
export function makeA1ResetProof(context: A1UiContext, expected: A1SigningIntent, observed: A1HttpResult<A1JobObservation>, fresh: A1HttpResult<A1AvailabilityObservation>, monotonicNow: number): A1ResetProof | null {
  const intent = a1UiIntent(expected, context);
  if (!intent || !clock(monotonicNow) || fresh.kind !== "success" || !fresh.value.ok || !fresh.value.available || fresh.value.documentVersion !== intent.expectedDocumentVersion || !Number.isSafeInteger(fresh.value.policyRevision) || Number(fresh.value.policyRevision) < 1 || (fresh.value.ownArtifactId ?? null) !== (context.ownArtifactId ?? null)) return null;
  const latest = fresh.value.latestJob;
  if (active(latest) || latest?.state === "succeeded") return null;
  const missing = observed.kind === "rejected" && observed.status === 404 && observed.error === "not_found";
  const job = observed.kind === "success" ? observed.value : null;
  if (!missing && (!job || !terminal(job) || job.requestId !== intent.requestId || job.documentVersion !== intent.expectedDocumentVersion || job.policyRevision !== intent.expectedPolicyRevision || !a1UiJobMatchesMode(job, context))) return null;
  return { contextKey: key(context), intent, reason: missing ? "not_found" : "terminal", observedJobId: job?.jobId ?? null, observedJobRevision: job?.revision ?? null, availability: { ...fresh.value, latestJob: latest ? { ...latest } : latest }, observedAt: monotonicNow };
}
export function a1ResetProofCurrent(proof: A1ResetProof | null, context: A1UiContext, expected: A1SigningIntent | null, monotonicNow: number): proof is A1ResetProof {
  return !!proof && !!expected && clock(monotonicNow) && clock(proof.observedAt) && monotonicNow >= proof.observedAt && monotonicNow - proof.observedAt <= A1_RECOVERY_PROOF_MS && proof.contextKey === key(context) && JSON.stringify(a1UiIntent(expected, context)) === JSON.stringify(proof.intent);
}
export function canCloseA1FromRead(job: A1JobObservation | null, context: A1UiContext, wallNow: number) {
  return !!job && active(job) && a1UiJobMatchesMode(job, context) && Number.isSafeInteger(wallNow) && wallNow >= 0 && iso(job.authorizationExpiresAt) && job.leaseUntil !== undefined && (job.leaseUntil === null || iso(job.leaseUntil)) && Date.parse(job.authorizationExpiresAt) <= wallNow && (job.leaseUntil === null || Date.parse(job.leaseUntil) <= wallNow);
}
export type A1LocalDecision = { version: 1; kind: "client_intent_reset"; contextKey: string; oldRequestId: string; observedReason: A1ResetProof["reason"]; documentVersion: string; oldPolicyRevision: number; nextPolicyRevision: number; at: string | null; authoritative: false };
/** Local notes are mutable browser data, never server authorization or proof of signing. */
export function a1LocalResetDecision(proof: A1ResetProof, at: string | null): A1LocalDecision {
  return { version: 1, kind: "client_intent_reset", contextKey: proof.contextKey, oldRequestId: proof.intent.requestId, observedReason: proof.reason, documentVersion: proof.intent.expectedDocumentVersion, oldPolicyRevision: proof.intent.expectedPolicyRevision, nextPolicyRevision: proof.availability.policyRevision!, at: iso(at) ? at : null, authoritative: false };
}
export function rememberA1LocalDecision(storage: Pick<Storage, "getItem" | "setItem"> | undefined, context: A1UiContext, record: A1LocalDecision): boolean {
  const namespace = a1UiContextKey(context); if (!namespace || !storage) return false;
  try { const raw = storage.getItem(`${namespace}:client-decisions`); let entries: unknown[] = []; if (raw && raw.length <= 65536) { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed)) entries = parsed.slice(-49); } storage.setItem(`${namespace}:client-decisions`, JSON.stringify([...entries, record])); return true; } catch { return false; }
}
