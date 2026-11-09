import type { DomainKind } from "./institutional";
import { normalizedInstitutionEmailDomain, resolveServerInstitutionForEmail, type InstitutionDomainMatch } from "./institution-domain-policy";
import { isInstitutionEligibleForServer } from "./institution-eligibility";

/** EBSERH é instituição autorizada por vínculo verificado ao MEC, sem ser classificada como IFES. */
export const EBSERH = {
  name: "Empresa Brasileira de Serviços Hospitalares",
  acronym: "EBSERH",
  domains: ["ebserh.gov.br", "hubrasil.gov.br"],
} as const;
export const SERVER_EMAIL_POLICY_VERSION = "2026-11-09.mec-verified-institution-binding-v4";

/** Binding deve vir do registry interno, nunca do payload enviado pelo usuário. */
export function acceptsServerDomain(
  kind: DomainKind | null | undefined,
  domain?: string | null,
  trustedBinding?: Pick<InstitutionDomainMatch, "institutionId" | "matchedDomain"> | null,
): boolean {
  if (kind === "discente" || !domain || trustedBinding === null) return false;
  const normalized = normalizedInstitutionEmailDomain(`validation@${domain.trim()}`);
  if (!normalized) return false;
  const institution = trustedBinding === undefined ? resolveServerInstitutionForEmail(`validation@${normalized}`) : trustedBinding;
  if (!institution || !isInstitutionEligibleForServer(institution.institutionId)) return false;
  return normalized === institution.matchedDomain || normalized.endsWith(`.${institution.matchedDomain}`);
}
