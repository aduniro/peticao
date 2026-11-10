/** Pure read contract. No DNS, provider, secret, payload or mutation dependency. */
export type PendingEmailActor = { userId: number; email: string; sessaoId: number | null };
export const PENDING_EMAIL_STATES = ["clicked", "opened", "delivered", "adverse", "accepted", "unrecorded"] as const;
export type PendingEmailState = typeof PENDING_EMAIL_STATES[number];
export type PendingEmailAdverseType = "hard_bounce" | "soft_bounce" | "blocked" | "complaint";
export type PendingEmailFilters = { q?: string; category?: "servidor" | "apoiador" | "estrangeiro"; institution?: string; domain?: string; provider?: string; state?: PendingEmailState; suppressed?: "yes" | "no"; queued?: "yes" | "no"; hasSuggestion?: "yes" | "no"; hasAdverse?: "yes" | "no"; hasAcceptance?: "yes" | "no"; adverseOrSuppressed?: "yes" | "no" };
export type PendingEmailOptions = { before?: string; limit?: number; filters?: PendingEmailFilters };
export const PENDING_EMAIL_LIMITS = { name: 512, email: 254, institution: 512, provider: 100, reason: 16384, detail: 16384, label: 100, date: 40, cursor: 100 } as const;
export type PendingEmailSignal = { state: Exclude<PendingEmailState, "unrecorded">; at: string; provider: string; source: "legacy_log" | "legacy_engagement" | "legacy_event" | "message_attempt" | "message_event" };
export type PendingEmailEvidence = {
  scope: "address_aggregate" | "none"; registrationLink: "email_only";
  lastSignal: PendingEmailSignal | null;
  lastAcceptedAt: string | null; deliveredAt: string | null; openedAt: string | null; clickedAt: string | null;
  lastAdverse: { type: PendingEmailAdverseType; at: string; provider: string; reason: string } | null;
  legacyEngagementFirstOnly: boolean;
  latestConfirmationMessage: { id: string; createdAt: string; status: "prepared" | "sending" | "accepted" | "rejected" | "indeterminate" | "queued" } | null;
};
/** state is the latest known chronological signal; ties: adverse > clicked > opened > delivered > accepted. Address history does not prove the state of this registration's current confirmation. */
export type PendingEmailRow = {
  id: number; version: string; name: string; email: string; category: string; instituicao: string;
  criada: string; criadaTxt: string; motivo: string; detalhe: string; provedor: string; dominio: string;
  sugestao: string | null; motivoSugestao: string | null; suggestionSource: "local_catalog" | "none";
  state: PendingEmailState; hasAcceptance: boolean; hasAdverse: boolean; providers: string[]; suppressed: boolean; suppressionReason: string | null; queued: boolean; queueSources: ("outbox" | "journal")[];
  evidence: PendingEmailEvidence;
};
export type PendingEmailCounts = { total: number; byState: Record<PendingEmailState, number>; suppressed: number; queued: number; withSuggestion: number; withAcceptance: number; withAdverse: number };
export type PendingEmailFacet = { value: string; count: number };
export type PendingEmailFacets = Record<"category" | "institution" | "domain" | "provider" | "state", PendingEmailFacet[]>;
export type PendingEmailReadResult = {
  ok: true; asOf: string; unit: "pending_registration";
  summary: { global: PendingEmailCounts; filtered: PendingEmailCounts };
  coverage: { pending: number; matched: number; totalRowsReturned: number; complete: true; facetsComplete: true };
  rows: PendingEmailRow[]; next: string | null; facets: PendingEmailFacets;
};
export type PendingEmailFailure = { ok: false; error: "invalid" | "forbidden" | "unavailable" };
export type PendingEmailExportResult = { ok: true; asOf: string; unit: "pending_registration"; rows: PendingEmailRow[]; total: number };

