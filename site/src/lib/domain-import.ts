import { query } from "./db";
import { classifyDomain, domainMatches, FREEMAIL } from "./institutional";

export type Candidate = { domain: string; institution?: string; count?: number };
export type ImportReport = { total: number; coveredBySuffix: number; freemail: number; alreadyKnown: number; inserted: number; sample: Candidate[] };

/**
 * Candidatos entram SEMPRE como `pendente` (nunca aprovados automaticamente): um humano da ADUNIR aprova em /admin/dominios.
 * Domínios já cobertos por sufixo restrito (.gov.br etc.), provedores gratuitos e domínios já conhecidos são descartados.
 */
export async function importCandidates(cands: Candidate[], source: string, apply: boolean): Promise<ImportReport> {
  const rep: ImportReport = { total: 0, coveredBySuffix: 0, freemail: 0, alreadyKnown: 0, inserted: 0, sample: [] };
  const known = new Map((await query<{ domain: string; status: string }>("SELECT domain,status FROM institutional_domains")).rows.map((r) => [r.domain, r.status]));
  const seen = new Set<string>();
  for (const c of cands) {
    const domain = c.domain.toLowerCase();
    if (seen.has(domain)) continue;
    seen.add(domain);
    rep.total++;
    if ([...FREEMAIL].some((f) => domainMatches(domain, f))) { rep.freemail++; continue; }
    if (classifyDomain(domain, [])) { rep.coveredBySuffix++; continue; }
    if (known.has(domain)) { rep.alreadyKnown++; continue; }
    if (rep.sample.length < 15) rep.sample.push(c);
    if (apply) {
      await query(
        `INSERT INTO institutional_domains(domain,institution,source,status,seen_count) VALUES($1,$2,$3,'pending',$4) ON CONFLICT (domain) DO NOTHING`,
        [domain, c.institution ?? null, source, 0]
      );
    }
    rep.inserted++;
  }
  return rep;
}

/** Aprovação em lote de pendentes de uma fonte (ex.: "siorg"). Cada domínio é decidido individualmente (auditoria e retroativo). */
export async function pendingBySource(source: string): Promise<string[]> {
  return (await query<{ domain: string }>("SELECT domain FROM institutional_domains WHERE status='pending' AND source=$1 ORDER BY domain", [source])).rows.map((r) => r.domain);
}
