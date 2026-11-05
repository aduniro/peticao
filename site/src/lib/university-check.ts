import { query } from "./db";
import { emailDomain, domainMatches, FREEMAIL } from "./institutional";
import { ensureWorldUniversities } from "./world-universities";
import { probeDomain, type ProbeResult } from "./domain-probe.mjs";
import { egressGet, egressSocket } from "./egress";

export type UniCheck =
  | { ok: true; domain: string; check: "list" | "curated" | "web" }
  | { ok: false; code: "not_university_email" | "university_country_mismatch" | "domain_unavailable"; detail?: string };

export type Probe = (domain: string) => Promise<ProbeResult>;

/** Dentro do sandbox (sem rede) a checagem pela internet passa pela ponte; fora dele é feita direto. */
export const defaultProbe: Probe = async (domain) => {
  if (egressSocket()) {
    try {
      const r = await egressGet(`/domain/${encodeURIComponent(domain)}`);
      if (r.status === 200) return JSON.parse(r.body) as ProbeResult;
    } catch { /* ponte indisponível */ }
    return { ok: false, reason: "network" };
  }
  return probeDomain(domain);
};

/**
 * O e-mail é de uma universidade REAL do país informado?
 *  1) domínio na base aberta de universidades (mesmo país) → aceito;
 *  2) domínio listado em outro país → recusa e diz qual;
 *  3) fora da lista → checagem pela internet (DNS + site HTTPS + indício acadêmico); se passar, entra na fila de curadoria.
 */
export async function validateUniversityEmail(email: string, country: string, probe: Probe = defaultProbe): Promise<UniCheck> {
  const d = emailDomain(email);
  if (!d || [...FREEMAIL].some((f) => domainMatches(d, f))) return { ok: false, code: "not_university_email" };
  await ensureWorldUniversities();
  const listed = (await query<{ country: string; domain: string }>(
    "SELECT country, domain FROM world_universities WHERE $1 = domain OR $1 LIKE '%.' || domain ORDER BY length(domain) DESC", [d])).rows;
  if (listed.length) {
    const hit = listed.find((r) => r.country === country);
    return hit ? { ok: true, domain: hit.domain, check: "list" } : { ok: false, code: "university_country_mismatch", detail: [...new Set(listed.map((r) => r.country))].join(",") };
  }
  const known = (await query<{ status: string; country: string | null }>("SELECT status, country FROM institutional_domains WHERE domain = $1 AND kind = 'universidade-estrangeira'", [d])).rows[0];
  if (known?.status === "approved") return { ok: true, domain: d, check: "curated" };
  if (known?.status === "rejected") return { ok: false, code: "not_university_email" };

  const r = await probe(d);
  if (r.reason === "network") return { ok: false, code: "domain_unavailable" };
  if (!r.ok) return { ok: false, code: "not_university_email", detail: r.reason };
  await query(
    `INSERT INTO institutional_domains(domain,kind,source,status,country,seen_count) VALUES($1,'universidade-estrangeira','web','pending',$2,1)
     ON CONFLICT (domain) DO UPDATE SET seen_count = institutional_domains.seen_count + 1 WHERE institutional_domains.status = 'pending'`, [d, country]);
  return { ok: true, domain: d, check: "web" };
}
