/** Browser-safe metadata projection. No binary, note, name or invented legacy author. */
export type DocumentHistoryRow = {
  id: string; ordinal: number; variant: "original" | "signed"; sha256: string; listHash: string | null;
  signatureKind: "none" | "icp-brasil" | "externa-nao-validada" | null;
  source: "prepared" | "upload" | "legacy-observed";
  authorId: number | null; recordedBy: number | null; capturedAt: string; byteLength: number;
};
export type DocumentHistoryPage = { versions: DocumentHistoryRow[]; nextBefore: number | null };
const id = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseDocumentHistoryPage(raw: unknown, batchId: number): DocumentHistoryPage | null {
  if (!id(batchId) || !object(raw) || raw.ok !== true || !Array.isArray(raw.versions) || raw.versions.length > 50 || raw.nextBefore !== null && !id(raw.nextBefore)) return null;
  const versions: DocumentHistoryRow[] = [], ids = new Set<string>();
  let previous = Infinity;
  for (const value of raw.versions) {
    if (!object(value) || value.batch_id !== batchId || typeof value.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) || !id(value.ordinal) || value.ordinal >= previous || ids.has(value.id.toLowerCase()) || !["original", "signed"].includes(String(value.variant)) || !hash(value.sha256) || typeof value.list_hash !== "string" || value.list_hash.length < 1 || value.list_hash.length > 512 || typeof value.source !== "string" || !["prepared", "upload", "legacy-observed"].includes(value.source) || value.author_id !== null && !id(value.author_id) || value.recorded_by !== null && !id(value.recorded_by) || typeof value.captured_at !== "string" || value.captured_at.length > 40 || !Number.isFinite(Date.parse(value.captured_at)) || new Date(value.captured_at).toISOString() !== value.captured_at || !Number.isSafeInteger(value.byte_length) || Number(value.byte_length) < 1 || Object.hasOwn(value, "bytes") || Object.hasOwn(value, "pdf")) return null;
    if (value.source === "legacy-observed" && value.author_id !== null) return null;
    previous = value.ordinal; ids.add(value.id.toLowerCase());
    const kind = ["none", "icp-brasil", "externa-nao-validada"].includes(String(value.signature_kind)) ? value.signature_kind as DocumentHistoryRow["signatureKind"] : null;
    versions.push({ id: value.id, ordinal: value.ordinal, variant: value.variant as DocumentHistoryRow["variant"], sha256: value.sha256, listHash: hash(value.list_hash) ? value.list_hash : null, signatureKind: kind, source: value.source as DocumentHistoryRow["source"], authorId: value.author_id as number | null, recordedBy: value.recorded_by as number | null, capturedAt: value.captured_at, byteLength: value.byte_length as number });
  }
  if (raw.nextBefore !== null && (!versions.length || raw.nextBefore !== versions.at(-1)!.ordinal)) return null;
  return { versions, nextBefore: raw.nextBefore as number | null };
}
export function appendDocumentHistory(current: DocumentHistoryPage, next: DocumentHistoryPage): DocumentHistoryPage | null {
  const seen = new Set(current.versions.map(row => row.id.toLowerCase())), oldest = current.versions.at(-1)?.ordinal ?? Infinity;
  if (next.versions.some(row => seen.has(row.id.toLowerCase()) || row.ordinal >= oldest)) return null;
  return { versions: [...current.versions, ...next.versions], nextBefore: next.nextBefore };
}
export async function loadDocumentHistoryPage(fetcher: typeof fetch, batchId: number, before?: number, signal?: AbortSignal) {
  if (!id(batchId) || before !== undefined && !id(before)) return { ok: false as const, error: "parameters" as const };
  const url = `/api/admin/lotes/${batchId}/versoes${before === undefined ? "" : `?antes=${before}`}`;
  const response = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
  const raw: unknown = await response.json().catch(() => null);
  if (response.status === 401) return { ok: false as const, error: "auth" as const };
  if (response.status === 403) return { ok: false as const, error: object(raw) && raw.erro === "stepup" ? "stepup" as const : "forbidden" as const };
  const page = response.ok ? parseDocumentHistoryPage(raw, batchId) : null;
  if (!page || before !== undefined && page.versions.some(row => row.ordinal >= before)) return { ok: false as const, error: "unavailable" as const };
  return { ok: true as const, page };
}
