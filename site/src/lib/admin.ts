import { cookies } from "next/headers";
import { readFileSync, statSync } from "node:fs";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { hmac, safeEqual } from "./security";
import { lookupIp } from "./geo";
import { isPrivateIp } from "./net";

export const ADMIN_COOKIE = "adm";
/**
 * Senha do painel: se existir o arquivo ADMIN_PASSWORD_FILE (padrão /etc/peticao/admin-password.hash, formato `scrypt$N$r$p$sal$hash`),
 * ele vale e é relido quando muda (troca sem reiniciar: deploy/13-senha-admin.sh). Sem o arquivo, vale ADMIN_PASSWORD.
 * Trocar a senha encerra as sessões abertas (o cookie depende dela).
 */
const pwFile = () => process.env.ADMIN_PASSWORD_FILE ?? (process.env.NODE_ENV === "production" ? "/etc/peticao/admin-password.hash" : "");
let cache: { path: string; mtime: number; value: string | null } | null = null;
function storedHash(): string | null {
  const f = pwFile();
  if (!f) return null;
  try {
    const st = statSync(f);
    if (cache && cache.path === f && cache.mtime === st.mtimeMs) return cache.value;
    const v = readFileSync(f, "utf8").trim();
    cache = { path: f, mtime: st.mtimeMs, value: /^scrypt\$/.test(v) ? v : null };
    return cache.value;
  } catch { cache = null; return null; }
}
function verifyScrypt(p: string, stored: string): boolean {
  const [, N, r, pp, salt, hash] = stored.split("$");
  try {
    const want = Buffer.from(hash, "hex");
    const got = scryptSync(p, Buffer.from(salt, "hex"), want.length, { N: Number(N), r: Number(r), p: Number(pp), maxmem: 256 * 1024 * 1024 });
    return want.length > 0 && timingSafeEqual(got, want);
  } catch { return false; }
}
const SESSAO_MS = 4 * 3600_000;
const assina = (exp: number) => hmac(`admin-session:${exp}:` + (storedHash() ?? config.adminPassword()));

/** Sessão com validade embutida e assinada (`exp.assinatura`): não dá para estender o prazo nem reaproveitar depois de expirada. */
export function adminToken(agora = Date.now()) {
  const exp = agora + SESSAO_MS;
  return `${exp}.${assina(exp)}`;
}
export const ADMIN_SESSAO_SEGUNDOS = SESSAO_MS / 1000;

export function tokenAdminValido(c: string | undefined, agora = Date.now()): boolean {
  if (!c) return false;
  const [e, sig] = c.split(".");
  const exp = Number(e);
  if (!Number.isFinite(exp) || !sig || exp < agora || exp > agora + SESSAO_MS + 60_000) return false;
  return safeEqual(sig, assina(exp));
}

/**
 * TEMPORÁRIO (só pré-visualização): painel aberto sem senha. Só vale com ADMIN_NO_PASSWORD=1 E PREVIEW_MODE=1 — na VPS real (sem PREVIEW_MODE)
 * a variável é ignorada, mesmo copiada por engano. Como reverter: ver PENDENCIAS-MARKETING.md ("Admin sem senha — TEMPORÁRIO").
 */
export const adminSemSenha = () => process.env.ADMIN_NO_PASSWORD === "1" && process.env.PREVIEW_MODE === "1";

export function isAdmin(): boolean {
  if (adminSemSenha()) return true;
  return tokenAdminValido(cookies().get(ADMIN_COOKIE)?.value);
}

export function passwordOk(p: string) {
  const h = storedHash();
  if (h) return verifyScrypt(p, h);
  return safeEqual(hmac("pw:" + p), hmac("pw:" + config.adminPassword()));
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Quem pode abrir uma sessão no painel: IPs localizados no estado de Rondônia (base offline DB-IP), a rede interna (tailnet, localhost) e os IPs
 * listados em ADMIN_ALLOW_IPS. A senha continua obrigatória. (A Cloudflare gratuita só filtra por país; o filtro por estado é feito aqui.)
 */
export async function adminIpAllowed(ip: string): Promise<boolean> {
  // Restrição por estado DESLIGADA por padrão (decisão de 03/11/2026: acesso livre, protegido por senha e limite de tentativas). Religar com ADMIN_GEOFENCE=1.
  if (process.env.ADMIN_GEOFENCE !== "1") return true;
  if (isPrivateIp(ip)) return true;
  const extra = (process.env.ADMIN_ALLOW_IPS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (extra.includes(ip)) return true;
  const g = await lookupIp(ip);
  return g.country === "BR" && fold(g.region ?? "") === "rondonia";
}
