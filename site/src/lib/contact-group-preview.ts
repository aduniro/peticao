import { tx } from "./db";
import { hmac, safeEqual } from "./security";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { config } from "./config";
import { montarPrevia, validarEntrada, type Entrada } from "./contact-replies";

export type GroupActor = { userId: number; email: string; sessaoId: number | null };
type Selection = { contactId: number; expectedReplyRound?: number; expectedDraftRevision?: number; newRound?: boolean };
export type GroupPreviewInput = { selections: Selection[]; template: Entrada; expectedProof?: string };
type Contact = { id: number; name: string; email: string; kind: string; message: string; message_length: number; created_at: string };
type Reply = { id: number; contact_id: number; rodada: number; versao: string; estado: string; ok: boolean; needs_review: boolean };
type Draft = { contact_id: number; revision: number; state: string; expired: boolean };
const idOk = (x: unknown): x is number => Number.isInteger(x) && Number(x) > 0 && Number(x) <= 2147483647;
const revisionOk = (x: unknown): x is number => Number.isInteger(x) && Number(x) >= 0 && Number(x) < 2147483647;
const keys = (x: unknown, allowed: string[]) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).every(k => allowed.includes(k));
const fail = (error: "parameters" | "forbidden" | "conflict") => ({ ok: false as const, error });
function entry(raw: unknown): Entrada | null {
  if (!keys(raw, ["assunto", "corpo"])) return null;
  const v = raw as Entrada;
  if (typeof v.assunto !== "string" || v.assunto.length > 150 || typeof v.corpo !== "string" || v.corpo.length > 5000 || /\0/.test(v.assunto + v.corpo)) return null;
  const parsed = validarEntrada(v);
  return parsed.ok ? parsed.v : null;
}
function parse(raw: unknown) {
  if (!keys(raw, ["selections", "template", "expectedProof"])) return null;
  const r = raw as GroupPreviewInput, template = entry(r.template);
  if (!template || !Array.isArray(r.selections) || r.selections.length < 1 || r.selections.length > 20 || r.expectedProof !== undefined && (typeof r.expectedProof !== "string" || !/^[a-f0-9]{64}$/.test(r.expectedProof))) return null;
  for (const s of r.selections) if (!keys(s, ["contactId", "expectedReplyRound", "expectedDraftRevision", "newRound"]) || !idOk(s.contactId) || s.expectedReplyRound !== undefined && !revisionOk(s.expectedReplyRound) || s.expectedDraftRevision !== undefined && !revisionOk(s.expectedDraftRevision) || s.newRound !== undefined && typeof s.newRound !== "boolean") return null;
  if (new Set(r.selections.map(s => s.contactId)).size !== r.selections.length) return null;
  return { ...r, template, selections: r.selections.map(s => ({ contactId: s.contactId, expectedReplyRound: s.expectedReplyRound, expectedDraftRevision: s.expectedDraftRevision, newRound: s.newRound === true })).sort((a, b) => a.contactId - b.contactId) };
}

