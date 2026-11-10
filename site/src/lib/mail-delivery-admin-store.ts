import type { PoolClient } from "pg";
import { audit, tx } from "@/lib/db";
import { decifrar } from "@/lib/crypto-dados";
import { latestPendingEmailSignal, type PendingEmailSignal } from "@/lib/pending-email-admin-contract";
import { mailDeliveryCount, mailDeliveryMatches, mailDeliveryQuery, mailDeliverySearch, mailDeliveryTimestamp, validMailDeliveryActor, MAIL_DELIVERY_FILTER_KEYS, MAIL_DELIVERY_STATES, type MailDeliveryActor, type MailDeliveryOptions, type MailDeliveryFilters, type MailDeliveryFailure, type MailDeliveryRow, type MailDeliveryReadResult, type MailDeliveryExportResult, type MailDeliverySummary, type MailDeliveryState } from "./mail-delivery-admin-contract";

const SOURCE_BYTES = 128 * 1024 * 1024, JSON_BYTES = 16 * 1024 * 1024, EXPORT_BYTES = 64 * 1024 * 1024, DEADLINE_MS = 10_000;
const fail = (error: MailDeliveryFailure["error"]): MailDeliveryFailure => ({ ok: false, error });
const count = (v: unknown) => { const n = mailDeliveryCount(v); if (n === null) throw new Error("invalid_delivery_count"); return n; };
const text = (v: unknown, max: number) => { if (typeof v !== "string" || v.length > max || v.includes("\u0000")) throw new Error("delivery_text_budget"); return v; };
const nullableText = (v: unknown, max: number) => v === null ? "" : text(v, max);
const date = (v: unknown) => v === null || v === "" ? "" : mailDeliveryTimestamp(v);
const checkpoint = (start: number) => { if (performance.now() - start > DEADLINE_MS) throw new Error("delivery_deadline"); };
const iso = (expression: string) => `to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function validMailDeliveryOptions(raw: unknown): raw is MailDeliveryOptions {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["filters", "page", "limit"].includes(k))) return false;
    const o = raw as MailDeliveryOptions;
    if (o.page !== undefined && typeof o.page !== "number" || o.limit !== undefined && typeof o.limit !== "number") return false;
    if (o.filters !== undefined && (!o.filters || typeof o.filters !== "object" || Array.isArray(o.filters) || Object.keys(o.filters).some(k => !MAIL_DELIVERY_FILTER_KEYS.includes(k as typeof MAIL_DELIVERY_FILTER_KEYS[number])) || Object.values(o.filters).some(v => typeof v !== "string"))) return false;
    const parsed = mailDeliverySearch(new URLSearchParams(mailDeliveryQuery(o)));
    return parsed.ok && (o.page === undefined || o.page === parsed.options.page) && (o.limit === undefined || o.limit === parsed.options.limit) && Object.entries(o.filters ?? {}).every(([k, v]) => (parsed.options.filters as Record<string, string>)[k] === v);
  } catch { return false; }
}
async function authorize(c: PoolClient, actor: MailDeliveryActor) {
  if (!(await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), ["edicao", "exclusao", "total"]])).rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function begin(c: PoolClient, actor: MailDeliveryActor) {
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL lock_timeout='1000ms'"); await c.query("SET LOCAL statement_timeout='10000ms'");
  return authorize(c, actor);
}

/** A source row keeps its registration ID even when another registration uses the same address. */
const BASE_CTE = `WITH registrations AS (
 SELECT id,lower(trim(email)) address,jsonb_build_object('id',id,'name',name,'email',email,'category',category,'institution',institution,'role',role,'campus',campus,'university',university,'city',city,'uf',uf,'country',country,'status',status,'created_at',${iso("created_at::timestamptz")},'confirmed_at',${iso("confirmed_at::timestamptz")},'wa_cipher',wa_cipher,'wa_allowed',wa_optin_at IS NOT NULL) registration FROM signatures
), addresses AS (
 SELECT address FROM registrations UNION SELECT lower(trim(to_addr)) FROM mail_log UNION SELECT lower(trim(email)) FROM mail_engagement
 UNION SELECT lower(trim(email)) FROM mail_events UNION SELECT lower(trim(to_addr)) FROM mail_messages UNION SELECT lower(trim(recipient)) FROM mail_message_events
), base AS (
 SELECT id,address,registration FROM registrations
 UNION ALL SELECT NULL::int,a.address,NULL::jsonb FROM addresses a WHERE NOT EXISTS(SELECT 1 FROM registrations r WHERE r.address=a.address)
)`;

/** All kinds are intentional: Entregas includes contacts and notices as well as confirmations. */
const READ_SQL = `${BASE_CTE}, signals AS (
 SELECT lower(trim(to_addr)) address,'accepted' state,ts signal_at,provider,'legacy_log' source,NULL::text adverse_type,''::text reason,kind FROM mail_log WHERE status='sent'
 UNION ALL SELECT lower(trim(email)),v.state,v.signal_at,provider,'legacy_engagement',NULL,'',NULL FROM mail_engagement CROSS JOIN LATERAL(VALUES('delivered',delivered_at),('opened',opened_at),('clicked',clicked_at))v(state,signal_at) WHERE v.signal_at IS NOT NULL
 UNION ALL SELECT lower(trim(email)),'adverse',ts,provider,'legacy_event',type,COALESCE(reason,''),NULL FROM mail_events
 UNION ALL SELECT lower(trim(m.to_addr)),'accepted',a.finished_at,a.provider,'message_attempt',NULL,'',m.kind FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE a.state='accepted' AND a.finished_at IS NOT NULL
 UNION ALL SELECT lower(trim(recipient)),CASE WHEN event_type IN('delivered','opened','clicked') THEN event_type ELSE 'adverse' END,occurred_at,provider,'message_event',CASE WHEN event_type IN('hard_bounce','soft_bounce','blocked','complaint') THEN event_type ELSE NULL END,'',NULL FROM mail_message_events
), selected_signals AS (SELECT * FROM signals WHERE ($1::text IS NULL OR provider=$1)), signal_summary AS (
 SELECT address,${iso("min(signal_at) FILTER(WHERE state='delivered')")} delivered_at,${iso("min(signal_at) FILTER(WHERE state='opened')")} opened_at,${iso("min(signal_at) FILTER(WHERE state='clicked')")} clicked_at,bool_or(source='legacy_engagement') legacy_first FROM selected_signals GROUP BY address
), last_signal AS (
 SELECT DISTINCT ON(address) address,jsonb_build_object('state',state,'at',${iso("signal_at")},'provider',provider,'source',source) signal FROM selected_signals
 ORDER BY address,signal_at DESC,CASE state WHEN 'adverse' THEN 5 WHEN 'clicked' THEN 4 WHEN 'opened' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END DESC,provider DESC,source DESC
), last_accepted AS (
 SELECT DISTINCT ON(address) address,${iso("signal_at")} accepted_at,kind FROM selected_signals WHERE state='accepted'
 ORDER BY address,signal_at DESC,provider DESC,source DESC,kind DESC
), last_adverse AS (
 SELECT DISTINCT ON(address) address,adverse_type,reason,${iso("signal_at")} adverse_at FROM selected_signals WHERE state='adverse'
 ORDER BY address,signal_at DESC,provider DESC,source DESC,adverse_type DESC,reason DESC
), provider_rows AS (
 SELECT lower(trim(to_addr)) address,provider FROM mail_log UNION SELECT lower(trim(email)),provider FROM mail_engagement UNION SELECT lower(trim(email)),provider FROM mail_events
 UNION SELECT lower(trim(m.to_addr)),a.provider FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id UNION SELECT lower(trim(recipient)),provider FROM mail_message_events
), providers AS (SELECT address,array_agg(DISTINCT provider ORDER BY provider) providers FROM provider_rows GROUP BY address), log_counts AS (
 SELECT lower(trim(to_addr)) address,count(*)::text n FROM mail_log WHERE status='sent' AND ($1::text IS NULL OR provider=$1) GROUP BY 1
), journal_counts AS (
 SELECT lower(trim(m.to_addr)) address,count(*)::text n FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE a.state='accepted' AND a.finished_at IS NOT NULL AND ($1::text IS NULL OR a.provider=$1) GROUP BY 1
)
SELECT b.*,s.delivered_at,s.opened_at,s.clicked_at,COALESCE(s.legacy_first,false) legacy_first,l.signal,a.accepted_at,a.kind last_kind,d.adverse_type,d.reason adverse_reason,d.adverse_at,COALESCE(p.providers,'{}') providers,COALESCE(lc.n,'0') accepted_logs,COALESCE(jc.n,'0') accepted_attempts
FROM base b LEFT JOIN signal_summary s USING(address) LEFT JOIN last_signal l USING(address) LEFT JOIN last_accepted a USING(address) LEFT JOIN last_adverse d USING(address) LEFT JOIN providers p USING(address) LEFT JOIN log_counts lc USING(address) LEFT JOIN journal_counts jc USING(address)
ORDER BY a.accepted_at DESC NULLS LAST,b.address COLLATE "C",b.id DESC NULLS LAST`;

/** Source budgets inspect metadata only, never archived content/payload or a credential. */
async function preflight(c: PoolClient, start: number): Promise<number> {
  // Metadata-only conservative JSON bound: each text byte expands to at most six ASCII bytes (\\uXXXX), plus fixed keys/identifiers/timestamps.
  const base = (await c.query(`WITH registrations AS (
    SELECT id,lower(trim(email)) address,(1024+6*(COALESCE(octet_length(name),0)+COALESCE(octet_length(email),0)+COALESCE(octet_length(category),0)+COALESCE(octet_length(institution),0)+COALESCE(octet_length(role),0)+COALESCE(octet_length(campus),0)+COALESCE(octet_length(university),0)+COALESCE(octet_length(city),0)+COALESCE(octet_length(uf),0)+COALESCE(octet_length(country),0)+COALESCE(octet_length(status),0)+COALESCE(octet_length(created_at),0)+COALESCE(octet_length(confirmed_at),0)+COALESCE(octet_length(wa_cipher),0)))::bigint bytes FROM signatures
  ), addresses AS (
    SELECT address FROM registrations UNION SELECT lower(trim(to_addr)) FROM mail_log UNION SELECT lower(trim(email)) FROM mail_engagement
    UNION SELECT lower(trim(email)) FROM mail_events UNION SELECT lower(trim(to_addr)) FROM mail_messages UNION SELECT lower(trim(recipient)) FROM mail_message_events
  ), base AS (
    SELECT bytes FROM registrations UNION ALL SELECT (1024+6*octet_length(a.address))::bigint FROM addresses a WHERE NOT EXISTS(SELECT 1 FROM registrations r WHERE r.address=a.address)
  ) SELECT count(*)::text total,COALESCE(sum(bytes),0)::text bytes FROM base`)).rows[0];
  if (count(base.bytes) > SOURCE_BYTES) throw new Error("delivery_source_budget"); checkpoint(start);
  const history = (await c.query(`SELECT COALESCE(sum(n),0)::text bytes FROM (
    SELECT sum(128+octet_length(provider)+octet_length(to_addr)+octet_length(kind)) n FROM mail_log
    UNION ALL SELECT sum(128+octet_length(provider)+octet_length(email)) FROM mail_engagement
    UNION ALL SELECT sum(128+octet_length(provider)+octet_length(email)+COALESCE(octet_length(reason),0)) FROM mail_events
    UNION ALL SELECT sum(128+octet_length(to_addr)+octet_length(kind)) FROM mail_messages
    UNION ALL SELECT sum(128+octet_length(provider)) FROM mail_message_attempts
    UNION ALL SELECT sum(128+octet_length(provider)+octet_length(recipient)) FROM mail_message_events
  ) b`)).rows[0];
  if (count(base.bytes) + count(history.bytes) > SOURCE_BYTES) throw new Error("delivery_history_budget"); checkpoint(start);
  return count(base.total);
}
const STATE: Record<NonNullable<PendingEmailSignal>["state"], MailDeliveryState> = { accepted: "aceito", delivered: "entregue", opened: "abriu", clicked: "clicou", adverse: "devolvido" };
function registrationId(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647; }
function project(raw: Record<string, any>, provider: string | undefined): MailDeliveryRow {
  const address = text(raw.address, 254); if (!address) throw new Error("invalid_delivery_address");
  const r = raw.registration;
  if (r !== null && (!r || typeof r !== "object" || Array.isArray(r) || !registrationId(raw.id) || r.id !== raw.id || !["servidor", "apoiador", "estrangeiro"].includes(r.category) || !["pending", "confirmed"].includes(r.status))) throw new Error("invalid_delivery_registration");
  if (!Array.isArray(raw.providers) || typeof raw.legacy_first !== "boolean") throw new Error("invalid_delivery_provider");
  const providers = raw.providers.map((v: unknown) => text(v, 100)); if (new Set(providers).size !== providers.length) throw new Error("duplicate_delivery_provider");
  const last = raw.signal === null ? null : latestPendingEmailSignal([raw.signal as PendingEmailSignal]);
  let contactState: MailDeliveryRow["evidence"]["contactState"] = "absent", phone = "";
  if (r?.wa_cipher) {
    if (r.wa_allowed !== true) contactState = "withheld_no_opt_in";
    else {
      contactState = "unavailable";
      try { const value = decifrar(text(r.wa_cipher, 4096), `wa:${r.id}`); if (typeof value === "string" && value.trim() && value.length <= 64) { phone = value; contactState = "available"; } } catch { /* Expose availability only; never ciphertext or secret errors. */ }
    }
  }
  const logs = count(raw.accepted_logs), attempts = count(raw.accepted_attempts);
  const adverseType = raw.adverse_type === null ? "" : text(raw.adverse_type, 100);
  if (adverseType && !["hard_bounce", "soft_bounce", "blocked", "complaint"].includes(adverseType)) throw new Error("invalid_delivery_adverse_type");
  const value = (key: string) => r === null ? "" : nullableText(r[key], 512);
  const row: MailDeliveryRow = {
    recordKey: r === null ? `unregistered:${address}` : `registration:${r.id}`, rowKind: r === null ? "unregistered_address" : "registration", cadastroId: r?.id ?? null,
    email: address, nome: value("name"), categoria: value("category"), instituicao: value("institution"), cargo: value("role"), campus: value("campus"), universidade: value("university"), cidadeUf: [value("city"), value("uf")].filter(Boolean).join("/"), pais: value("country"),
    cadastro: r === null ? "" : r.status === "pending" ? "aguardando" : "confirmado", cadastradoEm: r === null ? "" : date(r.created_at), confirmadoEm: r === null ? "" : date(r.confirmed_at), whatsapp: phone,
    envios: logs, ultimoEnvio: date(raw.accepted_at), ultimoTipo: nullableText(raw.last_kind, 100), provedores: text((provider === undefined ? providers : providers.includes(provider) ? [provider] : []).join(", "), 16384), situacao: last === null ? "sem_registro" : STATE[last.state],
    entregueEm: date(raw.delivered_at), abertoEm: date(raw.opened_at), clicouEm: date(raw.clicked_at), devolucao: adverseType, devolucaoMotivo: nullableText(raw.adverse_reason, 16384), devolucaoEm: date(raw.adverse_at),
    evidence: { scope: last !== null || providers.length > 0 ? "address_aggregate" : "none", registrationLink: r === null ? "none" : "email_only", messageKinds: "all", providerScope: provider ?? null, providersAll: providers, lastSignal: last, relationToCurrentConfirmation: "not_proven", timestamps: "earliest_recorded_history", legacyEngagementFirstOnly: raw.legacy_first, acceptedLogRecords: logs, acceptedJournalAttempts: attempts, sendCountMeaning: "legacy_accepted_log_records_not_unique_messages", contactState },
  };
  if (row.cidadeUf.length > 512) throw new Error("invalid_delivery_registration_projection");
  return row;
}
function summarize(rows: readonly MailDeliveryRow[]): MailDeliverySummary {
  const s: MailDeliverySummary = { total: rows.length, registrations: 0, pending: 0, confirmed: 0, unregisteredAddresses: 0, byState: Object.fromEntries(MAIL_DELIVERY_STATES.map(state => [state, 0])) as Record<MailDeliveryState, number> };
  for (const r of rows) { s.byState[r.situacao]++; if (r.rowKind === "unregistered_address") s.unregisteredAddresses++; else { s.registrations++; if (r.cadastro === "aguardando") s.pending++; else s.confirmed++; } }
  if (s.registrations !== s.pending + s.confirmed || s.total !== s.registrations + s.unregisteredAddresses || Object.values(s.byState).reduce((a, b) => a + b, 0) !== s.total) throw new Error("incomplete_delivery_summary");
  return s;
}
async function readSource(c: PoolClient, start: number, provider: string | undefined) {
  const expected = await preflight(c, start), raw = (await c.query(READ_SQL, [provider ?? null])).rows; checkpoint(start);
  if (raw.length !== expected || Buffer.byteLength(JSON.stringify(raw), "utf8") > SOURCE_BYTES) throw new Error("incomplete_delivery_source");
  const rows = raw.map(r => { checkpoint(start); return project(r, provider); });
  if (new Set(rows.map(r => r.recordKey)).size !== expected) throw new Error("duplicate_delivery_record"); checkpoint(start);
  const stamp = (await c.query("SELECT transaction_timestamp() stamp")).rows[0].stamp; checkpoint(start);
  return { rows, total: expected, asOf: mailDeliveryTimestamp(stamp) };
}

export async function readMailDeliveryPage(actor: MailDeliveryActor, options: MailDeliveryOptions = {}): Promise<MailDeliveryReadResult | MailDeliveryFailure> {
  if (!validMailDeliveryActor(actor)) return fail("forbidden"); if (!validMailDeliveryOptions(options)) return fail("invalid");
  try { return await tx(async c => {
    const start = performance.now(); if (!await begin(c, actor)) return fail("forbidden"); checkpoint(start);
    const source = await readSource(c, start, options.filters?.provedor), matches = source.rows.filter(row => mailDeliveryMatches(row, options.filters)), page = options.page ?? 1, limit = options.limit ?? 50, offset = (page - 1) * limit;
    const inventory = summarize(source.rows), rows = matches.slice(offset, offset + limit);
    const result: MailDeliveryReadResult = { ok: true, asOf: source.asOf, unit: "registration_or_unregistered_address", total: matches.length, pagina: page, limite: limit, linhas: rows, inventory: { records: source.total, registrations: inventory.registrations, pending: inventory.pending, confirmed: inventory.confirmed, unregisteredAddresses: inventory.unregisteredAddresses }, summary: summarize(matches), providerScope: options.filters?.provedor ?? null, coverage: { inventoryRecords: source.total, matched: matches.length, totalRowsReturned: rows.length, complete: true, signalsComplete: true } };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > JSON_BYTES) throw new Error("delivery_json_budget"); checkpoint(start);
    if (!await authorize(c, actor)) return fail("forbidden"); checkpoint(start); return result;
  }); } catch { return fail("unavailable"); }
}
export async function readMailDeliveryExport(actor: MailDeliveryActor, options: { filters?: MailDeliveryFilters } = {}): Promise<MailDeliveryExportResult | MailDeliveryFailure> {
  if (!validMailDeliveryActor(actor)) return fail("forbidden");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => k !== "filters") || !validMailDeliveryOptions(options)) return fail("invalid");
  try { return await tx(async c => {
    const start = performance.now(); if (!await begin(c, actor)) return fail("forbidden"); checkpoint(start);
    const source = await readSource(c, start, options.filters?.provedor), rows = source.rows.filter(row => mailDeliveryMatches(row, options.filters));
    if (rows.some(r => r.evidence.contactState === "unavailable")) throw new Error("delivery_export_contact_unavailable");
    const result: MailDeliveryExportResult = { ok: true, asOf: source.asOf, unit: "registration_or_unregistered_address", rows, total: rows.length, providerScope: options.filters?.provedor ?? null };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > EXPORT_BYTES) throw new Error("delivery_export_budget"); checkpoint(start);
    if (!await authorize(c, actor)) return fail("forbidden"); checkpoint(start); return result;
  }); } catch { return fail("unavailable"); }
}
export async function auditMailDeliveryExport(actor: MailDeliveryActor, data: { rows: number; bytes: number; sha256: string; asOf: string }): Promise<boolean> {
  if (!validMailDeliveryActor(actor) || !data || typeof data !== "object" || Object.keys(data).sort().join(",") !== "asOf,bytes,rows,sha256" || typeof data.rows !== "number" || typeof data.bytes !== "number" || mailDeliveryCount(data.rows) === null || mailDeliveryCount(data.bytes) === null || !/^[a-f0-9]{64}$/.test(data.sha256)) return false;
  try { mailDeliveryTimestamp(data.asOf); return await tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'"); await c.query("SET LOCAL statement_timeout='5000ms'");
    if (!await authorize(c, actor)) return false;
    await audit("export_entregas", null, { ...data, actorId: actor.userId, sessionId: actor.sessaoId, unit: "registration_or_unregistered_address", scope: "address_history_not_current_confirmation", meaning: "file_prepared_not_delivery" }, c);
    if (!await authorize(c, actor)) throw new Error("delivery_export_authorization_changed"); return true;
  }); } catch { return false; }
}
