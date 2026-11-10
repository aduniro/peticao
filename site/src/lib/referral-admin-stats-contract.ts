/** Read-only admin projection. No management token, identity document, email or mutation version. */
export type ReferralStatsActor = { userId: number; email: string; sessaoId: number | null };
export type ReferralStatsPage = { before?: number; limit?: number };
export type ReferralStatsTotals = { codes: number; personalCodes: number; organizationCodes: number; visits: number; signed: number; pending: number };
export type ReferralStatsRow = { id: number; code: string; kind: "personal" | "organization"; name: string | null; label: string | null; createdAt: string; archivedAt: string | null; visits: number; signed: number; pending: number };
export type ReferralStatsResult = { ok: true; totals: ReferralStatsTotals; rows: ReferralStatsRow[]; nextBefore: number | null };
export type ReferralPerson = { id: number; name: string; status: "pending" | "confirmed"; category: "servidor" | "apoiador" | "estrangeiro" };
export type ReferralPeopleResult = { ok: true; code: string; total: number; rows: ReferralPerson[]; nextBefore: number | null };
export type ReferralStatsFailure = { ok: false; error: "invalid" | "forbidden" | "not_found" | "unavailable" };
export const REFERRAL_STATS_CODE = /^[2-9A-HJKMNP-Z]{7}$/;
export const referralStatsId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
export function validReferralStatsActor(actor: ReferralStatsActor): boolean {
  return !!actor && referralStatsId(actor.userId) && referralStatsId(actor.sessaoId) && typeof actor.email === "string" && actor.email.length > 0 && actor.email.length <= 254;
}
export function referralStatsOptions(value: unknown = {}): Required<Pick<ReferralStatsPage, "limit">> & Pick<ReferralStatsPage, "before"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => k !== "before" && k !== "limit")) return null;
  const v = value as ReferralStatsPage;
  if (v.before !== undefined && !referralStatsId(v.before) || v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100)) return null;
  return { ...(v.before === undefined ? {} : { before: v.before }), limit: v.limit ?? 50 };
}
export function referralStatsSearch(params: URLSearchParams): ReferralStatsPage | null {
  const value: ReferralStatsPage = {};
  for (const [key, raw] of params) {
    if (!["before", "limit"].includes(key) || params.getAll(key).length !== 1 || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
    value[key as keyof ReferralStatsPage] = Number(raw);
  }
  return referralStatsOptions(value);
}
/** PostgreSQL count(*) is bigint. Reject overflow rather than round or silently truncate it. */
export function referralStatsCount(raw: unknown): number | null {
  if (typeof raw === "string" && /^(0|[1-9][0-9]{0,15})$/.test(raw)) { const n = Number(raw); return Number.isSafeInteger(n) && n >= 0 ? n : null; }
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}
