import registry from "../../public/data/institution-registry.json";

export type InstitutionEligibility = {
  linkedToMec: boolean;
  status: "verified" | "not_linked" | "pending";
  evidenceUrls: string[];
  reason: string;
  verifiedAt: string;
};

const eligibilityById = new Map<string, InstitutionEligibility>(
  registry.map((institution) => [institution.id, institution.eligibility as InstitutionEligibility])
);

/** Administrative MEC affiliation, separate from domain ownership or course accreditation.
 * Unknown institutions and missing evidence never grant server eligibility.
 */
export function getInstitutionEligibility(institutionId: string | null | undefined): InstitutionEligibility | null {
  const eligibility = institutionId ? eligibilityById.get(institutionId) : undefined;
  return eligibility ? { ...eligibility, evidenceUrls: [...eligibility.evidenceUrls] } : null;
}

export function isInstitutionEligibleForServer(institutionId: string | null | undefined): boolean {
  const eligibility = getInstitutionEligibility(institutionId);
  return eligibility?.linkedToMec === true && eligibility.status === "verified" && eligibility.evidenceUrls.length > 0;
}
