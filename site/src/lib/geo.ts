import { existsSync } from "node:fs";
import { join } from "node:path";
import maxmind, { Reader } from "maxmind";
import { isPrivateIp, normalizeIp } from "./net";

/**
 * Geolocalização por IP, sem pedir nada ao visitante: cabeçalhos de cidade da Cloudflare quando houver; senão base offline (nenhum IP sai do servidor).
 * Bases DB-IP Lite (cidade e ASN), licença CC BY 4.0: "IP Geolocation by DB-IP" (https://db-ip.com).
 * Baixe/atualize com scripts/update-geo-db.sh. Sem as bases, o painel continua funcionando, sem localização.
 */
export type Geo = { country: string | null; region: string | null; city: string | null; lat: number | null; lon: number | null; isp: string | null; asn: number | null };
const EMPTY: Geo = { country: null, region: null, city: null, lat: null, lon: null, isp: null, asn: null };

const g = globalThis as unknown as { __geo?: Promise<{ city: Reader<any> | null; asn: Reader<any> | null }>; __geoOk?: boolean; __geoAt?: number };
const dir = () => process.env.GEO_DIR ?? join(process.cwd(), "geo-data");

/** Falha ao abrir as bases NÃO fica guardada para sempre: depois de GEO_RETRY_MS (padrão 30 s) a próxima consulta tenta abrir de novo. */
function readers(): Promise<{ city: Reader<any> | null; asn: Reader<any> | null }> {
  const retry = Number(process.env.GEO_RETRY_MS ?? 30_000);
  if (g.__geo && g.__geoOk === false && Date.now() - (g.__geoAt ?? 0) >= retry) g.__geo = undefined;
  g.__geo ??= (async () => {
    const open = async (f: string) => {
      if (!existsSync(join(dir(), f))) return null;
      try { return await maxmind.open<any>(join(dir(), f)); } catch (e) { console.error("geo: não abriu", f, e instanceof Error ? e.message : e); return null; }
    };
    const r = { city: await open("dbip-city-lite.mmdb"), asn: await open("dbip-asn-lite.mmdb") };
    g.__geoOk = !!r.city; g.__geoAt = Date.now();
    return r;
  })();
  return g.__geo;
}

/** Cabeçalho que pode vir em UTF-8 lido como Latin-1 ("RondÃ´nia") ou com escapes %XX. */
function fixHeader(v: string | null): string | null {
  if (!v) return null;
  let s = v.trim();
  if (/%[0-9A-F]{2}/i.test(s)) { try { s = decodeURIComponent(s); } catch { /* mantém */ } }
  if (/[\u00c0-\u00c3][\u0080-\u00bf]/.test(s)) { const u = Buffer.from(s, "latin1").toString("utf8"); if (!u.includes("\ufffd")) s = u; }
  return s || null;
}

/**
 * Localização por cidade enviada pela Cloudflare ("Add visitor location headers": cf-ipcity, cf-iplatitude…), base comercial mais precisa
 * que a DB-IP Lite. Só vale quando a requisição atual é do mesmo IP consultado e o site está atrás da Cloudflare (TRUST_CF_HEADER=1).
 * Não pede nada ao visitante (nem permissão de localização do navegador).
 */
export function geoFromCfHeaders(h: Headers, ip: string): Partial<Geo> | null {
  if (process.env.TRUST_CF_HEADER !== "1") return null;
  const cip = h.get("cf-connecting-ip")?.trim();
  if (!cip || normalizeIp(cip) !== ip) return null;
  const lat = Number(h.get("cf-iplatitude")), lon = Number(h.get("cf-iplongitude"));
  const country = h.get("cf-ipcountry")?.toUpperCase() ?? null;
  const city = fixHeader(h.get("cf-ipcity"));
  if (!city && !Number.isFinite(lat)) return null;
  return {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: fixHeader(h.get("cf-region")),
    city,
    lat: h.get("cf-iplatitude") && Number.isFinite(lat) ? lat : null,
    lon: h.get("cf-iplongitude") && Number.isFinite(lon) ? lon : null,
  };
}

async function currentHeaders(): Promise<Headers | null> {
  try { const { headers } = await import("next/headers"); return headers() as unknown as Headers; } catch { return null; } // fora de uma requisição (testes, agendador)
}

export async function lookupIp(ip: string): Promise<Geo> {
  if (!ip || isPrivateIp(ip)) return { ...EMPTY, city: ip === "local" ? null : "(rede local)" };
  try {
    const { city, asn } = await readers();
    const c = city?.get(ip);
    const a = asn?.get(ip);
    const h = await currentHeaders();
    const cfg = h ? geoFromCfHeaders(h, ip) : null;
    if (cfg) {
      // Cloudflare primeiro (cidade e coordenadas); a DB-IP completa o que faltar e dá o provedor (ASN).
      return {
        country: cfg.country ?? c?.country?.iso_code ?? null,
        region: cfg.region ?? c?.subdivisions?.[0]?.names?.en ?? null,
        city: cfg.city ?? c?.city?.names?.en ?? null,
        lat: cfg.lat ?? (typeof c?.location?.latitude === "number" ? c.location.latitude : null),
        lon: cfg.lon ?? (typeof c?.location?.longitude === "number" ? c.location.longitude : null),
        isp: a?.autonomous_system_organization ?? null,
        asn: a?.autonomous_system_number ?? null,
      };
    }
    return {
      country: c?.country?.iso_code ?? null,
      region: c?.subdivisions?.[0]?.names?.en ?? null,
      city: c?.city?.names?.en ?? null,
      lat: typeof c?.location?.latitude === "number" ? c.location.latitude : null,
      lon: typeof c?.location?.longitude === "number" ? c.location.longitude : null,
      isp: a?.autonomous_system_organization ?? null,
      asn: a?.autonomous_system_number ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function geoDbStatus(): Promise<{ city: boolean; asn: boolean }> {
  const r = await readers();
  return { city: !!r.city, asn: !!r.asn };
}