export const PENDING_EMAIL_FILTER_KEYS = ["q", "category", "institution", "domain", "provider", "state", "suppressed", "queued", "hasSuggestion", "hasAdverse", "hasAcceptance", "adverseOrSuppressed"] as const;
const invalid = { ok: false, error: "invalid" } as const;
const id = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
export function validPendingEmailActor(actor: PendingEmailActor): boolean {
  return !!actor && id(actor.userId) && id(actor.sessaoId) && typeof actor.email === "string" && actor.email.length > 0 && actor.email.length <= 254;
}
export function pendingEmailBefore(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length > 100 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const text = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "id,v" || value.v !== 1 || !id(value.id) || encodePendingEmailBefore(value.id) !== raw) return null;
    return value.id;
  } catch { return null; }
}
export function encodePendingEmailBefore(value: number): string {
  if (!id(value)) throw new Error("invalid_pending_cursor");
  return btoa(JSON.stringify({ v: 1, id: value })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function pendingEmailSearch(sp: URLSearchParams): { ok: true; options: PendingEmailOptions; format: "json" | "csv" } | typeof invalid {
  if (sp.toString().length > 16384) return invalid;
  const filters: PendingEmailFilters = {};
  for (const [key, value] of sp) {
    if (![...PENDING_EMAIL_FILTER_KEYS, "before", "limit", "formato"].includes(key) || sp.getAll(key).length !== 1 || /[\u0000-\u001f\u007f]/.test(value)) return invalid;
    if (!PENDING_EMAIL_FILTER_KEYS.includes(key as typeof PENDING_EMAIL_FILTER_KEYS[number]) || value === "") continue;
    const max = key === "q" ? 80 : key === "institution" ? 512 : key === "provider" ? 100 : 254;
    if (value.length > max) return invalid;
    if (key === "category" && !["servidor", "apoiador", "estrangeiro"].includes(value) || key === "state" && !PENDING_EMAIL_STATES.includes(value as PendingEmailState) || ["suppressed", "queued", "hasSuggestion", "hasAdverse", "hasAcceptance", "adverseOrSuppressed"].includes(key) && !["yes", "no"].includes(value)) return invalid;
    (filters as Record<string, string>)[key] = value;
  }
  const before = sp.get("before"), rawLimit = sp.get("limit"), rawFormat = sp.get("formato") ?? "json";
  if (before !== null && pendingEmailBefore(before) === null || rawLimit !== null && (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) || !["json", "csv"].includes(rawFormat) || rawFormat === "csv" && before !== null) return invalid;
  return { ok: true, options: { filters, limit: rawLimit === null ? 50 : Number(rawLimit), ...(before === null ? {} : { before }) }, format: rawFormat as "json" | "csv" };
}
export function pendingEmailQuery(options: PendingEmailOptions): string {
  const sp = new URLSearchParams();
  for (const key of PENDING_EMAIL_FILTER_KEYS) { const value = options.filters?.[key]; if (value !== undefined && value !== "") sp.set(key, value); }
  if (options.before !== undefined) sp.set("before", options.before);
  if (options.limit !== undefined) sp.set("limit", String(options.limit));
  return sp.toString();
}
export function pendingEmailCount(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw))) return null;
  const n = Number(raw); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function pendingEmailTimestamp(raw: unknown): string {
  if (raw instanceof Date) raw = raw.toISOString();
  if (typeof raw !== "string" || raw.length > 40) throw new Error("invalid_pending_timestamp");
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/.exec(raw);
  const date = new Date(raw);
  if (!match || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,19) !== match[1] || raw.startsWith("0000")) throw new Error("invalid_pending_timestamp");
  return match[1] + "." + (match[2] ?? "").padEnd(6,"0") + "Z";
}
/** Last recorded timestamp, not the unknowable last real-world action; equal-time ordering is conservative. */
export function latestPendingEmailSignal(signals: readonly PendingEmailSignal[]): PendingEmailSignal | null {
  const rank = { accepted: 1, delivered: 2, opened: 3, clicked: 4, adverse: 5 };
  let selected: PendingEmailSignal | null = null;
  for (const raw of signals) {
    const signal = { ...raw, at: pendingEmailTimestamp(raw.at) };
    if (!Object.hasOwn(rank, signal.state) || typeof signal.provider !== "string" || signal.provider.length > 100) throw new Error("invalid_pending_signal");
    if (selected === null || signal.at > selected.at || signal.at === selected.at && (rank[signal.state] > rank[selected.state] || rank[signal.state] === rank[selected.state] && (signal.provider + ":" + signal.source) > (selected.provider + ":" + selected.source))) selected = signal;
  }
  return selected;
}
