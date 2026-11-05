import { query } from "../db";
import { providerCreds } from "./events";

/**
 * Engajamento dos e-mails (entregue / aberto / clicado) vindo das APIs dos provedores. Tabela própria (mail_engagement), sem relação com devoluções.
 * Limites: abertura depende de imagem carregada (leitores que bloqueiam imagens não contam; proxies de privacidade contam a mais) e spam só pode ser
 * inferido ("entregue e nunca aberto"). SES e SendPulse não entregam esses eventos pela API usada aqui (SES precisaria de SNS com eventos de entrega).
 */
export type Engaj = { provider: string; email: string; kind: "delivered" | "opened" | "clicked"; ts: string };
type F = typeof fetch;
const jget = async (f: F, url: string, headers: Record<string, string>) => {
  const r = await f(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<any>;
};

export async function brevoEngagement(key: string, days: number, f: F = fetch): Promise<Engaj[]> {
  const out: Engaj[] = [];
  for (const [ev, kind] of [["delivered", "delivered"], ["opened", "opened"], ["clicks", "clicked"]] as const) {
    for (let off = 0; off < 50_000; off += 500) {
      const j = await jget(f, `https://api.brevo.com/v3/smtp/statistics/events?event=${ev}&days=${Math.min(90, days)}&limit=500&offset=${off}`, { "api-key": key });
      const list: any[] = j.events ?? [];
      for (const e of list) if (e.email && e.date) out.push({ provider: "brevo", email: String(e.email).toLowerCase(), kind, ts: new Date(e.date).toISOString() });
      if (list.length < 500) break;
    }
  }
  return out;
}

export async function mailersendEngagement(token: string, days: number, f: F = fetch): Promise<Engaj[]> {
  const out: Engaj[] = [];
  const H = { Authorization: `Bearer ${token}` };
  const domains: any[] = (await jget(f, "https://api.mailersend.com/v1/domains?limit=25", H)).data ?? [];
  const now = Math.floor(Date.now() / 1000), since = now - Math.min(days, 90) * 86400;
  const map: Record<string, Engaj["kind"]> = { delivered: "delivered", opened: "opened", clicked: "clicked" };
  for (const d of domains) for (let page = 1; page <= 50; page++) {
    const j = await jget(f, `https://api.mailersend.com/v1/activity/${d.id}?limit=100&page=${page}&date_from=${since}&date_to=${now}&event[]=delivered&event[]=opened&event[]=clicked`, H);
    const list: any[] = j.data ?? [];
    for (const e of list) { const email = e.email?.recipient?.email, kind = map[e.type]; if (email && kind) out.push({ provider: "mailersend", email: String(email).toLowerCase(), kind, ts: new Date(e.created_at).toISOString() }); }
    if (list.length < 100) break;
  }
  return out;
}

const COL = { delivered: "delivered_at", opened: "opened_at", clicked: "clicked_at" } as const;
/** Grava mantendo o primeiro horário de cada tipo (nunca regride nem apaga). */
export async function storeEngagement(list: Engaj[]): Promise<number> {
  let n = 0;
  for (const e of list) {
    const c = COL[e.kind];
    const r = await query(`INSERT INTO mail_engagement(provider,email,${c}) VALUES($1,$2,$3) ON CONFLICT (provider,email) DO UPDATE SET ${c} = LEAST(COALESCE(mail_engagement.${c}, EXCLUDED.${c}), EXCLUDED.${c}), updated_at = now()`, [e.provider, e.email, e.ts]);
    n += r.rowCount ?? 0;
  }
  return n;
}

export type RelEngaj = Record<string, { ok: boolean; eventos?: number; erro?: string }>;
export async function syncEngajamento(days = 30, f: F = fetch, creds = providerCreds()): Promise<RelEngaj> {
  const rep: RelEngaj = {};
  const run = async (nome: string, fn: () => Promise<Engaj[]>) => { try { const ev = await fn(); await storeEngagement(ev); rep[nome] = { ok: true, eventos: ev.length }; } catch (e) { rep[nome] = { ok: false, erro: e instanceof Error ? e.message : String(e) }; } };
  if (creds.brevo) await run("brevo", () => brevoEngagement(creds.brevo!, days, f));
  if (creds.mailersend) await run("mailersend", () => mailersendEngagement(creds.mailersend!, days, f));
  return rep;
}

export type ResumoEngaj = { pendentes: number; clicou: number; abriu: number; entregueSemAbrir: number; devolvido: number; semRegistro: number; ultimaAtualizacao: string | null };
/** Situação dos cadastros AGUARDANDO confirmação: o melhor sinal registrado para cada e-mail (clicou > abriu > entregue > devolvido > sem registro). */
export async function resumoEngajamento(): Promise<ResumoEngaj> {
  const r = (await query<any>(`WITH p AS (
      SELECT lower(s.email) e FROM signatures s WHERE s.status='pending'),
    g AS (SELECT email, MAX(delivered_at) d, MAX(opened_at) o, MAX(clicked_at) c FROM mail_engagement GROUP BY email),
    b AS (SELECT DISTINCT lower(email) e FROM mail_events WHERE type IN ('hard_bounce','soft_bounce','blocked','complaint'))
    SELECT COUNT(*)::int pendentes,
      COUNT(*) FILTER (WHERE g.c IS NOT NULL)::int clicou,
      COUNT(*) FILTER (WHERE g.c IS NULL AND g.o IS NOT NULL)::int abriu,
      COUNT(*) FILTER (WHERE g.c IS NULL AND g.o IS NULL AND g.d IS NOT NULL)::int "entregueSemAbrir",
      COUNT(*) FILTER (WHERE g.d IS NULL AND g.o IS NULL AND g.c IS NULL AND b.e IS NOT NULL)::int devolvido,
      COUNT(*) FILTER (WHERE g.d IS NULL AND g.o IS NULL AND g.c IS NULL AND b.e IS NULL)::int "semRegistro",
      (SELECT MAX(updated_at)::text FROM mail_engagement) "ultimaAtualizacao"
    FROM p LEFT JOIN g ON g.email = p.e LEFT JOIN b ON b.e = p.e`)).rows[0];
  return r;
}

// ---------- Eventos em tempo real (webhooks) ----------
const iso = (x: unknown) => { const d = typeof x === "number" ? new Date(x < 1e12 ? x * 1000 : x) : new Date(String(x ?? "")); return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };

/** SES (via SNS, conjunto de configuração): Delivery, Open e Click viram engajamento. */
export function sesToEngajamento(ev: any): Engaj[] {
  const kind = ev?.eventType; const out: Engaj[] = [];
  const dest: string[] = (ev?.mail?.destination ?? []).map((x: unknown) => String(x).toLowerCase());
  const mk = (k: Engaj["kind"], ts: unknown) => { for (const e of dest) out.push({ provider: "ses", email: e, kind: k, ts: iso(ts ?? ev?.mail?.timestamp) }); };
  if (kind === "Delivery") mk("delivered", ev.delivery?.timestamp);
  else if (kind === "Open") mk("opened", ev.open?.timestamp);
  else if (kind === "Click") mk("clicked", ev.click?.timestamp);
  return out;
}

/** Brevo (webhook transacional): event = delivered | opened | unique_opened | click | ... */
export function brevoWebhookToEngaj(b: any): Engaj[] {
  const email = String(b?.email ?? "").toLowerCase(); if (!email) return [];
  const m: Record<string, Engaj["kind"]> = { delivered: "delivered", opened: "opened", unique_opened: "opened", opened_proxy: "opened", click: "clicked", clicks: "clicked" };
  const k = m[String(b?.event ?? "")]; return k ? [{ provider: "brevo", email, kind: k, ts: iso(b?.ts_event ?? b?.ts ?? b?.date) }] : [];
}

/** MailerSend (webhook): type = activity.delivered | activity.opened | activity.clicked */
export function mailersendWebhookToEngaj(b: any): Engaj[] {
  const email = String(b?.data?.email?.recipient?.email ?? b?.data?.recipient?.email ?? "").toLowerCase(); if (!email) return [];
  const m: Record<string, Engaj["kind"]> = { "activity.delivered": "delivered", "activity.opened": "opened", "activity.clicked": "clicked" };
  const k = m[String(b?.type ?? "")]; return k ? [{ provider: "mailersend", email, kind: k, ts: iso(b?.data?.created_at ?? b?.created_at) }] : [];
}
