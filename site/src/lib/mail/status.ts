import { query } from "../db";
import { readCredentialText } from "./smtp-credential";
import { pollProviders, providerCreds, type PollReport } from "./events";

type F = typeof fetch;
const put = (provider: string, data: unknown) => query("INSERT INTO provider_status(provider,data) VALUES($1,$2) ON CONFLICT (provider) DO UPDATE SET data=$2, at=now()", [provider, JSON.stringify(data)]);
const jget = async (f: F, url: string, headers: Record<string, string>, init: RequestInit = {}) => {
  const r = await f(url, { ...init, headers: { accept: "application/json", ...headers, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<any>;
};

/** Saldo e limites de cada provedor, lidos pela API de cada um (o SES e o Mailrelay não informam cota pela API: valores conhecidos). */
export async function refreshProviderStatus(f: F = fetch, creds = providerCreds()): Promise<void> {
  const tryit = async (nome: string, fn: () => Promise<unknown>) => { try { await put(nome, { ok: true, ...(await fn() as object) }); } catch (e) { await put(nome, { ok: false, erro: String((e as Error).message).slice(0, 120) }).catch(() => {}); } };
  if (creds.brevo) await tryit("brevo", async () => {
    const a = await jget(f, "https://api.brevo.com/v3/account", { "api-key": creds.brevo! });
    const creditos = (a.plan ?? []).filter((p: any) => p.credits !== undefined).reduce((n: number, p: any) => n + Number(p.credits || 0), 0);
    const r = await jget(f, "https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=30", { "api-key": creds.brevo! });
    return { creditos, planos: (a.plan ?? []).map((p: any) => ({ tipo: p.type, creditos: p.credits, validade: p.endDate ?? null })), ultimos30dias: { enviados: r.requests, entregues: r.delivered, hard: r.hardBounces, soft: r.softBounces } };
  });
  if (creds.sendpulse) await tryit("sendpulse", async () => {
    const [id, secret] = creds.sendpulse!.split("\n");
    const t = await jget(f, "https://api.sendpulse.com/oauth/access_token", {}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret }) });
    const b = await jget(f, "https://api.sendpulse.com/user/balance/detail", { Authorization: `Bearer ${t.access_token}` });
    return { restantes: b.smtp?.email_qty_left, total: b.smtp?.email_qty, porHora: b.smtp?.qty_per_hour, validade: b.smtp?.end_date ?? null };
  });
  if (creds.mailersend) await tryit("mailersend", async () => {
    const q = await jget(f, "https://api.mailersend.com/v1/api-quota", { Authorization: `Bearer ${creds.mailersend}` });
    return { cotaDia: q.quota, restantes: q.remaining, renova: q.reset };
  });
  await put("ses", { ok: true, cotaDia: 50000, porSegundo: 14, nota: "Cota e velocidade lidas da conta em 04/11/2026; o painel conta os envios e as devoluções do SES pelo próprio registro." });
  await put("mailrelaypresidente", { ok: true, nota: "O Mailrelay não informa cota pela API: confira os limites do plano no painel dele." });
}

/** Respostas recebidas pelo Email Routing da Cloudflare (7 dias), pelo token SÓ de leitura de estatísticas. Sem o token, avisa que falta configurar. */
export async function refreshReplies(f: F = fetch, token = process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? readCredentialText("cloudflare-analytics"), zone = process.env.CLOUDFLARE_ZONE_ID ?? "83a93e98d84ddcbc1417d93df4d0094b"): Promise<void> {
  if (!token) { await put("respostas", { ok: false, erro: "token de estatísticas da Cloudflare não configurado" }); return; }
  try {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString(), now = new Date().toISOString();
    const q = `{viewer{zones(filter:{zoneTag:"${zone}"}){emailRoutingAdaptiveGroups(limit:50,filter:{datetime_geq:"${since}",datetime_leq:"${now}"}){count dimensions{status action isSpam isNDR}}}}}`;
    const j = await jget(f, "https://api.cloudflare.com/client/v4/graphql", { Authorization: `Bearer ${token}` }, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    if (j.errors?.length) throw new Error(String(j.errors[0].message).slice(0, 100));
    const g: any[] = j.data?.viewer?.zones?.[0]?.emailRoutingAdaptiveGroups ?? [];
    const soma = (fn: (d: any) => boolean) => g.filter((x) => fn(x.dimensions)).reduce((n, x) => n + x.count, 0);
    await put("respostas", { ok: true, total: soma(() => true), entregues: soma((d) => d.status === "delivered" && !d.isSpam), spam: soma((d) => !!d.isSpam), rejeitadas: soma((d) => d.status !== "delivered"), devolucoesNDR: soma((d) => !!d.isNDR), dias: 7 });
  } catch (e) { await put("respostas", { ok: false, erro: String((e as Error).message).slice(0, 120) }); }
}

/** Sincroniza tudo (devoluções + saldos + respostas). Sem `force`, no máximo a cada 10 minutos. */
export async function syncMail(force = false, days = 3): Promise<{ ran: boolean; report?: PollReport }> {
  if (!force) {
    const r = await query<{ at: string }>("SELECT at FROM provider_status WHERE provider='_poll'");
    if (r.rows[0] && Date.now() - new Date(r.rows[0].at).getTime() < 10 * 60_000) return { ran: false };
  }
  const report = await pollProviders(days);
  await refreshProviderStatus();
  await refreshReplies();
  return { ran: true, report };
}
