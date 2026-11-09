import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { hmac } from "./security";

export type ReferralActor = { userId: number; email: string; sessaoId: number | null };
export type ReferralOperation = "edit" | "archive" | "restore";
export type ManagedReferral = { id: number; code: string; label: string; version: string; archivedAt: string | null };
type Row = { id: number; code: string; label: string | null; display_name: string | null; signature_id: number | null; admin_version: string; archived_at: Date | null };
type Failure = { ok: false; error: "invalid" | "forbidden" | "conflict" | "not_found" };
type Success = { ok: true; row: ManagedReferral; changed: boolean };
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });
const rowValue = (r: Row): ManagedReferral => ({ id: r.id, code: r.code, label: r.label!, version: String(r.admin_version), archivedAt: r.archived_at?.toISOString() ?? null });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const validActor = (a: ReferralActor) => Number.isInteger(a?.userId) && a.userId > 0 && a.userId <= 2147483647 && typeof a.email === "string" && Number.isInteger(a.sessaoId) && a.sessaoId! > 0 && a.sessaoId! <= 2147483647;

async function authorized(c: PoolClient, actor: ReferralActor, archival: boolean) {
  // Same lock ordering as account management; role and session remain current
  // through the write, not merely at the HTTP gate.
  await c.query("SELECT pg_advisory_xact_lock(7003)");
  const account = await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), archival ? ["exclusao", "total"] : ["edicao", "exclusao", "total"]]);
  if (!account.rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND ($3::boolean=false OR stepup_ate>now()) FOR SHARE", [actor.sessaoId, actor.userId, archival])).rowCount;
}

/** No signer identity, code, token, attribution or public-link mutation. */
export async function manageAdministrativeReferral(input: { id: number; version: string; requestId: string; operation: ReferralOperation; label?: string }, actor: ReferralActor): Promise<Success | Failure> {
  if (!validActor(actor)) return fail("forbidden");
  if (!Number.isInteger(input?.id) || input.id <= 0 || input.id > 2147483647 || typeof input.version !== "string" || !/^[1-9][0-9]{0,18}$/.test(input.version) || BigInt(input.version) > 9223372036854775807n || typeof input.requestId !== "string" || !uuid.test(input.requestId) || !["edit", "archive", "restore"].includes(input.operation)) return fail("invalid");
  const label = input.operation === "edit" && typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ") : null;
  if (input.operation === "edit" ? !label || label.length < 2 || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label) : input.label !== undefined) return fail("invalid");
  const fingerprint = hmac("admin-referral-mutation:v1:" + JSON.stringify([actor.userId, input.id, input.version, input.operation, label]));
  return tx(async c => {
    if (!await authorized(c, actor, input.operation !== "edit")) return fail("forbidden");
    await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [`referral-mutation:${actor.userId}:${input.requestId}`]);
    const previous = (await c.query<{ input_hash: string; result: Success }>("SELECT input_hash,result FROM admin_referral_mutations WHERE actor_id=$1 AND request_id=$2", [actor.userId, input.requestId])).rows[0];
    if (previous) return previous.input_hash === fingerprint ? previous.result : fail("conflict");
    const old = (await c.query<Row>("SELECT id,code,label,display_name,signature_id,admin_version,archived_at FROM referrers WHERE id=$1 FOR UPDATE", [input.id])).rows[0];
    if (!old || old.signature_id !== null || old.display_name !== null || old.label === null) return fail("not_found");
    if (String(old.admin_version) !== input.version) return fail("conflict");
    if (input.operation === "edit" && old.archived_at || input.operation === "archive" && old.archived_at || input.operation === "restore" && !old.archived_at) return fail("conflict");
    const changed = input.operation !== "edit" || old.label !== label;
    if (changed && input.version === "9223372036854775807") return fail("conflict");
    let current = old;
    if (changed) current = (await c.query<Row>("UPDATE referrers SET label=CASE WHEN $2='edit' THEN $3 ELSE label END,archived_at=CASE WHEN $2='archive' THEN now() WHEN $2='restore' THEN NULL ELSE archived_at END,admin_version=admin_version+1 WHERE id=$1 RETURNING id,code,label,display_name,signature_id,admin_version,archived_at", [input.id, input.operation, label])).rows[0];
    const result: Success = { ok: true, row: rowValue(current), changed };
    await audit("admin_referral_managed", null, { referrerId: input.id, requestId: input.requestId, operation: input.operation, before: rowValue(old), after: result.row, changed, userId: actor.userId, por: actor.email.toLowerCase() }, c);
    await c.query("INSERT INTO admin_referral_mutations(actor_id,request_id,input_hash,referrer_id,result) VALUES($1,$2,$3,$4,$5::jsonb)", [actor.userId, input.requestId, fingerprint, input.id, JSON.stringify(result)]);
    return result;
  });
}

/** Separate administrative inventory; existing public/statistical consumers stay unchanged. */
export async function listAdministrativeReferrals(actor: ReferralActor, options: { filter?: "active" | "archived" | "all"; before?: number; limit?: number } = {}) {
  if (!validActor(actor)) return fail("forbidden");
  const filter = options.filter ?? "active", limit = options.limit ?? 50;
  if (!["active", "archived", "all"].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 100 || options.before !== undefined && (!Number.isInteger(options.before) || options.before < 1 || options.before > 2147483647)) return fail("invalid");
  return tx(async c => {
    if (!await authorized(c, actor, false)) return fail("forbidden");
    const rows = (await c.query<Row>("SELECT id,code,label,display_name,signature_id,admin_version,archived_at FROM referrers WHERE signature_id IS NULL AND display_name IS NULL AND label IS NOT NULL AND ($1='all' OR ($1='active' AND archived_at IS NULL) OR ($1='archived' AND archived_at IS NOT NULL)) AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3", [filter, options.before ?? null, limit + 1])).rows;
    return { ok: true as const, rows: rows.slice(0, limit).map(rowValue), nextBefore: rows.length > limit ? rows[limit - 1].id : null };
  });
}
