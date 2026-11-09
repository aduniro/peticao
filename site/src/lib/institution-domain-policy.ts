import catalog from "../../public/data/institution-domain-catalog.json";
import { isInstitutionEligibleForServer } from "./institution-eligibility";

export type InstitutionDomainRule = {
  institutionId: string;
  acronym: string;
  fullName: string;
  domain: string;
  status: "approved" | "rejected";
  includeSubdomains?: boolean;
};
export type InstitutionDomainMatch = {
  institutionId: string;
  acronym: string;
  fullName: string;
  matchedDomain: string;
};

export function normalizedInstitutionEmailDomain(email: string): string | null {
  const pieces = email.trim().split("@");
  if (pieces.length !== 2 || !pieces[0] || /\s/.test(email)) return null;
  const value = pieces[1].toLowerCase().replace(/\.$/, "");
  if (!value || /[\s/%?#:@\\\[\]]/.test(value)) return null;
  try {
    const domain = new URL(`http://${value}`).hostname;
    if (domain.length > 253 || !domain.includes(".") || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return domain;
  } catch { return null; }
}

/** Correlação institucional, separada da elegibilidade e da entrega do e-mail. */
export function resolveInstitutionForEmail(email: string, rules: readonly InstitutionDomainRule[] = catalog as InstitutionDomainRule[]): InstitutionDomainMatch | null {
  const domain = normalizedInstitutionEmailDomain(email);
  if (!domain) return null;
  const matching = rules.filter((rule) => domain === rule.domain || (rule.includeSubdomains !== false && domain.endsWith(`.${rule.domain}`)));
  if (!matching.length) return null;
  const length = Math.max(...matching.map((rule) => rule.domain.length));
  const specific = matching.filter((rule) => rule.domain.length === length);
  if (specific.some((rule) => rule.status !== "approved") || new Set(specific.map((rule) => rule.institutionId)).size !== 1) return null;
  const rule = specific[0];
  return { institutionId: rule.institutionId, acronym: rule.acronym, fullName: rule.fullName, matchedDomain: rule.domain };
}


/** Permissão no formulário Servidor é distinta da titularidade do domínio. */
export function resolveServerInstitutionForEmail(email: string, rules?: readonly InstitutionDomainRule[]): InstitutionDomainMatch | null {
  const owner = resolveInstitutionForEmail(email, rules);
  return owner && isInstitutionEligibleForServer(owner.institutionId) ? owner : null;
}
