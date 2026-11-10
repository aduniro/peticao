import type { A1AvailabilityObservation, A1JobObservation, A1SigningIntent } from "./a1-job-view";

/** Browser-safe, one attempt, bounded body/deadline. No certificate, approval, sending or automatic POST retry. */
export type A1HttpResult<T> = { kind: "success"; value: T } | { kind: "rejected"; status: number; error: string } | { kind: "uncertain" };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const machine = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z_]{0,63}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const states = ["queued", "running", "validating", "succeeded", "failed", "stale", "cancelled"];
const badInput = { kind: "rejected" as const, status: 400, error: "parameters" };
const uncertain = { kind: "uncertain" as const };
function validIntent(v: A1SigningIntent) {
  return object(v) && Object.keys(v).sort().join(",") === "batchId,expectedDocumentVersion,expectedPolicyRevision,requestId" && id(v.batchId) && uuid(v.requestId) && hash(v.expectedDocumentVersion) && id(v.expectedPolicyRevision);
}
function job(raw: unknown, batchId: number): A1JobObservation | null {
  if (!object(raw) || !uuid(raw.jobId) || !uuid(raw.requestId) || raw.batchId !== batchId || !hash(raw.documentVersion) || !id(raw.policyRevision) || !id(raw.revision) || typeof raw.state !== "string" || !states.includes(raw.state)) return null;
  if (raw.outputVersionId !== undefined && raw.outputVersionId !== null && !uuid(raw.outputVersionId) || raw.outputSha256 !== undefined && raw.outputSha256 !== null && !hash(raw.outputSha256) || raw.errorCode !== undefined && raw.errorCode !== null && !machine(raw.errorCode)) return null;
  return { jobId: raw.jobId, requestId: raw.requestId, batchId, documentVersion: raw.documentVersion, policyRevision: raw.policyRevision, revision: raw.revision, state: raw.state as A1JobObservation["state"], outputVersionId: raw.outputVersionId as string | null | undefined, outputSha256: raw.outputSha256 as string | null | undefined, errorCode: raw.errorCode as string | null | undefined };
}
function matches(value: A1JobObservation, intent: A1SigningIntent) {
  return value.requestId === intent.requestId && value.documentVersion === intent.expectedDocumentVersion && value.policyRevision === intent.expectedPolicyRevision;
}
async function exchange<T>(path: string, method: "GET" | "POST", body: unknown, parse: (raw: Record<string, unknown>, status: number) => T | null, fetcher: typeof fetch, timeoutMs: number): Promise<A1HttpResult<T>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return badInput;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new Error("a1_deadline")); }, timeoutMs); });
  const work = async (): Promise<A1HttpResult<T>> => {
    const response = await fetcher(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: method === "POST" ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return uncertain; }
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); return uncertain; }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > 65_536)) { void response.body?.cancel().catch(() => {}); return uncertain; }
    reader = response.body?.getReader(); if (!reader) return uncertain;
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (controller.signal.aborted) return uncertain; if (part.done) break; size += part.value.byteLength; if (size > 65_536) return uncertain; chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!object(raw)) return uncertain;
    if (response.ok && raw.ok === true) { const value = parse(raw, response.status); return value === null ? uncertain : { kind: "success", value }; }
    if ([400, 401, 403, 404, 409, 413, 429].includes(response.status) && raw.ok === false) {
      const fallback: Record<number, string> = { 400: "parameters", 401: "authentication_required", 403: raw.erro === "stepup" ? "stepup_required" : "forbidden", 404: "not_found", 409: "conflict", 413: "body_too_large", 429: "rate_limited" };
      return { kind: "rejected", status: response.status, error: machine(raw.error) ? raw.error : fallback[response.status] };
    }
    return uncertain;
  };
  try { return await Promise.race([work(), deadline]); } catch { return uncertain; }
  finally { if (timer !== undefined) clearTimeout(timer); void reader?.cancel().catch(() => {}); }
}
export async function readA1Availability(batchId: number, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<A1HttpResult<A1AvailabilityObservation>> {
  if (!id(batchId)) return badInput;
  return exchange(`/api/admin/lotes/${batchId}/a1`, "GET", undefined, raw => {
    if (typeof raw.available !== "boolean" || raw.error !== undefined && !machine(raw.error)) return null;
    if (raw.documentVersion !== undefined && !hash(raw.documentVersion) || raw.policyRevision !== undefined && !id(raw.policyRevision)) return null;
    if (raw.available && (!hash(raw.documentVersion) || !id(raw.policyRevision))) return null;
    const selected = raw.latestJob == null ? null : job(raw.latestJob, batchId); if (raw.latestJob != null && !selected) return null;
    return { ok: true, available: raw.available, error: raw.error as string | undefined, documentVersion: raw.documentVersion as string | undefined, policyRevision: raw.policyRevision as number | undefined, latestJob: selected };
  }, fetcher, timeoutMs);
}
/** An absent intent is still only a read outcome, never permission to resend a POST. */
export async function readA1Intent(intent: A1SigningIntent, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<A1HttpResult<A1JobObservation>> {
  if (!validIntent(intent)) return badInput;
  const expected = { ...intent };
  return exchange(`/api/admin/lotes/${expected.batchId}/a1?requestId=${encodeURIComponent(expected.requestId)}`, "GET", undefined, raw => { const value = job(raw.job, expected.batchId); return value && matches(value, expected) ? value : null; }, fetcher, timeoutMs);
}
export async function submitA1Intent(intent: A1SigningIntent, fetcher: typeof fetch = fetch, timeoutMs = 20_000): Promise<A1HttpResult<A1JobObservation>> {
  if (!validIntent(intent)) return badInput;
  const expected = { ...intent };
  const body = { requestId: expected.requestId, expectedDocumentVersion: expected.expectedDocumentVersion, expectedPolicyRevision: expected.expectedPolicyRevision };
  return exchange(`/api/admin/lotes/${expected.batchId}/a1`, "POST", body, (raw, status) => {
    if (typeof raw.replayed !== "boolean" || status !== (raw.replayed ? 200 : 202)) return null;
    const value = job(raw.job, expected.batchId); return value && matches(value, expected) ? value : null;
  }, fetcher, timeoutMs);
}
