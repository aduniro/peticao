import { squash, type Ifes } from "./datasets-client";
import { normalizedInstitutionEmailDomain, type InstitutionDomainMatch } from "./institution-domain-policy";
export type { InstitutionDomainMatch } from "./institution-domain-policy";

export type InstitutionAutofillState = { domain: string | null; applied: boolean };

export const institutionEmailDomain = normalizedInstitutionEmailDomain;

export function institutionMatchesDomain(institution: Ifes | null, match: InstitutionDomainMatch | null): boolean {
  if (!institution || !match) return false;
  if (institution.id && match.institutionId) return institution.id === match.institutionId;
  const labels = [institution.s, institution.n, ...(institution.a ?? [])].map(squash);
  return labels.includes(squash(match.acronym)) || labels.includes(squash(match.fullName));
}

export function institutionForDomain(match: InstitutionDomainMatch | null, institutions: Ifes[]): Ifes | null {
  return match ? institutions.find((institution) => institutionMatchesDomain(institution, match)) ?? null : null;
}

/** Um preenchimento por domínio; uma escolha manual posterior continua visível para correção. */
export function institutionAutofill(
  previous: InstitutionAutofillState,
  email: string,
  match: InstitutionDomainMatch | null,
  institutions: Ifes[],
): { state: InstitutionAutofillState; institution: Ifes | null } {
  const domain = institutionEmailDomain(email);
  const state = previous.domain === domain ? previous : { domain, applied: false };
  const institution = institutionForDomain(match, institutions);
  if (!domain || state.applied || !institution) return { state, institution: null };
  return { state: { domain, applied: true }, institution };
}

export function allInstitutionCampiInAmazonia(institution: Ifes | null, amazoniaMunicipalities: ReadonlySet<number>): boolean {
  if (!institution) return false;
  const places = [...new Set([institution.m, ...institution.c])];
  return places.length > 0 && places.every((id) => amazoniaMunicipalities.has(id));
}

/** Hospital/unidade identifica a lotação; o backend deriva os mesmos dados novamente pelo ID. */
export function ebserhUnitSelection(unit: { id: string; acronym: string; city: string; municipalityIbge: number } | null, geo: { al: ReadonlySet<number>; ff: ReadonlySet<number> } | null) {
  return {
    ebserhUnit: unit?.acronym.toUpperCase() ?? "",
    ebserhUnitId: unit?.id ?? null,
    campus: unit?.city ?? "",
    campusIbge: unit?.municipalityIbge ?? null,
    region: !!unit && !!geo && (geo.al.has(unit.municipalityIbge) || geo.ff.has(unit.municipalityIbge)),
  };
}
