import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { hmac } from "../security";
import { providerId } from "./receipt";
import { validAccountScope } from "./event-scope";
const TYPES = new Set(["delivered", "opened", "clicked", "hard_bounce", "soft_bounce", "blocked", "complaint"]);
const PROVIDERS = new Set(["ses", "brevo", "mailersend", "sendpulse", "mailrelay", "mailrelaypresidente"]);
export type MessageEvent = { provider: string; accountScope?: string; providerId?: string; recipient: string; type: string; timestamp: string; source: "api" | "sns" | "webhook" };
export function eventTimestamp(raw: unknown) {
  if (typeof raw !== "string" || raw.startsWith("0000")) return undefined;
  const match = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,6}))?(?:Z|[+-]\d\d:\d\d)$/.exec(raw); if (!match) return undefined;
  const literal = new Date(raw.slice(0, 19) + "Z"), utc = new Date(raw);
  if (!Number.isFinite(literal.getTime()) || literal.toISOString().slice(0, 19) !== raw.slice(0, 19) || !Number.isFinite(utc.getTime()) || utc.toISOString().length !== 24) return undefined;
  return utc.toISOString().slice(0, 19) + "." + (match[1] ?? "").padEnd(6, "0") + "Z";
}
const email = (raw: unknown) => typeof raw === "string" && raw.length <= 254 && /^[^\s@<>]+@[^\s@<>]+$/.test(raw.trim()) ? raw.trim().toLowerCase() : undefined;
export async function lockEventLinks(client: PoolClient) {
  await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('mail-event-link'))");
}
/** Caller holds the shared event lock before locking a message/attempt. No signature state is changed. */
export async function reconcileReceiptEvents(client: PoolClient, provider: string, scope: string, id: string, recipient: string) {
  const matches = (await client.query<{id:string;message_id:string}>(`SELECT a.id,a.message_id FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id
    WHERE a.provider=$1 AND a.account_scope=$2 AND a.provider_id=$3 AND lower(m.to_addr)=$4
      AND a.state IN ('accepted','indeterminate') AND a.finished_at IS NOT NULL ORDER BY a.id LIMIT 2`, [provider,scope,id,recipient])).rows;
  const state = matches.length === 1 ? "linked" : matches.length > 1 ? "ambiguous" : "unlinked";
  const messageId = state === "linked" ? matches[0].message_id : null, attemptId = state === "linked" ? matches[0].id : null;
  const changed = (await client.query<{n:number}>(`WITH changed AS (
    UPDATE mail_message_events SET association_state=$5,message_id=$6,attempt_id=$7
      WHERE provider=$1 AND account_scope=$2 AND provider_id=$3 AND recipient=$4
      AND (association_state IS DISTINCT FROM $5 OR message_id IS DISTINCT FROM $6::uuid OR attempt_id IS DISTINCT FROM $7::uuid) RETURNING id)
    SELECT count(*)::int n FROM changed`, [provider,scope,id,recipient,state,messageId,attemptId])).rows[0].n;
  if (changed) await audit("mail_message_events_reconciled",null,{identity:hmac("mail-event-link-v1:"+JSON.stringify([provider,scope,id,recipient])),changed,state,messageId,attemptId},client);
  return changed;
}
/** Only authenticated adapters call this. Payloads never choose an administrative actor or scope. */
export async function recordMessageEvents(events: MessageEvent[]) {
  if (!Array.isArray(events) || events.length > 100) throw new Error("mail_event_parameters");
  if (!events.length) return { inserted:0,changed:0,skipped:0 };
  return tx(async client => {
    await lockEventLinks(client); const inserted: string[] = []; let changed=0,skipped=0;
    for (const event of events) {
      if(!event || typeof event!=="object"){skipped++;continue;}
      const recipient=email(event.recipient), id=providerId(event.providerId), timestamp=eventTimestamp(event.timestamp);
      if (!recipient || !id || !timestamp || !validAccountScope(event.accountScope) || !PROVIDERS.has(event.provider) || !TYPES.has(event.type) || !["api","sns","webhook"].includes(event.source)) { skipped++; continue; }
      const fingerprint=hmac("mail-event-v1:"+JSON.stringify([event.provider,event.accountScope,id,recipient,event.type,timestamp]));
      const row=(await client.query<{id:string}>(`INSERT INTO mail_message_events(fingerprint,provider,account_scope,provider_id,recipient,event_type,occurred_at,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,[fingerprint,event.provider,event.accountScope,id,recipient,event.type,timestamp,event.source])).rows[0];
      if(row)inserted.push(row.id);
      changed+=await reconcileReceiptEvents(client,event.provider,event.accountScope,id,recipient);
    }
    if(inserted.length)await audit("mail_message_events_received",null,{eventIds:inserted,by:"authenticated-provider"},client);
    return {inserted:inserted.length,changed,skipped};
  });
}
