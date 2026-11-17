import { referralCode, referralDate, referralId, referralKeys, referralObject } from "./referral-admin-client";
export type ManagedReferralRow = { id: number; code: string; label: string; version: string; archivedAt: string | null };
export type ReferralOperation = "edit" | "archive" | "restore";
export type ReferralMutation = { id: number; version: string; requestId: string; operation: ReferralOperation; label?: string };
export type ReferralMutationResult = { requestId: string; operation: ReferralOperation; context: { id: number; expectedVersion: string }; row: ManagedReferralRow; changed: boolean };
export type ReferralManagedPage = { rows: ManagedReferralRow[]; nextBefore: number | null };
export const mutationUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const referralVersion = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
export const normalizeReferralLabel = (v: string) => v.trim().replace(/\s+/g, " ");
function label(v: unknown): v is string { return typeof v === "string" && v.length >= 2 && v.length <= 80 && !/[\u0000-\u001f\u007f]/.test(v); }
export function parseManagedRow(v: unknown): ManagedReferralRow | null {
  if (!referralObject(v) || !referralKeys(v, "id,code,label,version,archivedAt") || !referralId(v.id) || !referralCode(v.code) || typeof v.label !== "string" || v.label.length > 4096 || !referralVersion(v.version) || v.archivedAt !== null && !referralDate(v.archivedAt)) return null;
  return { id: v.id, code: v.code, label: v.label, version: v.version, archivedAt: v.archivedAt as string | null };
}
export function parseReferralMutation(v: unknown): ReferralMutation | null {
  if (!referralObject(v) || !referralId(v.id) || !referralVersion(v.version) || !mutationUuid(v.requestId) || !["edit", "archive", "restore"].includes(String(v.operation)) || !referralKeys(v, v.operation === "edit" ? "id,version,requestId,operation,label" : "id,version,requestId,operation")) return null;
  if (v.operation === "edit" && (!label(v.label) || normalizeReferralLabel(v.label) !== v.label)) return null;
  return { id: v.id, version: v.version, requestId: v.requestId, operation: v.operation as ReferralOperation, ...(v.operation === "edit" ? { label: v.label as string } : {}) };
}
export function parseManagedPage(v: unknown, before?: number, filter: "active" | "archived" | "all" = "active", limit = 50): ReferralManagedPage | null {
  if (!referralObject(v) || !referralKeys(v, "ok,rows,nextBefore") || v.ok !== true || !Array.isArray(v.rows) || v.rows.length > limit) return null;
  const rows: ManagedReferralRow[] = [];
  for (const item of v.rows) { const r = parseManagedRow(item);if (!r || (rows.length ? r.id >= rows.at(-1)!.id : before !== undefined && r.id >= before) || filter === "active" && r.archivedAt !== null || filter === "archived" && r.archivedAt === null) return null;rows.push(r); }
  if (v.nextBefore !== null && (!referralId(v.nextBefore) || rows.length !== limit || rows.at(-1)?.id !== v.nextBefore)) return null;
  return { rows, nextBefore: v.nextBefore as number | null };
}
export function parseMutationResult(v: unknown, intent: ReferralMutation): ReferralMutationResult | null {
  if (!parseReferralMutation(intent) || !referralObject(v) || !referralKeys(v, "ok,requestId,operation,context,row,changed") || v.ok !== true || v.requestId !== intent.requestId || v.operation !== intent.operation || !referralObject(v.context) || !referralKeys(v.context, "id,expectedVersion") || v.context.id !== intent.id || v.context.expectedVersion !== intent.version || typeof v.changed !== "boolean") return null;
  const row = parseManagedRow(v.row);if (!row || row.id !== intent.id || BigInt(row.version) !== BigInt(intent.version) + (v.changed ? 1n : 0n)) return null;
  if (intent.operation === "edit" ? row.label !== intent.label || row.archivedAt !== null : !v.changed || (intent.operation === "archive" ? row.archivedAt === null : row.archivedAt !== null)) return null;
  return { requestId: intent.requestId, operation: intent.operation, context: { id: intent.id, expectedVersion: intent.version }, row, changed: v.changed };
}
export type ReferralMutationState = { mode: "ready" | "uncertain" | "not-found" | "confirmed" | "legacy"; intent: ReferralMutation | null; result: ReferralMutationResult | null };
export const readyMutation = (): ReferralMutationState => ({ mode: "ready", intent: null, result: null });
/** An unknown result never authorizes another POST. Only an explicit GET 404 permits same-intent retry. */
export function recoveredMutation(state: ReferralMutationState, value: unknown, httpStatus?: number, reason?: string): ReferralMutationState {
  if (!state.intent) return state;
  const result = parseMutationResult(value, state.intent);
  return result ? { ...state, mode: "confirmed", result } : { ...state, mode: httpStatus === 404 ? "not-found" : httpStatus === 409 && reason === "legacy_unavailable" ? "legacy" : "uncertain", result: null };
}
/** A durable mutation result is historical: it must never roll back a newer inventory revision. */
export function applyReferralResult(rows: ManagedReferralRow[], result: ManagedReferralRow, filter: "active" | "archived" | "all") {
  return rows.map(row => row.id === result.id && BigInt(row.version) <= BigInt(result.version) ? result : row)
    .filter(row => filter === "all" || (filter === "active" ? row.archivedAt === null : row.archivedAt !== null));
}

export type LegacyReferralReference = { requestId: string; id: number; observedVersion: string };
/** Only a specifically identified legacy result, followed by a fresh row read and consent, may be forgotten locally. */
export function abandonLegacyReferral(state: ReferralMutationState, row: ManagedReferralRow | undefined, checkedAt: number | null, readAt: number, consent: boolean): { state: ReferralMutationState; reference: LegacyReferralReference } | null {
  if (state.mode !== "legacy" || !state.intent || !parseReferralMutation(state.intent) || !row || row.id !== state.intent.id || !parseManagedRow(row) || checkedAt === null || !Number.isSafeInteger(checkedAt) || checkedAt < 0 || !Number.isSafeInteger(readAt) || readAt <= checkedAt || consent !== true) return null;
  return { state: readyMutation(), reference: { requestId: state.intent.requestId, id: row.id, observedVersion: row.version } };
}
