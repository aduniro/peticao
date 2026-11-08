import { query } from "./db";
import { lookupIp } from "./geo";
import { ipVersion, normalizeIp } from "./net";
import { parseUa } from "./ua";

export const EVENT_TYPES = new Set(["pageview", "click", "form_start", "form_submit", "identity_open", "signed", "confirmed", "ref_visit", "share", "scroll"]);
const cut = (s: unknown, n: number) => (typeof s === "string" && s ? s.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : null);

export type EventInput = { visitorId: string; sessionId?: string; type: string; path?: string; target?: string; label?: string; refCode?: string; ip: string; ua: string; lang?: string; screen?: string };

/** O visitante pediu para não ser rastreado (Do Not Track ou Global Privacy Control)? Então nada é registrado. */
export const optedOut = (h: Headers) => h.get("dnt") === "1" || h.get("sec-gpc") === "1";

/** Registra um evento com localização aproximada do IP (base offline) e dados do aparelho. Robôs são ignorados. */
export async function recordEvent(e: EventInput): Promise<boolean> {
  if (!EVENT_TYPES.has(e.type) || !/^[A-Za-z0-9_-]{8,64}$/.test(e.visitorId)) return false;
  const ua = parseUa(e.ua);
  if (ua.isBot) return false;
  const ip = normalizeIp(e.ip);
  const geo = await lookupIp(ip);
  await query(
    `INSERT INTO events(ts,visitor_id,session_id,type,path,target,label,ref_code,ip,ip_version,country,region,city,lat,lon,isp,asn,os,browser,device,is_bot,ua,lang,screen)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false,$21,$22,$23)`,
    [new Date().toISOString(), e.visitorId, cut(e.sessionId, 64), e.type, cut(e.path, 300), cut(e.target, 120), cut(e.label, 120), cut(e.refCode, 12),
     ip === "local" ? null : ip, ipVersion(ip), geo.country, geo.region, geo.city, geo.lat, geo.lon, geo.isp, geo.asn, ua.os, ua.browser, ua.device, cut(e.ua, 300), cut(e.lang, 20), cut(e.screen, 20)]
  );
  return true;
}

export async function purgeOldEvents(days = Number(process.env.EVENT_RETENTION_DAYS ?? 90)): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const r = await query("DELETE FROM events WHERE ts < $1", [cutoff]);
  // Registro de requisições do mapa e tentativas inválidas seguem a mesma retenção; bloqueios vencidos e e-mails já enviados da fila saem também.
  await query("DELETE FROM request_log WHERE ts < $1", [cutoff]);
  await query("DELETE FROM invalid_attempts WHERE ts < now() - interval '30 days'");
  await query("DELETE FROM ip_blacklist WHERE expires_at IS NOT NULL AND expires_at < now()");
  await query("DELETE FROM mail_outbox WHERE status IN ('sent','failed') AND created_at < now() - interval '30 days'");
  return r.rowCount ?? 0;
}
