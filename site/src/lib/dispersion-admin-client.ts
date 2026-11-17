/** Browser-only dispersion reads. No server/database imports and no mutations. */
export type DispersionView = "all" | "roots" | "children" | "diagnostics";
export type DispersionQuery = { view: DispersionView; parentId?: number; before?: number; limit?: number };
export const dispersionId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
export function dispersionQuery(value: unknown): DispersionQuery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["view", "parentId", "before", "limit"].includes(k)) || !["all", "roots", "children", "diagnostics"].includes(String(v.view)) || (v.view === "children" ? !dispersionId(v.parentId) : v.parentId !== undefined) || v.before !== undefined && !dispersionId(v.before) || v.limit !== undefined && (!Number.isInteger(v.limit) || (v.limit as number) < 1 || (v.limit as number) > 100)) return null;
  return { view: v.view as DispersionView, ...(v.parentId !== undefined ? { parentId: v.parentId as number } : {}), ...(v.before !== undefined ? { before: v.before as number } : {}), ...(v.limit !== undefined ? { limit: v.limit as number } : {}) };
}
export function dispersionPath(query: DispersionQuery): string | null {
  const q = dispersionQuery(query);if (!q) return null;const params = new URLSearchParams({ view: q.view });
  if (q.parentId !== undefined) params.set("parentId", String(q.parentId));if (q.before !== undefined) params.set("before", String(q.before));if (q.limit !== undefined) params.set("limit", String(q.limit));return `/api/admin/dispersao/dados?${params}`;
}
export type DispersionRead = { ok: true; data: unknown } | { ok: false; kind: "invalid" | "http" | "uncertain"; status?: number };
/** Independent deadline covers an uncooperative fetch and a stalled stream. One GET per call. */
export async function getDispersion(query: DispersionQuery, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<DispersionRead> {
  const path = dispersionPath(query);if (!path) return { ok: false, kind: "invalid" };
  const controller = new AbortController();let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = async (): Promise<DispersionRead> => {
    try {
      const response = await transport(path, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {});return { ok: false, kind: "http", status: response.status }; }
      const length = response.headers.get("content-length"), max = 32 * 1024 * 1024;
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { await response.body?.cancel().catch(() => {});return { ok: false, kind: "invalid" }; }
      reader = response.body.getReader();const chunks: Uint8Array[] = [];let size = 0;
      for (;;) { const part = await reader.read();if (part.done) break;size += part.value.byteLength;if (size > max) { await reader.cancel().catch(() => {});return { ok: false, kind: "invalid" }; }chunks.push(part.value); }
      const bytes = new Uint8Array(size);let at = 0;for (const part of chunks) { bytes.set(part, at);at += part.byteLength; }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));return data && typeof data === "object" && !Array.isArray(data) ? { ok: true, data } : { ok: false, kind: "invalid" };
    } catch { return { ok: false, kind: "uncertain" }; } finally { try { reader?.releaseLock(); } catch { /* Deadline may be cancelling reader. */ } }
  };
  try { return await Promise.race([work(), new Promise<DispersionRead>(resolve => { timer = setTimeout(() => { controller.abort();void reader?.cancel().catch(() => {});resolve({ ok: false, kind: "uncertain" }); }, Math.max(1, Math.min(30000, timeoutMs))); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export function appendDispersionRows<T extends { id: number }>(previous: T[], next: T[], expected: number | null, requested: number) {
  if (expected !== requested || !dispersionId(requested) || next.some((row, n) => !dispersionId(row.id) || row.id >= requested || n > 0 && row.id >= next[n - 1].id)) return null;
  const seen = new Set(previous.map(r => r.id));return [...previous, ...next.filter(row => !seen.has(row.id))];
}
/** Drill-down holds only IDs in memory; never recursively renders a potentially cyclic graph. */
export function enterDispersionNode(path: number[], nextId: number): { ok: true; path: number[] } | { ok: false; reason: "cycle" | "invalid" } {
  if (!dispersionId(nextId) || path.some(id => !dispersionId(id))) return { ok: false, reason: "invalid" };
  return path.includes(nextId) ? { ok: false, reason: "cycle" } : { ok: true, path: [...path, nextId] };
}
