import { domainToASCII } from "node:url";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { hmac } from "./security";

export type CatalogActor = { userId: number; email: string; sessaoId: number | null };
export type CatalogMetadata = { label: string | null; evidenceUrl: string | null };
type Operation = "edit" | "archive" | "restore";
type Failure = { ok: false; error: "invalid" | "forbidden" | "conflict" | "not_found" };
type Row = { domain: string; kind: string; status: string; institution: string | null; evidence_url: string | null; admin_catalog: Record<string, unknown>; admin_catalog_version: string; admin_archived_at: Date | null };
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });
const versionOk = (x: unknown): x is string => typeof x === "string" && /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n;
const actorOk = (a: CatalogActor) => Number.isInteger(a?.userId) && a.userId > 0 && a.userId <= 2147483647 && typeof a.email === "string" && Number.isInteger(a.sessaoId) && a.sessaoId! > 0 && a.sessaoId! <= 2147483647;
const validDomain = (x: unknown): x is string => typeof x === "string" && x.length <= 253 && domainToASCII(x) === x && x === x.toLowerCase() && x.includes(".") && x.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const state = (r: Row) => ({ domain: r.domain, version: String(r.admin_catalog_version), metadata: r.admin_catalog, archivedAt: r.admin_archived_at?.toISOString() ?? null });
type Success = { ok: true; row: ReturnType<typeof state>; changed: boolean };
const fields = "domain,kind,status,institution,evidence_url,admin_catalog,admin_catalog_version,admin_archived_at";
function metadata(value: unknown): CatalogMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "label") || !Object.hasOwn(value, "evidenceUrl")) return null;
  const m = value as CatalogMetadata;
  if (m.label !== null && (typeof m.label !== "string" || m.label.trim().length < 2 || m.label.length > 200 || /[\u0000-\u001f\u007f]/.test(m.label))) return null;
  if (m.evidenceUrl !== null) {
    if (typeof m.evidenceUrl !== "string" || m.evidenceUrl.length > 2048 || /[\u0000-\u0020\u007f]/.test(m.evidenceUrl)) return null;
    try { const u = new URL(m.evidenceUrl); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || !u.hostname) return null; } catch { return null; }
  }
  return { label: m.label?.trim().replace(/\s+/g, " ") ?? null, evidenceUrl: m.evidenceUrl };
}
async function authorized(c: PoolClient, a: CatalogActor, archive: boolean) {
  await c.query("SELECT pg_advisory_xact_lock(7003)");
  if (!(await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [a.userId, a.email.toLowerCase(), archive ? ["exclusao", "total"] : ["edicao", "exclusao", "total"]])).rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND ($3::boolean=false OR stepup_ate>now()) FOR SHARE", [a.sessaoId, a.userId, archive])).rowCount;
}

/** Administrative overlay only. Never writes effective decisions or triggers propagation/cache invalidation. */
export async function manageDomainCatalog(input: { domain: string; version: string; requestId: string; operation: Operation; metadata?: CatalogMetadata }, actor: CatalogActor): Promise<Success | Failure> {
  if (!actorOk(actor)) return fail("forbidden");
  if (!validDomain(input?.domain) || !versionOk(input.version) || typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId) || !["edit", "archive", "restore"].includes(input.operation)) return fail("invalid");
  const next = input.operation === "edit" ? metadata(input.metadata) : null;
  if (input.operation === "edit" ? !next : input.metadata !== undefined) return fail("invalid");
  const fingerprint = hmac("admin-domain-catalog:v1:" + JSON.stringify([actor.userId, input.domain, input.version, input.operation, next]));
  return tx(async c => {
    if (!await authorized(c, actor, input.operation !== "edit")) return fail("forbidden");
    await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [`domain-catalog:${actor.userId}:${input.requestId}`]);
    const previous = (await c.query<{ input_hash: string; result: Success }>("SELECT input_hash,result FROM admin_domain_catalog_requests WHERE actor_id=$1 AND request_id=$2", [actor.userId, input.requestId])).rows[0];
    if (previous) return previous.input_hash === fingerprint ? previous.result : fail("conflict");
    const old = (await c.query<Row>(`SELECT ${fields} FROM institutional_domains WHERE domain=$1 FOR UPDATE`, [input.domain])).rows[0];
    if (!old) return fail("not_found");
    if (String(old.admin_catalog_version) !== input.version || input.operation === "edit" && old.admin_archived_at || input.operation === "archive" && old.admin_archived_at || input.operation === "restore" && !old.admin_archived_at) return fail("conflict");
    // Preserve unknown overlay keys and legacy NULL/unknown effective fields.
    const merged = next ? { ...old.admin_catalog, ...next } : old.admin_catalog;
    const changed = input.operation !== "edit" || old.admin_catalog.label !== merged.label || old.admin_catalog.evidenceUrl !== merged.evidenceUrl;
    if (changed && input.version === "9223372036854775807") return fail("conflict");
    const current = changed ? (await c.query<Row>(`UPDATE institutional_domains SET admin_catalog=CASE WHEN $2='edit' THEN $3::jsonb ELSE admin_catalog END,admin_archived_at=CASE WHEN $2='archive' THEN now() WHEN $2='restore' THEN NULL ELSE admin_archived_at END,admin_catalog_version=admin_catalog_version+1 WHERE domain=$1 RETURNING ${fields}`, [input.domain, input.operation, JSON.stringify(merged)])).rows[0] : old;
    const result: Success = { ok: true, row: state(current), changed };
    await audit("admin_domain_catalog_managed", null, { domain: input.domain, requestId: input.requestId, operation: input.operation, before: state(old), after: result.row, changed, userId: actor.userId, por: actor.email.toLowerCase() }, c);
    await c.query("INSERT INTO admin_domain_catalog_requests(actor_id,request_id,input_hash,domain,result) VALUES($1,$2,$3,$4,$5::jsonb)", [actor.userId, input.requestId, fingerprint, input.domain, JSON.stringify(result)]);
    return result;
  });
}

export async function listDomainCatalog(actor: CatalogActor, options: { filter?: "active" | "archived" | "all"; after?: string; limit?: number } = {}) {
  if (!actorOk(actor)) return fail("forbidden");
  const filter = options.filter ?? "active", limit = options.limit ?? 50;
  if (!["active", "archived", "all"].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 100 || options.after !== undefined && !validDomain(options.after)) return fail("invalid");
  return tx(async c => {
    if (!await authorized(c, actor, false)) return fail("forbidden");
    const rows = (await c.query<Row>(`SELECT ${fields} FROM institutional_domains WHERE ($1='all' OR ($1='active' AND admin_archived_at IS NULL) OR ($1='archived' AND admin_archived_at IS NOT NULL)) AND ($2::text IS NULL OR domain>$2) ORDER BY domain LIMIT $3`, [filter, options.after ?? null, limit + 1])).rows;
    return { ok: true as const, rows: rows.slice(0, limit).map(r => ({ ...state(r), effective: { kind: r.kind, status: r.status, institution: r.institution, evidenceUrl: r.evidence_url } })), nextAfter: rows.length > limit ? rows[limit - 1].domain : null };
  });
}
