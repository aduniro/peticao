import type { PoolClient, QueryResultRow } from "pg";
import { audit, tx } from "./db";
import { analyzeDispersionGraph } from "./dispersion-graph";
import type { DispersionGraph, DispersionGraphInput } from "./dispersion-graph-contract";
import { dispersionOptions, validDispersionActor, type DispersionActor, type DispersionAllRow, type DispersionFailure, type DispersionOptions, type DispersionResult } from "./dispersion-admin-contract";
import { referralStatsCount } from "./referral-admin-stats-contract";
import { KIND_LABELS, type DomainKind } from "./institutional";

const fail = (error: DispersionFailure["error"]): DispersionFailure => ({ ok: false, error });
// Resource budgets reject the entire read explicitly; they never select a partial graph.
const GRAPH_BYTES = 128 * 1024 * 1024;
const EXPORT_SOURCE_BYTES = 64 * 1024 * 1024;
const READ_DEADLINE_MS = 10_000;
function withinDeadline(start: number) {
  if (performance.now() - start > READ_DEADLINE_MS) throw new Error("dispersion_read_deadline");
}
async function authorize(c: PoolClient, actor: DispersionActor) {
  const account = await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), ["edicao", "exclusao", "total"]]);
  if (!account.rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
function text(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 4096) throw new Error("invalid_dispersion_text");
  return value;
}
const date = (v: unknown, nullable = false) => {
  const s = text(v, nullable); if (s !== null && !Number.isFinite(Date.parse(s))) throw new Error("invalid_dispersion_date"); return s;
};
const count = (v: unknown) => { const n = referralStatsCount(v); if (n === null) throw new Error("invalid_dispersion_count"); return n; };
async function readGraph(c: PoolClient, start: number): Promise<{ graph: DispersionGraph; asOf: string }> {
  const budget = (await c.query(`SELECT count(*)::text total, COALESCE(sum(256+octet_length(s.name)+COALESCE(octet_length(s.ref_code),0)+COALESCE(octet_length(r.display_name),0)+COALESCE(octet_length(r.label),0)),0)::text bytes FROM signatures s LEFT JOIN referrers r ON r.code=s.ref_code`)).rows[0];
  if (count(budget.bytes) > GRAPH_BYTES) throw new Error("dispersion_resource_budget");
  const total = count(budget.total);
  withinDeadline(start);
  const raw = (await c.query(`SELECT s.id,s.name,s.status,s.ref_code,(r.id IS NOT NULL) referrer_found,r.signature_id owner_id,r.display_name,r.label,s.confirm_same_visitor FROM signatures s LEFT JOIN referrers r ON r.code=s.ref_code ORDER BY s.id DESC`)).rows;
  const input: DispersionGraphInput[] = raw.map(r => {
    if (!["confirmed", "pending"].includes(r.status) || typeof r.referrer_found !== "boolean" || (r.confirm_same_visitor !== null && typeof r.confirm_same_visitor !== "boolean")) throw new Error("invalid_dispersion_row");
    return { id: r.id, name: text(r.name)!, status: r.status, refCode: text(r.ref_code, true), referrerFound: r.referrer_found, ownerId: r.owner_id, referrerDisplayName: text(r.display_name, true), orgLabel: text(r.label, true), confirmSameVisitor: r.confirm_same_visitor };
  });
  withinDeadline(start);
  const graph = analyzeDispersionGraph(input, total);
  withinDeadline(start);
  const clock = (await c.query("SELECT transaction_timestamp() stamp")).rows[0].stamp;
  withinDeadline(start);
  if (!(clock instanceof Date)) throw new Error("invalid_dispersion_clock");
  return { graph, asOf: clock.toISOString() };
}
function details(raw: QueryResultRow, graph: DispersionGraph): DispersionAllRow {
  const node = graph.byId.get(raw.id); if (!node) throw new Error("missing_dispersion_node");
  const kind = text(raw.email_domain_kind, true);
  return { ...node, email: text(raw.email)!, category: text(raw.category)!, institution: text(raw.institution, true),
    emailDomain: text(raw.email_domain, true), emailInstitution: text(raw.email_institution, true), emailDomainKind: kind,
    emailDomainKindLabel: kind !== null && Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind as DomainKind] : kind,
    identityMethod: text(raw.identity_method, true), consentAt: date(raw.consent_at)!, confirmedAt: date(raw.confirmed_at, true),
    confirmSameVisitor: raw.confirm_same_visitor, refCode: text(raw.ref_code, true), orgLabel: text(raw.org_label, true) };
}
const DETAIL_SELECT = `SELECT s.id,s.email,s.category,s.institution,s.email_domain,s.email_institution,s.email_domain_kind,s.identity_method,s.consent_at,s.confirmed_at,s.confirm_same_visitor,s.ref_code,r.label org_label FROM signatures s LEFT JOIN referrers r ON r.code=s.ref_code`;
async function begin(c: PoolClient, actor: DispersionActor) {
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL lock_timeout='1000ms'");
  await c.query("SET LOCAL statement_timeout='10000ms'");
  return authorize(c, actor);
}
/** Each response is complete as of its own snapshot. Paging does not claim one persistent revision. */
export async function listDispersionData(actor: DispersionActor, options: DispersionOptions = {}): Promise<DispersionResult | DispersionFailure> {
  if (!validDispersionActor(actor)) return fail("forbidden");
  const page = dispersionOptions(options); if (!page) return fail("invalid");
  try { return await tx(async c => {
    const start = performance.now();
    if (!await begin(c, actor)) return fail("forbidden");
    withinDeadline(start);
    const { graph, asOf } = await readGraph(c, start);
    const focus = page.view === "children" ? graph.byId.get(page.parentId!) : null;
    if (page.view === "children" && !focus) return fail("not_found");
    const ids = page.view === "all" ? graph.nodes.map(n => n.id) : page.view === "roots" ? graph.roots : page.view === "diagnostics" ? graph.diagnostics : graph.children.get(page.parentId!) ?? [];
    const selected: number[] = [];
    // Arrays inherit SQL id DESC. No N*parent search or recursion.
    for (const id of ids) if (page.before === undefined || id < page.before) { selected.push(id); if (selected.length > page.limit) break; }
    const nextBefore = selected.length > page.limit ? selected[page.limit - 1] : null;
    const wanted = selected.slice(0, page.limit);
    const rows = page.view === "all" ? (await c.query(`${DETAIL_SELECT} WHERE s.id=ANY($1::int[]) ORDER BY s.id DESC`, [wanted])).rows.map(r => details(r, graph)) : wanted.map(id => graph.byId.get(id)!);
    if (rows.length !== wanted.length) throw new Error("incomplete_dispersion_page");
    withinDeadline(start);
    // SHARE locks prevent revocation during the transaction, but not passage of time.
    if (!await authorize(c, actor)) return fail("forbidden");
    withinDeadline(start);
    return { ok: true as const, view: page.view, asOf, summary: graph.summary, coverage: graph.coverage, total: ids.length, rows, nextBefore, focus: focus ?? null };
  }); } catch { return fail("unavailable"); }
}

