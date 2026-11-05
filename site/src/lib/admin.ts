import { cookies } from "next/headers";
import { readFileSync, statSync } from "node:fs";
import { verificarHash } from "./senha";
import { sessaoPorToken, temUsuarios, type SessaoAdmin } from "./admin-users";
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

/** Sessão que a pré-visualização usa quando o painel está sem senha (só com PREVIEW_MODE=1). */
const SESSAO_PREVIEW: SessaoAdmin = { userId: 0, email: "preview@local", nome: "Pré-visualização", nivel: "total", sessaoId: null, legado: false, preview: true, stepupAte: null, trocarSenha: false };
/** Sessão da senha única antiga: equivale ao dono (nível total), mas SÓ enquanto não existir nenhum usuário cadastrado. */
const SESSAO_LEGADO: SessaoAdmin = { userId: 0, email: "senha-unica@local", nome: "Senha única", nivel: "total", sessaoId: null, legado: true, preview: false, stepupAte: null, trocarSenha: false };

/**
 * Quem está logado no painel, ou null. A fonte da verdade é o banco: usuário ativo, sessão não expirada e nível atual. Enquanto não existir
 * nenhum usuário cadastrado vale a senha única antiga (transição); depois que existir o primeiro, ela deixa de valer.
 * Substitui o antigo isAdmin() síncrono (removido de propósito, para ninguém voltar a conferir só o cookie).
 */
export async function sessaoDoCookie(c: string | undefined): Promise<SessaoAdmin | null> {
  if (adminSemSenha()) return SESSAO_PREVIEW;
  if (!c) return null;
  if (await temUsuarios()) return sessaoPorToken(c);
  return tokenAdminValido(c) ? SESSAO_LEGADO : null;
}
/** Páginas (servidor): lê o cookie do contexto da requisição. As rotas de API usam sessaoDoCookie(req.cookies.get(ADMIN_COOKIE)?.value). */
export const sessaoAdmin = () => sessaoDoCookie(cookies().get(ADMIN_COOKIE)?.value);

export function passwordOk(p: string) {
  const h = storedHash();
  if (h) return verificarHash(p, h);
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
