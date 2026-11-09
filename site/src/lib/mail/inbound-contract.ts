import { createHmac, timingSafeEqual } from "node:crypto";

export const INBOUND_MAX_BODY = 2 * 1024 * 1024;
export const INBOUND_MAX_ATTACHMENT = 512 * 1024;
export type InboundMail = {
  account: string;
  externalId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { name: string; contentType: string; content: Buffer }[];
  receivedAt: string;
};
type Invalid = { ok: false; error: "disabled" | "size" | "signature" | "timestamp" | "input" | "recipient" };
const invalid = (error: Invalid["error"]): Invalid => ({ ok: false, error });
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && bytes(v) <= max && !v.includes("\0");
const line = (v: unknown, max: number): v is string => bounded(v, max) && !/[\u0000-\u001f\u007f]/.test(v);
function address(v: unknown): v is string {
  if (!line(v, 254)) return false;
  const parts = v.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..")
    && domain.includes(".") && domain.split(".").every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}
const messageId = (v: unknown): v is string => line(v, 254) && /^<[^\s<>@]+@[^\s<>@]+>$/.test(v);

/** Own relay protocol v1: HMAC-SHA256 over ASCII timestamp + '.' + exact raw bytes.
 * Authentication precedes JSON decoding. It proves the relay, not the human sender.
 * No process/env/network/credential reads; callers must explicitly supply the key.
 */
export function verifyInboundRelay(raw: Buffer, timestamp: string | null, signature: string | null, key: Buffer | null, nowMs = Date.now()): { ok: true } | Invalid {
  if (!key || key.length < 32) return invalid("disabled");
  if (!Buffer.isBuffer(raw) || raw.length > INBOUND_MAX_BODY) return invalid("size");
  if (!timestamp || !/^[0-9]{10}$/.test(timestamp) || !Number.isFinite(nowMs) || Math.abs(nowMs - Number(timestamp) * 1000) > 300000) return invalid("timestamp");
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return invalid("signature");
  const expected = createHmac("sha256", key).update(timestamp + ".", "ascii").update(raw).digest();
  const actual = Buffer.from(signature.slice(7), "hex");
  return timingSafeEqual(expected, actual) ? { ok: true } : invalid("signature");
}

/** Strict normalized relay input. HTML and attachments are data, never rendered,
 * fetched, executed or extracted here. No identity/thread inferred from an address.
 */
export function parseInboundMail(raw: Buffer, allowedRecipients: readonly string[]): { ok: true; mail: InboundMail } | Invalid {
  if (!Buffer.isBuffer(raw) || raw.length > INBOUND_MAX_BODY) return invalid("size");
  let v: unknown;
  try { v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return invalid("input"); }
  const keys = ["account", "externalId", "messageId", "inReplyTo", "references", "from", "to", "subject", "text", "html", "attachments", "receivedAt"];
  if (!plain(v) || Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !(k in v))) return invalid("input");
  if (!line(v.account, 80) || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.account) || !line(v.externalId, 200) || !v.externalId.trim()) return invalid("input");
  if (v.messageId !== null && !messageId(v.messageId) || v.inReplyTo !== null && !messageId(v.inReplyTo)) return invalid("input");
  if (!Array.isArray(v.references) || v.references.length > 30 || !v.references.every(messageId)) return invalid("input");
  if (!address(v.from) || !Array.isArray(v.to) || !v.to.length || v.to.length > 10 || !v.to.every(address)) return invalid("input");
  const recipients = [...new Set(v.to.map(s => s.toLowerCase()))];
  const allowed = new Set(allowedRecipients.filter(address).map(s => s.toLowerCase()));
  if (!recipients.some(s => allowed.has(s))) return invalid("recipient");
  if (!line(v.subject, 2048) || !bounded(v.text, 256 * 1024) || !bounded(v.html, 256 * 1024)) return invalid("input");
  if (!line(v.receivedAt, 40) || !Number.isFinite(Date.parse(v.receivedAt)) || new Date(v.receivedAt).toISOString() !== v.receivedAt) return invalid("input");
  if (!Array.isArray(v.attachments) || v.attachments.length > 4) return invalid("input");
  const attachments: InboundMail["attachments"] = []; let total = 0;
  for (const a of v.attachments) {
    if (!plain(a) || Object.keys(a).sort().join(",") !== "base64,contentType,name" || !line(a.name, 255) || !a.name.trim() || /[\/\\]/.test(a.name)
      || !line(a.contentType, 127) || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(a.contentType)
      || !bounded(a.base64, Math.ceil(INBOUND_MAX_ATTACHMENT / 3) * 4) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64)) return invalid("input");
    const content = Buffer.from(a.base64, "base64"); total += content.length;
    if (content.length > INBOUND_MAX_ATTACHMENT || total > 1024 * 1024 || content.toString("base64") !== a.base64) return invalid("size");
    attachments.push({ name: a.name, contentType: a.contentType.toLowerCase(), content });
  }
  return { ok: true, mail: { account: v.account, externalId: v.externalId, messageId: v.messageId as string | null, inReplyTo: v.inReplyTo as string | null, references: [...v.references], from: v.from.toLowerCase(), to: recipients, subject: v.subject, text: v.text, html: v.html, attachments, receivedAt: new Date(v.receivedAt).toISOString() } };
}
