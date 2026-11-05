/**
 * "Você quis dizer …?": sugere o domínio certo quando o digitado parece um erro de digitação de um domínio conhecido
 * (instituições federais de ensino, órgãos e provedores comuns). Só sugere; nunca recusa nem corrige sozinho.
 * Atenção: "edu.br" é domínio legítimo de várias universidades (ex.: ufpa.edu.br consta como aprovado), então o sufixo sozinho nunca é erro.
 */
export const KNOWN_DOMAINS: readonly string[] = ["am.gov.br", "bol.com.br", "cefet-rj.br", "cefetmg.br", "ebserh.gov.br", "furg.br", "furg.edu.br", "gmail.com", "hotmail.com", "icloud.com", "ifac.edu.br", "ifal.edu.br", "ifam.edu.br", "ifap.edu.br", "ifb.edu.br", "ifba.edu.br", "ifbaiano.edu.br", "ifcatarinense.edu.br", "ifce.edu.br", "ifes.edu.br", "iff.edu.br", "iffarroupilha.edu.br", "ifg.edu.br", "ifgoiano.edu.br", "ifma.edu.br", "ifmg.edu.br", "ifms.edu.br", "ifmt.edu.br", "ifnmg.edu.br", "ifpa.edu.br", "ifpb.edu.br", "ifpe.edu.br", "ifpi.edu.br", "ifpr.edu.br", "ifrj.edu.br", "ifrn.edu.br", "ifro.edu.br", "ifrr.edu.br", "ifrs.edu.br", "ifs.edu.br", "ifsc.edu.br", "ifsertao-pe.edu.br", "ifsp.edu.br", "ifsudestemg.edu.br", "ifsul.edu.br", "ifsuldeminas.edu.br", "iftm.edu.br", "ifto.edu.br", "iscp.edu.br", "ita.br", "live.com", "mg.gov.br", "outlook.com", "proton.me", "protonmail.com", "sou.ufac.br", "terra.com.br", "ufabc.edu.br", "ufac.br", "ufal.br", "ufal.edu.br", "ufam.edu.br", "ufape.edu.br", "ufba.br", "ufba.edu.br", "ufc.br", "ufc.edu.br", "ufca.edu.br", "ufcat.edu.br", "ufcg.edu.br", "ufcspa.edu.br", "ufdpar.edu.br", "ufersa.edu.br", "ufes.br", "uff.br", "uffs.edu.br", "ufg.br", "ufgd.edu.br", "ufj.edu.br", "ufjf.br", "ufjf.edu.br", "ufla.br", "ufma.br", "ufmg.br", "ufms.br", "ufmt.br", "ufnt.edu.br", "ufob.edu.br", "ufop.br", "ufop.edu.br", "ufopa.edu.br", "ufpa.br", "ufpa.edu.br", "ufpb.br", "ufpe.br", "ufpel.edu.br", "ufpi.br", "ufpi.edu.br", "ufpr.br", "ufr.edu.br", "ufra.edu.br", "ufrb.edu.br", "ufrgs.br", "ufrj.br", "ufrj.edu.br", "ufrn.br", "ufrn.edu.br", "ufrpe.br", "ufrr.br", "ufrrj.br", "ufs.br", "ufsb.edu.br", "ufsc.br", "ufscar.br", "ufsj.edu.br", "ufsm.br", "uft.edu.br", "uftm.edu.br", "ufu.br", "ufv.br", "ufvjm.edu.br", "unb.br", "unifal-mg.edu.br", "unifap.br", "unifei.edu.br", "unifesp.br", "unifesp.edu.br", "unifesspa.edu.br", "unila.edu.br", "unilab.edu.br", "unipampa.edu.br", "unir.br", "unirio.br", "univasf.edu.br", "uol.com.br", "utfpr.edu.br", "yahoo.com", "yahoo.com.br"];

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Melhor domínio conhecido para o digitado, ou null. Domínio já conhecido não gera sugestão, a menos que `semServidor` seja verdadeiro
 * (o servidor de e-mail do domínio não existe, como ufpa.edu.br): aí procuramos outro domínio conhecido com a mesma sigla ou quase igual.
 */
export function suggestDomain(domain: string, o: { known?: readonly string[]; semServidor?: boolean } = {}): string | null {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  const known = o.known ?? KNOWN_DOMAINS;
  if (d.length < 4 || !d.includes(".")) return null;
  if (known.includes(d) && !o.semServidor) return null;
  const stem = d.split(".")[0];
  let best: { c: string; score: number } | null = null;
  for (const c of known) {
    if (c === d) continue;
    const dist = editDistance(d, c);
    const sameStem = stem.length >= 3 && c.split(".")[0] === stem;
    const score = sameStem ? 0.5 + dist / 100 : dist <= 2 ? dist : Infinity; // mesma sigla vence; entre elas, a mais parecida
    if (score !== Infinity && (!best || score < best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

/** Endereço completo corrigido (mantém a parte local), ou null. */
export function suggestEmail(email: string, o: { known?: readonly string[]; semServidor?: boolean } = {}): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const s = suggestDomain(email.trim().slice(at + 1), o);
  return s ? `${email.trim().slice(0, at)}@${s}`.toLowerCase() : null;
}
