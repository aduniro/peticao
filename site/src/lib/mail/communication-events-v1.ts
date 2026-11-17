import { createHash } from "node:crypto";

// Pure normalization. Authentication and registry loading belong to the existing ingress.
const providers = new Set(["ses", "sendpulse", "mailersend", "brevo", "mailrelay", "mailrelaypresidente"]);
const kinds = new Set(["delivered", "opened", "clicked", "hard_bounce", "soft_bounce", "complaint", "unsubscribe"]);
const ref = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const messageId = /^[A-Za-z0-9_.@+<>=:/-]{1,200}$/;
const digest = /^[a-f0-9]{64}$/;
const brand = Symbol("authenticated communication account");
const bindings = new WeakSet<object>();

export class CommunicationContractError extends Error {
  constructor(code: string) { super(code); this.name = "CommunicationContractError"; }
}

function text(value: unknown, pattern: RegExp, code: string): string {
  if (typeof value !== "string" || value.includes("\n") || value.includes("\r") || !pattern.test(value)) {
    throw new CommunicationContractError(code);
  }
  return value;
}

function member(value: unknown, options: Set<string>, code: string): string {
  if (typeof value !== "string" || !options.has(value)) throw new CommunicationContractError(code);
  return value;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)]));
  }
  return value;
}

function fingerprint(domain: string, value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sorted([domain, value]))).digest("hex");
}

export interface AccountRegistryEntry {
  provider: string;
  authenticated_scope: string;
  account_id: string;
  unsubscribe_scope?: "all" | "marketing";
}

export interface WebhookAuthentication { status: 200 | 401 | 503; scope?: string }
export interface CommunicationAccountBinding {
  readonly provider: string;
  readonly account_id: string;
  readonly legacy_account_scope: string;
  readonly unsubscribe_scope?: "all" | "marketing";
  readonly [brand]: true;
}

export type CommunicationBindingResult =
  | { status: 401 | 503; mode: "rejected"; binding: null }
  | { status: 200; mode: "legacy"; binding: null }
  | { status: 200; mode: "bound"; binding: CommunicationAccountBinding };

// Only pass the actual authenticateWebhook result and a server-owned registry.
// This function does not authenticate arbitrary caller data or read configuration.
export function bindCommunicationAccount(provider: string, auth: WebhookAuthentication, registry?: readonly AccountRegistryEntry[]): CommunicationBindingResult {
  if (auth.status === 401 || auth.status === 503) return { status: auth.status, mode: "rejected", binding: null };
  if (auth.status !== 200 || !providers.has(provider)) return { status: 503, mode: "rejected", binding: null };
  if (auth.scope === undefined || registry === undefined) return { status: 200, mode: "legacy", binding: null };
  try {
    text(auth.scope, digest, "invalid_authenticated_scope");
    if (!Array.isArray(registry)) throw new CommunicationContractError("invalid_account_registry");
    for (const row of registry) {
      if (!row || typeof row !== "object") throw new CommunicationContractError("invalid_account_registry");
      member(row.provider, providers, "invalid_provider");
      text(row.authenticated_scope, digest, "invalid_registry_scope");
      text(row.account_id, ref, "invalid_account_id");
      if (row.unsubscribe_scope !== undefined && row.unsubscribe_scope !== "all" && row.unsubscribe_scope !== "marketing") throw new CommunicationContractError("invalid_unsubscribe_scope");
    }
    const matches = registry.filter(row => row.provider === provider && row.authenticated_scope === auth.scope);
    if (matches.length !== 1) throw new CommunicationContractError("account_binding_not_unique");
    const row = matches[0];
    const binding: CommunicationAccountBinding = Object.freeze({ provider, account_id: row.account_id, legacy_account_scope: auth.scope, unsubscribe_scope: row.unsubscribe_scope, [brand]: true as const });
    bindings.add(binding);
    return { status: 200, mode: "bound", binding };
  } catch {
    return { status: 503, mode: "rejected", binding: null };
  }
}

export function canonicalCommunicationTime(raw: unknown): string {
  if (typeof raw !== "string") throw new CommunicationContractError("invalid_event_time");
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (!m || m[0] !== raw) throw new CommunicationContractError("invalid_event_time");
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (year < 1 || local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) throw new CommunicationContractError("invalid_event_time");
  const zone = m[8];
  let offset = 0;
  if (zone !== "Z") {
    const h = Number(zone.slice(1, 3)), min = Number(zone.slice(4));
    if (h > 23 || min > 59) throw new CommunicationContractError("invalid_event_time");
    offset = (zone[0] === "+" ? 1 : -1) * (h * 60 + min) * 60000;
  }
  const utc = new Date(local.getTime() - offset);
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) throw new CommunicationContractError("invalid_event_time");
  return utc.toISOString().slice(0, 19) + "." + (m[7] ?? "").padEnd(6, "0") + "Z";
}

export interface CanonicalCommunicationEvent {
  schema_version: 1;
  provider: string;
  account_id: string;
  event_id: string;
  source_event_id: string;
  provider_message_id: string;
  contact_key: string;
  event_type: string;
  occurred_at: string;
  evidence_kind: string;
  applies_to: "all" | "marketing";
  payload_sha256: string;
  idempotency_key: string;
  message_key: string;
  legacy_account_scope: string;
}

export function normalizeCommunicationEvent(input: unknown, binding: CommunicationAccountBinding): CanonicalCommunicationEvent {
  if (!binding || !bindings.has(binding)) throw new CommunicationContractError("untrusted_account_binding");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CommunicationContractError("invalid_event");
  const row = input as Record<string, unknown>;
  const keys = ["event_id", "provider_message_id", "contact_key", "event_type", "occurred_at", "evidence_kind"];
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key))) throw new CommunicationContractError("invalid_event_fields");
  const sourceId = text(row.event_id, messageId, "invalid_event_id");
  const providerId = text(row.provider_message_id, messageId, "invalid_provider_message_id");
  const contact = text(row.contact_key, digest, "invalid_contact_key");
  const kind = member(row.event_type, kinds, "invalid_event_type");
  const evidence = member(row.evidence_kind, new Set(["provider_event", "provider_occurrence_timestamp"]), "invalid_event_evidence");
  if (kind === "unsubscribe" && binding.unsubscribe_scope === undefined) throw new CommunicationContractError("unsubscribe_scope_required");
  const eventId = fingerprint("communication-recipient-event-v1", [sourceId, contact]);
  const base = { schema_version: 1 as const, provider: binding.provider, account_id: binding.account_id, event_id: eventId, source_event_id: sourceId, provider_message_id: providerId, contact_key: contact, event_type: kind, occurred_at: canonicalCommunicationTime(row.occurred_at), evidence_kind: evidence, applies_to: kind === "unsubscribe" ? binding.unsubscribe_scope! : "all" as const };
  return { ...base, payload_sha256: fingerprint("communication-event-payload-v1", base), idempotency_key: fingerprint("communication-event-v1", [binding.provider, binding.account_id, eventId]), message_key: fingerprint("communication-message-v1", [binding.provider, binding.account_id, providerId, contact]), legacy_account_scope: binding.legacy_account_scope };
}

export function communicationRawBodySha256(raw: string | Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Fallback identity only for an observed provider occurrence, never a polling clock.
export function derivedCommunicationSourceId(providerMessageId: unknown, eventType: unknown, occurredAt: unknown): string {
  return "derived-v1:" + fingerprint("communication-source-occurrence-v1", [text(providerMessageId, messageId, "invalid_provider_message_id"), member(eventType, kinds, "invalid_event_type"), canonicalCommunicationTime(occurredAt)]);
}
