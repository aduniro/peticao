import type { PoolClient } from "pg";

export type OutboundEvidence = {
  messages: { id: string; kind: string; status: string; created_at: string }[];
  attempts: { id: string; message_id: string; provider: string; state: string; started_at: string; finished_at: string | null }[];
  events: { id: string; message_id: string; attempt_id: string; provider: string; type: string; ts: string }[];
};
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

/** Metadata only, on the caller's read snapshot. Address correlation does not identify an active confirmation token. */
export async function collectOutbound(client: PoolClient, email: string) {
  const truncated: string[] = [];
  const messages = (await client.query(`SELECT id,kind,status,created_at FROM mail_messages
    WHERE lower(to_addr)=$1 AND channel='transactional' AND kind IN ('confirmacao','reenvio')
      AND created_at>=now()-interval '14 days' AND created_at<=now()
    ORDER BY created_at DESC,id DESC LIMIT 21`, [email])).rows;
  if (messages.length > 20) truncated.push("outbound_messages");
  const kept = messages.slice(0, 20), ids = kept.map(m => m.id);
  const attempts = ids.length ? (await client.query(`SELECT id,message_id,provider,state,started_at,finished_at
    FROM mail_message_attempts WHERE message_id=ANY($1::uuid[])
    ORDER BY started_at DESC,id DESC LIMIT 201`, [ids])).rows : [];
  if (attempts.length > 200) truncated.push("outbound_attempts");
  // Recheck all association dimensions: a matching address alone is never message-level evidence.
  const events = ids.length ? (await client.query(`SELECT e.id::text,e.message_id,e.attempt_id,e.provider,e.event_type type,e.occurred_at ts
    FROM mail_message_events e JOIN mail_message_attempts a ON a.id=e.attempt_id AND a.message_id=e.message_id
    JOIN mail_messages m ON m.id=e.message_id
    WHERE e.message_id=ANY($1::uuid[]) AND e.association_state='linked'
      AND a.state IN ('accepted','indeterminate') AND a.finished_at IS NOT NULL
      AND a.provider=e.provider AND a.account_scope=e.account_scope AND a.provider_id=e.provider_id
      AND e.recipient=lower(m.to_addr)
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT 101`, [ids])).rows : [];
  if (events.length > 100) truncated.push("outbound_events");
  const evidence: OutboundEvidence = {
    messages: kept.map(m => ({ ...m, created_at: iso(m.created_at) })),
    attempts: attempts.slice(0, 200).map(a => ({ ...a, started_at: iso(a.started_at), finished_at: a.finished_at ? iso(a.finished_at) : null })),
    events: events.slice(0, 100).map(e => ({ ...e, ts: iso(e.ts) })),
  };
  return { evidence, truncated };
}

/** Internal diagnostic codes only; none authorizes a resend or resolves the contact. */
export function outboundReasons(outbound: OutboundEvidence | undefined, snapshotAt: string) {
  if (!outbound) return [];
  const reasons = new Set<string>();
  const at = Date.parse(snapshotAt);
  if (outbound.attempts.some(a => a.state === "accepted" && a.finished_at)) reasons.add("provider_accepted_not_delivery_proof");
  if (outbound.attempts.some(a => ["prepared", "indeterminate"].includes(a.state)) || outbound.messages.some(m => ["prepared", "sending", "indeterminate"].includes(m.status))) reasons.add("message_attempt_unresolved");
  if (outbound.attempts.some(a => a.state === "rejected")) reasons.add("send_failure_recorded");
  const validEvents = outbound.events.filter(e => {
    const attempt = outbound.attempts.find(a => a.id === e.attempt_id && a.message_id === e.message_id && a.provider === e.provider);
    const time = Date.parse(e.ts);
    const started = attempt ? Date.parse(attempt.started_at) : NaN;
    if (!attempt || !Number.isFinite(at) || !Number.isFinite(time) || !Number.isFinite(started) || time > at || time < started) {
      reasons.add("message_event_timing_or_context_inconsistent");
      return false;
    }
    return true;
  });
  for (const e of validEvents) {
    if (e.type === "delivered") reasons.add("message_delivery_recorded_not_signature_confirmation");
    if (e.type === "opened") reasons.add("message_open_recorded_not_identity_proof");
    if (e.type === "clicked") reasons.add("message_click_recorded_not_identity_proof");
    if (["hard_bounce", "blocked", "complaint"].includes(e.type)) reasons.add("message_failure_recorded");
    if (e.type === "soft_bounce") reasons.add("message_transient_failure_recorded");
  }
  if (validEvents.some(e => e.type === "delivered" && validEvents.some(other => other.message_id === e.message_id && ["hard_bounce", "blocked", "complaint"].includes(other.type)))) reasons.add("message_delivery_conflict_requires_review");
  return [...reasons];
}
