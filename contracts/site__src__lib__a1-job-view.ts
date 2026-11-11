/** Pure client state. No requests, certificate operations, approval or sending occur here. */
export type A1JobViewPhase = "enabled" | "queued" | "running" | "succeeded" | "failed" | "stale";
export type A1JobObservation = {
  jobId: string; requestId?: string; batchId: number; documentVersion: string; policyRevision: number;
  revision: number; state: "queued" | "running" | "validating" | "succeeded" | "failed" | "stale" | "cancelled";
  authorizationExpiresAt?: string; leaseUntil?: string | null;
  ownArtifactId?: string | null; outputVersionId?: string | null; outputSha256?: string | null; errorCode?: string | null;
};
export type A1AvailabilityObservation =
  | { ok: false; error: string }
  | { ok: true; available: boolean; error?: string; documentVersion?: string; policyRevision?: number; latestJob?: A1JobObservation | null; ownArtifactId?: string | null };
export type A1SigningIntent = {
  batchId: number; requestId: string; expectedDocumentVersion: string; expectedPolicyRevision: number; expectedOwnArtifactId?: string;
};
export type A1JobViewState = {
  batchId: number; availability: A1AvailabilityObservation | null; intent: A1SigningIntent | null;
  job: A1JobObservation | null; postPending: boolean; readPending: boolean;
  resultUncertain: boolean; refreshRequired: boolean; errorCode: string | null;
  usedRequestIds: readonly string[];
};
export type A1JobViewEvent =
  | { type: "read_started" }
  | { type: "read_received"; availability: A1AvailabilityObservation }
  | { type: "read_transport_failed" }
  | { type: "intent_read_received"; requestId: string; job: A1JobObservation }
  | { type: "intent_read_failed"; requestId: string; error: string }
  | { type: "request_started"; intent: A1SigningIntent }
  | { type: "request_admitted"; requestId: string; job: A1JobObservation }
  | { type: "request_rejected"; requestId: string; error: string }
  | { type: "request_transport_failed"; requestId: string };

const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const positive = (value: number | undefined) => Number.isSafeInteger(value) && Number(value) > 0;
const states = new Set(["queued", "running", "validating", "succeeded", "failed", "stale", "cancelled"]);
const active = (job: A1JobObservation | null) => !!job && ["queued", "running", "validating"].includes(job.state);
const finishedOutput = (job: A1JobObservation | null) => !!job && job.state === "succeeded" && uuid(job.outputVersionId) && hash(job.outputSha256);

export function createA1JobViewState(batchId: number): A1JobViewState {
  if (!positive(batchId)) throw new Error("invalid_batch_id");
  return { batchId, availability: null, intent: null, job: null, postPending: false, readPending: false, resultUncertain: false, refreshRequired: true, errorCode: null, usedRequestIds: [] };
}

/** Controls are UI affordances only; the server still authorizes each action. */
export function a1JobView(state: A1JobViewState) {
  const available = state.availability?.ok === true ? state.availability : null;
  const published = finishedOutput(state.job);
  const completionUnproven = state.job?.state === "succeeded" && !published;
  let phase: A1JobViewPhase | null = null;
  if (state.job) phase = state.job.state === "validating" ? "running" : state.job.state === "cancelled" ? "stale" : state.job.state === "succeeded" && !published ? null : state.job.state;
  else if (available?.available) phase = "enabled";
  const canRequest = !!available?.available && hash(available.documentVersion) && positive(available.policyRevision)
    && !state.postPending && !state.readPending && !state.resultUncertain && !state.refreshRequired
    && !active(state.job) && !published && !completionUnproven;
  return {
    phase, signaturePublished: published, completionUnproven,
    resultCheckRequired: state.resultUncertain || state.refreshRequired || completionUnproven,
    controls: { canRequest, canCheckResult: !state.readPending, canReadSignedVersion: published },
    // Polling/reconciliation can suggest GET only. POST always requires a new explicit user event.
    nextRead: !state.readPending && (state.refreshRequired || state.resultUncertain || completionUnproven || active(state.job))
      ? { method: "GET" as const, batchId: state.batchId, requestId: state.intent?.requestId ?? state.job?.requestId ?? null, jobId: state.job?.jobId ?? null } : null,
    effects: { approveBatch: false as const, sendBatch: false as const, repeatPost: false as const },
  };
}

