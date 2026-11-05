// Verifica, pela internet, se um domínio de e-mail "parece" ser de uma instituição de ensino real.
// ATENÇÃO (SSRF): o domínio vem de um desconhecido. Por isso: só HTTPS na porta 443, o IP é resolvido e VALIDADO como público
// antes de conectar (e fixado na conexão, contra DNS rebinding), cada redirecionamento é revalidado (máx. 2), 5 s, 200 KB.
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/** Endereço público e roteável? Recusa loopback, privados, link-local (169.254.x.x, metadados de nuvem), CGNAT, multicast, reservados e IPv6 equivalentes. */
export function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isPublicIp(mapped[1]);
    if (l === "::" || l === "::1" || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb")) return false;
    if (l.startsWith("fc") || l.startsWith("fd") || l.startsWith("ff") || l.startsWith("2001:db8") || l.startsWith("64:ff9b")) return false;
    return true;
  }
  return false;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
export function isValidHostname(h) {
  if (typeof h !== "string" || h.length > 253 || !h.includes(".")) return false;
  const labels = h.toLowerCase().split(".");
  return labels.every((l) => LABEL.test(l)) && /^[a-z]{2,}$|^xn--/.test(labels[labels.length - 1]);
}

const ACAD_TLD = /(^|\.)(edu|ac)(\.[a-z]{2})?$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$|(^|\.)uni-[a-z0-9-]+\.[a-z]{2,}$|(^|\.)univ-[a-z0-9-]+\.[a-z]{2,}$/;
const ACAD_WORDS = /(universit|universid|université|universität|hochschule|fachhochschule|college|polytechn|politécnic|politecnic|academ|akadem|institut|escola superior|faculdade|facultad|faculté|école|ecole|school of|campus|università|universiteit|egyetem|uniwersytet|univerzit|yliopisto|universitet)/i;

export function academicEvidence(host, title = "", desc = "") {
  const tld = ACAD_TLD.test(host);
  const words = ACAD_WORDS.test(`${title} ${desc}`) || ACAD_WORDS.test(host.replace(/[-.]/g, " "));
  return { tld, words, ok: tld || words };
}

async function safeLookup(host, resolver) {
  let addrs;
  try {
    addrs = await resolver.lookup(host, { all: true });
  } catch (e) {
    const code = e?.code;
    return { error: code === "ENOTFOUND" || code === "ENODATA" ? "no_dns" : "network" };
  }
  if (!addrs.length) return { error: "no_dns" };
  if (addrs.some((a) => !isPublicIp(a.address))) return { error: "private_ip" };
  return { addr: addrs[0] };
}

function fetchOnce(host, path, addr, { timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    const req = https.request({ host, servername: host, port: 443, path, method: "GET", timeout: timeoutMs,
      headers: { "user-agent": "peticao-plv12-validator/1.0 (+verificacao de dominio academico)", accept: "text/html" },
      lookup: (_h, _o, cb) => cb(null, addr.address, addr.family) }, // fixa o IP validado
    (res) => {
      const chunks = []; let n = 0;
      res.on("data", (c) => { n += c.length; if (n > maxBytes) { res.destroy(); } else chunks.push(c); });
      const done = () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: Buffer.concat(chunks).toString("utf8") });
      res.on("end", done); res.on("close", done); res.on("error", () => resolve({ status: 0 }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0 }); });
    req.on("error", () => resolve({ status: 0 }));
    req.end();
  });
}

/**
 * @returns {{ ok: boolean, reason: string, evidence?: {tld:boolean, words:boolean, title:string} }}
 * reason: "ok" | "invalid" | "no_dns" | "private_ip" | "network" | "no_mail" | "no_site" | "not_academic"
 */
export async function probeDomain(domain, opts = {}) {
  const resolver = opts.resolver ?? dns;
  const fetcher = opts.fetchOnce ?? fetchOnce;
  const timeoutMs = opts.timeoutMs ?? 5000, maxBytes = opts.maxBytes ?? 200_000;
  const host0 = String(domain).trim().toLowerCase().replace(/\.$/, "");
  if (!isValidHostname(host0)) return { ok: false, reason: "invalid" };

  // O domínio existe se tiver A/AAAA, MX ou um "www." (há universidades cujo site é só www e o raiz só recebe e-mail).
  const apex = await safeLookup(host0, resolver);
  if (apex.error === "private_ip" || apex.error === "network") return { ok: false, reason: apex.error };
  let mxOk = false;
  try { mxOk = (await resolver.resolveMx(host0)).length > 0; } catch { /* sem MX */ }
  let site = apex.error ? null : { host: host0, addr: apex.addr };
  if (!site && !host0.startsWith("www.")) {
    const w = await safeLookup("www." + host0, resolver);
    if (w.error === "private_ip" || w.error === "network") return { ok: false, reason: w.error };
    if (!w.error) site = { host: "www." + host0, addr: w.addr };
  }
  if (!site && !mxOk) return { ok: false, reason: "no_dns" };

  // TLDs de uso RESTRITO a instituições acadêmicas (edu, ac.xx, edu.xx): o domínio existir já é evidência suficiente.
  const restricted = /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(host0);
  let html = "", reached = false, path = "/";
  if (site) {
    let { host, addr } = site;
    for (let hop = 0; hop <= 2; hop++) {
      const r = await fetcher(host, path, addr, { timeoutMs, maxBytes });
      const redirect = r.status >= 300 && r.status < 400 && r.location;
      if (redirect && hop < 2) {
        let u; try { u = new URL(r.location, `https://${host}${path}`); } catch { break; }
        if (u.protocol !== "https:" || (u.port && u.port !== "443") || !isValidHostname(u.hostname)) break;
        const nx = await safeLookup(u.hostname, resolver);
        if (nx.error === "private_ip" || nx.error === "network") return { ok: false, reason: nx.error };
        if (nx.error) break;
        host = u.hostname; path = u.pathname + u.search; addr = nx.addr; continue;
      }
      if (redirect) break; // redirecionamentos demais
      // Qualquer resposta HTTP prova que o servidor existe (muitas universidades devolvem 403 a robôs); só um 2xx traz página para ler.
      if (r.status > 0) { reached = true; html = r.status < 300 ? r.body ?? "" : ""; break; }
      if (hop === 0 && !host.startsWith("www.") && !host0.startsWith("www.")) { // sem resposta: tenta o "www."
        const w = await safeLookup("www." + host0, resolver);
        if (w.error === "network") return { ok: false, reason: "network" };
        if (!w.error) { host = "www." + host0; addr = w.addr; path = "/"; continue; }
      }
      break;
    }
  }
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i.exec(html)?.[1] ?? "";
  const ev = academicEvidence(host0, title, desc);
  if (ev.ok || restricted) return { ok: true, reason: "ok", evidence: { tld: ev.tld || restricted, words: ev.words, title } };
  return { ok: false, reason: reached || mxOk ? "not_academic" : "no_site", evidence: { tld: false, words: false, title } };
}
