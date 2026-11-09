import { credentialScope, mailrelayScope } from "./event-scope";
import { eventTimestamp, recordMessageEvents, type MessageEvent } from "./message-events";
import { providerId } from "./receipt";

export type EventPage<T> = (legacy: T[], events: MessageEvent[]) => Promise<void>;
const recipient = (value: unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+$/.test(value.trim()) ? value.trim().toLowerCase() : undefined;
function fact(provider: string, scope: string | undefined, id: unknown, to: unknown, type: string, at: unknown): MessageEvent[] {
  const messageId = providerId(id), email = recipient(to), timestamp = eventTimestamp(at);
  return scope && messageId && email && timestamp ? [{ provider, accountScope: scope, providerId: messageId, recipient: email, type, timestamp, source: "api" }] : [];
}

/** The event type comes from the authenticated API's filter, never from an administrative request. */
export function brevoApiEvents(rows: any[], key: string, type: string): MessageEvent[] {
  const scope = credentialScope("brevo", key);
  return rows.flatMap(e => fact("brevo", scope, e?.messageId, e?.email, type, e?.date));
}
const MS_TYPES: Record<string, string> = { delivered: "delivered", opened: "opened", clicked: "clicked", hard_bounced: "hard_bounce", soft_bounced: "soft_bounce", spam_complaint: "complaint", spam_complaints: "complaint" };
/** Activity IDs are not message IDs. Missing message_id or timezone leaves the event uncorrelated. */
export function mailersendApiEvents(rows: any[], key: string): MessageEvent[] {
  const scope = credentialScope("mailersend", key);
  return rows.flatMap(e => {
    const type = MS_TYPES[e?.type];
    return type ? fact("mailersend", scope, e?.email?.message_id, e?.email?.recipient?.email, type, e?.created_at) : [];
  });
}
/** The numeric SMTP record ID matches the send receipt. RFC Message-ID/processed_at are different facts. */
export function mailrelayApiEvents(rows: any[], key: string, host: string, provider: string): MessageEvent[] {
  if (!["mailrelay", "mailrelaypresidente"].includes(provider)) return [];
  const scope = mailrelayScope(provider, host, key);
  return rows.flatMap(e => {
    if (!Number.isSafeInteger(e?.id) || e.id < 1) return [];
    return ([["delivered", e.delivered_at], ["hard_bounce", e.bounced_at], ["soft_bounce", e.soft_bounced_at]] as const)
      .flatMap(([type, at]) => fact(provider, scope, String(e.id), e.email, type, at));
  });
}
/** Keep each transaction bounded; a failed page is retried by the existing poller without losing previous pages. */
export async function recordApiEvents(events: MessageEvent[]) {
  for (let start = 0; start < events.length; start += 100) await recordMessageEvents(events.slice(start, start + 100));
}
