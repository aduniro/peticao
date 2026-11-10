import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { explorar, linhas, onde, type Resultado, type Linha } from "./assinaturas-explorar";
import { filtrosParaQuery, type Filtros } from "./assinaturas-filtros";
import { signatureExplorerCapabilities, signatureExplorerSafeCount, signatureExplorerSearch, validSignatureExplorerActor, type SignatureExplorerActor, type SignatureExplorerOptions, type SignatureExplorerFailure, type SignatureExplorerResult } from "./signature-explorer-admin-contract";

const SOURCE_BYTES = 128 * 1024 * 1024;
const JSON_BYTES = 16 * 1024 * 1024;
const EXPORT_BYTES = 64 * 1024 * 1024;
const DEADLINE_MS = 10_000;
const FILTER_KEYS = ["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf", "whatsapp", "q", "de", "ate"] as const;
const fail = (error: SignatureExplorerFailure["error"]): SignatureExplorerFailure => ({ ok: false, error });
const safeCount = (v: unknown) => { const n = signatureExplorerSafeCount(v); if (n === null) throw new Error("invalid_explorer_count"); return n; };
function withinDeadline(start: number) { if (performance.now() - start > DEADLINE_MS) throw new Error("explorer_deadline"); }
/** Strict shape validation applies even when a trusted internal caller bypasses the URL parser. */
export function validSignatureExplorerOptions(raw: unknown): raw is SignatureExplorerOptions {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "direction,filters,format,limit,order,page") return false;
    const o = raw as SignatureExplorerOptions, f = o.filters;
    if (!f || typeof f !== "object" || Array.isArray(f) || Object.keys(f).sort().join(",") !== [...FILTER_KEYS].sort().join(",")) return false;
    for (const key of FILTER_KEYS) {
      if (["q", "de", "ate"].includes(key)) { if (typeof f[key] !== "string") return false; }
      else if (!Array.isArray(f[key]) || (f[key] as unknown[]).some(v => typeof v !== "string")) return false;
    }
    if (typeof o.page !== "number" || typeof o.limit !== "number" || typeof o.order !== "string" || typeof o.direction !== "string" || typeof o.format !== "string") return false;
    const sp = new URLSearchParams(filtrosParaQuery(f));
    sp.set("pagina", String(o.page)); sp.set("limite", String(o.limit)); sp.set("ordem", o.order); sp.set("dir", o.direction); sp.set("formato", o.format);
    const parsed = signatureExplorerSearch(sp);
    return parsed.ok && FILTER_KEYS.every(k => JSON.stringify(parsed.options.filters[k]) === JSON.stringify(f[k])) && parsed.options.page === o.page && parsed.options.limit === o.limit && parsed.options.order === o.order && parsed.options.direction === o.direction && parsed.options.format === o.format;
  } catch { return false; }
}
async function authorize(c: PoolClient, actor: SignatureExplorerActor): Promise<string | null> {
  const account = (await c.query("SELECT nivel FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), ["leitura", "edicao", "exclusao", "total"]])).rows[0];
  if (!account) return null;
  if (!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount) return null;
  return account.nivel;
}
async function begin(c: PoolClient, actor: SignatureExplorerActor) {
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL lock_timeout='1000ms'");
  await c.query("SET LOCAL statement_timeout='10000ms'");
  return authorize(c, actor);
}
async function asOf(c: PoolClient) {
  const stamp = (await c.query("SELECT transaction_timestamp() stamp")).rows[0].stamp;
  if (!(stamp instanceof Date)) throw new Error("invalid_explorer_clock");
  return stamp.toISOString();
}
/** Budget all facet source values as well as matched rows; never LIMIT the coverage to satisfy the budget. */
async function preflight(c: PoolClient, start: number, filters: Filtros, exporting: boolean) {
  const w = exporting ? onde(filters) : { sql: "", params: [] };
  const budget = (await c.query(`SELECT COALESCE(sum(512+octet_length(json_build_array(s.name,s.category,s.institution,s.role,s.region_criteria,s.campus,s.city,s.uf,s.country,s.university,s.status,s.created_at,s.confirmed_at,s.campus_ibge,s.city_ibge,s.ifes_acronym)::text)),0)::text bytes FROM signatures s ${w.sql}`, w.params)).rows[0];
  if (safeCount(budget.bytes) > SOURCE_BYTES) throw new Error("explorer_source_budget");
  withinDeadline(start);
}
function verifyResult(result: Resultado) {
  if (result.total !== result.totais.confirmadas + result.totais.pendentes || result.total !== result.totais.servidores + result.totais.apoiadores + result.totais.estrangeiros) throw new Error("incomplete_explorer_totals");
  const mapped = result.pontos.reduce((n, p) => n + p.conf + p.pend, result.semLocal);
  if (mapped !== result.total || new Set(result.linhas.map(r => r.id)).size !== result.linhas.length) throw new Error("incomplete_explorer_rows");
}
export async function readSignatureExplorer(actor: SignatureExplorerActor, options: SignatureExplorerOptions): Promise<SignatureExplorerResult | SignatureExplorerFailure> {
  if (!validSignatureExplorerActor(actor)) return fail("forbidden");
  if (!validSignatureExplorerOptions(options) || options.format !== "json") return fail("invalid");
  try { return await tx(async c => {
    const start = performance.now(), level = await begin(c, actor);
    if (!level) return fail("forbidden");
    withinDeadline(start);
    await preflight(c, start, options.filters, false);
    const capabilities = signatureExplorerCapabilities(level);
    const result = await explorar(options.filters, { pagina: options.page, limite: options.limit, ordem: options.order, dir: options.direction }, { client: c, contacts: capabilities.contacts, checkpoint: () => withinDeadline(start) });
    if (result.linhas.length !== Math.min(options.limit, Math.max(0, result.total - (options.page - 1) * options.limit))) throw new Error("invalid_explorer_page_count");
    verifyResult(result); withinDeadline(start);
    const stamp = await asOf(c);
    withinDeadline(start);
    const response: SignatureExplorerResult = { ok: true, ...result, pagina: options.page, limite: options.limit, asOf: stamp, coverage: { matched: result.total, totalRowsReturned: result.linhas.length, facetsComplete: true, mapComplete: true, complete: true }, capabilities };
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > JSON_BYTES) throw new Error("explorer_json_budget");
    withinDeadline(start);
    if (!await authorize(c, actor)) return fail("forbidden");
    withinDeadline(start);
    return response;
  }); } catch { return fail("unavailable"); }
}
export type SignatureExportSource = { ok: true; asOf: string; rows: Linha[]; total: number };
export async function readSignatureExport(actor: SignatureExplorerActor, options: SignatureExplorerOptions): Promise<SignatureExportSource | SignatureExplorerFailure> {
  if (!validSignatureExplorerActor(actor)) return fail("forbidden");
  if (!validSignatureExplorerOptions(options) || options.format !== "csv") return fail("invalid");
  try { return await tx(async c => {
    const start = performance.now();
    if (!await begin(c, actor)) return fail("forbidden");
    withinDeadline(start);
    await preflight(c, start, options.filters, true);
    // No contact selected even for administrators; existing CSV stays exactly eleven columns.
    const result = await linhas(options.filters, { ordem: options.order, dir: options.direction, todas: true }, { client: c, contacts: false, checkpoint: () => withinDeadline(start) });
    if (result.linhas.length !== result.total || new Set(result.linhas.map(r => r.id)).size !== result.total) throw new Error("incomplete_explorer_export");
    if (Buffer.byteLength(JSON.stringify(result.linhas), "utf8") > EXPORT_BYTES) throw new Error("explorer_export_budget");
    withinDeadline(start);
    const stamp = await asOf(c);
    if (!await authorize(c, actor)) return fail("forbidden");
    withinDeadline(start);
    return { ok: true as const, rows: result.linhas, total: result.total, asOf: stamp };
  }); } catch { return fail("unavailable"); }
}
/** Fresh READ COMMITTED audit; no PII and no assertion that the browser received the bytes. */
export async function auditSignatureExport(actor: SignatureExplorerActor, data: { rows: number; bytes: number; sha256: string; asOf: string }): Promise<boolean> {
  if (!validSignatureExplorerActor(actor) || !Number.isSafeInteger(data.rows) || data.rows < 0 || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || !/^[a-f0-9]{64}$/.test(data.sha256) || !Number.isFinite(Date.parse(data.asOf))) return false;
  try { return await tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'"); await c.query("SET LOCAL statement_timeout='5000ms'");
    if (!await authorize(c, actor)) return false;
    await audit("export_internal_base", null, { ...data, actorId: actor.userId, sessionId: actor.sessaoId, scope: "signatures_complete_filtered", meaning: "file_prepared_not_delivery" }, c);
    // Audit may wait on its serialized chain or triggers. Expiry after that wait must roll back the new entry.
    if (!await authorize(c, actor)) throw new Error("expired_export_session");
    return true;
  }); } catch { return false; }
}
