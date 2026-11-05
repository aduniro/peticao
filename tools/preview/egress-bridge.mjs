// PONTE DE SAÍDA da pré-visualização. Roda FORA do sandbox (que não tem rede) e atende, por um socket Unix, APENAS dois pedidos:
//   GET /cpf/<11 dígitos>   → consulta a CPF Brasil com a chave que fica no disco do computador (a chave nunca entra no sandbox)
//   GET /domain/<nome>      → checa, pela internet, se o domínio parece de uma instituição de ensino (com proteção contra SSRF)
// Qualquer outro caminho/método é recusado. Limites de uso por minuto. Nenhuma URL (que contém CPF) é registrada.
import http from "node:http";
import https from "node:https";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeDomain, isValidHostname } from "../../site/src/lib/domain-probe.mjs";

const MAX_BODY = 20_000;

function defaultUpstream(cpf, key) {
  return new Promise((resolve) => {
    const req = https.request({ host: "api.cpf-brasil.org", path: `/cpf/${cpf}`, method: "GET", timeout: 5000, headers: { "X-API-Key": key, accept: "application/json" } }, (res) => {
      const chunks = []; let n = 0;
      res.on("data", (c) => { n += c.length; if (n <= MAX_BODY) chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ status: 502, body: JSON.stringify({ code: "NETWORK" }) }));
    req.end();
  });
}

/** Limite deslizante simples: no máximo `max` pedidos por minuto. */
function limiter(max, now) {
  let hits = [];
  return () => { const t = now(); hits = hits.filter((x) => t - x < 60_000); if (hits.length >= max) return false; hits.push(t); return true; };
}

export function createBridge({ getKey, upstream = defaultUpstream, probe = probeDomain, now = Date.now, cpfPerMinute = 30, domainPerMinute = 60 } = {}) {
  const okCpf = limiter(cpfPerMinute, now), okDom = limiter(domainPerMinute, now);
  const send = (res, status, obj, raw) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(raw ?? JSON.stringify(obj)); };
  return async (req, res) => {
    if (req.method !== "GET") return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
    const url = req.url ?? "";
    let m;
    if ((m = /^\/cpf\/(\d{11})$/.exec(url))) {
      if (!okCpf()) return send(res, 429, { code: "RATE_LIMITED" });
      const key = getKey?.();
      if (!key) return send(res, 503, { code: "NO_KEY" });
      const r = await upstream(m[1], key);
      return send(res, r.status, null, (r.body ?? "").slice(0, MAX_BODY));
    }
    if ((m = /^\/domain\/([A-Za-z0-9.%-]{3,253})$/.exec(url))) {
      let d; try { d = decodeURIComponent(m[1]).toLowerCase(); } catch { return send(res, 400, { code: "BAD_REQUEST" }); }
      if (!isValidHostname(d)) return send(res, 400, { code: "INVALID_DOMAIN" });
      if (!okDom()) return send(res, 429, { code: "RATE_LIMITED" });
      return send(res, 200, await probe(d));
    }
    return send(res, 404, { code: "NOT_ALLOWED" });
  };
}

/** Lê a chave do disco a cada pedido (acompanha a troca de chave sem reiniciar). */
function keyReader(files) {
  const cache = new Map();
  return () => {
    for (const f of files) {
      try {
        const m = statSync(f).mtimeMs; const c = cache.get(f);
        if (c && c.m === m) return c.v;
        const v = readFileSync(f, "utf8").trim(); cache.set(f, { m, v }); if (v) return v;
      } catch { /* arquivo ausente */ }
    }
    return null;
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [socket, state, root] = process.argv.slice(2);
  if (!socket) { console.error("uso: node egress-bridge.mjs <socket> <preview-state> <raiz-do-projeto>"); process.exit(1); }
  const getKey = keyReader([join(state, "secrets", "cpf-brasil-api-key"), join(root, "secrets", "cpf-brasil-api-key")]);
  mkdirSync(dirname(socket), { recursive: true });
  if (existsSync(socket)) unlinkSync(socket);
  const server = http.createServer(createBridge({ getKey }));
  server.listen(socket, () => { chmodSync(socket, 0o600); console.log(`ponte de saída em ${socket} (chave ${getKey() ? "encontrada" : "AUSENTE"})`); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}