export type DispersionExportSource = { ok: true; asOf: string; rows: DispersionAllRow[]; total: number };
export async function readDispersionExport(actor: DispersionActor): Promise<DispersionExportSource | DispersionFailure> {
  if (!validDispersionActor(actor)) return fail("forbidden");
  try { return await tx(async c => {
    const start = performance.now();
    if (!await begin(c, actor)) return fail("forbidden");
    withinDeadline(start);
    // Includes escaped-cell overhead margin in the separate final CSV budget.
    const bytes = count((await c.query(`SELECT COALESCE(sum(octet_length(json_build_array(s.id,s.email,s.category,s.institution,s.email_domain,s.email_institution,s.email_domain_kind,s.identity_method,s.consent_at,s.confirmed_at,s.confirm_same_visitor,s.ref_code,r.label)::text)),0)::text n FROM signatures s LEFT JOIN referrers r ON r.code=s.ref_code`)).rows[0].n);
    if (bytes > EXPORT_SOURCE_BYTES) throw new Error("dispersion_export_budget");
    const { graph, asOf } = await readGraph(c, start);
    const rows = (await c.query(`${DETAIL_SELECT} ORDER BY s.id DESC`)).rows.map(r => details(r, graph));
    if (rows.length !== graph.coverage.total || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("incomplete_dispersion_export");
    withinDeadline(start);
    if (!await authorize(c, actor)) return fail("forbidden");
    withinDeadline(start);
    return { ok: true as const, rows, total: graph.coverage.total, asOf };
  }); } catch { return fail("unavailable"); }
}
/** Final audit uses a fresh READ COMMITTED transaction, so its serialized hash chain sees the latest entry. */
export async function auditDispersionExport(actor: DispersionActor, data: { rows: number; bytes: number; sha256: string; asOf: string }): Promise<boolean> {
  if (!validDispersionActor(actor)) return false;
  try { return await tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'");
    await c.query("SET LOCAL statement_timeout='5000ms'");
    if (!await authorize(c, actor)) return false;
    await audit("export_internal_base", null, { ...data, actorId: actor.userId, sessionId: actor.sessaoId, scope: "dispersion_complete", meaning: "file_prepared_not_delivery" }, c);
    return true;
  }); } catch { return false; }
}