/** Same-response preparation only: never saves drafts, reserves delivery, dispatches mail or creates a new round. */
export async function prepareContactGroupPreview(raw: unknown, actor: GroupActor) {
  const r = parse(raw); if (!r) return fail("parameters");
  if (!idOk(actor?.userId) || !idOk(actor.sessaoId) || typeof actor.email !== "string") return fail("forbidden");
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await c.query("SET LOCAL statement_timeout='3000ms'");
    if (!(await c.query("SELECT u.id FROM admin_users u JOIN admin_sessions s ON s.user_id=u.id WHERE u.id=$1 AND lower(u.email)=$2 AND u.ativo AND u.nivel='total' AND s.id=$3 AND s.expira_em>now() AND s.stepup_ate>now()", [actor.userId, actor.email.toLowerCase(), actor.sessaoId])).rowCount) return fail("forbidden");
    const ids = r.selections.map(s => s.contactId);
    const contacts = (await c.query<Contact>("SELECT id,name,email,kind,left(message,4000) message,length(message)::int message_length,created_at FROM contact_messages WHERE id=ANY($1::int[]) ORDER BY id", [ids])).rows;
    const replies = (await c.query<Reply>("SELECT r.id,r.contact_id,r.rodada,r.versao,r.estado,r.ok,l.needs_review FROM (SELECT contact_id,max(rodada) rodada,bool_or(estado IN ('prepared','blocked','sending','uncertain') OR (estado='legacy' AND NOT ok)) needs_review FROM contact_replies WHERE contact_id=ANY($1::int[]) GROUP BY contact_id) l CROSS JOIN LATERAL (SELECT id,contact_id,rodada,versao,estado,ok FROM contact_replies WHERE contact_id=l.contact_id AND rodada=l.rodada ORDER BY id LIMIT 3) r ORDER BY r.contact_id,r.id", [ids])).rows;
    const drafts = (await c.query<Draft>("SELECT contact_id,revision,state,expires_at<=now() expired FROM contact_drafts WHERE contact_id=ANY($1::int[])", [ids])).rows;
    const suppressed = new Set((await c.query<{ email: string }>("SELECT lower(email) email FROM email_suppressions WHERE lower(email)=ANY($1::text[])", [contacts.map(x => x.email.trim().toLowerCase())])).rows.map(x => x.email));
    const recipients = new Map<string, number>();
    for (const contact of contacts) { const email = contact.email.trim().toLowerCase(); recipients.set(email, (recipients.get(email) ?? 0) + 1); }
    const copies = config.contactBcc(), replyTo = config.mailReplyTo() || copies[0] || null;
    const results = [];
    const contexts = [];
    for (const selection of r.selections) {
      const contact = contacts.find(x => x.id === selection.contactId);
      if (!contact) { results.push({ contactId: selection.contactId, eligible: false, issues: ["not_found"], preview: null }); contexts.push({ id: selection.contactId, missing: true }); continue; }
      const email = contact.email.trim().toLowerCase(), history = replies.filter(x => x.contact_id === contact.id), round = Math.max(0, ...history.map(x => x.rodada)), draft = drafts.find(x => x.contact_id === contact.id);
      const draftRevision = draft?.revision ?? 0, draftState = draft?.expired && draft.state === "stored" ? "expired" : draft?.state ?? "empty";
      const firstName = contact.name.trim().split(/\s+/)[0];
      const expandedInput = entry({ assunto: r.template.assunto.replaceAll("{nome}", firstName), corpo: r.template.corpo.replaceAll("{nome}", firstName) });
      const issues: string[] = [];
      if (!SAFE_EMAIL_RE.test(contact.email)) issues.push("invalid_recipient");
      if (!copies.length || copies.length > 20 || copies.some(e => !SAFE_EMAIL_RE.test(e))) issues.push("owner_copy_unavailable");
      if (!replyTo || !SAFE_EMAIL_RE.test(replyTo)) issues.push("reply_to_invalid");
      if (!firstName) issues.push("missing_name");
      if (contact.message_length > 4000) issues.push("source_context_truncated");
      if ((recipients.get(email) ?? 0) > 1) issues.push("duplicate_recipient");
      if (suppressed.has(email)) issues.push("suppressed");
      if (!expandedInput) issues.push("rendered_input_invalid");
      if (selection.expectedReplyRound !== undefined && selection.expectedReplyRound !== round) issues.push("reply_conflict");
      if (selection.expectedDraftRevision !== undefined && selection.expectedDraftRevision !== draftRevision) issues.push("draft_conflict");
      if (history.some(x => x.needs_review) || history.length > 2) issues.push("history_needs_review");
      if (round > 0 && (selection.newRound !== true || selection.expectedReplyRound !== round)) issues.push("explicit_new_round_required");
      if (round >= 2147483646) issues.push("round_limit");
      const preview = !issues.length && expandedInput ? await montarPrevia(contact.id, expandedInput, round + 1, undefined, c) : null;
      results.push({ contactId: contact.id, recipient: contact.email, firstName, currentReplyRound: round, nextReplyRound: round + 1, draftRevision, draftState, draftContentUsed: false, eligible: !!preview, issues,
        expandedInput, preview: preview ? { para: preview.para, texto: preview.texto, selo: preview.selo, cardPlanned: !!preview.card, cardSubject: preview.card?.assunto ?? null } : null });
      contexts.push({ id: contact.id, contactHash: hmac("contact-group-source:v1:" + JSON.stringify(contact)), history, draft: draft ?? null, issues, expandedInput, seal: preview?.selo ?? null });
    }
    const proof = hmac("contact-group-preview:v1:" + JSON.stringify([actor.userId, actor.email.toLowerCase(), actor.sessaoId, r.selections, r.template, contexts, copies, replyTo]));
    if (r.expectedProof && !safeEqual(r.expectedProof, proof)) return fail("conflict");
    return { ok: true as const, proof, recipients: results, ownerCopies: copies, replyTo, automaticSend: false, draftWrites: false, groupReserved: false, format: "texto" as const };
  });
}
