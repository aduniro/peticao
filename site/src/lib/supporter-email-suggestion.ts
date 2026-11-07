import freemail from "./freemail.json";
import { distancia } from "./email-diagnostico";
import { SAFE_EMAIL_RE } from "./email-syntax";

/** Editorial suggestion priority, not delivery statistics or an acceptance allowlist. */
export const SUPPORTER_PROVIDER_PRIORITY = [
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com.br", "yahoo.com",
  "icloud.com", "live.com", "uol.com.br", "bol.com.br", "terra.com.br",
  "protonmail.com", "proton.me", "gmx.com",
] as const;
const legitimate = new Set<string>(freemail);

/** Prefix and ordered letters disambiguate truncated domains; exact domains remain untouched. */
export function supporterEmailSuggestion(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || legitimate.has(domain)) return null;
  const stem = domain.split(".")[0];
  if (!/^[a-z]+$/.test(stem)) return null;
  let best: { domain: string; score: number } | null = null;
  for (const [priority, candidate] of SUPPORTER_PROVIDER_PRIORITY.entries()) {
    const target = candidate.split(".")[0];
    let score: number;
    if (target === stem) score = 0;
    else if (target.startsWith(stem)) score = 1;
    else {
      const edits = distancia(stem, target);
      if (stem.length < 3 || edits > (target.length < 7 ? 1 : 2)) continue;
      score = 2 + edits;
    }
    // Preserve provider priority for ambiguous prefixes, use suffix similarity to break siblings.
    score += priority / 100 + distancia(domain, candidate) / 10000;
    if (!best || score < best.score) best = { domain: candidate, score };
  }
  const result = best ? `${email.slice(0, at)}@${best.domain}` : null;
  return result && SAFE_EMAIL_RE.test(result) ? result : null;
}
