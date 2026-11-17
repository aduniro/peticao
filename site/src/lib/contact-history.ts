import { tx } from "./db";
import type { ContactDeliveryState } from "./contact-delivery";

type Actor = { userId: number; email: string };
type Options = { replyBefore?: number; campusBefore?: number; limit?: number };
type Contact = { id: number; name: string; email: string; kind: string; message: string; locale: string | null; created_at: string };
type Reply = { id: number; rodada: number; versao: string; por: string | null; assunto: string; estado: ContactDeliveryState; legacy_ok: boolean; legacy_scheduled: boolean; created_at: string; due_at: string | null; started_at: string | null; finished_at: string | null };
type Campus = { id: number; triage_job_id: number; revision: number; previous_id: number | null; proposal: unknown; decision: "approved" | "rejected"; source_reviewed: boolean; created_by: number; created_at: string };
export const validHistoryId = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const stamp = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function page<T extends { id: number }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextBefore: rows.length > limit ? items[items.length - 1].id : null };
}

/** One received contact, never an inferred identity/conversation based on an email match.
 * No payload/ciphertext, provider receipts, free-form transport errors or dispatch.
 */
export async function readContactHistory(contactId: number, actor: Actor, options: Options = {}) {
  const limit = options.limit ?? 10;
  if (!validHistoryId(contactId) || !Number.isInteger(limit) || limit < 1 || limit > 20
    || options.replyBefore !== undefined && !validHistoryId(options.replyBefore)
    || options.campusBefore !== undefined && !validHistoryId(options.campusBefore)) return { ok: false as const, error: "parameters" };
  if (!actor || !validHistoryId(actor.userId) || typeof actor.email !== "string" || actor.email.length > 254) return { ok: false as const, error: "forbidden" };
  return tx(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout='3000ms'");
    const authorized = await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN ('edicao','exclusao','total')", [actor.userId, actor.email.toLowerCase()]);
    if (!authorized.rowCount) return { ok: false as const, error: "forbidden" };
    const contact = (await client.query<Contact>(`SELECT id,name,email,kind,message,locale,${stamp("created_at")} AS created_at FROM contact_messages WHERE id=$1`, [contactId])).rows[0];
    if (!contact) return { ok: false as const, error: "not_found" };
    const replies = await client.query<Reply>(`SELECT id,rodada,versao,por,assunto,estado,ok AS legacy_ok,agendada AS legacy_scheduled,
      ${stamp("criada_em")} AS created_at,${stamp("due_at")} AS due_at,${stamp("started_at")} AS started_at,${stamp("finished_at")} AS finished_at
      FROM contact_replies WHERE contact_id=$1 AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`, [contactId, options.replyBefore ?? null, limit + 1]);
    const campus = await client.query<Campus>(`SELECT id,triage_job_id,revision,previous_id,proposal,decision,source_reviewed,created_by,${stamp("created_at")} AS created_at
      FROM contact_campus_reviews WHERE contact_id=$1 AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`, [contactId, options.campusBefore ?? null, limit + 1]);
    const triage = (await client.query(`SELECT id,revision,engine,status,${stamp("created_at")} AS created_at,${stamp("finished_at")} AS finished_at
      FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC LIMIT 1`, [contactId])).rows[0] ?? null;
    return { ok: true as const, contact, replies: page(replies.rows, limit), campus: { ...page(campus.rows, limit), published: false as const }, triage, delivery: "not_evaluated" as const };
  });
}
