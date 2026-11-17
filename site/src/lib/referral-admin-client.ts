/** Browser-only referral reads. No email, token, CPF or server imports. */
export type ReferralStatsRow = { id: number; code: string; kind: "personal" | "organization"; name: string | null; label: string | null; createdAt: string; archivedAt: string | null; visits: number; signed: number; pending: number };
export type ReferralTotals = { codes: number; personalCodes: number; organizationCodes: number; visits: number; signed: number; pending: number };
export type ReferralStatsPage = { totals: ReferralTotals; rows: ReferralStatsRow[]; nextBefore: number | null };
export type ReferralPerson = { id: number; name: string; status: "pending" | "confirmed"; category: "servidor" | "apoiador" | "estrangeiro" };
export type ReferralPeoplePage = { code: string; total: number; rows: ReferralPerson[]; nextBefore: number | null };
export type ReferralClientResult = { ok: true; data: unknown } | { ok: false; kind: "http" | "invalid" | "uncertain"; status?: number; reason?: "stepup" | "forbidden" | "conflict" | "not_found" | "legacy_unavailable" | "unavailable" | "invalid" };
export const referralObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const referralKeys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(",") === expected.split(",").sort().join(",");
export const referralId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
export const referralCode = (v: unknown): v is string => typeof v === "string" && /^[2-9A-HJKMNP-Z]{7}$/.test(v);
export const referralDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !/[\u0000]/.test(v);
function cursor(value: unknown, rows: { id: number }[], limit: number, before?: number) {
  return rows.length <= limit && (value === null || referralId(value) && rows.length === limit && rows.at(-1)?.id === value) && rows.every((r, n) => referralId(r.id) && (n ? rows[n - 1].id > r.id : before === undefined || r.id < before));
}
export function parseReferralStats(value: unknown, before?: number, limit = 50): ReferralStatsPage | null {
  if (!referralObject(value) || !referralKeys(value, "ok,totals,rows,nextBefore") || value.ok !== true || !referralObject(value.totals) || !referralKeys(value.totals, "codes,personalCodes,organizationCodes,visits,signed,pending") || !Object.values(value.totals).every(count) || value.totals.codes !== (value.totals.personalCodes as number) + (value.totals.organizationCodes as number) || !Array.isArray(value.rows)) return null;
  const rows: ReferralStatsRow[] = [];
  for (const r of value.rows) {
    if (!referralObject(r) || !referralKeys(r, "id,code,kind,name,label,createdAt,archivedAt,visits,signed,pending") || !referralId(r.id) || !referralCode(r.code) || !["personal", "organization"].includes(String(r.kind)) || r.name !== null && !text(r.name) || r.label !== null && !text(r.label) || !referralDate(r.createdAt) || r.archivedAt !== null && !referralDate(r.archivedAt) || !count(r.visits) || !count(r.signed) || !count(r.pending)) return null;
    rows.push({ id: r.id, code: r.code, kind: r.kind as ReferralStatsRow["kind"], name: r.name as string | null, label: r.label as string | null, createdAt: r.createdAt, archivedAt: r.archivedAt as string | null, visits: r.visits, signed: r.signed, pending: r.pending });
  }
  if (!cursor(value.nextBefore, rows, limit, before) || new Set(rows.map(r => r.code)).size !== rows.length || rows.length > (value.totals.codes as number)) return null;
  return { totals: value.totals as ReferralTotals, rows, nextBefore: value.nextBefore as number | null };
}
export function parseReferralPeople(value: unknown, code: string, before?: number, limit = 50): ReferralPeoplePage | null {
  if (!referralCode(code) || !referralObject(value) || !referralKeys(value, "ok,code,total,rows,nextBefore") || value.ok !== true || value.code !== code || !count(value.total) || !Array.isArray(value.rows)) return null;
  const rows: ReferralPerson[] = [];
  for (const r of value.rows) {
    if (!referralObject(r) || !referralKeys(r, "id,name,status,category") || !referralId(r.id) || !text(r.name) || !["pending", "confirmed"].includes(String(r.status)) || !["servidor", "apoiador", "estrangeiro"].includes(String(r.category))) return null;
    rows.push({ id: r.id, name: r.name, status: r.status as ReferralPerson["status"], category: r.category as ReferralPerson["category"] });
  }
  return cursor(value.nextBefore, rows, limit, before) && rows.length <= value.total ? { code, total: value.total, rows, nextBefore: value.nextBefore as number | null } : null;
}
export function appendReferralRows<T extends { id: number }>(rows: T[], next: T[], cursorId: number | null, requestedBefore: number) {
  if (cursorId !== requestedBefore || !referralId(requestedBefore) || next.some((r, n) => r.id >= requestedBefore || n > 0 && r.id >= next[n - 1].id)) return null;
  const seen = new Set(rows.map(r => r.id));return [...rows, ...next.filter(r => !seen.has(r.id))];
}
/** Fixed same-origin route allowlist. A single attempt, independent of an uncooperative fetch/read. */
export async function referralRequest(path: string, method: "GET" | "POST" = "GET", body?: unknown, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<ReferralClientResult> {
  if (!["GET", "POST"].includes(method) || !/^\/api\/admin\/indicacoes\/(?:estatisticas|[2-9A-HJKMNP-Z]{7}\/pessoas|gestao)(?:\?[^#]{1,256})?$/.test(path) || method === "POST" && path !== "/api/admin/indicacoes/gestao" || method === "GET" && body !== undefined) return { ok: false, kind: "invalid" };
  const maxBytes = path.includes("/pessoas") ? 2 * 1024 * 1024 : 4 * 1024 * 1024;
  const controller = new AbortController();let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = async (): Promise<ReferralClientResult> => {
    try {
      const response = await transport(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      const length = response.headers.get("content-length");
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel().catch(() => {});return response.ok ? { ok: false, kind: "invalid" } : { ok: false, kind: "http", status: response.status }; }
      reader = response.body.getReader();const chunks: Uint8Array[] = [];let size = 0;
      for (;;) { const part = await reader.read();if (part.done) break;size += part.value.byteLength;if (size > maxBytes) { await reader.cancel().catch(() => {});return { ok: false, kind: "invalid" }; }chunks.push(part.value); }
      const bytes = new Uint8Array(size);let at = 0;for (const part of chunks) { bytes.set(part, at);at += part.byteLength; }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!response.ok) { const reason = referralObject(data) ? data.error ?? data.erro : undefined;return { ok: false, kind: "http", status: response.status, ...(["stepup", "forbidden", "conflict", "not_found", "legacy_unavailable", "unavailable", "invalid"].includes(String(reason)) ? { reason: reason as "stepup" | "forbidden" | "conflict" | "not_found" | "legacy_unavailable" | "unavailable" | "invalid" } : {}) }; }
      return referralObject(data) ? { ok: true, data } : { ok: false, kind: "invalid" };
    } catch { return { ok: false, kind: "uncertain" }; } finally { try { reader?.releaseLock(); } catch { /* timed-out readers may be cancelling */ } }
  };
  try { return await Promise.race([work(), new Promise<ReferralClientResult>(resolve => { timer = setTimeout(() => { controller.abort();void reader?.cancel().catch(() => {});resolve({ ok: false, kind: "uncertain" }); }, Math.max(1, Math.min(30000, timeoutMs))); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export const statsPath = (before?: number) => `/api/admin/indicacoes/estatisticas${before === undefined ? "" : `?before=${before}`}`;
export const peoplePath = (code: string, before?: number) => `/api/admin/indicacoes/${code}/pessoas${before === undefined ? "" : `?before=${before}`}`;
