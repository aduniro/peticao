/**
 * Capitalização de nomes próprios: "mAria DA sILVA" → "Maria da Silva".
 * Usado na máscara do navegador e, de novo, no servidor antes de gravar.
 *
 * Regras (não existe regra universal; seguimos o uso corrente por idioma):
 *  - Cada palavra começa com maiúscula; também depois de hífen ("Anne-Marie") e apóstrofo ("D'Angelo", "O'Brien").
 *  - Partículas ficam em minúsculas quando NÃO são a primeira palavra: pt (da de do das dos e), es (del y; la/las/los depois de "de"),
 *    fr (de du des; la/le/les depois de "de"), it (di da del della dei degli delle dal dalla dai dallo de'), de/nl/escandinavo
 *    (von vom zu zum zur van der den ter ten te tot thoe op aan af av til), árabe/malaio (bin binti ibn bint).
 *  - "Mc" + letras: "mcdonald" → "McDonald". ("Mac" não é tratado: "Macedo", "Machado", "Maciel" são comuns no Brasil.)
 *  - Algarismos romanos finais (II, III, IV) e "Jr"/"Sr" são preservados.
 *  - Todos os caracteres acentuados/não latinos são mantidos (usa toLocaleUpperCase/LowerCase).
 */
const STRONG_LOWER = new Set([
  "da", "de", "do", "das", "dos", "e", // português
  "del", // espanhol
  "du", "des", // francês
  "di", "dei", "degli", "delle", "della", "dal", "dalla", "dallo", "dell", // italiano
  "von", "vom", "zu", "zum", "zur", "van", "der", "ter", // germânico/holandês
  "bin", "binti", "ibn", "bint", // árabe/malaio
]);
/** Podem ser sobrenome ("Wei Dai", "Maria Ten", "Ana Op"): só ficam em minúsculas em nomes com 3 ou mais palavras e nunca como última palavra. */
const AMBIGUOUS_LOWER = new Set(["y", "dai", "den", "ten", "te", "tot", "thoe", "op", "aan", "af", "av", "til"]);
const AFTER_PARTICLE_LOWER = new Set(["la", "las", "los", "le", "les", "lo", "l", "dem", "t", "'t"]); // "de la Cruz", "de los Santos", "von dem", "in 't"
const ROMAN = new Set(["ii", "iii", "iv"]);
const SUFFIX = new Map([["jr", "Jr"], ["jr.", "Jr."], ["sr", "Sr"], ["sr.", "Sr."], ["filho", "Filho"], ["neto", "Neto"]]);

// Sem "Locale": em navegadores turcos/azeris toLocaleLowerCase("I") vira "ı" e estraga e-mails e nomes.
const up = (s: string) => s.toUpperCase();
const low = (s: string) => s.toLowerCase();
const cap = (s: string) => (s ? up(s.charAt(0)) + low(s.slice(1)) : s);

/** Capitaliza uma palavra comum: depois de hífen e de apóstrofo (D'Angelo, O'Brien, Anne-Marie). */
function capWord(w: string): string {
  const lower = low(w);
  if (/^mc[a-zà-ÿ]{2,}/i.test(lower)) return "Mc" + capWord(lower.slice(2)); // "mcdonald-smith" → "McDonald-Smith"
  return lower.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + up(ch));
}

/** `final`: remove espaços duplicados e das pontas (use ao enviar/ao sair do campo). Sem `final`, preserva o espaço do fim para não atrapalhar a digitação. */
export function titleCaseName(input: string, { final = false }: { final?: boolean } = {}): string {
  const parts = input.split(/(\s+)/); // mantém os separadores
  const words = parts.filter((p) => p && !/^\s+$/.test(p));
  const total = words.length;
  let wordIndex = 0;
  let prevWasParticle = false;
  const out = parts.map((p) => {
    if (!p || /^\s+$/.test(p)) return final ? (p ? " " : p) : p;
    const lower = low(p);
    const bare = lower.replace(/[.,;:]+$/g, "");
    let res: string;
    if (wordIndex === 0) { res = capWord(p); prevWasParticle = false; }
    else if (ROMAN.has(bare)) { res = up(p); prevWasParticle = false; }
    else if (SUFFIX.has(bare)) { res = SUFFIX.get(bare)!; prevWasParticle = false; }
    else if (final && wordIndex === total - 1) { res = capWord(p); prevWasParticle = false; } // a última palavra é sobrenome ("Maria Del", "Wei Dai")
    else if (STRONG_LOWER.has(bare) || (total >= 3 && AMBIGUOUS_LOWER.has(bare))) { res = lower; prevWasParticle = true; }
    else if (/^d[e]?'$/.test(bare) || bare === "de'") { res = lower; prevWasParticle = true; } // de' (Medici), d' solto
    else if (prevWasParticle && AFTER_PARTICLE_LOWER.has(bare)) { res = lower; prevWasParticle = true; }
    else { res = capWord(p); prevWasParticle = false; }
    wordIndex++;
    return res;
  });
  const joined = out.join("");
  return final ? joined.trim().replace(/\s+/g, " ") : joined.replace(/^\s+/, "");
}

/** Normalização de e-mail: minúsculas e sem espaços nas pontas. */
export const lowerEmail = (s: string) => s.trim().toLowerCase();
