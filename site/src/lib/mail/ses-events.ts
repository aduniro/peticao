import { createVerify } from "node:crypto";
import { storeEvents, sesToEvents } from "./events";
import { storeEngagement, sesToEngajamento } from "./engajamento";
import { suppress } from "./suppression";
import { recordMessageEvents } from "./message-events";
import { sesMessageEvents } from "./ses-message-events";

/** Mensagem do Amazon SNS (campos usados na assinatura variam por tipo). */
export type SnsMessage = Record<string, string> & { Type: string };

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Só aceitamos certificado/URL de confirmação servidos pelo próprio SNS, por HTTPS. */
export function isSnsUrl(raw: string | undefined): boolean {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" && SNS_HOST.test(u.hostname) && !u.port && !u.username;
  } catch {
    return false;
  }
}

const FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/** String assinada pelo SNS: "Campo\nValor\n" na ordem alfabética definida pela AWS; Subject só entra se existir. */
export function stringToSign(m: SnsMessage): string | null {
  const fields = FIELDS[m.Type];
  if (!fields) return null;
  let s = "";
  for (const f of fields) {
    if (f === "Subject" && m.Subject === undefined) continue;
    if (m[f] === undefined) return null;
    s += `${f}\n${m[f]}\n`;
  }
  return s;
}

const certCache = new Map<string, string>();
async function fetchCert(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`certificado SNS: HTTP ${res.status}`);
  const pem = await res.text();
  if (pem.length > 20_000) throw new Error("certificado SNS grande demais");
  certCache.set(url, pem);
  return pem;
}

export async function verifySns(m: SnsMessage, getCert: (url: string) => Promise<string> = fetchCert): Promise<boolean> {
  try {
    if (!isSnsUrl(m.SigningCertURL) || !String(m.SigningCertURL).endsWith(".pem")) return false;
    const algo = m.SignatureVersion === "2" ? "RSA-SHA256" : m.SignatureVersion === "1" ? "RSA-SHA1" : null;
    const text = stringToSign(m);
    if (!algo || text === null || !m.Signature) return false;
    const v = createVerify(algo);
    v.update(text, "utf8");
    return v.verify(await getCert(m.SigningCertURL), m.Signature, "base64");
  } catch {
    return false;
  }
}

/** Endereços a bloquear num evento do SES: bounce PERMANENTE e reclamação. Bounce temporário (caixa cheia etc.) é ignorado. */
export function extractSuppressions(ev: any): { email: string; reason: "bounce" | "complaint"; detail: string }[] {
  const kind = ev?.eventType ?? ev?.notificationType;
  const out: { email: string; reason: "bounce" | "complaint"; detail: string }[] = [];
  if (kind === "Bounce" && ev.bounce?.bounceType === "Permanent") {
    for (const r of ev.bounce.bouncedRecipients ?? []) if (r?.emailAddress) out.push({ email: String(r.emailAddress), reason: "bounce", detail: String(r.diagnosticCode ?? ev.bounce.bounceSubType ?? "") });
  } else if (kind === "Complaint") {
    for (const r of ev.complaint?.complainedRecipients ?? []) if (r?.emailAddress) out.push({ email: String(r.emailAddress), reason: "complaint", detail: String(ev.complaint.complaintFeedbackType ?? "") });
  }
  return out;
}

export type SnsResult = { status: number; body: string };

/** Processa uma mensagem do SNS. Exige a assinatura válida e o tópico esperado (SES_SNS_TOPIC_ARN); sem isso, recusa tudo. */
export async function handleSns(m: SnsMessage, deps: { getCert?: (u: string) => Promise<string>; confirm?: (url: string) => Promise<void>; topic?: string | undefined } = {}): Promise<SnsResult> {
  const topic = "topic" in deps ? deps.topic : process.env.SES_SNS_TOPIC_ARN;
  if (!topic) return { status: 503, body: "SES_SNS_TOPIC_ARN não configurado" };
  if (m.TopicArn !== topic) return { status: 403, body: "tópico não autorizado" };
  if (!(await verifySns(m, deps.getCert))) return { status: 403, body: "assinatura inválida" };
  if (m.Type === "SubscriptionConfirmation") {
    if (!isSnsUrl(m.SubscribeURL)) return { status: 400, body: "SubscribeURL inválida" };
    await (deps.confirm ?? (async (u) => { await fetch(u, { signal: AbortSignal.timeout(8000) }); }))(m.SubscribeURL);
    return { status: 200, body: "inscrição confirmada" };
  }
  if (m.Type === "Notification") {
    let ev: any;
    try { ev = JSON.parse(m.Message); } catch { return { status: 200, body: "ignorada (não é JSON)" }; }
    const list = extractSuppressions(ev);
    for (const s of list) await suppress(s.email, s.reason, s.detail);
    await storeEvents(sesToEvents(ev)).catch(() => {}); // também entra no painel de e-mails (permanentes e transitórios)
    await storeEngagement(sesToEngajamento(ev)).catch(() => {}); // entrega, abertura e clique (quando o conjunto publica esses eventos)
    // A journal failure propagates to the existing HTTP 500 handler, so SNS retries. Suppression is already preserved.
    await recordMessageEvents(sesMessageEvents(ev,topic));
    return { status: 200, body: `${list.length} endereço(s) bloqueado(s)` };
  }
  return { status: 200, body: "ignorada" };
}
