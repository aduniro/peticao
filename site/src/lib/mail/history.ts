import { tx } from "../db";
import { validMessageId } from "./archive-codec";

const STATES = ["prepared", "sending", "accepted", "rejected", "indeterminate", "queued"];
const CHANNELS = ["transactional", "marketing"];
const MAX_LEGACY_ID = 2_147_483_647;
const isoSql = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const validKey = (key: unknown): key is string => typeof key === "string" && (
  key.startsWith("message:") && validMessageId(key.slice(8)) || /^legacy:[1-9]\d{0,9}$/.test(key) && Number(key.slice(7)) <= MAX_LEGACY_ID
);
type Cursor = { at: string; key: string };
function decodeCursor(raw: unknown): Cursor | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || !validKey(parsed.key) || typeof parsed.at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(parsed.at)) return null;
    const date = new Date(parsed.at);
    if (parsed.at.startsWith("0000") || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== parsed.at.slice(0, 19)) return null;
    return { at: parsed.at, key: parsed.key };
  } catch { return null; }
}
const encodeCursor = (row: { created_at: string; record_key: string }) => Buffer.from(JSON.stringify({ at: row.created_at, key: row.record_key })).toString("base64url");
export type HistoryOptions = { before?: string; limit?: number; recipient?: string; kind?: string; channel?: string; status?: string };
export type MailHistoryRow = {
  record_key: string; source: "message" | "legacy_attempt"; created_at: string; kind: string; channel: string;
  to_addr: string; status: string; content_state: string; previous_id: string | null;
};
/** Metadata only. Unlinked old logs remain individual attempts, never invented messages or deliveries. */
export async function mailHistory(options: HistoryOptions = {}) {
  const limit = options.limit ?? 30, cursor = decodeCursor(options.before);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor === null ||
    options.recipient !== undefined && (typeof options.recipient !== "string" || !options.recipient || options.recipient.length > 254 || /[\r\n\0]/.test(options.recipient)) ||
    options.kind !== undefined && (typeof options.kind !== "string" || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(options.kind)) ||
    options.channel !== undefined && !CHANNELS.includes(options.channel) || options.status !== undefined && !STATES.includes(options.status)) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout='2000ms'");
    const rows = (await client.query<MailHistoryRow>(`WITH records AS (
      SELECT 'message:'||id::text record_key,'message'::text source,created_at,kind,channel,to_addr,status,
        CASE WHEN content_state='stored' AND content_expires_at<=clock_timestamp() THEN 'expired' ELSE content_state END content_state,previous_id::text
      FROM mail_messages
      UNION ALL
      SELECT 'legacy:'||id::text,'legacy_attempt',ts,kind,channel,to_addr,
        CASE status WHEN 'sent' THEN 'accepted' WHEN 'queued' THEN 'queued' ELSE 'indeterminate' END,'unavailable',NULL
      FROM mail_log WHERE message_id IS NULL
    ) SELECT record_key,source,${isoSql("created_at")} created_at,kind,channel,to_addr,status,content_state,previous_id FROM records
    WHERE ($1::timestamptz IS NULL OR (created_at,record_key COLLATE "C")<($1::timestamptz,$2::text COLLATE "C"))
      AND ($3::text IS NULL OR lower(to_addr)=$3) AND ($4::text IS NULL OR kind=$4)
      AND ($5::text IS NULL OR channel=$5) AND ($6::text IS NULL OR status=$6)
    ORDER BY records.created_at DESC,record_key COLLATE "C" DESC LIMIT $7`,
    [cursor?.at ?? null, cursor?.key ?? null, options.recipient?.toLowerCase() ?? null, options.kind ?? null, options.channel ?? null, options.status ?? null, limit + 1])).rows;
    const items = rows.slice(0, limit);
    return { ok: true as const, records: items, next: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
  });
}
/** Bounded detail; no content decrypt, queue payload, request hash, fingerprint or free-form provider error. */
export async function mailHistoryDetail(key: unknown) {
  if (!validKey(key)) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout='2000ms'");
    if (key.startsWith("legacy:")) {
      const row = (await client.query(`SELECT id,${isoSql("ts")} created_at,kind,channel,to_addr,provider,from_addr,status
        FROM mail_log WHERE id=$1 AND message_id IS NULL`, [Number(key.slice(7))])).rows[0];
      return row ? { ok: true as const, source: "legacy_attempt" as const, record: row, content_state: "unavailable", attempts: [], attempts_truncated: false } : { ok: false as const, error: "not_found" };
    }
    const id = key.slice(8);
    const row = (await client.query(`SELECT id,${isoSql("created_at")} created_at,kind,channel,to_addr,status,previous_id,
      CASE WHEN content_state='stored' AND content_expires_at<=clock_timestamp() THEN 'expired' ELSE content_state END content_state
      FROM mail_messages WHERE id=$1`, [id])).rows[0];
    if (!row) return { ok: false as const, error: "not_found" };
    const attempts = (await client.query(`SELECT id,provider,from_addr,state,${isoSql("started_at")} started_at,
      ${isoSql("finished_at")} finished_at,provider_id,error_code FROM mail_message_attempts
      WHERE message_id=$1 ORDER BY started_at DESC,id DESC LIMIT 101`, [id])).rows;
    const events=(await client.query(`SELECT id,provider,event_type,${isoSql("occurred_at")} occurred_at,${isoSql("received_at")} received_at,attempt_id
      FROM mail_message_events WHERE message_id=$1 AND association_state='linked' ORDER BY occurred_at DESC,id DESC LIMIT 101`,[id])).rows;
    return { ok: true as const, source: "message" as const, record: row, attempts: attempts.slice(0, 100), attempts_truncated: attempts.length > 100, events:events.slice(0,100),events_truncated:events.length>100 };
  });
}
