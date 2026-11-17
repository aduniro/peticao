import { tx } from "./db";
import { analyzeDispersionGraph } from "./dispersion-graph";
import type { DispersionGraphInput, DispersionGraphSummary, DispersionOrigin } from "./dispersion-graph-contract";

export type Origin = DispersionOrigin;
export type DispRow = {
  id: number; name: string; email: string; category: string; institution: string | null; email_domain: string | null; email_institution: string | null;
  email_domain_kind: string | null; status: "confirmed" | "pending"; consent_at: string; confirmed_at: string | null; ref_code: string | null; identity_method: string | null;
  confirm_same_visitor: boolean | null; org_label: string | null; owner_id: number | null; referrer_found: boolean; referrer_display_name: string | null;
  generation: number | null; invited: number; invited_confirmed: number; origin: Origin;
};
const input = (r: DispRow): DispersionGraphInput => ({ id: r.id, name: r.name, status: r.status, refCode: r.ref_code, referrerFound: r.referrer_found, ownerId: r.owner_id, referrerDisplayName: r.referrer_display_name, orgLabel: r.org_label, confirmSameVisitor: r.confirm_same_visitor });
/** Compatibility for internal campaign tests. Active admin HTTP uses the authorized bounded store. No SQL/depth truncation. */
export async function dispersionRows(): Promise<DispRow[]> {
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await c.query("SET LOCAL statement_timeout='10000ms'");
    const total = Number((await c.query("SELECT count(*)::text n FROM signatures")).rows[0].n);
    const rows = (await c.query<DispRow>(`SELECT s.id,s.name,s.email,s.category,s.institution,s.email_domain,s.email_institution,s.email_domain_kind,s.status,s.consent_at,s.confirmed_at,s.ref_code,s.identity_method,s.confirm_same_visitor,r.label org_label,r.signature_id owner_id,(r.id IS NOT NULL) referrer_found,r.display_name referrer_display_name FROM signatures s LEFT JOIN referrers r ON r.code=s.ref_code ORDER BY s.id DESC`)).rows;
    const graph = analyzeDispersionGraph(rows.map(input), total);
    return rows.map(r => { const n = graph.byId.get(r.id)!; return { ...r, generation: n.generation, origin: n.origin, invited: n.invited, invited_confirmed: n.invitedConfirmed }; });
  });
}
export type Summary = DispersionGraphSummary;
export function summarize(rows: DispRow[]): Summary { return analyzeDispersionGraph(rows.map(input), rows.length).summary; }
