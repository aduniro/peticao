/**
 * IP do visitante. O servidor fica atrás de um proxy confiável (Tailscale Funnel, Cloudflare, nginx) que ACRESCENTA
 * o IP do cliente ao final de X-Forwarded-For; entradas anteriores podem ter sido forjadas pelo cliente.
 * Por isso usamos a entrada contada a partir do FIM (TRUSTED_PROXY_HOPS, padrão 1), nunca a primeira.
 */
export function clientIp(headers: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf && process.env.TRUST_CF_HEADER === "1") return normalizeIp(cf.trim());
  const parts = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "local";
  return normalizeIp(parts[Math.max(0, parts.length - Math.max(1, hops))]);
}

export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip.replace(/^\[|\]$/g, "");
}

export const ipVersion = (ip: string): 4 | 6 | null => (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? 4 : ip.includes(":") ? 6 : null);

export function isPrivateIp(ip: string): boolean {
  if (ip === "local") return true;
  if (ipVersion(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l.startsWith("fe80:") || l.startsWith("fc") || l.startsWith("fd");
}

/** Endereço público (esquema + host) pelo cabeçalho da requisição: funciona em localhost, no Funnel e no domínio final. `fallback` se o host for inválido. */
export function publicOrigin(h: Headers, fallback: string): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https")).split(",")[0].trim();
  const valid = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d{1,5})?$/i.test(host) && /^https?$/.test(proto);
  const allowed = (process.env.ALLOWED_HOSTS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); // opcional: lista de hosts aceitos (domínio final, Funnel, localhost)
  if (!valid || (allowed.length > 0 && !allowed.includes(host.toLowerCase()))) return fallback;
  return `${proto}://${host}`;
}

/** Endereço público desta requisição (host do proxy; reserva: APP_URL). Use no lugar de `req.url` ao montar redirecionamentos: atrás do Caddy/Cloudflare, `req.url` vira localhost:3000. */
export const requestOrigin = (h: Headers): string => publicOrigin(h, process.env.APP_URL ?? "http://localhost:3000");
