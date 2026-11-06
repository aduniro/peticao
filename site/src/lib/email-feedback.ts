import freemail from "./freemail.json";
import { SAFE_EMAIL_RE } from "./email-syntax";

const personalDomains = new Set(freemail as string[]);

/** Keep useful corrections without suggesting personal mail in an institutional form. */
export function emailSuggestionForCategory(
  category: "servidor" | "apoiador" | "estrangeiro",
  candidate: string | null | undefined,
  issue?: string,
): string | null {
  if (!candidate || !SAFE_EMAIL_RE.test(candidate) || issue === "apoiador_institutional_email") return null;
  const domain = candidate.slice(candidate.lastIndexOf("@") + 1).toLowerCase();
  if (category !== "apoiador" && [...personalDomains].some((d) => domain === d || domain.endsWith("." + d))) return null;
  return candidate;
}
