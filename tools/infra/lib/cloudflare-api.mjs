// Cliente mínimo da API v4 da Cloudflare (DNS). A chave só fica em memória; nunca é impressa.
const BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }

export function createCfClient({ token, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error("sem token da Cloudflare");
  async function call(method, path, body) {
    const r = await fetchImpl(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const msg = (j.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
      const hint = r.status === 403 ? " (o token precisa de Zone → DNS → Edit nesta zona)" : r.status === 401 ? " (token inválido)" : "";
      throw new CloudflareError(r.status, `Cloudflare HTTP ${r.status}${msg ? ` — ${msg}` : ""}${hint}`, j);
    }
    return j;
  }
  return { get: (p) => call("GET", p), patch: (p, b) => call("PATCH", p, b), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), del: (p) => call("DELETE", p) };
}

export const findZone = async (cf, name) => (await cf.get(`/zones?name=${encodeURIComponent(name)}&per_page=5`)).result?.[0] ?? null;
export const listDns = async (cf, zoneId) => (await cf.get(`/zones/${zoneId}/dns_records?per_page=500`)).result ?? [];

/** Registros desejados do site: A e AAAA no apex e CNAME do www, todos com o proxy da Cloudflare ligado. */
export function siteRecords(domain, { ipv4, ipv6 }) {
  const r = [];
  if (ipv4) r.push({ type: "A", name: domain, content: ipv4, proxied: true, ttl: 1 });
  if (ipv6) r.push({ type: "AAAA", name: domain, content: ipv6, proxied: true, ttl: 1 });
  r.push({ type: "CNAME", name: `www.${domain}`, content: domain, proxied: true, ttl: 1 });
  return r;
}

const norm6 = (a) => String(a).toLowerCase().replace(/(^|:)0+(?=[0-9a-f])/g, "$1");
const same = (a, b) => (a.type === "AAAA" ? norm6(a.content) === norm6(b.content) : a.content.toLowerCase() === b.content.toLowerCase());

/** Compara com o que já existe: criar, manter (já igual) ou conflito (mesmo nome/tipo com outro conteúdo, ou CNAME x outro tipo). Nunca apaga nada. */
export function planDns(existing, desired) {
  return desired.map((d) => {
    const sameName = existing.filter((e) => e.name.toLowerCase() === d.name.toLowerCase());
    const exact = sameName.find((e) => e.type === d.type && same(e, d));
    if (exact) return { action: "manter", record: d, found: exact, note: exact.proxied ? "já existe (proxy ligado)" : "já existe, mas SEM proxy" };
    const clash = sameName.filter((e) => e.type === d.type || e.type === "CNAME" || d.type === "CNAME");
    if (clash.length) return { action: "conflito", record: d, found: clash, note: `já existe ${clash.map((c) => `${c.type} → ${c.content}`).join(", ")}` };
    return { action: "criar", record: d };
  });
}
