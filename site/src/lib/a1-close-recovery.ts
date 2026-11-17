import type { A1AvailabilityObservation, A1JobObservation } from "./a1-job-view";
import type { A1HttpResult } from "./a1-request";
import { a1CloseIntent, type A1CloseIntent, type A1CloseObservation } from "./a1-close-request";
import { a1UiContextKey, a1UiJobMatchesMode, type A1UiContext } from "./a1-ui-context";

const terminal = (job: A1JobObservation) => ["succeeded", "failed", "stale", "cancelled"].includes(job.state);
const key = (context: A1UiContext) => a1UiContextKey(context) ?? JSON.stringify([context.batchId, context.ownArtifactId ?? null, context.documentRevision ?? null]);
export type A1CloseAbandonProof = { contextKey: string; intent: A1CloseIntent; job: A1JobObservation; observedAt: number; reason: "revision_changed" | "already_terminal" };
/** Metadata can retire only a local obsolete closure intent; this grants neither closure nor signing. */
export function makeA1CloseAbandonProof(context: A1UiContext, expected: A1CloseIntent, read: A1HttpResult<A1CloseObservation>, fresh: A1HttpResult<A1AvailabilityObservation>, monotonicNow: number): A1CloseAbandonProof | null {
  const intent = a1CloseIntent(expected, context);
  if (!intent || !Number.isFinite(monotonicNow) || monotonicNow < 0 || read.kind !== "rejected" || read.status !== 404 || read.error !== "not_found" || fresh.kind !== "success" || !fresh.value.ok) return null;
  if ((fresh.value.ownArtifactId ?? null) !== (context.ownArtifactId ?? null)) return null;
  const job = fresh.value.latestJob;
  if (!job || job.jobId !== intent.jobId || job.batchId !== intent.batchId || job.requestId !== intent.signingRequestId || job.documentVersion !== intent.expectedDocumentVersion || !a1UiJobMatchesMode(job, context) || !Number.isSafeInteger(job.revision) || job.revision < intent.expectedRevision) return null;
  if (!terminal(job) && (!['queued', 'running', 'validating'].includes(job.state) || job.revision <= intent.expectedRevision)) return null;
  return { contextKey: key(context), intent, job: { ...job }, observedAt: monotonicNow, reason: terminal(job) ? "already_terminal" : "revision_changed" };
}
export function a1CloseAbandonProofCurrent(proof: A1CloseAbandonProof | null, context: A1UiContext, expected: A1CloseIntent | null, monotonicNow: number): proof is A1CloseAbandonProof {
  return !!proof && !!expected && Number.isFinite(monotonicNow) && monotonicNow >= proof.observedAt && monotonicNow - proof.observedAt <= 60_000 && proof.contextKey === key(context) && JSON.stringify(a1CloseIntent(expected, context)) === JSON.stringify(proof.intent);
}
export type A1LocalCloseDecision = { kind: "client_close_intent_abandoned"; oldRequestId: string; jobId: string; observedRevision: number; observedReason: A1CloseAbandonProof["reason"]; at: string | null; authoritative: false };
export function rememberA1LocalCloseDecision(storage: Pick<Storage, "getItem" | "setItem"> | undefined, context: A1UiContext, proof: A1CloseAbandonProof, at: string | null): A1LocalCloseDecision {
  const record: A1LocalCloseDecision = { kind: "client_close_intent_abandoned", oldRequestId: proof.intent.requestId, jobId: proof.job.jobId, observedRevision: proof.job.revision, observedReason: proof.reason, at, authoritative: false };
  const namespace = a1UiContextKey(context);
  if (storage && namespace) try { const raw = storage.getItem(`${namespace}:client-close-decisions`); const parsed: unknown = raw && raw.length < 65536 ? JSON.parse(raw) : []; storage.setItem(`${namespace}:client-close-decisions`, JSON.stringify([...(Array.isArray(parsed) ? parsed.slice(-49) : []), record])); } catch { /* Mutable local notes are not server audit or authorization. */ }
  return record;
}
