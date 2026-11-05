// Servidor da PRÉ-VISUALIZAÇÃO. Roda dentro do sandbox, escuta em um socket Unix (sem porta TCP) e coloca
// uma página de senha na frente de TUDO (páginas, API, arquivos estáticos). Sem senha configurada, não serve nada.
import http from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import next from "next";

const GATE_DIR = process.env.GATE_DIR ?? "/state/gate";
const SOCKET = process.env.APP_SOCKET ?? "/state/run/app.sock";
const APP_DIR = process.env.APP_DIR ?? process.cwd();
const SESSION_MS = 12 * 3600_000;
// PREVIEW_PUBLIC=1: sem página de senha (acesso aberto pela internet). Mesmo assim, /dev/* (caixa de e-mails de teste, com dados de quem assinou) só responde ao acesso local.
const PUBLIC = process.env.PREVIEW_PUBLIC === "1";
// Acesso local = sem nenhum cabeçalho de proxy. Qualquer sinal de proxy/túnel conta como "vindo da internet".
const PROXY_HEADERS = ["tailscale-funnel-request", "tailscale-user-login", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip", "via"];
const fromInternet = (req) => PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
/** Caminho normalizado como o Next o enxergaria: decodificado, sem barras duplicadas, minúsculo. Falha ao decodificar = bloqueia. */
const normPath = (raw) => { try { return decodeURIComponent((raw ?? "/").split("?")[0].split("#")[0]).replace(/\/{2,}/g, "/").replace(/\/\.{1,2}(?=\/|$)/g, "").toLowerCase(); } catch { return "/dev"; } };

// --- leitura da senha (hash scrypt) e do segredo do cookie; relidas se o arquivo mudar ---
const cache = new Map();
function readCached(file) {
  try {
    const m = statSync(file).mtimeMs;
    const c = cache.get(file);
    if (c && c.m === m) return c.v;
    const v = readFileSync(file, "utf8").trim();
    cache.set(file, { m, v });
    return v;
  } catch { return null; }
}
const getHash = () => readCached(join(GATE_DIR, "password.scrypt"));
const getSecret = () => readCached(join(GATE_DIR, "cookie.secret"));

export function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const [alg, N, r, p, salt, hash] = (stored ?? "").split("$");
    if (alg !== "scrypt" || !hash) return resolve(false);
    const expected = Buffer.from(hash, "base64");
    scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      resolve(!err && key.length === expected.length && timingSafeEqual(key, expected)));
  });
}

const sign = (secret, exp) => createHmac("sha256", secret).update(String(exp)).digest("base64url");
const makeCookie = (secret) => { const exp = Date.now() + SESSION_MS; return `${exp}.${sign(secret, exp)}`; };
function cookieOk(req, secret) {
  const m = /(?:^|;\s*)gate=([^;]+)/.exec(req.headers.cookie ?? "");
  if (!m || !secret) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(secret, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- limite de tentativas de senha ---
const fails = new Map();
let globalFails = [];
function limited(key) {
  const now = Date.now(), win = 10 * 60_000;
  globalFails = globalFails.filter((t) => now - t < win);
  const arr = (fails.get(key) ?? []).filter((t) => now - t < win);
  fails.set(key, arr);
  return arr.length >= 5 || globalFails.length >= 60;
}
const addFail = (key) => { const t = Date.now(); fails.set(key, [...(fails.get(key) ?? []), t]); globalFails.push(t); };
const clientKey = (req) => (req.headers["x-forwarded-for"] ?? "").toString().split(",")[0].trim() || "local";

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const page = (title, body, next = "/", msg = "") => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2430;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #d9dee6;border-radius:10px;padding:24px 28px;max-width:380px;width:92%}
h1{font-size:1.2rem;margin:0 0 6px}p{margin:.4em 0;color:#5b6575;font-size:.92rem}input,button{font:inherit;width:100%;padding:10px;border-radius:6px;box-sizing:border-box}
input{border:1px solid #b9c1cd;margin:10px 0}button{background:#0b5d3b;color:#fff;border:0;font-weight:700;cursor:pointer}.err{color:#b42318;font-weight:600}</style></head>
<body><main>${body}</main></body></html>`;
const loginPage = (next, msg) => page("Acesso restrito", `<h1>Pré-visualização restrita</h1><p>Petição pela sanção integral do PLV nº 12/2026. Acesso apenas para quem recebeu a senha.</p>
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<form method="post" action="/__gate/login"><input type="hidden" name="next" value="${esc(next)}">
<label for="p">Senha</label><input id="p" name="password" type="password" autocomplete="current-password" required autofocus><button>Entrar</button></form>`, next);

function send(res, status, html, extra = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "same-origin", ...extra });
  res.end(html);
}
const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on("data", (c) => { n += c.length; if (n > 262144) { reject(new Error("grande")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});
const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/__gate") ? n : "/");

export async function main() {
  const app = next({ dev: false, dir: APP_DIR });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = http.createServer(async (req, res) => {
    try {
      const hash = getHash(), secret = getSecret();
      if (PUBLIC) {
        const p = normPath(req.url);
        if ((p === "/dev" || p.startsWith("/dev/") || p.includes("/dev/")) && fromInternet(req)) return send(res, 404, page("Não encontrado", "<h1>Não encontrado</h1>"));
        res.setHeader("x-robots-tag", "noindex, nofollow");
        return await handle(req, res);
      }
      if (!hash || !secret) return send(res, 503, page("Indisponível", "<h1>Pré-visualização indisponível</h1><p>A senha de acesso ainda não foi configurada.</p>"));
      const url = new URL(req.url ?? "/", "http://x");

      if (url.pathname === "/__gate/login" && req.method === "POST") {
        const key = clientKey(req);
        const form = new URLSearchParams(await readBody(req).catch(() => ""));
        const nxt = safeNext(form.get("next"));
        if (limited(key)) return send(res, 429, loginPage(nxt, "Muitas tentativas. Aguarde alguns minutos."));
        const ok = await verifyPassword((form.get("password") ?? ""), hash);
        if (!ok) { addFail(key); await new Promise((r) => setTimeout(r, 400)); return send(res, 401, loginPage(nxt, "Senha incorreta.")); }
        const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        res.writeHead(303, { location: nxt, "set-cookie": `gate=${makeCookie(secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`, "cache-control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/__gate/logout") {
        res.writeHead(303, { location: "/", "set-cookie": "gate=; HttpOnly; Path=/; Max-Age=0" });
        return res.end();
      }
      if (!cookieOk(req, secret)) {
        return send(res, 401, loginPage(safeNext(url.pathname + url.search)));
      }
      res.setHeader("x-robots-tag", "noindex, nofollow");
      await handle(req, res);
    } catch (e) {
      console.error("erro na requisição", e);
      if (!res.headersSent) send(res, 500, page("Erro", "<h1>Erro interno</h1>"));
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.maxHeadersCount = 50;

  mkdirSync(dirname(SOCKET), { recursive: true });
  if (existsSync(SOCKET)) unlinkSync(SOCKET);
  server.listen(SOCKET, () => { chmodSync(SOCKET, 0o660); console.log(`Pré-visualização no socket ${SOCKET}`); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
