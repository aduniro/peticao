import policy from "@/content/name-validation-policy.json";
export const NAME_VALIDATION_POLICY = policy;

export type CpfNameMatch = "complete" | "partial" | "mismatch";

const PARTICLES = new Set(policy.ignored_particles);
const FORBIDDEN = new Set(policy.forbidden_name_words);

function words(value: string): string[] {
  // Split only at actual whitespace. Punctuation must never invent a missing
  // space ("Ana.Paula" cannot equal API "ANA PAULA"). Hífen é separador
  // válido de composto, desde que cada componente tenha grafia exata na API.
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .trim().split(/[\s-]+/u).map(word => word.replace(/['’ʼ]/g, "").replace(/\.$/, ""))
    .filter(word => word && !PARTICLES.has(word));
}

/** Exact spelling and real word boundaries only. Display-name repairs never authorize identity.
 * Partial names always require a separate identity challenge. */
export function classifyCpfName(registered: string, declared: string): CpfNameMatch {
  if (/[^\p{L}\p{M}\s.'’ʼ-]/u.test(registered + declared)) return "mismatch";
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const rawWords = (registered + " " + declared).split(/[\s-]+/u).map(word => word.replace(/['’ʼ]/g, ""));
  if (rawWords.some(word => FORBIDDEN.has(normalize(word)))) return "mismatch";
  const registry = words(registered), typed = words(declared);
  if (registry.length < policy.minimum_api_word_count || typed.length < 2 || [...registry, ...typed].some((word) => word.length < 2 || !/^[\p{L}]+(?:-[\p{L}]+)*$/u.test(word))) return "mismatch";
  if (typed.length > registry.length) return "mismatch";

  // Every typed word must be an exact API word in the same order. Short names
  // qualify only when they reach the threshold defined by API word count.
  let position = 0;
  for (const word of typed) {
    position = registry.indexOf(word, position);
    if (position < 0) return "mismatch";
    position++;
  }
  if (typed.length === registry.length) return "complete";
  const required = registry.length === 2 ? 2 : registry.length === 3 ? 2 : 3;
  return typed.length >= required ? "partial" : "mismatch";
}
