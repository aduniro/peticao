/** Extração de domínios (e-mails e sites) para os importadores de domínios institucionais. Funções puras. */
const BR_SECOND_LEVEL = new Set([
  "com", "org", "net", "edu", "gov", "mil", "leg", "jus", "mp", "def", "art", "adm", "adv", "arq", "bio", "eco", "emp", "eng", "esp", "etc", "far", "fnd",
  "fot", "g12", "ind", "inf", "jor", "lel", "med", "mus", "not", "odo", "ppg", "pro", "psc", "psi", "rec", "srv", "tur", "vet",
]);

/** `www.reitoria.unir.br` → `unir.br`; `x.sp.gov.br` → `sp.gov.br`; `a.b.com.br` → `b.com.br`. */
export function registrableDomain(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || h.includes("..")) return null;
  const l = h.split(".");
  if (l.length < 2) return null;
  if (l[l.length - 1] === "br" && l.length >= 3 && BR_SECOND_LEVEL.has(l[l.length - 2])) return l.slice(-3).join(".");
  return l.slice(-2).join(".");
}

/** Domínios (registráveis) encontrados em e-mails e URLs dentro de um texto qualquer. */
export function extractDomains(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    const d = registrableDomain(m[1]);
    if (d) out.add(d);
  }
  for (const m of text.matchAll(/(?:https?:\/\/)?((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?::\d+)?(?:[\/?#]|\s|$)/g)) {
    const d = registrableDomain(m[1]);
    if (d) out.add(d);
  }
  return [...out];
}
