import { query } from "./db";
import { checkMx } from "./email-check";
import { KNOWN_DOMAINS, suggestEmail } from "./email-typos";
import { emailDomain, approvedDomains, classifyDomain } from "./institutional";
import { EBSERH } from "./server-email-policy";

/**
 * Domínios que o banco já conhece, usados nos avisos "você quis dizer…?" e na política central de e-mail (lib/email-diagnostico.ts):
 *  - todos os domínios APROVADOS na tabela de curadoria (os semeados das IFES e os inseridos à mão pela plataforma, de qualquer tipo);
 *  - domínios frequentes entre as assinaturas confirmadas (3 ou mais);
 *  - para estrangeiros, também os domínios da base mundial de universidades;
 *  - somados à lista fixa. Domínios rejeitados ou pendentes (ainda sem curadoria) NUNCA são sugeridos: podem ser eles mesmos erros de digitação.
 */
// Cache global (sobrevive ao hot reload) e compartilhado com institutional.ts, que o zera quando a curadoria decide um domínio (sem import circular).
type Cache = Record<string, { at: number; list: string[] }>;
const g = globalThis as unknown as { __domSug?: Cache };
const cacheMap = (): Cache => (g.__domSug ??= {});
export async function dominiosConhecidos(estrangeiro = false): Promise<string[]> {
  const k = estrangeiro ? "mundo" : "br";
  const c = cacheMap()[k];
  if (c && Date.now() - c.at < 10 * 60_000) return c.list;
  const a = await query<{ d: string }>("SELECT lower(domain) d FROM institutional_domains WHERE status='approved'");
  const b = await query<{ d: string }>("SELECT lower(split_part(email,'@',2)) d FROM signatures WHERE status='confirmed' GROUP BY 1 HAVING COUNT(*) >= 3");
  const w = estrangeiro ? await query<{ d: string }>("SELECT DISTINCT lower(domain) d FROM world_universities WHERE domain IS NOT NULL AND domain <> ''") : { rows: [] as { d: string }[] };
  const list = [...new Set([...KNOWN_DOMAINS, ...a.rows.map((r) => r.d), ...b.rows.map((r) => r.d), ...w.rows.map((r) => r.d)])].filter(Boolean);
  cacheMap()[k] = { at: Date.now(), list };
  return list;
}
export const _limparDominios = () => { g.__domSug = undefined; };

/** Approved IFES plus the explicit EBSERH exception; never generic public-sector domains. */
export async function dominiosIfes(): Promise<string[]> {
  const rules = await approvedDomains();
  return [...new Set([...EBSERH.domains, ...rules.filter(r => r.status === "approved" && r.kind === "ifes" && classifyDomain(r.domain, rules)?.kind === "ifes").map(r => r.domain)])];
}

export type Sugestao = { sugestao: string | null; motivo: string | null };

/** Sugere o e-mail provável (só o domínio é corrigido; erro na parte antes do @ não dá para adivinhar). */
export async function sugerir(email: string, mxOverride?: "ok" | "none" | "erro"): Promise<Sugestao> {
  const dom = emailDomain(email) ?? "";
  const mx = mxOverride ?? (await checkMx(email));
  const known = await dominiosConhecidos();
  const s = suggestEmail(email, { known, semServidor: mx === "none" });
  if (!s || s.toLowerCase() === email.trim().toLowerCase()) return { sugestao: null, motivo: null };
  const novoDom = emailDomain(s) ?? "";
  return { sugestao: s, motivo: mx === "none" ? `o domínio ${dom} não recebe e-mail; o mais parecido é ${novoDom}` : `${dom} parece erro de digitação de ${novoDom}` };
}
