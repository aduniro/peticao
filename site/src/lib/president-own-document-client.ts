/** Browser-only own-confirmation PDF controls. No PDF bytes or identity fields in storage/URLs. */
export type OwnPdfIntent = { requestId: string; batchId: number; receiptId: string; expectedDocumentVersion: string };
export type OwnPdfMetadata = {
  source: "president-own"; dispatchAllowed: false; icpBrasil: false; govBr: false;
  requestId: string; state: "pending" | "completed" | "failed"; artifactId: string | null;
  batchId: number; receiptId: string; documentVersion: string; sha256: string | null;
  sourceSha256: string | null; error: string | null; createdAt: string;
};
export type OwnPdfClientResult = { ok: true; data: unknown } | { ok: false; kind: "http" | "invalid" | "uncertain"; status?: number };
export const ownPdfUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function ownPdfIntent(value: unknown): OwnPdfIntent | null {
  if (!object(value) || Object.keys(value).sort().join(",") !== "batchId,expectedDocumentVersion,receiptId,requestId" || !ownPdfUuid(value.requestId) || !ownPdfUuid(value.receiptId) || !hash(value.expectedDocumentVersion) || !Number.isInteger(value.batchId) || (value.batchId as number) < 1 || (value.batchId as number) > 2147483647) return null;
  return { requestId: value.requestId, batchId: value.batchId as number, receiptId: value.receiptId, expectedDocumentVersion: value.expectedDocumentVersion };
}
export function ownPdfMetadata(value: unknown, intent: OwnPdfIntent): OwnPdfMetadata | null {
  if (!object(value) || value.ok !== true || !object(value.document)) return null;
  const d = value.document;
  if (d.source !== "president-own" || d.dispatchAllowed !== false || d.icpBrasil !== false || d.govBr !== false || d.requestId !== intent.requestId || d.batchId !== intent.batchId || d.receiptId !== intent.receiptId || d.documentVersion !== intent.expectedDocumentVersion || !["pending", "completed", "failed"].includes(String(d.state)) || typeof d.createdAt !== "string" || d.createdAt.length > 30 || !Number.isFinite(Date.parse(d.createdAt))) return null;
  if (d.state === "completed") {
    if (!ownPdfUuid(d.artifactId) || !hash(d.sha256) || !hash(d.sourceSha256) || d.error !== null) return null;
  } else if (d.artifactId !== null || d.sha256 !== null || d.sourceSha256 !== null || (d.state === "pending" ? d.error !== null : typeof d.error !== "string" || d.error.length < 1 || d.error.length > 64)) return null;
  return { source: "president-own", dispatchAllowed: false, icpBrasil: false, govBr: false, requestId: intent.requestId, state: d.state as OwnPdfMetadata["state"], artifactId: d.artifactId as string | null, batchId: intent.batchId, receiptId: intent.receiptId, documentVersion: intent.expectedDocumentVersion, sha256: d.sha256 as string | null, sourceSha256: d.sourceSha256 as string | null, error: d.error as string | null, createdAt: d.createdAt };
}
export function ownPdfDownloadPath(document: OwnPdfMetadata): string | null {
  return document.state === "completed" && document.source === "president-own" && document.dispatchAllowed === false && document.icpBrasil === false && document.govBr === false && ownPdfUuid(document.artifactId) && hash(document.sha256) && hash(document.sourceSha256) ? `/api/admin/presidente/documentos-proprios/${document.artifactId}` : null;
}
const BASE = "/api/admin/presidente/documentos-proprios";
export async function ownPdfRequest(method: "GET" | "POST", input: OwnPdfIntent | string, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<OwnPdfClientResult> {
  if (method === "GET" ? !ownPdfUuid(input) : method !== "POST" || !ownPdfIntent(input)) return { ok: false, kind: "invalid" };
  const path = method === "GET" ? `${BASE}?requestId=${input}` : BASE;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const job = async (): Promise<OwnPdfClientResult> => {
    try {
      const response = await transport(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(ownPdfIntent(input)) } : {}), signal: controller.signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "http", status: response.status }; }
      const length = response.headers.get("content-length");
      if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > 16384) || !response.body) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 16384) { await reader.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; } chunks.push(chunk.value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); return object(data) ? { ok: true, data } : { ok: false, kind: "invalid" }; } catch { return { ok: false, kind: "invalid" }; }
    } catch { return { ok: false, kind: "uncertain" }; }
    finally { try { reader?.releaseLock(); } catch { /* A timed-out reader may still be cancelling. */ } }
  };
  try {
    const deadline = new Promise<OwnPdfClientResult>(resolve => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); resolve({ ok: false, kind: "uncertain" }); }, Math.min(60_000, Math.max(1, timeoutMs))); });
    return await Promise.race([job(), deadline]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
