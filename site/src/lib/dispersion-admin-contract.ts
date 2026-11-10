import type { DispersionGraphCoverage, DispersionGraphNode, DispersionGraphSummary } from "./dispersion-graph-contract";

export type DispersionActor = { userId: number; email: string; sessaoId: number | null };
export type DispersionView = "all" | "roots" | "children" | "diagnostics";
export type DispersionOptions = { view?: DispersionView; parentId?: number; before?: number; limit?: number };
export type DispersionAllRow = DispersionGraphNode & {
  email: string; category: string; institution: string | null; emailDomain: string | null;
  emailInstitution: string | null; emailDomainKind: string | null; emailDomainKindLabel: string | null;
  identityMethod: string | null; consentAt: string; confirmedAt: string | null;
  confirmSameVisitor: boolean | null; refCode: string | null; orgLabel: string | null;
};
export type DispersionFailure = { ok: false; error: "invalid" | "forbidden" | "not_found" | "unavailable" };
export type DispersionResult = {
  ok: true; view: DispersionView; asOf: string; summary: DispersionGraphSummary; coverage: DispersionGraphCoverage;
  total: number; rows: (DispersionGraphNode | DispersionAllRow)[]; nextBefore: number | null; focus: DispersionGraphNode | null;
};
export const dispersionId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
export function validDispersionActor(actor: DispersionActor): boolean {
  return !!actor && dispersionId(actor.userId) && dispersionId(actor.sessaoId) && typeof actor.email === "string" && actor.email.length > 0 && actor.email.length <= 254;
}
export function dispersionOptions(raw: unknown = {}): Required<Pick<DispersionOptions, "view" | "limit">> & Pick<DispersionOptions, "parentId" | "before"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["view", "parentId", "before", "limit"].includes(k))) return null;
  const v = raw as DispersionOptions;
  const view = v.view ?? "all";
  if (!["all", "roots", "children", "diagnostics"].includes(view) || (v.before !== undefined && !dispersionId(v.before)) || (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))) return null;
  if (view === "children" ? !dispersionId(v.parentId) : v.parentId !== undefined) return null;
  return { view, limit: v.limit ?? 50, ...(v.before === undefined ? {} : { before: v.before }), ...(v.parentId === undefined ? {} : { parentId: v.parentId }) };
}
export function dispersionSearch(params: URLSearchParams): DispersionOptions | null {
  const value: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    if (!["view", "parentId", "before", "limit"].includes(key) || params.getAll(key).length !== 1) return null;
    if (key === "view") value.view = raw;
    else { if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null; value[key] = Number(raw); }
  }
  return dispersionOptions(value);
}
