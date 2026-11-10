import { readA1Availability, readA1Intent } from "./a1-request";
import { updateA1JobView, type A1JobViewEvent, type A1JobViewState } from "./a1-job-view";

export type A1Reconciliation = { batchId: number; requestId: string | null; event: A1JobViewEvent };

/** One GET only. Apply through the current state, not the captured pre-request state. */
export async function readA1Reconciliation(state: A1JobViewState, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<A1Reconciliation> {
  const batchId = state.batchId;
  const intent = state.intent ? { ...state.intent } : null;
  const needsAvailability = !!state.job && ["failed", "stale", "cancelled"].includes(state.job.state) && !state.resultUncertain && !state.postPending;
  if (intent && !needsAvailability) {
    const result = await readA1Intent(intent, fetcher, timeoutMs);
    return {
      batchId, requestId: intent.requestId,
      event: result.kind === "success"
        ? { type: "intent_read_received", requestId: intent.requestId, job: result.value }
        : { type: "intent_read_failed", requestId: intent.requestId, error: result.kind === "rejected" ? result.error : "read_transport_failed" },
    };
  }
  const result = await readA1Availability(batchId, fetcher, timeoutMs);
  return {
    batchId, requestId: intent?.requestId ?? null,
    event: result.kind === "success" ? { type: "read_received", availability: result.value }
      : result.kind === "rejected" ? { type: "read_received", availability: { ok: false, error: result.error } }
      : { type: "read_transport_failed" },
  };
}

/** Ignore results from another selected batch or an intent replaced while GET was pending. */
export function applyA1Reconciliation(state: A1JobViewState, observation: A1Reconciliation): A1JobViewState {
  if (state.batchId !== observation.batchId || (state.intent?.requestId ?? null) !== observation.requestId) return state;
  return updateA1JobView(state, observation.event);
}
