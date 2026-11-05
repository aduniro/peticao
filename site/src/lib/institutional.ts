import { domainToASCII } from "node:url";
import { audit, query } from "./db";
import freemailList from "./freemail.json";

/**
 * Selo de "e-mail institucional confirmado". Significa que o e-mail é de um domínio de órgão/instituição pública
 * (ou de ensino superior), NÃO que a pessoa seja servidora: alunos, terceirizados e aposentados também têm e-mail institucional.
 */
export type DomainKind =
  | "governo" | "ensino-edu-br" | "legislativo" | "judiciario" | "ministerio-publico"
  | "ifes" | "federal" | "estadual" | "municipal" | "discente" | "universidade-estrangeira" | "outro";

export const KIND_LABELS: Record<DomainKind, string> = {
  governo: "Governo (.gov.br)", "ensino-edu-br": "Ensino superior (.edu.br, pública ou privada)", legislativo: "Legislativo (.leg.br)",
  judiciario: "Judiciário (.jus.br)", "ministerio-publico": "Ministério Público (.mp.br)", ifes: "Instituição federal de ensino",
  federal: "Administração federal", estadual: "Administração estadual", municipal: "Administração municipal",
  discente: "Domínio de discentes", "universidade-estrangeira": "Universidade estrangeira", outro: "Outro",
};

