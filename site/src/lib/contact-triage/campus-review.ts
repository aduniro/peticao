import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { hmac, safeEqual } from "../security";
import { findIfes } from "../ifes-data";
import { municipalityById } from "../geo-data";
import { ENGINE, proposeCampus } from "./analyze";
import { CONTACT_SQL, inputHash } from "./evidence";

type Actor = { userId: number; email: string };
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0 && Number(id) <= 2147483647;
const keys = (value: unknown, names: string[]) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...names].sort().join(",");
export type CampusInput = { institution: string; cityIbge: number; campusName: string; sourceUrl: string };
export type ReviewInput = { contato: number; proposal: CampusInput; decision: "approved" | "rejected"; sourceReviewed: boolean; expectedDecisionId: number | null };

/** Public reference facts only. This validates syntax, not whether a page actually proves a campus exists. Never fetches a URL. */
export function normalizeCampusProposal(raw: unknown) {
  if (!keys(raw, ["institution", "cityIbge", "campusName", "sourceUrl"])) return null;
  const p = raw as CampusInput;
  if (typeof p.institution !== "string" || p.institution.length > 200 || !validId(p.cityIbge) || typeof p.campusName !== "string" || typeof p.sourceUrl !== "string" || p.sourceUrl.length > 1000) return null;
  const institution = findIfes(p.institution), municipality = municipalityById(p.cityIbge);
  const campusName = p.campusName.normalize("NFC").trim().replace(/ +/g, " ");
  if (!institution || !municipality || campusName.length < 2 || campusName.length > 160 || !/^[\p{L}\p{N}\p{Pd} .'’()\/]+$/u.test(campusName)) return null;
  let url: URL;
  try { url = new URL(p.sourceUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || /[\s\\\u0000-\u001f]/.test(p.sourceUrl) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) || /\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
  const context = proposeCampus({ institution: institution.s, city: municipality.name, uf: municipality.uf, ibge: municipality.id });
  return { institution: institution.s, campusName, municipality: { id: municipality.id, name: municipality.name, uf: municipality.uf }, sourceUrl: url.href, listedMunicipality: context.status === "listed", criteria: context.criteria };
}
function parse(raw: unknown) {
  if (!keys(raw, ["contato", "proposal", "decision", "sourceReviewed", "expectedDecisionId"])) return null;
  const r = raw as ReviewInput, proposal = normalizeCampusProposal(r.proposal);
  if (!validId(r.contato) || !proposal || !["approved", "rejected"].includes(r.decision) || typeof r.sourceReviewed !== "boolean" || r.decision === "approved" && !r.sourceReviewed || r.expectedDecisionId !== null && !validId(r.expectedDecisionId)) return null;
  return { ...r, proposal };
}
async function authorized(c: PoolClient, actor: Actor, write: boolean) {
  if (!actor || !validId(actor.userId) || typeof actor.email !== "string" || actor.email.length > 254) return false;
  return !!(await c.query(`SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN (${write ? "'total'" : "'edicao','exclusao','total'"})${write ? " FOR SHARE" : ""}`, [actor.userId, actor.email.toLowerCase()])).rowCount;
}
async function context(c: PoolClient, contactId: number) {
  const contact = (await c.query(CONTACT_SQL, [contactId])).rows[0];
  if (!contact) return { ok: false as const, error: "not_found" };
  const job = (await c.query("SELECT id,revision,engine,status,input_hash,analysis FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC LIMIT 1", [contactId])).rows[0];
  if (!job || job.status !== "complete" || job.engine !== ENGINE || job.analysis?.category !== "campus" || job.input_hash !== inputHash(contact)) return { ok: false as const, error: "triage_context_changed" };
  return { ok: true as const, contactId, jobId: job.id as number, revision: job.revision as number, inputHash: job.input_hash as string };
}
const latest = async (c: PoolClient, id: number) => (await c.query("SELECT id,revision,intent_hash FROM contact_campus_reviews WHERE contact_id=$1 ORDER BY id DESC LIMIT 1", [id])).rows[0];
function stamp(r: NonNullable<ReturnType<typeof parse>>, state: Extract<Awaited<ReturnType<typeof context>>, { ok: true }>, actor: Actor) {
  return hmac("campus-review-intent-v1:" + JSON.stringify([state.contactId, state.jobId, state.revision, state.inputHash, actor.userId, r.proposal, r.decision, r.sourceReviewed, r.expectedDecisionId]));
}

/** Nonpersistent preview; the operator must explicitly identify the decision being superseded. */
export async function previewCampusReview(raw: unknown, actor: Actor) {
  const r = parse(raw); if (!r) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    if (!await authorized(c, actor, false)) return { ok: false as const, error: "forbidden" };
    const state = await context(c, r.contato); if (!state.ok) return state;
    const previous = await latest(c, r.contato);
    if ((previous?.id ?? null) !== r.expectedDecisionId) return { ok: false as const, error: "decision_conflict" };
    return { ok: true as const, proposal: r.proposal, decision: r.decision, sourceReviewed: r.sourceReviewed, expectedDecisionId: r.expectedDecisionId, context: { contactId: state.contactId, jobId: state.jobId, revision: state.revision }, proof: stamp(r, state, actor), published: false, requiresHumanReview: true };
  });
}

/** Human reference decision only. No campus publication, signer edit, identity approval or e-mail. */
export async function recordCampusReview(raw: unknown, proof: unknown, actor: Actor) {
  const r = parse(raw);
  if (!r || typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    if (!await authorized(c, actor, true)) return { ok: false as const, error: "forbidden" };
    if (!(await c.query("SELECT id FROM contact_messages WHERE id=$1 FOR UPDATE", [r.contato])).rowCount) return { ok: false as const, error: "not_found" };
    // Same contact lock as requestTriage: a newer manual/job revision cannot overtake this decision.
    const state = await context(c, r.contato); if (!state.ok) return state;
    const expected = stamp(r, state, actor);
    if (!safeEqual(proof, expected)) return { ok: false as const, error: "intent_changed" };
    const previous = await latest(c, r.contato);
    if (previous?.intent_hash === expected) return { ok: true as const, id: previous.id as number, revision: previous.revision as number, existing: true, published: false };
    if ((previous?.id ?? null) !== r.expectedDecisionId) return { ok: false as const, error: "decision_conflict" };
    const revision = (previous?.revision ?? 0) + 1;
    const row = (await c.query<{ id: number }>(`INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,previous_id,proposal,decision,source_reviewed,created_by,intent_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [r.contato, state.jobId, revision, r.expectedDecisionId, JSON.stringify(r.proposal), r.decision, r.sourceReviewed, actor.userId, expected])).rows[0];
    await audit("contact_campus_review_recorded", null, { id: row.id, contactId: r.contato, jobId: state.jobId, revision, previousId: r.expectedDecisionId, decision: r.decision, userId: actor.userId, por: actor.email.toLowerCase(), published: false }, c);
    return { ok: true as const, id: row.id, revision, existing: false, published: false };
  });
}

export async function campusReviewHistory(contactId: unknown) {
  if (!validId(contactId)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    if (!(await c.query("SELECT 1 FROM contact_messages WHERE id=$1", [contactId])).rowCount) return { ok: false as const, error: "not_found" };
    const records = (await c.query("SELECT id,contact_id,triage_job_id,revision,previous_id,proposal,decision,source_reviewed,created_by,created_at FROM contact_campus_reviews WHERE contact_id=$1 ORDER BY id DESC LIMIT 21", [contactId])).rows;
    return { ok: true as const, records: records.slice(0, 20), truncated: records.length > 20, published: false };
  });
}
