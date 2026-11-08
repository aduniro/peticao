import { KNOWN_DOMAINS, suggestDomain } from "./email-typos";
import freemailList from "./freemail.json";

/**
 * Política central de diagnóstico de e-mail digitado errado (função pura, igual no navegador e no servidor).
 * Em vez de só dizer "e-mail inválido", devolve O QUE está errado, o que deveria estar no lugar e como digitar:
 *  - estrutura: sem @, mais de um @, espaço, vírgula no lugar do ponto, domínio incompleto ("fulano@gmail");
 *  - provedor aberto digitado errado ("gmial.com", "gmail.con" → gmail.com): erro quase certo, por isso BLOQUEIA;
 *  - mesmo provedor com final diferente ("gmail.com.br", "hotmail.fr"): só bloqueia se o domínio não receber e-mail (quem decide é o servidor);
 *  - domínio institucional ou da lista do site parecido com um conhecido ("ufpa.edu.gov" → ufpa.edu.br): sugere.
 * "Conhecidos" = lista fixa + provedores abertos + domínios do banco (aprovados na curadoria, inclusive os inseridos à mão).
 */
export type Problema = "espaco" | "sem_arroba" | "varios_arrobas" | "virgula" | "sem_final" | "provedor" | "final" | "parecido";
export type Diagnostico = {
  problema: Problema;
  /** O pedaço digitado que está errado (domínio, ou "@"/"espaço" nos erros de estrutura). */
  errado: string;
  /** O que deveria estar no lugar (domínio correto), quando dá para saber. */
  correto: string | null;
  /** Endereço completo corrigido, mantendo a parte antes do @. */
  sugestao: string | null;
  /** Exemplo de como digitar (o próprio endereço corrigido, ou um modelo). */
  exemplo: string;
  /** Erro quase certo: o formulário não deixa seguir. Falso = só sugere (ou o servidor decide). */
  bloqueia: boolean;
};

const EXEMPLO = "seunome@gmail.com";
/** Provedores abertos mais usados: alvo das correções automáticas. */
export const PROVEDORES_ABERTOS: readonly string[] = ["gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "yahoo.com", "yahoo.com.br", "icloud.com", "live.com", "uol.com.br", "bol.com.br", "terra.com.br", "protonmail.com"];
/** Domínios legítimos que ficam a 1 letra de um provedor grande (nunca tratados como erro). */
const LEGITIMOS = ["email.com", "mail.com", "gmx.com", "me.com", "msn.com", "ymail.com", "aol.com", "zoho.com"];

const distanciaMaxima = (alvo: string) => (alvo.length < 10 ? 1 : 2); // alvo curto (gmail.com, live.com) tolera 1 erro; os demais 2

/** Distância de edição que conta a troca de duas letras vizinhas como 1 erro ("gmial" → "gmail"), o erro de digitação mais comum. */
export function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

export function diagnosticar(raw: string, known: readonly string[] = []): Diagnostico | null {
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  // alvos = domínios que podem ser SUGERIDOS; validos = alvos + o resto dos provedores gratuitos (redes sociais, encurtadores…), que são válidos mas nunca sugeridos
  const alvos = new Set<string>([...KNOWN_DOMAINS, ...LEGITIMOS, ...PROVEDORES_ABERTOS, ...known.map((d) => d.toLowerCase())]);
  const conhecidos = new Set<string>([...alvos, ...(freemailList as string[])]);
  const mk = (problema: Problema, errado: string, correto: string | null, sugestao: string | null, bloqueia: boolean): Diagnostico =>
    ({ problema, errado, correto, sugestao, exemplo: sugestao ?? EXEMPLO, bloqueia });

  if (/\s/.test(e)) { const sem = e.replace(/\s+/g, ""); return mk("espaco", "espaço", null, sem.includes("@") ? sem : null, true); }
  const arrobas = (e.match(/@/g) ?? []).length;
  if (arrobas === 0) {
    // "fulanogmail.com": termina num domínio conhecido, faltou o @
    const d = [...conhecidos].filter((x) => e.length > x.length && e.endsWith(x)).sort((a, b) => b.length - a.length)[0];
    const local = d ? e.slice(0, e.length - d.length).replace(/[.\-_]+$/, "") : "";
    return mk("sem_arroba", e, d ?? null, d && local ? `${local}@${d}` : null, true);
  }
  if (arrobas > 1) return mk("varios_arrobas", "@", null, null, true);
  const [local, dom] = e.split("@");
  if (!local || !dom) return null; // a sintaxe básica cuida disso
  if (dom.includes(",")) { const fix = dom.replace(/,/g, "."); return mk("virgula", dom, fix, `${local}@${fix}`, true); }
  if (dom.endsWith(".")) { const fix = dom.replace(/\.+$/, ""); return mk("final", dom, fix, `${local}@${fix}`, true); }
  if (!dom.includes(".")) {
    const c = [...alvos].filter((x) => x.split(".")[0] === dom).sort((a, b) => a.length - b.length)[0]; // "gmail" → gmail.com
    return mk("sem_final", dom, c ?? null, c ? `${local}@${c}` : null, true);
  }
  if (conhecidos.has(dom)) return null;

  // provedor aberto digitado errado: gmial.com, gmai.com, gmail.con, hotmial.com…
  let melhor: { p: string; d: number } | null = null;
  for (const p of PROVEDORES_ABERTOS) { const d = distancia(dom, p); if (d <= distanciaMaxima(p) && (!melhor || d < melhor.d)) melhor = { p, d }; }
  if (melhor) return mk("provedor", dom, melhor.p, `${local}@${melhor.p}`, true);

  // mesmo provedor com final diferente (gmail.com.br, hotmail.fr): suspeito, mas há versões legítimas por país; o servidor decide pelo MX
  const stem = dom.split(".")[0];
  const irmao = PROVEDORES_ABERTOS.filter((p) => p.split(".")[0] === stem).sort((a, b) => distancia(dom, a) - distancia(dom, b))[0];
  if (irmao) return mk("final", dom, irmao, `${local}@${irmao}`, false);

  // domínio institucional ou da lista do site parecido com um conhecido
  const s = suggestDomain(dom, { known: [...alvos] });
  if (s) return mk("parecido", dom, s, `${local}@${s}`, false);
  return null;
}

/** Detalhe para uma sugestão que já foi calculada por outro caminho (servidor sem MX, domínio institucional etc.). */
export function detalheDeSugestao(email: string, sugestao: string): Diagnostico | null {
  const at = email.trim().lastIndexOf("@"), at2 = sugestao.lastIndexOf("@");
  if (at < 1 || at2 < 1) return null;
  const errado = email.trim().slice(at + 1).toLowerCase(), correto = sugestao.slice(at2 + 1).toLowerCase();
  if (!errado || !correto || errado === correto) return null;
  const aberto = PROVEDORES_ABERTOS.includes(correto);
  return { problema: aberto ? "provedor" : "parecido", errado, correto, sugestao: sugestao.toLowerCase(), exemplo: sugestao.toLowerCase(), bloqueia: false };
}
