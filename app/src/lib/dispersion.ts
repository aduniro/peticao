import { query } from "./db";

export type Origin = "direto" | "organizacao" | "pessoal";
export type DispRow = {
  id: number; name: string; email: string; category: string; institution: string | null; email_domain: string | null; email_institution: string | null;
  email_domain_kind: string | null; status: string; consent_at: string; confirmed_at: string | null; ref_code: string | null; identity_method: string | null;
  confirm_same_visitor: boolean | null; org_label: string | null; owner_id: number | null; generation: number; invited: number; invited_confirmed: number; origin: Origin;
};

/**
 * Uma linha por assinante, com a ORIGEM do acesso e a GERAÇÃO na cadeia de indicações:
 *  - direto: entrou sem link rastreado; organizacao: entrou por código de uma organização (ADUNIR, sindicato…);
 *  - pessoal: entrou pelo link/QR de outro assinante (geração 1 = convidado de quem veio direto; geração 2 = convidado de um convidado…).
 */
export async function dispersionRows(limit = 5000): Promise<DispRow[]> {
  const { rows } = await query<Omit<DispRow, "origin">>(
    `WITH RECURSIVE base AS (
       SELECT s.id, s.name, s.email, s.category, s.institution, s.email_domain, s.email_institution, s.email_domain_kind, s.status, s.consent_at, s.confirmed_at,
              s.ref_code, s.identity_method, s.confirm_same_visitor, r.label AS org_label, r.signature_id AS owner_id
       FROM signatures s LEFT JOIN referrers r ON r.code = s.ref_code),
     gen AS (
       SELECT b.*, 0 AS generation FROM base b WHERE b.owner_id IS NULL
       UNION ALL
       SELECT b.*, g.generation + 1 FROM base b JOIN gen g ON b.owner_id = g.id WHERE g.generation < 20)
     SELECT g.*,
       (SELECT COUNT(*) FROM base c WHERE c.owner_id = g.id)::int AS invited,
       (SELECT COUNT(*) FROM base c WHERE c.owner_id = g.id AND c.status='confirmed')::int AS invited_confirmed
     FROM gen g ORDER BY g.consent_at DESC, g.id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ ...r, origin: r.owner_id !== null ? "pessoal" : r.org_label ? "organizacao" : "direto" }));
}

export type Summary = {
  total: number; confirmed: number;
  byOrigin: Record<Origin, { total: number; confirmed: number }>;
  byGeneration: { generation: number; total: number; confirmed: number }[];
  spreaders: { id: number; name: string; invited: number; invitedConfirmed: number; reach: number }[];
  avgInvitedPerConfirmed: number; deepShare: number; notSameDevice: number; sameDevice: number;
};

/** Quantas assinaturas CONFIRMADAS descendem de cada pessoa (convidados, convidados dos convidados…). */
function reachMap(rows: DispRow[]): Map<number, number> {
  const kids = new Map<number, DispRow[]>();
  for (const r of rows) if (r.owner_id !== null) kids.set(r.owner_id, [...(kids.get(r.owner_id) ?? []), r]);
  const memo = new Map<number, number>();
  const walk = (id: number, depth = 0): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (depth > 25) return 0;
    const n = (kids.get(id) ?? []).reduce((a, k) => a + (k.status === "confirmed" ? 1 : 0) + walk(k.id, depth + 1), 0);
    memo.set(id, n);
    return n;
  };
  for (const r of rows) walk(r.id);
  return memo;
}

export function summarize(rows: DispRow[]): Summary {
  const reach = reachMap(rows);
  const byOrigin: Summary["byOrigin"] = { direto: { total: 0, confirmed: 0 }, organizacao: { total: 0, confirmed: 0 }, pessoal: { total: 0, confirmed: 0 } };
  const gens = new Map<number, { total: number; confirmed: number }>();
  for (const r of rows) {
    const ok = r.status === "confirmed" ? 1 : 0;
    byOrigin[r.origin].total++; byOrigin[r.origin].confirmed += ok;
    const g = gens.get(r.generation) ?? { total: 0, confirmed: 0 };
    g.total++; g.confirmed += ok; gens.set(r.generation, g);
  }
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const invitedViaPeople = rows.filter((r) => r.origin === "pessoal" && r.status === "confirmed").length;
  return {
    total: rows.length, confirmed: confirmed.length, byOrigin,
    byGeneration: [...gens].sort((a, b) => a[0] - b[0]).map(([generation, v]) => ({ generation, ...v })),
    spreaders: rows.filter((r) => (reach.get(r.id) ?? 0) > 0).sort((a, b) => (reach.get(b.id) ?? 0) - (reach.get(a.id) ?? 0) || b.invited_confirmed - a.invited_confirmed || a.id - b.id).slice(0, 10).map((r) => ({ id: r.id, name: r.name, invited: r.invited, invitedConfirmed: r.invited_confirmed, reach: reach.get(r.id) ?? 0 })),
    avgInvitedPerConfirmed: confirmed.length ? invitedViaPeople / confirmed.length : 0,
    deepShare: confirmed.length ? confirmed.filter((r) => r.generation >= 2).length / confirmed.length : 0,
    notSameDevice: confirmed.filter((r) => r.confirm_same_visitor === false).length,
    sameDevice: confirmed.filter((r) => r.confirm_same_visitor === true).length,
  };
}
