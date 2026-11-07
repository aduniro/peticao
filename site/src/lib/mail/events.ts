import { query } from "../db";
import { suppress } from "./suppression";
import { readCredentialText } from "./smtp-credential";
import { sendpulseCreds } from "./index";
import { brevoApiEvents, mailersendApiEvents, mailrelayApiEvents, recordApiEvents, type EventPage } from "./api-message-events";

/**
 * Devoluções (hard/soft bounce), bloqueios e reclamações de TODOS os provedores num só lugar (tabela mail_events).
 * Cada provedor tem um coletor que devolve eventos normalizados; `pollProviders` os grava (sem duplicar) e põe na lista de supressão
 * os endereços que devolveram de forma permanente ou reclamaram, para o app nunca mais escrever para eles.
 */
export type MailEventType = "hard_bounce" | "soft_bounce" | "blocked" | "complaint";
export type MailEvent = { ts: string; provider: string; type: MailEventType; email: string; reason: string; source: string };
type F = typeof fetch;
const day = (d: Date) => d.toISOString().slice(0, 10);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
const jget = async (f: F, url: string, headers: Record<string, string>) => {
  const r = await f(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<any>;
};

export async function brevoEvents(key: string, days: number, f: F = fetch, onPage?: EventPage<MailEvent>): Promise<MailEvent[]> {
  const out: MailEvent[] = [];
  for (const [ev, type] of [["hardBounces", "hard_bounce"], ["softBounces", "soft_bounce"], ["blocked", "blocked"], ["spam", "complaint"]] as const) {
    for (let off = 0; off < 5000; off += 500) {
      const j = await jget(f, `https://api.brevo.com/v3/smtp/statistics/events?event=${ev}&days=${days}&limit=500&offset=${off}`, { "api-key": key });
      const list: any[] = j.events ?? [];
      const start = out.length;
      for (const e of list) if (e.email && e.date) out.push({ ts: new Date(e.date).toISOString(), provider: "brevo", type, email: String(e.email).toLowerCase(), reason: clean(e.reason ?? ev), source: "api" });
      if (onPage) await onPage(out.slice(start), brevoApiEvents(list, key, type));
      if (list.length < 500) break;
    }
  }
  return out;
}

export async function sendpulseEvents(token: string, days: number, f: F = fetch): Promise<MailEvent[]> {
  const out: MailEvent[] = [];
  const from = day(new Date(Date.now() - days * 86400_000)), to = day(new Date(Date.now() + 86400_000));
  for (let off = 0; off < 5000; off += 100) {
    const list: any[] = await jget(f, `https://api.sendpulse.com/smtp/emails?limit=100&offset=${off}&from=${from}&to=${to}`, { Authorization: `Bearer ${token}` });
    if (!Array.isArray(list)) break;
    for (const e of list) {
      const code = Number(e.smtp_answer_code);
      if (!e.recipient || !(code >= 400)) continue;
      out.push({ ts: new Date(String(e.send_date).replace(" ", "T") + "Z").toISOString(), provider: "sendpulse", type: code >= 500 ? "hard_bounce" : "soft_bounce", email: String(e.recipient).toLowerCase(), reason: clean(`${code} ${e.smtp_answer_code_explain ?? ""} ${e.smtp_answer_data ?? ""}`), source: "api" });
    }
    if (list.length < 100) break;
  }
  return out;
}

export async function mailersendEvents(token: string, days: number, f: F = fetch, onPage?: EventPage<MailEvent>): Promise<MailEvent[]> {
  const out: MailEvent[] = [];
  const H = { Authorization: `Bearer ${token}` };
  const domains: any[] = (await jget(f, "https://api.mailersend.com/v1/domains?limit=25", H)).data ?? [];
  const now = Math.floor(Date.now() / 1000), since = now - Math.min(days, 90) * 86400;
  for (const d of domains) {
    for (let page = 1; page <= 20; page++) {
      const j = await jget(f, `https://api.mailersend.com/v1/activity/${d.id}?limit=100&page=${page}&date_from=${since}&date_to=${now}&event[]=hard_bounced&event[]=soft_bounced&event[]=spam_complaints`, H);
      const list: any[] = j.data ?? [];
      const start = out.length;
      for (const e of list) {
        const email = e.email?.recipient?.email; if (!email) continue;
        const type: MailEventType = e.type === "hard_bounced" ? "hard_bounce" : (e.type === "spam_complaint" || e.type === "spam_complaints") ? "complaint" : "soft_bounce";
        out.push({ ts: new Date(e.created_at).toISOString(), provider: "mailersend", type, email: String(email).toLowerCase(), reason: clean(e.type), source: "api" });
      }
      if (onPage) await onPage(out.slice(start), mailersendApiEvents(list, token));
      if (list.length < 100) break;
    }
  }
  return out;
}

export async function mailrelayEvents(key: string, host: string, provider: string, f: F = fetch, onPage?: EventPage<MailEvent>): Promise<MailEvent[]> {
  const out: MailEvent[] = [];
  for (let page = 1; page <= 20; page++) {
    const list: any[] = await jget(f, `https://${host}/api/v1/smtp_emails?per_page=100&page=${page}`, { "X-AUTH-TOKEN": key });
    if (!Array.isArray(list)) break;
    const start = out.length;
    for (const e of list) {
      const hard = e.bounced_at, soft = e.soft_bounced_at;
      if (!e.email || !(hard || soft)) continue;
      out.push({ ts: new Date(hard ?? soft).toISOString(), provider, type: hard ? "hard_bounce" : "soft_bounce", email: String(e.email).toLowerCase(), reason: clean(e.bounce_message ?? e.bounce_category ?? e.status), source: "api" });
    }
    if (onPage) await onPage(out.slice(start), mailrelayApiEvents(list, key, host, provider));
    if (list.length < 100) break;
  }
  return out;
}

/** Grava os eventos sem duplicar e suprime quem devolveu de forma permanente ou reclamou. */
export async function storeEvents(list: MailEvent[]): Promise<{ inserted: number; suppressed: number }> {
  let inserted = 0, suppressed = 0;
  for (const e of list) {
    const r = await query("INSERT INTO mail_events(ts,provider,type,email,reason,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [e.ts, e.provider, e.type, e.email, e.reason, e.source]);
    if (r.rowCount) inserted++;
    if (e.type === "hard_bounce" || e.type === "complaint") {
      try { await suppress(e.email, e.type === "complaint" ? "complaint" : "bounce", `${e.provider}: ${e.reason}`.slice(0, 200)); suppressed++; } catch { /* já suprimido */ }
    }
  }
  return { inserted, suppressed };
}

type Creds = { brevo: string | null; sendpulse: string | null; mailersend: string | null; mailrelayP: { key: string; host: string } | null; mailrelay?: { key: string; host: string } | null };
export function providerCreds(): Creds {
  const sp = sendpulseCreds();
  const mrKey = process.env.MAILRELAY_PRESIDENTE_API_KEY ?? readCredentialText("mailrelay-presidente-api"), mrHost = process.env.MAILRELAY_PRESIDENTE_HOST;
  const integralKey = process.env.MAILRELAY_API_KEY ?? readCredentialText("mailrelay-api"), integralHost = process.env.MAILRELAY_HOST;
  return {
    mailrelay: integralKey && integralHost ? { key: integralKey, host: integralHost } : null,
    brevo: process.env.BREVO_API_KEY ?? readCredentialText("brevo-api"),
    sendpulse: sp ? `${sp.id}\n${sp.secret}` : null,
    mailersend: process.env.MAILERSEND_API_TOKEN ?? readCredentialText("mailersend-api"),
    mailrelayP: mrKey && mrHost ? { key: mrKey, host: mrHost } : null,
  };
}

export async function spToken(idsecret: string, f: F): Promise<string> {
  const [id, secret] = idsecret.split("\n");
  const r = await f("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret }), signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string };
  if (!r.ok || !j.access_token) throw new Error(`autenticação recusada (HTTP ${r.status})`);
  return j.access_token;
}

export type PollReport = Record<string, { ok: boolean; eventos?: number; novos?: number; suprimidos?: number; erro?: string }>;

/** Consulta todos os provedores configurados (últimos `days` dias), grava as devoluções e atualiza a supressão. Um provedor com erro não impede os outros. */
export async function pollProviders(days = 3, f: F = fetch, creds: Creds = providerCreds()): Promise<PollReport> {
  const rep: PollReport = {};
  const run = async (nome: string, fn: (sink: EventPage<MailEvent>) => Promise<MailEvent[]>, paged = true) => {
    let inserted = 0, suppressed = 0;
    const sink: EventPage<MailEvent> = async (legacy, events) => {
      const saved = await storeEvents(legacy); inserted += saved.inserted; suppressed += saved.suppressed;
      await recordApiEvents(events);
    };
    try {
      const ev = await fn(sink);
      if (!paged) await sink(ev, []);
      rep[nome] = { ok: true, eventos: ev.length, novos: inserted, suprimidos: suppressed };
    } catch (e) { rep[nome] = { ok: false, erro: String((e as Error).message).slice(0, 120) }; }
  };
  if (creds.brevo) await run("brevo", sink => brevoEvents(creds.brevo!, days, f, sink));
  // SMTP send_date is not an occurrence time for a delivery/bounce. Preserve the legacy aggregate only.
  if (creds.sendpulse) await run("sendpulse", async () => sendpulseEvents(await spToken(creds.sendpulse!, f), days, f), false);
  if (creds.mailersend) await run("mailersend", sink => mailersendEvents(creds.mailersend!, days, f, sink));
  if (creds.mailrelay) await run("mailrelay", sink => mailrelayEvents(creds.mailrelay!.key, creds.mailrelay!.host, "mailrelay", f, sink));
  if (creds.mailrelayP) await run("mailrelaypresidente", sink => mailrelayEvents(creds.mailrelayP!.key, creds.mailrelayP!.host, "mailrelaypresidente", f, sink));
  await query("INSERT INTO provider_status(provider,data) VALUES('_poll',$1) ON CONFLICT (provider) DO UPDATE SET data=$1, at=now()", [JSON.stringify(rep)]);
  return rep;
}

/** Evento recebido do SES pelo webhook (bounce permanente/transitório e reclamação), para entrar na mesma tabela. */
export function sesToEvents(ev: any): MailEvent[] {
  const kind = ev?.eventType ?? ev?.notificationType; const out: MailEvent[] = [];
  const ts = (x: unknown) => { const d = new Date(String(x ?? "")); return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };
  if (kind === "Bounce") for (const r of ev.bounce?.bouncedRecipients ?? []) if (r?.emailAddress) out.push({ ts: ts(ev.bounce.timestamp ?? ev.mail?.timestamp), provider: "ses", type: ev.bounce.bounceType === "Permanent" ? "hard_bounce" : "soft_bounce", email: String(r.emailAddress).toLowerCase(), reason: clean(r.diagnosticCode ?? ev.bounce.bounceSubType), source: "webhook" });
  if (kind === "Complaint") for (const r of ev.complaint?.complainedRecipients ?? []) if (r?.emailAddress) out.push({ ts: ts(ev.complaint.timestamp ?? ev.mail?.timestamp), provider: "ses", type: "complaint", email: String(r.emailAddress).toLowerCase(), reason: clean(ev.complaint.complaintFeedbackType ?? "complaint"), source: "webhook" });
  return out;
}
