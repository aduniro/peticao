// Operações do Vultr usadas pelo CLI (separadas para poderem ser testadas com um `fetch` simulado).
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const GB10 = 10 * 1024 ** 3;

/** A URL atende aos requisitos do Vultr? (link direto, sem `?`, sem redirecionamento, .iso, < 10 GB) */
export async function checkIsoUrl(url, fetchImpl = globalThis.fetch) {
  const problems = [];
  let u;
  try { u = new URL(url); } catch { return { ok: false, problems: ["URL inválida."], size: null }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") problems.push("Use um endereço http(s).");
  if (u.username || u.password) problems.push("A URL não pode ter usuário/senha.");
  if (u.search) problems.push("A URL não pode ter parâmetros (?…).");
  if (!u.pathname.toLowerCase().endsWith(".iso")) problems.push("O nome do arquivo precisa terminar em .iso.");
  let size = null;
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400) problems.push(`O endereço redireciona (HTTP ${res.status} → ${res.headers.get("location") ?? "?"}). O Vultr recusa redirecionamentos: use o link final.`);
    else if (res.status !== 200) problems.push(`O endereço respondeu HTTP ${res.status}.`);
    else {
      size = Number(res.headers.get("content-length")) || null;
      if (size && size >= GB10) problems.push("A ISO tem 10 GB ou mais (limite do Vultr).");
    }
  } catch (e) { problems.push(`Não consegui acessar o endereço (${e.cause?.code ?? e.message}).`); }
  return { ok: problems.length === 0, problems, size };
}

export async function listIsos(client) {
  const d = await client.get("/iso?per_page=100");
  return d?.isos ?? [];
}

/** Cria a ISO a partir de uma URL; avisa antes se já há 2 ISOs na conta. */
export async function createIso(client, url) {
  const existing = (await listIsos(client)).filter((i) => i.status !== "deleted");
  if (existing.length >= 2) throw new Error(`A conta já tem ${existing.length} ISOs (limite de 2 no Vultr). Apague uma com: iso:apagar <id>`);
  const d = await client.post("/iso", { url });
  return d?.iso ?? d;
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera a ISO ficar pronta ("complete"). Devolve a ISO final. */
export async function waitIso(client, id, { intervalMs = 10_000, timeoutMs = 30 * 60_000, sleep = sleepDefault, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const iso = (await client.get(`/iso/${id}`))?.iso;
    onTick?.(iso);
    if (iso?.status === "complete") return iso;
    if (iso?.status && !["pending", "downloading"].includes(iso.status)) throw new Error(`Estado inesperado da ISO: ${iso.status}`);
    if (Date.now() - t0 > timeoutMs) throw new Error("Tempo esgotado esperando a ISO ficar pronta.");
    await sleep(intervalMs);
  }
}

/** Compara o SHA-512 devolvido pelo Vultr com o oficial informado. */
export const sha512Matches = (iso, expected) => !!iso?.sha512sum && !!expected && iso.sha512sum.toLowerCase() === expected.trim().toLowerCase();

/** Baixa a ISO para uma pasta temporária, confere o SHA-256 com o SHA256SUMS do mesmo diretório oficial e apaga o arquivo. */
export async function verifyLocalSha256(url, dir, { fetchImpl = globalThis.fetch, keep = false } = {}) {
  const u = new URL(url);
  const file = basename(u.pathname);
  const sumsUrl = new URL("SHA256SUMS", u).toString();
  const sums = await (await fetchImpl(sumsUrl)).text();
  const line = sums.split("\n").map((l) => l.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)).find((m) => m && m[2] === file);
  if (!line) throw new Error(`Não achei ${file} em ${sumsUrl}`);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, file);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const hash = createHash("sha256");
  const tap = new (await import("node:stream")).Transform({ transform(c, _e, cb) { hash.update(c); cb(null, c); } });
  await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(dest));
  const got = hash.digest("hex");
  if (!keep) rmSync(dest, { force: true });
  return { ok: got === line[1].toLowerCase(), expected: line[1].toLowerCase(), got, sumsUrl };
}

export function instancePayload(o) {
  const miss = ["iso", "plano", "regiao", "rotulo", "hostname"].filter((k) => !o[k]);
  if (miss.length) throw new Error(`Faltam opções: ${miss.map((m) => `--${m}`).join(", ")}`);
  const p = { region: o.regiao, plan: o.plano, iso_id: o.iso, label: o.rotulo, hostname: o.hostname, backups: o.backups ? "enabled" : "disabled", enable_ipv6: !!o.ipv6 };
  if (o.tag) p.tags = [o.tag];
  return p;
}

/** Sem `confirmado`, só devolve o que SERIA enviado (nenhuma chamada). */
export async function createInstance(client, o, confirmado) {
  const payload = instancePayload(o);
  if (!confirmado) return { simulacao: true, payload };
  const d = await client.post("/instances", payload);
  return { simulacao: false, instance: d?.instance ?? d };
}

