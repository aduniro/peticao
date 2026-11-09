import { SAFE_EMAIL_RE } from "./email-syntax";

/** Recognized supporter domains, not IFES approvals or exemptions from validation. */
export const SUPPORTER_KNOWN_DOMAINS = ["ucpel.edu.br", "sou.ucpel.edu.br"] as const;

export function isKnownSupporterEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!SAFE_EMAIL_RE.test(normalized)) return false;
  return (SUPPORTER_KNOWN_DOMAINS as readonly string[]).includes(normalized.slice(normalized.lastIndexOf("@") + 1));
}
