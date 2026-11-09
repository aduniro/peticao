import { normalizedInstitutionEmailDomain } from "./institution-domain-policy";
import { query } from "./db";
import { getInstitutionEligibility, isInstitutionEligibleForServer, type InstitutionEligibility } from "./institution-eligibility";

export type InstitutionIdentity = {
  institutionId: string;
  acronym: string;
  fullName: string;
  matchedDomain: string;
};
export type InstitutionDomainRecord = {
  domain: string;
  status: "approved" | "pending" | "rejected";
  includeSubdomains: boolean;
  kind: string;
  evidenceUrl: string | null;
};
export type RegisteredInstitution = {
  id: string;
  acronym: string;
  fullName: string;
  aliases: string[];
  evidenceUrl: string | null;
  domains: InstitutionDomainRecord[];
  eligibility?: InstitutionEligibility | null;
};

/** Lista uma instituição uma única vez, com todos os seus domínios em objetos separados. */
export async function listInstitutions(): Promise<RegisteredInstitution[]> {
  const { rows } = await query<RegisteredInstitution>(
    `SELECT id, acronym, full_name AS "fullName", aliases, evidence_url AS "evidenceUrl", domains
     FROM institution_registry_with_domains ORDER BY acronym, id`
  );
  return rows.map((institution) => ({ ...institution, eligibility: getInstitutionEligibility(institution.id) }));
}

/** Lista elegível para o formulário Servidor, sem remover históricos administrativos. */
export async function listServerInstitutions(): Promise<RegisteredInstitution[]> {
  return (await listInstitutions()).filter((institution) => isInstitutionEligibleForServer(institution.id));
}

/** Consulta a curadoria atual; rejeição de subdomínio prevalece sobre a aprovação do pai.
 * Reconhecer a instituição não comprova vínculo funcional nem substitui MX/validação do e-mail.
 */
export async function resolveInstitutionOwnerForEmail(email: string): Promise<InstitutionIdentity | null> {
  const domain = normalizedInstitutionEmailDomain(email);
  if (!domain) return null;
  const { rows } = await query<{
    status: string;
    institutionId: string | null;
    acronym: string | null;
    fullName: string | null;
    matchedDomain: string;
  }>(
    `SELECT d.status, i.id AS "institutionId", i.acronym, i.full_name AS "fullName", d.domain AS "matchedDomain"
     FROM institutional_domains d LEFT JOIN institution_registry i ON i.id=d.institution_id
     WHERE d.status IN ('approved','rejected')
       AND d.domain NOT IN ('br','gov.br','edu.br','com.br','org.br')
       AND (d.domain=$1 OR (d.include_subdomains AND right($1,length(d.domain)+1)='.'||d.domain))
     ORDER BY length(d.domain) DESC LIMIT 1`,
    [domain]
  );
  const match = rows[0];
  return match?.status === "approved" && match.institutionId && match.acronym && match.fullName
    ? { institutionId: match.institutionId, acronym: match.acronym, fullName: match.fullName, matchedDomain: match.matchedDomain }
    : null;
}

/** Server permission is checked after ownership resolution; a military owner remains auditable. */
export async function resolveInstitutionForEmail(email: string): Promise<InstitutionIdentity | null> {
  const owner = await resolveInstitutionOwnerForEmail(email);
  return owner && isInstitutionEligibleForServer(owner.institutionId) ? owner : null;
}
