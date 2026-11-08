import { query } from "./db";
import { config } from "./config";
import { sendMail } from "./mail";
import { hmac } from "./security";
import { lowerEmail, titleCaseName } from "./name-case";
import { brasilia } from "./time";
import { SAFE_EMAIL_RE as EMAIL_RE } from "./email-syntax";

export const CONTACT_KINDS = ["duvida", "bug", "outro"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export type ContactInput = { name: string; email: string; kind: ContactKind; message: string; locale?: string };

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const KIND_LABEL: Record<ContactKind, string> = { duvida: "Dúvida", bug: "Problema/erro na página", outro: "Outro assunto" };

/** Valida e normaliza (nome com caixa de nome próprio, e-mail em minúsculas). Códigos de erro são traduzidos no navegador. */
export function validateContact(raw: any): { ok: true; value: ContactInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = titleCaseName(clean(raw?.name, 120).replace(/\s+/g, " "), { final: true });
  const email = lowerEmail(clean(raw?.email, 200));
  const message = clean(raw?.message, 4000);
  const kind = raw?.kind as ContactKind;
  if (name.length < 2) errors.name = "name_required";
  if (!EMAIL_RE.test(email)) errors.email = "email_invalid";
  if (!CONTACT_KINDS.includes(kind)) errors.kind = "kind_invalid";
  if (message.length < 10) errors.message = "message_short";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, kind, message, locale: clean(raw?.locale, 5) || undefined } };
}

/** Grava SEMPRE (a mensagem não se perde se o e-mail falhar) e tenta enviar para a caixa de contato, com cópia oculta e Reply-To do remetente. */
export async function saveAndSendContact(c: ContactInput, ip: string): Promise<{ id: number; mailed: boolean }> {
  const ins = await query<{ id: number }>(
    "INSERT INTO contact_messages(name,email,kind,message,locale,ip_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [c.name, c.email, c.kind, c.message, c.locale ?? null, hmac(`contato|${ip}`)]);
  const id = ins.rows[0].id;
  let mailed = false, err: string | null = null;
  try {
    const outcome = await sendMail({
      to: config.contactTo(), bcc: config.contactBcc(), replyTo: c.email,
      subject: `[Contato PLV 12/2026] ${KIND_LABEL[c.kind]} · ${c.name}`,
      text: `${KIND_LABEL[c.kind]}\nDe: ${c.name} <${c.email}>\nIdioma da página: ${c.locale ?? "?"}\nRecebida em: ${brasilia(new Date(), true)} (mensagem nº ${id})\n\n${c.message}\n`,
    }, "contato");
    mailed = outcome === "sent";
    if (outcome === "queued") err = "na fila de reenvio (será enviada quando o serviço de e-mail voltar)";
  } catch (e) { err = String(e).slice(0, 200); }
  await query("UPDATE contact_messages SET mailed=$1, mail_error=$2 WHERE id=$3", [mailed, err, id]);
  return { id, mailed };
}

export const listContacts = async (limit = 200) =>
  (await query<{ id: number; name: string; email: string; kind: string; message: string; locale: string | null; mailed: boolean; mail_error: string | null; created_at: string }>(
    "SELECT id,name,email,kind,message,locale,mailed,mail_error,created_at FROM contact_messages ORDER BY id DESC LIMIT $1", [limit])).rows;
