/** Browser-only inventory: metadata, never challenge credentials or identity. */
export type HistoryKind = "receipts" | "artifacts";
type Assurance = { assurance: "own-confirmation"; icpBrasil: false; govBr: false; dispatchAllowed: false };
export type HistoryReceipt = Assurance & { challengeId: string; receiptId: string; batchId: number; responsibleId: number; issuedBy: number; documentVersion: string | null; createdAt: string; confirmedAt: string; isCurrent: boolean };
export type HistoryArtifact = Assurance & { artifactId: string; receiptId: string; batchId: number; documentVersion: string; sha256: string; sourceSha256: string; byteLength: number; createdBy: number; createdAt: string; source: "president-own" };
export type HistoryRow = HistoryReceipt | HistoryArtifact;
export type HistoryPage = { kind: HistoryKind; batchId: number; rows: HistoryRow[]; hasMore: boolean; nextCursor: string | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const historyUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(",") === expected.split(",").sort().join(",");
const commonKeys = "assurance,icpBrasil,govBr,dispatchAllowed,receiptId,batchId,documentVersion,createdAt";
export const historyRowId = (row: HistoryRow) => "artifactId" in row ? row.artifactId : row.challengeId;
export function parseOwnHistory(value: unknown, kind: HistoryKind, batchId: number, after?: string): HistoryPage | null {
  if (!id(batchId) || after !== undefined && !historyUuid(after) || !object(value) || !keys(value, `ok,kind,batchId,${kind === "receipts" ? "receipts" : "documents"},hasMore,nextCursor`) || value.ok !== true || value.kind !== kind || value.batchId !== batchId || typeof value.hasMore !== "boolean") return null;
  const list = value[kind === "receipts" ? "receipts" : "documents"];
  if (!Array.isArray(list) || list.length > 20 || value.hasMore && list.length !== 20 || (value.hasMore ? !historyUuid(value.nextCursor) : value.nextCursor !== null)) return null;
  const seen = new Set<string>();const rows: HistoryRow[] = [];
  for (const row of list) {
    if (!object(row) || row.assurance !== "own-confirmation" || row.icpBrasil !== false || row.govBr !== false || row.dispatchAllowed !== false || row.batchId !== batchId || !historyUuid(row.receiptId) || !date(row.createdAt)) return null;
    if (kind === "receipts") {
      if (!keys(row, `${commonKeys},challengeId,responsibleId,issuedBy,confirmedAt,isCurrent`) || !historyUuid(row.challengeId) || !id(row.responsibleId) || !id(row.issuedBy) || !date(row.confirmedAt) || row.confirmedAt < row.createdAt || typeof row.isCurrent !== "boolean" || (row.documentVersion !== null && !hash(row.documentVersion)) || row.isCurrent && !hash(row.documentVersion)) return null;
    } else if (!keys(row, `${commonKeys},artifactId,sha256,sourceSha256,byteLength,createdBy,source`) || !historyUuid(row.artifactId) || !hash(row.documentVersion) || !hash(row.sha256) || !hash(row.sourceSha256) || !Number.isInteger(row.byteLength) || (row.byteLength as number) < 1 || (row.byteLength as number) > 64 * 1024 * 1024 || !id(row.createdBy) || row.source !== "president-own") return null;
    const parsed = row as unknown as HistoryRow, key = historyRowId(parsed), previous = rows.at(-1);
    if (key === after || seen.has(key) || previous && (previous.createdAt < parsed.createdAt || previous.createdAt === parsed.createdAt && historyRowId(previous) <= key)) return null;
    seen.add(key);rows.push(parsed);
  }
  if (value.hasMore && value.nextCursor !== historyRowId(rows[rows.length - 1])) return null;
  return { kind, batchId, rows, hasMore: value.hasMore, nextCursor: value.nextCursor as string | null };
}
export function appendOwnHistory(previous: HistoryPage | null, page: HistoryPage, after?: string): HistoryPage | null {
  if (!previous) return after === undefined ? page : null;
  if (!after || previous.nextCursor !== after || !previous.hasMore || previous.kind !== page.kind || previous.batchId !== page.batchId) return null;
  const existing = new Set(previous.rows.map(historyRowId));
  const newRows = page.rows.filter(row => !existing.has(historyRowId(row)));
  const last = previous.rows.at(-1), first = newRows[0];
  if (last && first && (last.createdAt < first.createdAt || last.createdAt === first.createdAt && historyRowId(last) <= historyRowId(first))) return null;
  return { ...page, rows: [...previous.rows, ...newRows] };
}
export async function ownHistoryRequest(batchId: number, kind: HistoryKind, cursor?: string, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<HistoryPage | null> {
  if (!id(batchId) || !["receipts", "artifacts"].includes(kind) || cursor !== undefined && !historyUuid(cursor)) return null;
  const controller = new AbortController();let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const job = async () => {
    try {
      const q = new URLSearchParams({ kind });if (cursor) q.set("cursor", cursor);
      const response = await transport(`/api/admin/lotes/${batchId}/presidente/historico?${q}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || !response.body || response.headers.has("content-length") && (!/^\d+$/.test(response.headers.get("content-length")!) || Number(response.headers.get("content-length")) > 65536)) { await response.body?.cancel().catch(() => {});return null; }
      reader = response.body.getReader();const chunks: Uint8Array[] = [];let size = 0;
      for (;;) { const chunk = await reader.read();if (chunk.done) break;size += chunk.value.byteLength;if (size > 65536) { await reader.cancel().catch(() => {});return null; }chunks.push(chunk.value); }
      const bytes = new Uint8Array(size);let at = 0;for (const chunk of chunks) { bytes.set(chunk, at);at += chunk.byteLength; }
      return parseOwnHistory(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), kind, batchId, cursor);
    } catch { return null; } finally { try { reader?.releaseLock(); } catch { /* deadline may cancel read */ } }
  };
  try {
    return await Promise.race([job(), new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort();void reader?.cancel().catch(() => {});resolve(null); }, Math.max(1, Math.min(30000, timeoutMs))); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
