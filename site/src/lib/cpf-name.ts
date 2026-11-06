export type CpfNameMatch = "complete" | "partial" | "mismatch";

const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);

function words(value: string): string[] {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’ʼ]/g, "").replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/).filter((word) => word && !PARTICLES.has(word));
}

/** Compatibility only: partial names always require a separate identity challenge. */
export function classifyCpfName(registered: string, declared: string): CpfNameMatch {
  if (/[^\p{L}\p{M}\s.'’ʼ-]/u.test(registered + declared)) return "mismatch";
  const registry = words(registered), typed = words(declared);
  if (registry.length < 2 || typed.length < 2 || [...registry, ...typed].some((word) => word.length < 2)) return "mismatch";
  if (registry.length === typed.length && registry.every((word, i) => word === typed[i])) return "complete";
  if (typed.length >= registry.length) return "mismatch";

  // The API has no separate given-name/surname fields. A shortened name must
  // start at its first or second term and include a full term after those two;
  // two possible given names alone are insufficient. Ambiguity can be resolved
  // by entering the complete name, without an administrator's approval.
  for (const start of [0, 1]) {
    if (typed[0] !== registry[start]) continue;
    let position = start;
    for (const word of typed.slice(1)) {
      position = registry.indexOf(word, position + 1);
      if (position < 0) break;
    }
    if (position >= 2) return "partial";
  }
  return "mismatch";
}
