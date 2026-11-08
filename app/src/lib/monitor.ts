import { query } from "./db";

export type Window = "1h" | "24h" | "7d" | "30d" | "all";
export const sinceOf = (w: Window): string => {
  const ms = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3, all: 0 }[w] ?? 86400e3;
  return ms ? new Date(Date.now() - ms).toISOString() : "1970-01-01T00:00:00.000Z";
};

export type Summary = { visitors: number; pageviews: number; clicks: number; formStarts: number; signedVisitors: number; confirmedVisitors: number };
export type Point = { lat: number; lon: number; city: string | null; region: string | null; country: string | null; visitors: number; signed: number };
export type VisitorRow = {
  visitor_id: string; ip: string | null; ip_version: number | null; country: string | null; region: string | null; city: string | null; lat: number | null; lon: number | null;
  isp: string | null; asn: number | null; os: string | null; browser: string | null; device: string | null; ref_code: string | null;
  first_seen: string; last_seen: string; pageviews: number; clicks: number; paths: string[] | null; sig_status: string | null;
};
export type EventRow = { ts: string; type: string; path: string | null; target: string | null; label: string | null; ref_code: string | null };

export async function monitorSummary(since: string): Promise<Summary> {
  const r = (await query<any>(
    `SELECT COUNT(DISTINCT visitor_id)::int visitors,
       COUNT(*) FILTER (WHERE type='pageview')::int pageviews,
       COUNT(*) FILTER (WHERE type='click')::int clicks,
       COUNT(DISTINCT visitor_id) FILTER (WHERE type='form_start')::int form_starts
     FROM events WHERE ts >= $1 AND is_bot=false`, [since])).rows[0];
  const s = (await query<any>(
    `SELECT COUNT(DISTINCT e.visitor_id)::int signed, COUNT(DISTINCT e.visitor_id) FILTER (WHERE s.status='confirmed')::int confirmed
     FROM events e JOIN signatures s ON s.visitor_id = e.visitor_id WHERE e.ts >= $1 AND e.is_bot=false`, [since])).rows[0];
  return { visitors: r.visitors, pageviews: r.pageviews, clicks: r.clicks, formStarts: r.form_starts, signedVisitors: s.signed, confirmedVisitors: s.confirmed };
}

/** Pontos do mapa: visitantes agrupados por localização aproximada (arredondada a ~1 km). */
export async function monitorPoints(since: string): Promise<Point[]> {
  return (await query<Point>(
    `WITH last AS (
       SELECT DISTINCT ON (visitor_id) visitor_id, lat, lon, city, region, country FROM events
       WHERE ts >= $1 AND is_bot=false AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY visitor_id, ts DESC)
     SELECT ROUND(l.lat::numeric,2)::float lat, ROUND(l.lon::numeric,2)::float lon, MAX(l.city) city, MAX(l.region) region, MAX(l.country) country,
       COUNT(*)::int visitors,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM signatures s WHERE s.visitor_id = l.visitor_id))::int signed
     FROM last l GROUP BY 1,2 ORDER BY visitors DESC LIMIT 2000`, [since])).rows;
}

export async function monitorVisitors(since: string, limit = 300): Promise<VisitorRow[]> {
  return (await query<VisitorRow>(
    `WITH ev AS (SELECT * FROM events WHERE ts >= $1 AND is_bot=false),
     last AS (SELECT DISTINCT ON (visitor_id) visitor_id, ip, ip_version, country, region, city, lat, lon, isp, asn, os, browser, device, ref_code FROM ev ORDER BY visitor_id, ts DESC),
     agg AS (SELECT visitor_id, MIN(ts) first_seen, MAX(ts) last_seen,
               COUNT(*) FILTER (WHERE type='pageview')::int pageviews, COUNT(*) FILTER (WHERE type='click')::int clicks,
               array_agg(DISTINCT path) FILTER (WHERE path IS NOT NULL) paths FROM ev GROUP BY visitor_id)
     SELECT l.*, a.first_seen, a.last_seen, a.pageviews, a.clicks, a.paths, s.status AS sig_status
     FROM last l JOIN agg a USING (visitor_id)
     LEFT JOIN LATERAL (SELECT status FROM signatures WHERE visitor_id = l.visitor_id ORDER BY (status='confirmed') DESC LIMIT 1) s ON true
     ORDER BY a.last_seen DESC LIMIT $2`, [since, limit])).rows;
}

export async function visitorTimeline(vid: string): Promise<EventRow[]> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(vid)) return [];
  return (await query<EventRow>("SELECT ts,type,path,target,label,ref_code FROM events WHERE visitor_id=$1 ORDER BY ts LIMIT 500", [vid])).rows;
}

export type RequestPoint = { lat: number; lon: number; city: string | null; region: string | null; country: string | null; confirmed: number; pending: number; invalid: number; blocked: number; queued: number };
export type RequestRow = { ts: string; kind: string; ip: string | null; city: string | null; region: string | null; country: string | null; detail: string | null; sig_status: string | null };

/** Pontos do mapa das requisições de assinatura e de segurança, por localização aproximada: confirmadas, aguardando e-mail, e-mail inexistente, bloqueios e e-mails na fila. */
export async function monitorRequestPoints(since: string): Promise<RequestPoint[]> {
  return (await query<RequestPoint>(
    `SELECT ROUND(r.lat::numeric,2)::float lat, ROUND(r.lon::numeric,2)::float lon, MAX(r.city) city, MAX(r.region) region, MAX(r.country) country,
       COUNT(*) FILTER (WHERE r.kind='sign_confirmed')::int confirmed,
       COUNT(*) FILTER (WHERE r.kind='sign_pending' AND s.status='pending')::int pending,
       COUNT(*) FILTER (WHERE r.kind='email_invalid')::int invalid,
       COUNT(*) FILTER (WHERE r.kind = 'email_blocked')::int blocked,
       COUNT(*) FILTER (WHERE r.kind='mail_queued')::int queued
     FROM request_log r LEFT JOIN signatures s ON s.id = r.signature_id
     WHERE r.ts >= $1 AND r.lat IS NOT NULL AND r.lon IS NOT NULL GROUP BY 1,2 ORDER BY COUNT(*) DESC LIMIT 2000`, [since])).rows;
}

export async function monitorRequests(since: string, limit = 300): Promise<RequestRow[]> {
  return (await query<RequestRow>(
    `SELECT r.ts, r.kind, r.ip, r.city, r.region, r.country, r.detail, s.status AS sig_status
     FROM request_log r LEFT JOIN signatures s ON s.id = r.signature_id WHERE r.ts >= $1 ORDER BY r.ts DESC LIMIT $2`, [since, limit])).rows;
}
