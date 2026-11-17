import { domainToASCII } from "node:url";
import { audit, query, tx } from "./db";
import freemailList from "./freemail.json";
import type { PoolClient } from "pg";
import { findIfes } from "./ifes-data";
import { hmac, safeEqual } from "./security";

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

export class DomainDecisionDenied extends Error {}
export class DomainDecisionConflict extends Error {}
type DomainActor = { userId: number; email: string };
type DecisionOptions = { kind?: DomainKind; institution?: string; evidenceUrl?: string; by: string; actor?: DomainActor };
async function decideDomainInTransaction(client: PoolClient, domain: string, status: "approved" | "rejected", opts: DecisionOptions): Promise<number> {
  const d = domainToASCII(domain.trim().toLowerCase());
  if (!d || !d.includes(".")) throw new Error("Domínio inválido.");
  if ([...FREEMAIL].some((f) => domainMatches(d, f))) throw new Error("Provedores de e-mail gratuitos não podem ser institucionais.");
  if (opts.actor !== undefined) {
    const actor = opts.actor;
    if (!Number.isInteger(actor?.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string") throw new DomainDecisionDenied("Não autorizado.");
    await client.query("SELECT pg_advisory_xact_lock(7003)");
    const current = await client.query("SELECT id FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel IN ('edicao','exclusao','total') FOR SHARE", [actor.userId, actor.email.trim().toLowerCase()]);
    if (!current.rowCount) throw new DomainDecisionDenied("Não autorizado.");
  }
  const by = opts.actor ? opts.actor.email.trim().toLowerCase() : opts.by;
  // Manual decisions overlap for parent/subdomains; serialize them before touching signer metadata.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('institutional-domain-decision'))");
  await client.query(
    `INSERT INTO institutional_domains(domain,kind,institution,source,status,evidence_url,decided_by,updated_at)
     VALUES($1,$2,$3,'manual',$4,$5,$6,$7)
     ON CONFLICT (domain) DO UPDATE SET kind=EXCLUDED.kind, institution=COALESCE(EXCLUDED.institution, institutional_domains.institution),
       status=EXCLUDED.status, evidence_url=COALESCE(EXCLUDED.evidence_url, institutional_domains.evidence_url), decided_by=EXCLUDED.decided_by, updated_at=EXCLUDED.updated_at`,
    [d, opts.kind ?? "outro", opts.institution ?? null, status, opts.evidenceUrl ?? null, by, new Date().toISOString()]
  );
  const institutionId = opts.institution ? findIfes(opts.institution)?.id ?? null : null;
  if (institutionId) await client.query("UPDATE institutional_domains SET institution_id=$2 WHERE domain=$1", [d, institutionId]);
  let count = 0;
  if (status === "approved") {
    // Use the same classifier, with rules from this transaction rather than the process cache.
    const rules = (await client.query<ApprovedDomain>("SELECT domain,kind,status,institution FROM institutional_domains WHERE status IN ('approved','rejected') AND kind <> 'universidade-estrangeira'")).rows;
    const sigs = (await client.query<{ id: number; email: string }>("SELECT id,email FROM signatures WHERE split_part(email,'@',2) = $1 OR RIGHT(split_part(email,'@',2), LENGTH($1)+1) = '.' || $1 ORDER BY id FOR UPDATE", [d])).rows;
    for (const signer of sigs) {
      const domain = emailDomain(signer.email), classification = domain ? classifyDomain(domain, rules) : null;
      const rule = classification && domain ? rules.filter(r => r.status !== "rejected" && domainMatches(domain, r.domain)).sort((a, b) => b.domain.length - a.domain.length)[0] : null;
      await client.query("UPDATE signatures SET email_domain_kind=$1,email_domain=$2,email_institution=$3 WHERE id=$4", [classification?.kind ?? null, classification && domain ? registrableDomain(domain) ?? domain : null, rule?.institution ?? null, signer.id]);
      count++;
    }
  }
  await audit(status === "approved" ? "domain_approved" : "domain_rejected", null, { domain: d, kind: opts.kind ?? "outro", by, updated: count, ...(opts.actor ? { userId: opts.actor.userId } : {}) }, client);
  return count;
}

export async function decideDomain(domain: string, status: "approved" | "rejected", opts: DecisionOptions): Promise<number> {
  const updated = await tx(client => decideDomainInTransaction(client, domain, status, opts));
  _clearDomainCache();
  return updated;
}

export type DomainSourceRow = { domain: string; kind: string; institution: string | null; source: string; status: string; evidence_url: string | null; decided_by: string | null; updated_at: string | null };
/** Snapshot of the displayed pending decisions, not an authorization to change them. */
export function domainSourceVersion(source: string, rows: DomainSourceRow[], actor: DomainActor): string {
  const pending = rows.filter(row => row.source === source && row.status === "pending").sort((a, b) => a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0);
  return hmac("domain-source-version:v1:" + JSON.stringify([source, actor.userId, actor.email.trim().toLowerCase(), pending.map(row => [row.domain, row.kind, row.institution, row.evidence_url, row.decided_by, row.updated_at])]));
}

/** One source approval is atomic; a stale page never approves newly discovered candidates. */
export async function approveDomainSource(source: string, kind: DomainKind, actor: DomainActor, version: string) {
  if (!source || source.length > 200 || !Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) || typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version)) throw new DomainDecisionConflict();
  if (!actor || !Number.isInteger(actor.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string") throw new DomainDecisionDenied("Não autorizado.");
  const result = await tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    await client.query("SELECT pg_advisory_xact_lock(7003)");
    if (!(await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel IN ('edicao','exclusao','total') FOR SHARE", [actor.userId, actor.email.trim().toLowerCase()])).rowCount) throw new DomainDecisionDenied("Não autorizado.");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('institutional-domain-decision'))");
    const rows = (await client.query<DomainSourceRow>("SELECT domain,kind,institution,source,status,evidence_url,decided_by,updated_at FROM institutional_domains WHERE status='pending' AND source=$1 ORDER BY domain FOR UPDATE", [source])).rows;
    if (!rows.length || !safeEqual(domainSourceVersion(source, rows, actor), version)) throw new DomainDecisionConflict();
    let updated = 0;
    for (const row of rows) updated += await decideDomainInTransaction(client, row.domain, "approved", { kind, by: actor.email, actor });
    return { domains: rows.length, updated };
  });
  _clearDomainCache();
  return result;
}