function compatibleJob(state: A1JobViewState, job: A1JobObservation, directResponse = false) {
  if (job.batchId !== state.batchId || !uuid(job.jobId) || !hash(job.documentVersion) || !positive(job.policyRevision) || !positive(job.revision) || !states.has(job.state) || job.ownArtifactId != null && !uuid(job.ownArtifactId)) return false;
  if (!state.intent) return true;
  if ((job.ownArtifactId ?? null) !== (state.intent.expectedOwnArtifactId ?? null)) return false;
  if (job.documentVersion !== state.intent.expectedDocumentVersion || job.policyRevision !== state.intent.expectedPolicyRevision) return false;
  if (job.requestId && job.requestId !== state.intent.requestId) return false;
  return directResponse || job.requestId === state.intent.requestId || state.job?.jobId === job.jobId;
}

export function updateA1JobView(state: A1JobViewState, event: A1JobViewEvent): A1JobViewState {
  if (event.type === "read_started") return { ...state, readPending: true };
  if (event.type === "read_transport_failed") return { ...state, readPending: false, refreshRequired: true, errorCode: "read_transport_failed" };
  if (event.type === "read_received") {
    const availability = event.availability;
    if (!availability.ok) return { ...state, availability: { ...availability }, readPending: false, refreshRequired: true, errorCode: availability.error };
    const incoming = availability.latestJob;
    if (availability.ownArtifactId != null && (!uuid(availability.ownArtifactId) || incoming && incoming.ownArtifactId !== availability.ownArtifactId)) return { ...state, availability: { ...availability, available: false }, readPending: false, refreshRequired: true, errorCode: "job_binding_mismatch" };
    if (incoming && !compatibleJob(state, incoming)) return { ...state, availability: { ...availability }, readPending: false, refreshRequired: true, errorCode: "job_binding_mismatch" };
    if (incoming && state.job?.jobId === incoming.jobId && incoming.revision < state.job.revision) return { ...state, readPending: false };
    const correlated = !!incoming && compatibleJob(state, incoming);
    return {
      ...state, availability: { ...availability, latestJob: incoming ? { ...incoming } : incoming },
      job: incoming ? { ...incoming } : state.job, readPending: false,
      resultUncertain: state.resultUncertain && !correlated,
      refreshRequired: state.resultUncertain && !correlated,
      errorCode: state.resultUncertain && !correlated ? "result_not_confirmed" : null,
    };
  }
  if (event.type === "request_started") {
    const available = state.availability;
    const intent = event.intent;
    if (!a1JobView(state).controls.canRequest || !available?.ok || intent.batchId !== state.batchId || !uuid(intent.requestId)
      || (intent.expectedOwnArtifactId??null)!==(available.ownArtifactId??null)
      || Object.hasOwn(intent,"expectedOwnArtifactId") && !uuid(intent.expectedOwnArtifactId)
      || state.usedRequestIds.includes(intent.requestId) || intent.expectedDocumentVersion !== available.documentVersion || intent.expectedPolicyRevision !== available.policyRevision) return state;
    return { ...state, intent: { ...intent }, job: null, postPending: true, errorCode: null, usedRequestIds: [...state.usedRequestIds, intent.requestId] };
  }
  if (!state.intent || event.requestId !== state.intent.requestId) return state;
  if (event.type === "intent_read_failed") return {
    ...state, readPending: false, refreshRequired: true,
    resultUncertain: state.resultUncertain || !state.job, errorCode: event.error,
  };
  if (event.type === "intent_read_received") {
    if (event.job.requestId !== state.intent.requestId || !compatibleJob(state, event.job)) return {
      ...state, readPending: false, resultUncertain: true, refreshRequired: true, errorCode: "job_binding_mismatch",
    };
    if (state.job?.jobId === event.job.jobId && event.job.revision < state.job.revision) return { ...state, readPending: false };
    return {
      ...state, job: { ...event.job }, readPending: false, postPending: false,
      resultUncertain: false, refreshRequired: ["failed", "stale", "cancelled"].includes(event.job.state), errorCode: null,
    };
  }
  if (event.type === "request_transport_failed") return state.job && !state.postPending ? state : { ...state, postPending: false, resultUncertain: true, refreshRequired: true, errorCode: "request_transport_failed" };
  if (event.type === "request_rejected") return state.job && !state.postPending ? state : { ...state, postPending: false, refreshRequired: true, errorCode: event.error };
  if (!compatibleJob(state, event.job, true)) return { ...state, postPending: false, resultUncertain: true, refreshRequired: true, errorCode: "job_binding_mismatch" };
  if (state.job?.jobId === event.job.jobId && event.job.revision < state.job.revision) return state;
  return { ...state, job: { ...event.job }, postPending: false, resultUncertain: false, refreshRequired: false, errorCode: null };
}
