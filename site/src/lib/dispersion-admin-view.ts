import { dispersionId, type DispersionQuery, type DispersionView } from "./dispersion-admin-client";
export type DispersionOrigin = "direto" | "organizacao" | "pessoal" | "desconhecido";
export type AttributionState = "direct" | "organization" | "personal" | "unknown_code" | "unlinked_personal";
export type ChainState = "rooted" | "unknown_code" | "unlinked_personal" | "missing_owner" | "cycle" | "cycle_descendant" | "unresolved_ancestor";
export type DispersionTreeNode = { id: number; name: string; status: "pending" | "confirmed"; origin: DispersionOrigin; attributionState: AttributionState; ownerId: number | null; parentName: string | null; generation: number | null; chainState: ChainState; rootIssueId: number | null; cycleSize: number | null; invited: number; invitedConfirmed: number; reach: number | null };
export type DispersionAllRow = DispersionTreeNode & { email: string; category: "servidor" | "apoiador" | "estrangeiro"; institution: string | null; emailDomain: string | null; emailInstitution: string | null; emailDomainKind: string | null; emailDomainKindLabel: string | null; identityMethod: string | null; consentAt: string; confirmedAt: string | null; confirmSameVisitor: boolean | null; refCode: string | null; orgLabel: string | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, s: string) => Object.keys(v).sort().join(",") === s.split(",").sort().join(",");
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !v.includes("\u0000");
const nullableText = (v: unknown) => v === null || text(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 35 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
export const ORIGIN_LABELS: Record<DispersionOrigin, string> = { direto: "Link direto / sem rastreio", organizacao: "Código de organização", pessoal: "Indicação de um assinante", desconhecido: "Código não identificado" };
// MUDAR AQUI: diagnósticos de vínculos de indicação, não da validade da assinatura.
export const CHAIN_LABELS: Record<ChainState, string> = { rooted: "Cadeia vinculada", unknown_code: "Código de indicação não localizado", unlinked_personal: "Código pessoal sem vínculo de origem", missing_owner: "Origem pessoal não localizada", cycle: "Ciclo no vínculo de indicação", cycle_descendant: "Vínculo descendente de um ciclo", unresolved_ancestor: "Vínculo anterior sem resolução" };
const nodeKeys = "id,name,status,origin,attributionState,ownerId,parentName,generation,chainState,rootIssueId,cycleSize,invited,invitedConfirmed,reach";
const allKeys = "email,category,institution,emailDomain,emailInstitution,emailDomainKind,emailDomainKindLabel,identityMethod,consentAt,confirmedAt,confirmSameVisitor,refCode,orgLabel";
export function parseDispersionNode(value: unknown, full = false): DispersionTreeNode | DispersionAllRow | null {
  if (!object(value) || !keys(value, full ? `${nodeKeys},${allKeys}` : nodeKeys) || !dispersionId(value.id) || !text(value.name) || !["pending", "confirmed"].includes(String(value.status)) || !Object.keys(ORIGIN_LABELS).includes(String(value.origin)) || !["direct", "organization", "personal", "unknown_code", "unlinked_personal"].includes(String(value.attributionState)) || !Object.keys(CHAIN_LABELS).includes(String(value.chainState)) || value.ownerId !== null && !dispersionId(value.ownerId) || !nullableText(value.parentName) || value.generation !== null && !count(value.generation) || value.rootIssueId !== null && !dispersionId(value.rootIssueId) || value.cycleSize !== null && (!count(value.cycleSize) || value.cycleSize < 1) || !count(value.invited) || !count(value.invitedConfirmed) || value.invitedConfirmed > value.invited || value.reach !== null && !count(value.reach)) return null;
  if (value.chainState === "rooted" ? value.generation === null || value.reach === null || value.rootIssueId !== null || value.cycleSize !== null : value.generation !== null || value.reach !== null) return null;
  if (full && (!text(value.email) || !["servidor", "apoiador", "estrangeiro"].includes(String(value.category)) || !["institution", "emailDomain", "emailInstitution", "emailDomainKind", "emailDomainKindLabel", "identityMethod", "refCode", "orgLabel"].every(k => nullableText(value[k])) || !date(value.consentAt) || value.confirmedAt !== null && !date(value.confirmedAt) || value.confirmSameVisitor !== null && typeof value.confirmSameVisitor !== "boolean")) return null;
  return { ...value } as unknown as DispersionTreeNode | DispersionAllRow;
}
export function validDispersionRows(rows: unknown, query: DispersionQuery) {
  if (!Array.isArray(rows) || rows.length > (query.limit ?? 50)) return null;const parsed: (DispersionTreeNode | DispersionAllRow)[] = [];
  for (const row of rows) { const next = parseDispersionNode(row, query.view === "all");if (!next || (parsed.length ? next.id >= parsed.at(-1)!.id : query.before !== undefined && next.id >= query.before) || query.view === "children" && next.ownerId !== query.parentId || query.view === "diagnostics" && next.chainState === "rooted") return null;parsed.push(next); }
  return parsed;
}
export type DispersionEnvelopeCore = { view: DispersionView; asOf: string; total: number; rows: (DispersionTreeNode | DispersionAllRow)[]; nextBefore: number | null; focus: DispersionTreeNode | null };
export function parseDispersionEnvelopeCore(v: unknown, query: DispersionQuery): DispersionEnvelopeCore | null {
  if (!object(v) || !keys(v,"ok,view,asOf,summary,coverage,total,rows,nextBefore,focus") || v.ok !== true || v.view !== query.view || !date(v.asOf) || !count(v.total)) return null;
  const rows = validDispersionRows(v.rows, query);if (!rows || rows.length > v.total || v.nextBefore !== null && (!dispersionId(v.nextBefore) || rows.length !== (query.limit ?? 50) || rows.at(-1)?.id !== v.nextBefore)) return null;
  const focus = v.focus === null ? null : parseDispersionNode(v.focus);if (query.view === "children" ? !focus || focus.id !== query.parentId : v.focus !== null) return null;
  return { view: query.view, asOf: v.asOf, total: v.total, rows, nextBefore: v.nextBefore as number | null, focus };
}

import type { DispersionGraphCoverage, DispersionGraphSummary, DispersionMetricCoverage } from "./dispersion-graph-contract";
export type DispersionPage = DispersionEnvelopeCore & { summary: DispersionGraphSummary; coverage: DispersionGraphCoverage };
function metric(v: unknown): v is DispersionMetricCoverage {
  return object(v) && keys(v,"numerator,denominator,unknown,complete") && count(v.numerator) && count(v.denominator) && count(v.unknown) && v.numerator <= v.denominator && v.unknown <= v.denominator && typeof v.complete === "boolean";
}
export function parseDispersionPage(value: unknown, query: DispersionQuery): DispersionPage | null {
  const core = parseDispersionEnvelopeCore(value, query);if (!core || !object(value)) return null;const s = value.summary, c = value.coverage;
  if (!object(s) || !keys(s,"total,confirmed,pending,byOrigin,byGeneration,spreaders,avgInvitedPerConfirmed,deepShare,sameDevice,notSameDevice,unknownDevice,metricCoverage") || ![s.total,s.confirmed,s.pending,s.sameDevice,s.notSameDevice,s.unknownDevice].every(count) || (s.confirmed as number) + (s.pending as number) !== s.total || (s.sameDevice as number) + (s.notSameDevice as number) + (s.unknownDevice as number) !== s.confirmed || !object(s.byOrigin) || !keys(s.byOrigin,"direto,organizacao,pessoal,desconhecido") || !Array.isArray(s.byGeneration) || !Array.isArray(s.spreaders) || s.spreaders.length > 10 || !object(s.metricCoverage) || !keys(s.metricCoverage,"avgInvitedPerConfirmed,deepShare")) return null;
  for (const k of ["avgInvitedPerConfirmed","deepShare"] as const) {
    const m = s.metricCoverage[k], ratio = s[k];if (!metric(m) || m.denominator !== s.confirmed || ratio !== null && (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1 || !m.complete || m.denominator === 0 || Math.abs(ratio - m.numerator / m.denominator) > 1e-9)) return null;
  }
  let originTotal = 0, originConfirmed = 0, originPending = 0;
  for (const v of Object.values(s.byOrigin)) { if (!object(v) || !keys(v,"total,confirmed,pending") || ![v.total,v.confirmed,v.pending].every(count) || (v.confirmed as number) + (v.pending as number) !== v.total) return null;originTotal += v.total as number;originConfirmed += v.confirmed as number;originPending += v.pending as number; }
  if (originTotal !== s.total || originConfirmed !== s.confirmed || originPending !== s.pending) return null;
  let genTotal = 0, genConfirmed = 0, genPending = 0, last = -1, sawUnknown = false;
  for (const g of s.byGeneration) { if (!object(g) || !keys(g,"generation,total,confirmed,pending") || ![g.total,g.confirmed,g.pending].every(count) || (g.confirmed as number) + (g.pending as number) !== g.total || sawUnknown || g.generation !== null && (!count(g.generation) || g.generation <= last)) return null;if (g.generation === null) sawUnknown = true;else last = g.generation as number;genTotal += g.total as number;genConfirmed += g.confirmed as number;genPending += g.pending as number; }
  if (genTotal !== s.total || genConfirmed !== s.confirmed || genPending !== s.pending) return null;
  const seen = new Set<number>();for (const p of s.spreaders) { if (!object(p) || !keys(p,"id,name,invited,invitedConfirmed,reach") || !dispersionId(p.id) || seen.has(p.id) || !text(p.name) || ![p.invited,p.invitedConfirmed,p.reach].every(count) || (p.invitedConfirmed as number) > (p.invited as number)) return null;seen.add(p.id); }
  if (!object(c) || !keys(c,"total,analyzed,complete,attributionKnown,attributionUnknown,generationKnown,generationUnknown,generationKnownConfirmed,generationUnknownConfirmed,reachKnown,reachUnknown,rankingExcluded,chainStates") || c.complete !== true || !Object.entries(c).filter(([k]) => !["complete","chainStates"].includes(k)).every(([,v]) => count(v)) || c.total !== s.total || c.analyzed !== s.total || (c.attributionKnown as number) + (c.attributionUnknown as number) !== c.total || (c.generationKnown as number) + (c.generationUnknown as number) !== c.total || (c.generationKnownConfirmed as number) + (c.generationUnknownConfirmed as number) !== s.confirmed || (c.reachKnown as number) + (c.reachUnknown as number) !== c.total || !object(c.chainStates) || !keys(c.chainStates,Object.keys(CHAIN_LABELS).join(",")) || !Object.values(c.chainStates).every(count) || Object.values(c.chainStates).reduce((a,b) => (a as number) + (b as number),0) !== c.total) return null;
  return { ...core, summary: s as unknown as DispersionGraphSummary, coverage: c as unknown as DispersionGraphCoverage };
}
