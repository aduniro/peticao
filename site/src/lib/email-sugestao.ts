import { query } from "./db";
import { checkMx } from "./email-check";
import { KNOWN_DOMAINS, suggestEmail } from "./email-typos";
import { emailDomain } from "./institutional";

/** Domínios que o banco já conhece (aprovados na curadoria e os mais frequentes entre as assinaturas confirmadas), somados à lista fixa. */
let cache: { at: number; list: string[] } | null = null;
export async function dominiosConhecidos(): Promise<string[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  const a = await query<{ d: string }>("SELECT lower(domain) d FROM institutional_domains WHERE status='approved'");
  const b = await query<{ d: string }>("SELECT lower(split_part(email,'@',2)) d FROM signatures WHERE status='confirmed' GROUP BY 1 HAVING COUNT(*) >= 3");
  const list = [...new Set([...KNOWN_DOMAINS, ...a.rows.map((r) => r.d), ...b.rows.map((r) => r.d)])].filter(Boolean);
  cache = { at: Date.now(), list };
  return list;
}
export const _limparDominios = () => { cache = null; };

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
