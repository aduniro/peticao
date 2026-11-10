import type { PoolClient, QueryResultRow } from "pg";
import { tx } from "@/lib/db";
import { REFERRAL_STATS_CODE, referralStatsCount, referralStatsId, referralStatsOptions, validReferralStatsActor, type ReferralStatsActor, type ReferralStatsFailure, type ReferralStatsPage, type ReferralStatsResult, type ReferralPeopleResult, type ReferralStatsRow } from "./referral-admin-stats-contract";
const fail = (error: ReferralStatsFailure["error"]): ReferralStatsFailure => ({ ok: false, error });
const personal = "(r.signature_id IS NOT NULL OR r.display_name IS NOT NULL)";
async function beginRead(c: PoolClient, actor: ReferralStatsActor) {
  // No DML. SHARE locks preserve account/session authorization until this read snapshot commits.
  // REPEATABLE READ is selected before the first snapshot/authorization query.
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL lock_timeout='1000ms'");
  await c.query("SET LOCAL statement_timeout='5000ms'");
  const account = await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), ["leitura", "edicao", "exclusao", "total"]]);
  if (!account.rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
function counts(raw: QueryResultRow, keys: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) { const value = referralStatsCount(raw[key]); if (value === null) throw new Error("invalid_referral_count"); result[key] = value; }
  return result;
}
const text = (v: unknown, nullable = false): string | null => { if (nullable && v === null) return null; if (typeof v !== "string" || v.length > 4096) throw new Error("invalid_referral_text"); return v; };
const iso = (v: unknown) => { if (!(v instanceof Date) || !Number.isFinite(v.getTime())) throw new Error("invalid_referral_date"); return v.toISOString(); };
function row(raw: QueryResultRow): ReferralStatsRow {
  if (!referralStatsId(raw.id) || typeof raw.code !== "string" || !REFERRAL_STATS_CODE.test(raw.code) || !["personal", "organization"].includes(raw.kind) || typeof raw.created_at !== "string" || raw.created_at.length > 64 || !Number.isFinite(Date.parse(raw.created_at))) throw new Error("invalid_referral_row");
  const n = counts(raw, ["visits", "signed", "pending"]);
  return { id: raw.id, code: raw.code, kind: raw.kind, name: text(raw.name, true), label: text(raw.label, true), createdAt: raw.created_at, archivedAt: raw.archived_at === null ? null : iso(raw.archived_at), visits: n.visits, signed: n.signed, pending: n.pending };
}
/** All kinds/archived rows count exactly once. Visits are a SUM of distinct visitors PER code, not globally unique people. */
export async function listReferralAdminStats(actor: ReferralStatsActor, options: ReferralStatsPage = {}): Promise<ReferralStatsResult | ReferralStatsFailure> {
  if (!validReferralStatsActor(actor)) return fail("forbidden");
  const page = referralStatsOptions(options); if (!page) return fail("invalid");
  try { return await tx(async c => {
    if (!await beginRead(c, actor)) return fail("forbidden");
    const totalsRow = (await c.query(`WITH visit_counts AS (
      SELECT e.ref_code,count(DISTINCT e.visitor_id) n FROM events e JOIN referrers x ON x.code=e.ref_code WHERE e.type='ref_visit' AND e.is_bot=false GROUP BY e.ref_code
    ) SELECT count(*)::text codes,count(*) FILTER(WHERE ${personal})::text personal_codes,count(*) FILTER(WHERE NOT ${personal})::text organization_codes,
      COALESCE((SELECT sum(n) FROM visit_counts),0)::text visits,
      (SELECT count(*) FROM signatures s JOIN referrers x ON x.code=s.ref_code WHERE s.status='confirmed')::text signed,
      (SELECT count(*) FROM signatures s JOIN referrers x ON x.code=s.ref_code WHERE s.status='pending')::text pending FROM referrers r`)).rows[0];
    const n = counts(totalsRow, ["codes", "personal_codes", "organization_codes", "visits", "signed", "pending"]);
    const rows = (await c.query(`SELECT r.id,r.code,r.display_name name,r.label,r.created_at,r.archived_at,
      CASE WHEN ${personal} THEN 'personal' ELSE 'organization' END kind,
      (SELECT count(DISTINCT e.visitor_id) FROM events e WHERE e.type='ref_visit' AND e.ref_code=r.code AND e.is_bot=false)::text visits,
      (SELECT count(*) FROM signatures s WHERE s.ref_code=r.code AND s.status='confirmed')::text signed,
      (SELECT count(*) FROM signatures s WHERE s.ref_code=r.code AND s.status='pending')::text pending
      FROM referrers r WHERE ($1::int IS NULL OR r.id<$1) ORDER BY r.id DESC LIMIT $2`, [page.before ?? null, page.limit + 1])).rows;
    return { ok: true as const, totals: { codes: n.codes, personalCodes: n.personal_codes, organizationCodes: n.organization_codes, visits: n.visits, signed: n.signed, pending: n.pending }, rows: rows.slice(0, page.limit).map(row), nextBefore: rows.length > page.limit ? rows[page.limit - 1].id : null };
  }); } catch { return fail("unavailable"); }
}
export async function listReferralAdminPeople(code: string, actor: ReferralStatsActor, options: ReferralStatsPage = {}): Promise<ReferralPeopleResult | ReferralStatsFailure> {
  if (!validReferralStatsActor(actor)) return fail("forbidden");
  const page = referralStatsOptions(options); if (typeof code !== "string" || !REFERRAL_STATS_CODE.test(code) || !page) return fail("invalid");
  try { return await tx(async c => {
    if (!await beginRead(c, actor)) return fail("forbidden");
    if (!(await c.query("SELECT id FROM referrers WHERE code=$1", [code])).rowCount) return fail("not_found");
    const total = referralStatsCount((await c.query("SELECT count(*)::text n FROM signatures WHERE ref_code=$1", [code])).rows[0].n); if (total === null) throw new Error("invalid_referral_count");
    const rows = (await c.query("SELECT id,name,status,category FROM signatures WHERE ref_code=$1 AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3", [code, page.before ?? null, page.limit + 1])).rows;
    return { ok: true as const, code, total, rows: rows.slice(0, page.limit).map(r => { if (!referralStatsId(r.id) || !["pending", "confirmed"].includes(r.status) || !["servidor", "apoiador", "estrangeiro"].includes(r.category)) throw new Error("invalid_referral_person"); return { id: r.id, name: text(r.name)!, status: r.status as "pending" | "confirmed", category: r.category as "servidor" | "apoiador" | "estrangeiro" }; }), nextBefore: rows.length > page.limit ? rows[page.limit - 1].id : null };
  }); } catch { return fail("unavailable"); }
}
