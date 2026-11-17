import { tx } from "../db";
import { normalizeCampusProposal } from "../contact-triage/campus-review";
import { canonical, document, PURPOSES, repositoryKnowledge, type KnowledgeDocument, type Purpose } from "./catalog";

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "em", "um", "uma", "para", "por", "com", "que", "como", "qual", "onde", "no", "na", "os", "as", "the", "and", "for"]);
const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const terms = (s: string) => [...new Set(normalize(s).match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter(t => !STOP.has(t));
// PostgreSQL translate handles one-character Latin decompositions without an extension or a schema change.
const accents = new Map<string,string>();
for (const [first, last] of [[0xc0, 0x24f], [0x1e00, 0x1eff]]) for (let n = first; n <= last; n++) {
  const ch = String.fromCodePoint(n).toLowerCase(), plain = normalize(ch);
  if ([...ch].length === 1 && [...plain].length === 1 && ch !== plain) accents.set(ch, plain);
}
const FROM = [...accents.keys()].join(""), TO = [...accents.values()].join("");
function reviewedDocument(row: { id: number; proposal: any; created_at: Date | string }): KnowledgeDocument | null {
  const p = row.proposal;
  const normalized = normalizeCampusProposal({ institution: p?.institution, campusName: p?.campusName, cityIbge: p?.municipality?.id, sourceUrl: p?.sourceUrl });
  // Extra fields, malformed old rows or changed public classifications need curation again, never silent rewriting.
  if (!normalized || JSON.stringify(canonical(normalized)) !== JSON.stringify(canonical(p))) return null;
  const date = new Date(row.created_at); if (!Number.isFinite(date.getTime())) return null;
  return document(`campus:${row.id}`, `${p.institution} — ${p.campusName}`, JSON.stringify({ institution: p.institution, campusName: p.campusName, municipality: p.municipality, sourceUrl: p.sourceUrl, listedMunicipality: p.listedMunicipality, criteria: p.criteria, published: false }), PURPOSES, `campus-review:${row.id}`, "human_reviewed_reference", date.toISOString());
}

/** Read-only retrieval for all three future functions. Does not invoke an LLM, save a query, send or execute anything. */
export async function searchKnowledge(query: unknown, purpose: unknown, limit: unknown = 6) {
  if (typeof query !== "string" || query.length < 2 || query.length > 240 || /[\u0000-\u001f]/.test(query) || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(query) || /[^\s@]+@[^\s@]+/.test(query) || !PURPOSES.includes(purpose as Purpose) || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) return { ok: false as const, error: "parameters" };
  const tokens = terms(query); if (!tokens.length || tokens.length > 12) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    const documents = repositoryKnowledge().filter(d => d.purposes.includes(purpose as Purpose));
    let curatedUnavailable = false, curatedTruncated = false, invalidOrStaleCurations = 0;
    await c.query("SAVEPOINT knowledge_curations");
    try {
      // Filter AFTER selecting the latest decision: a rejection must not revive an earlier approval.
      const rows = (await c.query(`WITH latest AS (
        SELECT DISTINCT ON(contact_id) id,proposal,decision,source_reviewed,created_at FROM contact_campus_reviews ORDER BY contact_id,id DESC
      ), documents AS (
        SELECT id,proposal,created_at,regexp_split_to_array(translate(lower(concat_ws(' ',proposal->>'institution',proposal->>'campusName',proposal#>>'{municipality,name}',proposal#>>'{municipality,uf}')),$2,$3),'[^[:alnum:]]+') words
        FROM latest WHERE decision='approved' AND source_reviewed
      ), matches AS (
        SELECT id,proposal,created_at,(SELECT count(*) FROM unnest($1::text[]) term WHERE term=ANY(words)) score FROM documents
      ) SELECT id,proposal,created_at FROM matches WHERE score>0 ORDER BY score DESC,id DESC LIMIT 51`, [tokens, FROM, TO])).rows;
      curatedTruncated = rows.length > 50;
      for (const row of rows.slice(0, 50)) { const d = reviewedDocument(row); if (d) documents.push(d); else invalidOrStaleCurations++; }
      await c.query("RELEASE SAVEPOINT knowledge_curations");
    } catch {
      await c.query("ROLLBACK TO SAVEPOINT knowledge_curations"); await c.query("RELEASE SAVEPOINT knowledge_curations"); curatedUnavailable = true;
    }
    const hits = documents.map(d => { const words = new Set(terms(d.title + " " + d.text)); return { d, score: tokens.filter(t => words.has(t)).length }; }).filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0));
    return { ok: true as const, engine: "knowledge-lexical-v1", purpose: purpose as Purpose, results: hits.slice(0, Number(limit)).map(({ d, score }) => ({ ...d, score })), coverage: { curatedUnavailable, curatedTruncated, invalidOrStaleCurations, rankedResultsTruncated: hits.length > Number(limit) }, currentLegalVerification: false, sourceTextIsInstruction: false, executesActions: false, generatedReply: false };
  });
}

/** Resolve an exact current citation. Removed/rejected/replaced references cannot silently retain authority. */
export async function knowledgeSource(id: unknown, version: unknown, purpose: unknown) {
  if (typeof id !== "string" || id.length > 100 || typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version) || !PURPOSES.includes(purpose as Purpose)) return { ok: false as const, error: "parameters" };
  let d = repositoryKnowledge().find(item => item.id === id);
  if (!d) {
    if (!/^campus:[1-9]\d{0,9}$/.test(id) || Number(id.slice(7)) > 2147483647) return { ok: false as const, error: "not_found" };
    const found = await tx(async c => {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
      return (await c.query(`SELECT r.id,r.proposal,r.created_at FROM contact_campus_reviews r WHERE r.id=$1 AND r.decision='approved' AND r.source_reviewed
        AND NOT EXISTS(SELECT 1 FROM contact_campus_reviews newer WHERE newer.contact_id=r.contact_id AND newer.id>r.id)`, [Number(id.slice(7))])).rows[0];
    });
    if (!found) return { ok: false as const, error: "not_found" };
    const normalized = reviewedDocument(found); if (!normalized) return { ok: false as const, error: "source_stale" }; d = normalized;
  }
  if (!d.purposes.includes(purpose as Purpose)) return { ok: false as const, error: "forbidden" };
  if (d.source.version !== version) return { ok: false as const, error: "source_stale" };
  return { ok: true as const, document: d, currentLegalVerification: false, sourceTextIsInstruction: false, executesActions: false };
}
