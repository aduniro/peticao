import type { A1HttpResult } from "./a1-request";
import type { A1JobObservation } from "./a1-job-view";
import { a1UiContextKey, a1UiJobMatchesMode, a1UiUuid, type A1UiContext } from "./a1-ui-context";
export type A1CloseIntent = { batchId: number; requestId: string; signingRequestId: string; jobId: string; expectedRevision: number; expectedDocumentVersion: string; expectedOwnArtifactId?: string };
export type A1CloseObservation = { closeRequestId: string; job: A1JobObservation; replayed: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function a1CloseIntent(value: unknown, context: A1UiContext): A1CloseIntent | null {
  if (!object(value)) return null;
  const keys = ["batchId", "requestId", "signingRequestId", "jobId", "expectedRevision", "expectedDocumentVersion", ...(context.ownArtifactId == null ? [] : ["expectedOwnArtifactId"])].sort().join(",");
  if (Object.keys(value).sort().join(",") !== keys || value.batchId !== context.batchId || !positive(value.batchId) || !a1UiUuid(value.requestId) || !a1UiUuid(value.signingRequestId) || value.requestId === value.signingRequestId || !a1UiUuid(value.jobId) || !positive(value.expectedRevision) || !hash(value.expectedDocumentVersion) || (value.expectedOwnArtifactId ?? null) !== (context.ownArtifactId ?? null)) return null;
  return { batchId: value.batchId, requestId: value.requestId, signingRequestId: value.signingRequestId, jobId: value.jobId, expectedRevision: value.expectedRevision, expectedDocumentVersion: value.expectedDocumentVersion, ...(context.ownArtifactId == null ? {} : { expectedOwnArtifactId: context.ownArtifactId }) };
}
export function makeA1CloseIntent(context: A1UiContext, job: A1JobObservation, nonce: string): A1CloseIntent | null {
  return a1UiJobMatchesMode(job, context) ? a1CloseIntent({ batchId: context.batchId, requestId: nonce, signingRequestId: job.requestId, jobId: job.jobId, expectedRevision: job.revision, expectedDocumentVersion: job.documentVersion, ...(context.ownArtifactId == null ? {} : { expectedOwnArtifactId: context.ownArtifactId }) }, context) : null;
}
function parseClosed(raw: unknown, intent: A1CloseIntent): A1CloseObservation | null {
  if (!object(raw) || raw.ok !== true || raw.closed !== true || raw.closeRequestId !== intent.requestId || typeof raw.replayed !== "boolean" || !object(raw.job)) return null;
  const j = raw.job;
  if (j.jobId !== intent.jobId || j.batchId !== intent.batchId || j.requestId !== intent.signingRequestId || j.documentVersion !== intent.expectedDocumentVersion || (j.ownArtifactId ?? null) !== (intent.expectedOwnArtifactId ?? null) || j.state !== "stale" || !positive(j.revision) || j.revision <= intent.expectedRevision || !positive(j.policyRevision) || j.outputVersionId != null || j.outputSha256 != null || j.authorizationExpiresAt !== undefined && !utc(j.authorizationExpiresAt) || j.leaseUntil !== undefined && j.leaseUntil !== null && !utc(j.leaseUntil)) return null;
  return { closeRequestId: intent.requestId, replayed: raw.replayed, job: { jobId: intent.jobId, batchId: intent.batchId, requestId: intent.signingRequestId, documentVersion: intent.expectedDocumentVersion, policyRevision: j.policyRevision, revision: j.revision, state: "stale", ownArtifactId: intent.expectedOwnArtifactId ?? null, outputVersionId: null, outputSha256: null, authorizationExpiresAt: j.authorizationExpiresAt as string | undefined, leaseUntil: j.leaseUntil as string | null | undefined, errorCode: typeof j.errorCode === "string" && /^[a-z][a-z_]{0,63}$/.test(j.errorCode) ? j.errorCode : null } };
}
export async function exchangeA1Close(intent: A1CloseIntent, method: "GET" | "POST", fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<A1HttpResult<A1CloseObservation>> {
  const expected = a1CloseIntent(intent, { batchId: intent.batchId, ownArtifactId: intent.expectedOwnArtifactId });
  if (!expected || !["GET", "POST"].includes(method) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { kind: "rejected", status: 400, error: "parameters" };
  const path = `/api/admin/lotes/${intent.batchId}/a1/encerrar${method === "GET" ? "?requestId=" + intent.requestId : ""}`;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = async (): Promise<A1HttpResult<A1CloseObservation>> => {
    try {
      const { batchId: _batch, signingRequestId: _signing, ...body } = expected;
      const response = await fetcher(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) { await response.body?.cancel().catch(() => {}); return { kind: "uncertain" }; }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536) || !response.body) { await response.body?.cancel().catch(() => {}); return { kind: "uncertain" }; }
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) return { kind: "uncertain" }; chunks.push(part.value); }
      const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (response.ok) { const value = parseClosed(raw, expected); return value ? { kind: "success", value } : { kind: "uncertain" }; }
      if ([400, 401, 403, 404, 409, 413, 429].includes(response.status) && object(raw) && raw.ok === false) return { kind: "rejected", status: response.status, error: typeof raw.error === "string" && /^[a-z][a-z_]{0,63}$/.test(raw.error) ? raw.error : "forbidden" };
      return { kind: "uncertain" };
    } catch { return { kind: "uncertain" }; }
  };
  try {
    const deadline = new Promise<A1HttpResult<A1CloseObservation>>(resolve => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); resolve({ kind: "uncertain" }); }, timeoutMs); });
    return await Promise.race([work(), deadline]);
  } finally { if (timer !== undefined) clearTimeout(timer); void reader?.cancel().catch(() => {}); }
}
export function rememberA1CloseIntent(storage: Pick<Storage, "setItem"> | undefined, context: A1UiContext, intent: A1CloseIntent): boolean {
  const key = a1UiContextKey(context); if (!storage || !key || !a1CloseIntent(intent, context)) return false;
  try { storage.setItem(`${key}:close:selected`, JSON.stringify(intent)); return true; } catch { return false; }
}
export function restoreA1CloseIntent(storage: Pick<Storage, "getItem"> | undefined, context: A1UiContext): A1CloseIntent | null {
  const key = a1UiContextKey(context); if (!storage || !key) return null;
  try { const raw = storage.getItem(`${key}:close:selected`); return raw && raw.length <= 2048 ? a1CloseIntent(JSON.parse(raw), context) : null; } catch { return null; }
}
export function retireA1CloseIntent(storage: Pick<Storage, "getItem" | "removeItem"> | undefined, context: A1UiContext, expected: A1CloseIntent): boolean {
  const key = a1UiContextKey(context); if (!key || !storage) return true;
  try { const current = restoreA1CloseIntent(storage, context); if (current && current.requestId !== expected.requestId) return false; storage.removeItem(`${key}:close:selected`); return true; } catch { return true; }
}
