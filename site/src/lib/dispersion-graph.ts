import type { DispersionChainState, DispersionCount, DispersionGraph, DispersionGraphInput, DispersionGraphNode, DispersionGraphSummary, DispersionMetricCoverage, DispersionOrigin } from "./dispersion-graph-contract";
const id = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;
const nullableString = (value: unknown) => value === null || typeof value === "string";
const requireValue = (condition: unknown, code: string) => { if (!condition) throw new Error(code); };
type Resolved = { generation: number | null; chainState: DispersionChainState; rootIssueId: number | null; cycleSize: number | null };
const empty = (): DispersionCount => ({ total: 0, confirmed: 0, pending: 0 });
const count = (value: DispersionCount, confirmed: boolean) => { value.total++; if (confirmed) value.confirmed++; else value.pending++; };
const metric = (numerator: number, denominator: number, unknown: number): DispersionMetricCoverage => ({ numerator, denominator, unknown, complete: unknown === 0 });
/** Complete O(N+E) functional-graph analysis, including rootless components. Output/index order preserves input order (the store can SELECT id DESC). */
export function analyzeDispersionGraph(input: readonly DispersionGraphInput[], expectedTotal: number = input.length): DispersionGraph {
  requireValue(Array.isArray(input) && Number.isSafeInteger(expectedTotal) && expectedTotal >= 0 && input.length === expectedTotal, "dispersion_incomplete_source");
  const source = new Map<number, DispersionGraphInput>(), byId = new Map<number, DispersionGraphNode>(), children = new Map<number, number[]>(), resolved = new Map<number, Resolved>();
  for (const row of input) {
    requireValue(row && id(row.id) && !source.has(row.id) && typeof row.name === "string" && ["confirmed", "pending"].includes(row.status) && nullableString(row.refCode) && typeof row.referrerFound === "boolean" && (row.ownerId === null || id(row.ownerId)) && nullableString(row.referrerDisplayName) && nullableString(row.orgLabel) && [null, true, false].includes(row.confirmSameVisitor), "dispersion_invalid_input");
    requireValue(row.referrerFound ? row.refCode !== null : row.ownerId === null && row.referrerDisplayName === null && row.orgLabel === null, "dispersion_inconsistent_referrer");
    source.set(row.id, row);
  }
  for (const row of input) {
    const personal = row.referrerFound && (row.ownerId !== null || row.referrerDisplayName !== null);
    const unknown = row.refCode !== null && !row.referrerFound;
    const origin: DispersionOrigin = unknown ? "desconhecido" : !row.referrerFound ? "direto" : personal ? "pessoal" : "organizacao";
    const attributionState = unknown ? "unknown_code" : origin === "direto" ? "direct" : origin === "organizacao" ? "organization" : row.ownerId === null ? "unlinked_personal" : "personal";
    const node: DispersionGraphNode = { id: row.id, name: row.name, status: row.status, origin, attributionState, ownerId: row.ownerId, parentName: row.ownerId === null ? null : source.get(row.ownerId)?.name ?? null, generation: null, chainState: "unresolved_ancestor", invited: 0, invitedConfirmed: 0, reach: null, rootIssueId: null, cycleSize: null };
    byId.set(row.id, node);
    if (row.ownerId !== null) { const list = children.get(row.ownerId); if (list) list.push(row.id); else children.set(row.ownerId, [row.id]); }
    const issue = (chainState: DispersionChainState): Resolved => ({ chainState, generation: null, rootIssueId: row.id, cycleSize: null });
    if (unknown) resolved.set(row.id, issue("unknown_code"));
    else if (personal && row.ownerId === null) resolved.set(row.id, issue("unlinked_personal"));
    else if (row.ownerId !== null && !source.has(row.ownerId)) resolved.set(row.id, issue("missing_owner"));
    else if (!personal) resolved.set(row.id, { chainState: "rooted", generation: 0, rootIssueId: null, cycleSize: null });
  }
  // Explicit paths replace recursion. Each unresolved node is visited and resolved once.
  for (const start of input) {
    if (resolved.has(start.id)) continue;
    const path: number[] = [], positions = new Map<number, number>(); let cursor = start.id;
    while (!resolved.has(cursor)) {
      const prior = positions.get(cursor);
      if (prior !== undefined) {
        let rootIssueId = path[prior]; for (let i = prior + 1; i < path.length; i++) rootIssueId = Math.min(rootIssueId, path[i]);
        const cycleSize = path.length - prior;
        for (let i = prior; i < path.length; i++) resolved.set(path[i], { chainState: "cycle", generation: null, rootIssueId, cycleSize });
        break;
      }
      positions.set(cursor, path.length); path.push(cursor);
      const owner = source.get(cursor)!.ownerId; requireValue(owner !== null && source.has(owner), "dispersion_unresolved_parent"); cursor = owner!;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const current = path[i]; if (resolved.has(current)) continue;
      const parent = resolved.get(source.get(current)!.ownerId!)!;
      resolved.set(current, parent.chainState === "rooted"
        ? { chainState: "rooted", generation: parent.generation! + 1, rootIssueId: null, cycleSize: null }
        : { chainState: parent.chainState === "cycle" || parent.chainState === "cycle_descendant" ? "cycle_descendant" : "unresolved_ancestor", generation: null, rootIssueId: parent.rootIssueId, cycleSize: parent.cycleSize });
    }
  }
  requireValue(resolved.size === input.length, "dispersion_incomplete_analysis");
  const remaining = new Map<number, number>(), reach = new Map<number, number>(), queue: number[] = [];
  for (const row of input) {
    const node = byId.get(row.id)!; Object.assign(node, resolved.get(row.id));
    const kids = children.get(row.id) ?? []; node.invited = kids.length; node.invitedConfirmed = kids.reduce((n, child) => n + (source.get(child)!.status === "confirmed" ? 1 : 0), 0);
    if (node.chainState !== "rooted") continue;
    const validChildren = kids.reduce((n, child) => n + (resolved.get(child)!.chainState === "rooted" ? 1 : 0), 0);
    remaining.set(row.id, validChildren); reach.set(row.id, 0); if (validChildren === 0) queue.push(row.id);
  }
  for (let index = 0; index < queue.length; index++) {
    const current = byId.get(queue[index])!; current.reach = reach.get(current.id)!;
    const parent = current.ownerId === null ? null : byId.get(current.ownerId);
    if (!parent || parent.chainState !== "rooted") continue;
    reach.set(parent.id, reach.get(parent.id)! + current.reach + (current.status === "confirmed" ? 1 : 0));
    const left = remaining.get(parent.id)! - 1; remaining.set(parent.id, left); if (left === 0) queue.push(parent.id);
  }
  requireValue(queue.length === remaining.size, "dispersion_invalid_rooted_graph");
  const nodes = [...byId.values()], roots: number[] = [], diagnostics: number[] = [];
  const byOrigin: DispersionGraphSummary["byOrigin"] = { direto: empty(), organizacao: empty(), pessoal: empty(), desconhecido: empty() };
  const generationCounts: DispersionCount[] = [], unknownGeneration = empty(); let maxGeneration = -1;
  const chainStates = { rooted: 0, unknown_code: 0, unlinked_personal: 0, missing_owner: 0, cycle: 0, cycle_descendant: 0, unresolved_ancestor: 0 };
  let confirmed = 0, sameDevice = 0, notSameDevice = 0, unknownDevice = 0, unknownOrigin = 0, unknownOriginConfirmed = 0, unknownGenerationConfirmed = 0, knownGeneration = 0, deepConfirmed = 0;
  const spreaders: DispersionGraphSummary["spreaders"] = [];
  const compare = (a: (typeof spreaders)[number], b: (typeof spreaders)[number]) => b.reach - a.reach || b.invitedConfirmed - a.invitedConfirmed || a.id - b.id;
  for (const node of nodes) {
    const ok = node.status === "confirmed"; confirmed += ok ? 1 : 0; count(byOrigin[node.origin], ok); chainStates[node.chainState]++;
    if (node.origin === "desconhecido") { unknownOrigin++; unknownOriginConfirmed += ok ? 1 : 0; }
    if (node.generation === null) { count(unknownGeneration, ok); unknownGenerationConfirmed += ok ? 1 : 0; diagnostics.push(node.id); }
    else { knownGeneration++; maxGeneration = Math.max(maxGeneration, node.generation); generationCounts[node.generation] ??= empty(); count(generationCounts[node.generation], ok); if (node.generation >= 2 && ok) deepConfirmed++; if (node.ownerId === null) roots.push(node.id); }
    if (ok) { const device = source.get(node.id)!.confirmSameVisitor; if (device === true) sameDevice++; else if (device === false) notSameDevice++; else unknownDevice++; }
    if (node.reach !== null && node.reach > 0) {
      const candidate = { id: node.id, name: node.name, invited: node.invited, invitedConfirmed: node.invitedConfirmed, reach: node.reach };
      let position = 0; while (position < spreaders.length && compare(spreaders[position], candidate) <= 0) position++;
      if (position < 10) { spreaders.splice(position, 0, candidate); if (spreaders.length > 10) spreaders.pop(); }
    }
  }
  const byGeneration: DispersionGraphSummary["byGeneration"] = [];
  for (let generation = 0; generation <= maxGeneration; generation++) if (generationCounts[generation]) byGeneration.push({ generation, ...generationCounts[generation] });
  if (unknownGeneration.total) byGeneration.push({ generation: null, ...unknownGeneration });
  const avgCoverage = metric(byOrigin.pessoal.confirmed, confirmed, unknownOriginConfirmed), deepCoverage = metric(deepConfirmed, confirmed, unknownGenerationConfirmed);
  const summary: DispersionGraphSummary = { total: nodes.length, confirmed, pending: nodes.length - confirmed, byOrigin, byGeneration, spreaders, avgInvitedPerConfirmed: confirmed > 0 && avgCoverage.complete ? avgCoverage.numerator / confirmed : null, deepShare: confirmed > 0 && deepCoverage.complete ? deepCoverage.numerator / confirmed : null, sameDevice, notSameDevice, unknownDevice, metricCoverage: { avgInvitedPerConfirmed: avgCoverage, deepShare: deepCoverage } };
  return { nodes, byId, children, roots, diagnostics, summary, coverage: { total: expectedTotal, analyzed: nodes.length, complete: true, attributionKnown: nodes.length - unknownOrigin, attributionUnknown: unknownOrigin, generationKnown: knownGeneration, generationUnknown: unknownGeneration.total, generationKnownConfirmed: confirmed - unknownGenerationConfirmed, generationUnknownConfirmed: unknownGenerationConfirmed, reachKnown: knownGeneration, reachUnknown: unknownGeneration.total, rankingExcluded: unknownGeneration.total, chainStates } };
}
