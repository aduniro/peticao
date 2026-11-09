/** Browser-safe projections of the protected inbound API; never parse received email HTML here. */
export type InboxThread = { thread_root: string; messages: number; available: number; last_at: string };
export type InboxMessage = { id: string; received_at: string; created_at: string; expires_at: string; state: "expired" | "available" | "unavailable"; correlation: "new" | "header-reference" };
export type InboxPage<T> = { rows: T[]; nextCursor: string | null };
export type InboxPreview = { state: "ready"; subject: string; html: string; attachments: { filename: string; bytes: number }[] } | { state: "limited" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const inboxId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const inboxAccount = (v: string) => /^[A-Za-z0-9_-]{1,80}$/.test(v);
const stamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v.slice(0, 23) + "Z";
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function page<T>(raw: unknown, key: string, project: (v: unknown) => T | null, id: (v: T) => string): InboxPage<T> | null {
  if (!object(raw) || raw.ok !== true || !Array.isArray(raw[key]) || raw[key].length > 20 || raw.nextCursor !== null && (typeof raw.nextCursor !== "string" || raw.nextCursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw.nextCursor))) return null;
  const rows = raw[key].map(project); if (rows.some(v => !v)) return null;
  const typed = rows as T[]; if (new Set(typed.map(id)).size !== typed.length || raw.nextCursor !== null && typed.length === 0) return null;
  return { rows: typed, nextCursor: raw.nextCursor as string | null };
}
export function parseInboxThreads(raw: unknown) {
  return page<InboxThread>(raw, "threads", v => object(v) && inboxId(v.thread_root) && count(v.messages) && v.messages > 0 && count(v.available) && v.available <= v.messages && stamp(v.last_at) ? { thread_root: v.thread_root, messages: v.messages, available: v.available, last_at: v.last_at } : null, v => v.thread_root);
}
export function parseInboxMessages(raw: unknown) {
  return page<InboxMessage>(raw, "messages", v => object(v) && inboxId(v.id) && stamp(v.received_at) && stamp(v.created_at) && stamp(v.expires_at) && ["expired", "available", "unavailable"].includes(String(v.state)) && ["new", "header-reference"].includes(String(v.correlation)) ? { id: v.id, received_at: v.received_at, created_at: v.created_at, expires_at: v.expires_at, state: v.state as InboxMessage["state"], correlation: v.correlation as InboxMessage["correlation"] } : null, v => v.id);
}
export function appendInboxPage<T>(previous: InboxPage<T>, next: InboxPage<T>, id: (row: T) => string): InboxPage<T> | null {
  if (next.nextCursor !== null && next.nextCursor === previous.nextCursor || new Set([...previous.rows, ...next.rows].map(id)).size !== previous.rows.length + next.rows.length) return null;
  return { rows: [...previous.rows, ...next.rows], nextCursor: next.nextCursor };
}
export function parseInboxPreview(raw: unknown): InboxPreview | null {
  if (!object(raw) || raw.ok !== true || raw.state !== "preview" || !object(raw.preview)) return null;
  const v = raw.preview;
  if (v.state === "limited") return { state: "limited" };
  if (v.state !== "ready" || v.transformed !== true || typeof v.html !== "string" || v.html.length > 1_000_000 || typeof v.subject !== "string" || v.subject.length > 4096 || !Array.isArray(v.attachments) || v.attachments.length > 4 || v.attachmentsTruncated !== false) return null;
  const attachments: { filename: string; bytes: number }[] = [];
  for (const a of v.attachments) { if (!object(a) || typeof a.filename !== "string" || a.filename.length > 200 || !count(a.bytes)) return null; attachments.push({ filename: a.filename, bytes: a.bytes }); }
  return { state: "ready", subject: v.subject, html: v.html, attachments };
}
export class InboxRequestError extends Error { constructor(public status: number) { super("inbox_request"); } }
export async function inboxGet(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw new InboxRequestError(response.status);
  return response.json();
}
