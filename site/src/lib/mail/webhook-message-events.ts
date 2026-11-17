import { eventTimestamp, type MessageEvent } from "./message-events";
import { validAccountScope } from "./event-scope";
import { providerId } from "./receipt";

const TYPES = new Map([
  ["delivered","delivered"], ["opened","opened"], ["unique_opened","opened"], ["opened_unique","opened"],
  ["click","clicked"], ["clicks","clicked"], ["clicked","clicked"], ["clicked_unique","clicked"],
  ["hard_bounce","hard_bounce"], ["hard_bounced","hard_bounce"], ["soft_bounce","soft_bounce"], ["soft_bounced","soft_bounce"],
  ["blocked","blocked"], ["spam","complaint"], ["spam_complaint","complaint"], ["spam_complaints","complaint"], ["spam_by_user","complaint"],
]);
/** Numeric webhook times are documented UTC seconds; an absent/invalid time is never replaced by the poll clock. */
function seconds(raw: unknown) {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > 253402300799) return undefined;
  return new Date(raw * 1000).toISOString();
}
const email = (raw: unknown) => typeof raw === "string" && raw.length <= 254 && /^[^\s@<>]+@[^\s@<>]+$/.test(raw.trim()) ? raw.trim().toLowerCase() : undefined;
/** Called only after request authentication. The trusted scope is server configuration, never a payload property. */
export function webhookMessageEvents(provider: string, payload: unknown, scope: string | undefined): MessageEvent[] {
  if (!validAccountScope(scope) || !payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const b = payload as Record<string, any>;
  let type: string | undefined, id: unknown, to: unknown, at: unknown;
  if (provider === "brevo") {
    type = typeof b.event === "string" ? TYPES.get(b.event) : undefined;
    id = b["message-id"]; to = b.email; at = seconds(b.ts_event);
  } else if (provider === "mailersend") {
    type = typeof b.type === "string" && b.type.startsWith("activity.") ? TYPES.get(b.type.slice(9)) : undefined;
    // Version 2: email_id and activity id are not the send API's message_id.
    id = b.data?.message_id; to = b.data?.recipient; at = b.created_at;
  } else if (provider === "sendpulse") {
    type = typeof b.event === "string" ? TYPES.get(b.event) : undefined;
    id = Number.isSafeInteger(b.message_id) && b.message_id > 0 ? String(b.message_id) : b.message_id;
    to = b.recipient; at = seconds(b.timestamp);
  } else return [];
  const messageId = providerId(id), recipient = email(to), timestamp = eventTimestamp(at);
  return type && messageId && recipient && timestamp ? [{ provider, accountScope: scope, providerId: messageId, recipient, type, timestamp, source: "webhook" }] : [];
}
