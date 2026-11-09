import { cifrar, decifrar } from "../crypto-dados";
import { INBOUND_MAX_BODY, parseInboundMail, type InboundMail } from "./inbound-contract";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function inboundWire(mail: InboundMail): Buffer {
  return Buffer.from(JSON.stringify({
    account: mail.account, externalId: mail.externalId, messageId: mail.messageId,
    inReplyTo: mail.inReplyTo, references: mail.references, from: mail.from, to: mail.to,
    subject: mail.subject, text: mail.text, html: mail.html,
    attachments: mail.attachments.map(a => ({ name: a.name, contentType: a.contentType, base64: a.content.toString("base64") })),
    receivedAt: mail.receivedAt,
  }), "utf8");
}

/** Same existing AES-GCM/key mechanism, with its own domain and immutable message ID. */
export function encryptInbound(id: string, mail: InboundMail): string {
  if (!uuid.test(id)) throw new Error("inbound_parameters");
  const raw = inboundWire(mail), validated = parseInboundMail(raw, mail.to);
  if (!validated.ok) throw new Error("inbound_parameters");
  return cifrar(raw.toString("utf8"), `mail-inbound:v1:${id}`);
}

export function decryptInbound(id: string, cipher: string): InboundMail | null {
  if (!uuid.test(id) || typeof cipher !== "string" || cipher.length > Math.ceil(INBOUND_MAX_BODY / 3) * 4 + 100) return null;
  const raw = decifrar(cipher, `mail-inbound:v1:${id}`);
  if (raw === null || Buffer.byteLength(raw, "utf8") > INBOUND_MAX_BODY) return null;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as { to?: unknown }).to)) return null;
    const recipients = (candidate as { to: unknown[] }).to;
    if (!recipients.every((x): x is string => typeof x === "string")) return null;
    const result = parseInboundMail(Buffer.from(raw, "utf8"), recipients);
    return result.ok ? result.mail : null;
  } catch { return null; }
}