export const detachIso = (client, id) => client.post(`/instances/${id}/iso/detach`);
export const getInstance = async (client, id) => (await client.get(`/instances/${id}`))?.instance;
export const listInstances = async (client) => (await client.get("/instances?per_page=100"))?.instances ?? [];
export const deleteInstance = (client, id) => client.del(`/instances/${id}`);

// ---------- Firewall (grupo do Vultr) e IPv6 ----------
import { isIPv4, isIPv6 } from "node:net";

const CIDR_RE = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
export const splitCidr = (c) => { const [subnet, n] = c.split("/"); return { subnet, subnet_size: Number(n) }; };

/** Faixas públicas da Cloudflare (https://www.cloudflare.com/ips-v4 e ips-v6). Recusa linhas que não sejam CIDR válido. */
export async function fetchCloudflareRanges(fetchImpl = globalThis.fetch) {
  const get = async (u) => {
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Não consegui ler ${u} (HTTP ${r.status})`);
    return (await r.text()).split("\n").map((l) => l.trim()).filter(Boolean);
  };
  const v4 = await get("https://www.cloudflare.com/ips-v4"), v6 = await get("https://www.cloudflare.com/ips-v6");
  for (const c of v4) if (!CIDR_RE.test(c) || !isIPv4(c.split("/")[0]) || splitCidr(c).subnet_size > 32) throw new Error(`Faixa IPv4 inesperada da Cloudflare: ${c}`);
  for (const c of v6) if (!CIDR_RE.test(c) || !isIPv6(c.split("/")[0]) || splitCidr(c).subnet_size > 128) throw new Error(`Faixa IPv6 inesperada da Cloudflare: ${c}`);
  if (!v4.length || !v6.length) throw new Error("Lista de faixas da Cloudflare vazia.");
  return { v4, v6 };
}

/** Expande um IPv6 e devolve o prefixo /64 (ex.: 2804:14d:cc84:8308::). */
export function v6Prefix64(addr) {
  if (!isIPv6(addr)) throw new Error(`IPv6 inválido: ${addr}`);
  let [head, tail = null] = addr.split("::");
  const h = head ? head.split(":") : [], t = tail === null ? [] : tail ? tail.split(":") : [];
  const full = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::";
}

/** Regras do grupo "site": 443 só dos IPs da Cloudflare; SSH só do(s) IP(s) informado(s). Nada mais entra. */
export function buildSiteRules({ cf, sshV4, sshV6, webPorts = ["443"] }) {
  const rules = [];
  for (const port of webPorts) {
    for (const c of cf.v4) rules.push({ ip_type: "v4", protocol: "tcp", ...splitCidr(c), port, notes: "Cloudflare" });
    for (const c of cf.v6) rules.push({ ip_type: "v6", protocol: "tcp", ...splitCidr(c), port, notes: "Cloudflare" });
  }
  if (sshV4) { if (!isIPv4(sshV4)) throw new Error(`IPv4 inválido: ${sshV4}`); rules.push({ ip_type: "v4", protocol: "tcp", subnet: sshV4, subnet_size: 32, port: "22", notes: "SSH - meu IP" }); }
  if (sshV6) { rules.push({ ip_type: "v6", protocol: "tcp", subnet: v6Prefix64(sshV6), subnet_size: 64, port: "22", notes: "SSH - meu prefixo IPv6" }); }
  return rules;
}

export const listFirewalls = async (client) => (await client.get("/firewalls?per_page=100"))?.firewall_groups ?? [];
export const listFirewallRules = async (client, id) => (await client.get(`/firewalls/${id}/rules?per_page=500`))?.firewall_rules ?? [];

/** Cria o grupo e as regras. Recusa se o total passar do limite do Vultr. */
export async function createSiteFirewall(client, description, rules) {
  const group = (await client.post("/firewalls", { description }))?.firewall_group;
  if (group?.max_rule_count && rules.length > group.max_rule_count) {
    await client.del(`/firewalls/${group.id}`).catch(() => {});
    throw new Error(`São ${rules.length} regras e o limite do grupo é ${group.max_rule_count}.`);
  }
  for (const r of rules) await client.post(`/firewalls/${group.id}/rules`, r);
  return group;
}

export const enableIpv6 = async (client, id) => (await client.patch(`/instances/${id}`, { enable_ipv6: true }))?.instance;

/** Anexa o grupo à instância e confirma que o SSH continua acessível; se não, tenta desanexar. */
export async function applyFirewall(client, groupId, instanceId, { check, waitMs = 8000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!(await check())) throw new Error("O SSH já não responde ANTES de aplicar; nada foi alterado.");
  await client.patch(`/instances/${instanceId}`, { firewall_group_id: groupId });
  await sleep(waitMs);
  for (let i = 0; i < 3; i++) { if (await check()) return { ok: true }; await sleep(3000); }
  let reverted = false;
  try { await client.patch(`/instances/${instanceId}`, { firewall_group_id: "" }); reverted = true; } catch { /* mostrado abaixo */ }
  return { ok: false, reverted };
}
