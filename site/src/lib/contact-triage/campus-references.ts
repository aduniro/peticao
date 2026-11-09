import index from "./campus-reference-index.json";
import centroids from "../../../public/data/geo/municipios-centroides.json";
import { findIfes } from "../ifes-data";
import { municipalityById, regionCriteria, regionOf } from "../geo-data";

const cursor = (s: string) => /^csv:[1-9][0-9]{0,5}$/.test(s) ? Number(s.slice(4)) : NaN;
const coordinates = centroids as Record<string, number[]>;
export const CAMPUS_REFERENCE_PROVENANCE = {
  format: index.format, sourceSnapshotDate: index.sourceSnapshotDate,
  sourceRows: index.rowCount, sourceUrlReferences: index.urlReferenceCount,
  indirectRows: index.indirectCount, sources: index.sources,
  liveVerified: false, contentArchived: false,
} as const;

/** Public local references only; this is not campus publication, geolocation or evidence of current operation. */
export function campusReferenceEvidence(input: { institution: string; cityIbge?: number; after?: string; limit?: number }) {
  if (!input || typeof input.institution !== "string" || input.institution.length > 200) return { ok: false as const, error: "invalid" };
  const institution = findIfes(input.institution);
  if (!institution) return { ok: false as const, error: "unknown_institution" };
  const municipality = input.cityIbge === undefined ? null : Number.isInteger(input.cityIbge) ? municipalityById(input.cityIbge) : null;
  const limit = input.limit ?? 50, after = input.after === undefined ? 0 : cursor(input.after);
  if (input.cityIbge !== undefined && !municipality || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(after)) return { ok: false as const, error: "invalid" };
  const rows = index.records.filter(r => r.institution === institution.s && (!municipality || r.cityIbge === municipality.id) && cursor(r.id) > after);
  const selected = rows.slice(0, limit).map(r => {
    const city = municipalityById(r.cityIbge)!;
    const pair = coordinates[String(city.id)];
    const compatibleName = r.campusName.length >= 2 && r.campusName.length <= 160 && /^[\p{L}\p{N}\p{Pd} .'’()\/]+$/u.test(r.campusName);
    const reviewCandidate = r.sourceCategory === "official_page_reference" && compatibleName && r.sourceUrl && !new URL(r.sourceUrl).search && !new URL(r.sourceUrl).hash ? { institution: r.institution, cityIbge: city.id, campusName: r.campusName, sourceUrl: new URL(r.sourceUrl).href } : null;
    return {
      ...r, municipality: city,
      listedMunicipality: institution.m === city.id || institution.c.includes(city.id),
      policyCriteria: regionCriteria(regionOf(city.id)),
      location: pair && pair.length === 2 && pair.every(Number.isFinite) ? { kind: "municipal_centroid" as const, longitude: pair[0], latitude: pair[1], campusCoordinatesKnown: false } : null,
      locationEvidence: "municipality_inferred_or_declared_not_distinguished" as const,
      reviewCandidate, sourceReviewed: false, evidenceSufficient: false,
      requiresHumanReview: true, published: false,
    };
  });
  return {
    ok: true as const, institution: { acronym: institution.s, name: institution.n }, municipality,
    provenance: CAMPUS_REFERENCE_PROVENANCE, records: selected,
    nextAfter: rows.length > limit ? rows[limit - 1].id : null,
    auditNotes: index.auditNotes.filter(n => n.institution.toLowerCase() === institution.s.toLowerCase() && (!municipality || n.cityIbge === municipality.id)),
    published: false, requiresHumanReview: true, networkUsed: false, automaticApplication: false,
  };
}