/** Sufixos cujo registro é restrito pelo Registro.br/CGI.br. `.def.br` e `.mil.br` só entram após conferir as regras (EXTRA_SUFFIXES). */
const SUFFIX_KIND: Record<string, DomainKind> = {
  "gov.br": "governo", "edu.br": "ensino-edu-br", "leg.br": "legislativo", "jus.br": "judiciario", "mp.br": "ministerio-publico",
};
function suffixes(): Record<string, DomainKind> {
  const extra = (process.env.EXTRA_SUFFIXES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { ...SUFFIX_KIND, ...Object.fromEntries(extra.map((s) => [s, "outro" as DomainKind])) };
}

/** Provedores gratuitos e redes sociais/serviços genéricos: NUNCA são domínio institucional. */
export const FREEMAIL = new Set<string>(freemailList);

const STUDENT_LABELS = new Set(["aluno", "alunos", "discente", "discentes", "estudante", "estudantes", "academico", "academicos", "graduando", "graduandos", "posgrad"]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const d = domainToASCII(email.slice(at + 1).trim().toLowerCase().replace(/\.$/, ""));
  return d && d.includes(".") ? d : null;
}

/** `x.unir.br` casa com `unir.br`; `fakeunir.br` e `unir.br.evil.com` não. */
export const domainMatches = (domain: string, base: string) => domain === base || domain.endsWith("." + base);

export type ApprovedDomain = { domain: string; kind: DomainKind; status?: "approved" | "rejected"; institution?: string | null };

/** Função pura: classifica um domínio dado o conjunto de domínios aprovados. Retorna null se não for institucional. */
export function classifyDomain(domain: string, approved: ApprovedDomain[]): { kind: DomainKind; base: string } | null {
  const d = domain.toLowerCase();
  if ([...FREEMAIL].some((f) => domainMatches(d, f))) return null;
  let hit: { kind: DomainKind; base: string } | null = null;
  for (const [suf, kind] of Object.entries(suffixes())) if (domainMatches(d, suf)) hit = { kind, base: suf };
  for (const a of approved) {
    if (a.status !== "rejected" && domainMatches(d, a.domain) && (!hit || a.domain.length > hit.base.length)) hit = { kind: a.kind, base: a.domain };
  }
  if (!hit) return null;
  // Rejeição manual (mais específica ou igual à regra encontrada) vence as regras automáticas de sufixo.
  if (approved.some((a) => a.status === "rejected" && domainMatches(d, a.domain) && a.domain.length >= hit!.base.length)) return null;
  const sub = d === hit.base ? [] : d.slice(0, d.length - hit.base.length - 1).split(".");
  if (sub.some((l) => STUDENT_LABELS.has(l))) return { kind: "discente", base: hit.base };
  return hit;
}

import { registrableDomain } from "./domain-extract";

const g = globalThis as unknown as { __domCache?: { at: number; rows: ApprovedDomain[] } };
export const _clearDomainCache = () => {
  g.__domCache = undefined;
  (globalThis as unknown as { __domSug?: unknown }).__domSug = undefined; // cache das sugestões "você quis dizer…" (email-sugestao.ts): domínio decidido à mão entra na hora
};

/** Regras de domínio vigentes (aprovados e rejeitados) — o nome histórico é mantido. */
export async function approvedDomains(): Promise<ApprovedDomain[]> {
  if (g.__domCache && Date.now() - g.__domCache.at < 60_000) return g.__domCache.rows;
  const { rows } = await query<ApprovedDomain>("SELECT domain, kind, status, institution FROM institutional_domains WHERE status IN ('approved','rejected') AND kind <> 'universidade-estrangeira'");
  g.__domCache = { at: Date.now(), rows };
  return rows;
}

export async function institutionalKind(email: string): Promise<DomainKind | null> {
  const d = emailDomain(email);
  return d ? classifyDomain(d, await approvedDomains())?.kind ?? null : null;
}

/** Domínio do e-mail e nome da instituição correspondente (quando o domínio está na tabela aprovada). Só para e-mail institucional. */
export async function institutionInfo(email: string): Promise<{ domain: string | null; institution: string | null }> {
  const d = emailDomain(email);
  if (!d) return { domain: null, institution: null };
  const rules = await approvedDomains();
  const cls = classifyDomain(d, rules);
  if (!cls) return { domain: null, institution: null };
  const rule = rules.filter((r) => r.status !== "rejected" && domainMatches(d, r.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
  return { domain: registrableDomain(d) ?? d, institution: rule?.institution ?? null };
}

/** Domínio desconhecido de quem se declara servidor: entra na fila de curadoria (nunca é aprovado sozinho). */
export async function notePendingDomain(domain: string): Promise<void> {
  if ([...FREEMAIL].some((f) => domainMatches(domain, f))) return;
  await query(
    `INSERT INTO institutional_domains(domain,status,source,seen_count) VALUES($1,'pending','visitante',1)
     ON CONFLICT (domain) DO UPDATE SET seen_count = institutional_domains.seen_count + 1, updated_at = $2
     WHERE institutional_domains.status = 'pending'`,
    [domain, new Date().toISOString()]
  );
}

export async function decideDomain(domain: string, status: "approved" | "rejected", opts: { kind?: DomainKind; institution?: string; evidenceUrl?: string; by: string }): Promise<number> {
  const d = domainToASCII(domain.trim().toLowerCase());
  if (!d || !d.includes(".")) throw new Error("Domínio inválido.");
  if ([...FREEMAIL].some((f) => domainMatches(d, f))) throw new Error("Provedores de e-mail gratuitos não podem ser institucionais.");
  await query(
    `INSERT INTO institutional_domains(domain,kind,institution,source,status,evidence_url,decided_by,updated_at)
     VALUES($1,$2,$3,'manual',$4,$5,$6,$7)
     ON CONFLICT (domain) DO UPDATE SET kind=EXCLUDED.kind, institution=COALESCE(EXCLUDED.institution, institutional_domains.institution),
       status=EXCLUDED.status, evidence_url=COALESCE(EXCLUDED.evidence_url, institutional_domains.evidence_url), decided_by=EXCLUDED.decided_by, updated_at=EXCLUDED.updated_at`,
    [d, opts.kind ?? "outro", opts.institution ?? null, status, opts.evidenceUrl ?? null, opts.by, new Date().toISOString()]
  );
  _clearDomainCache();
  let updated = 0;
  if (status === "approved") {
    // Sobe retroativamente quem já assinou com esse domínio (e subdomínios), respeitando a regra de discentes.
    const approved = await approvedDomains();
    const sigs = (await query<{ id: number; email: string }>(
      "SELECT id,email FROM signatures WHERE split_part(email,'@',2) = $1 OR RIGHT(split_part(email,'@',2), LENGTH($1)+1) = '.' || $1", [d])).rows;
    for (const s of sigs) {
      const k = await institutionalKind(s.email);
      const info = k ? await institutionInfo(s.email) : { domain: null, institution: null };
      await query("UPDATE signatures SET email_domain_kind=$1, email_domain=$2, email_institution=$3 WHERE id=$4", [k, info.domain, info.institution, s.id]);
      updated++;
    }
    void approved;
  }
  await audit(status === "approved" ? "domain_approved" : "domain_rejected", null, { domain: d, kind: opts.kind ?? "outro", by: opts.by, updated });
  return updated;
}
