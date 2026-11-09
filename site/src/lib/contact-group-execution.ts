import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { hmac } from "./security";
import { dispatchContactReply, type ContactDeliveryOptions } from "./contact-delivery";
import { reserveContactResponseWith } from "./contact-replies";
import { normalizeContactGroupPreviewInput, prepareContactGroupPreviewWith, type GroupActor, type GroupPreviewInput } from "./contact-group-preview";

export type GroupExecutionInput = { requestId: string; preview: GroupPreviewInput; proof: string; approvedContactIds: number[] };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const idOk = (x: unknown): x is number => Number.isInteger(x) && Number(x) > 0 && Number(x) <= 2147483647;
const fail = (error: "parameters" | "forbidden" | "conflict" | "not_found") => ({ ok: false as const, error });
class ReservationConflict extends Error { constructor(readonly reason: "conflict" | "forbidden" = "conflict") { super(reason); } }
function parse(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "approvedContactIds,preview,proof,requestId") return null;
  const r = raw as GroupExecutionInput, p = normalizeContactGroupPreviewInput(r.preview);
  if (!p || typeof r.requestId !== "string" || !UUID.test(r.requestId) || typeof r.proof !== "string" || !/^[a-f0-9]{64}$/.test(r.proof) || p.expectedProof !== undefined && p.expectedProof !== r.proof || !Array.isArray(r.approvedContactIds) || r.approvedContactIds.length < 1 || r.approvedContactIds.length > 20 || !r.approvedContactIds.every(idOk) || new Set(r.approvedContactIds).size !== r.approvedContactIds.length || r.approvedContactIds.some(id => !p.selections.some(s => s.contactId === id))) return null;
  return { requestId: r.requestId, preview: { selections: p.selections, template: p.template }, proof: r.proof, approvedContactIds: [...r.approvedContactIds].sort((a, b) => a - b) };
}
async function authorize(c: PoolClient, a: GroupActor, lock: boolean) {
  if (!idOk(a?.userId) || !idOk(a.sessaoId) || typeof a.email !== "string") return false;
  if (lock) await c.query("SELECT pg_advisory_xact_lock(7003)");
  if (!(await c.query(`SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel='total'${lock ? " FOR SHARE" : ""}`, [a.userId, a.email.toLowerCase()])).rowCount) return false;
  return !!(await c.query(`SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp()${lock ? " FOR SHARE" : ""}`, [a.sessaoId, a.userId])).rowCount;
}
async function resultWith(c: PoolClient, requestId: string, actor: GroupActor) {
  const group = (await c.query<{ id: string; created_at: Date }>("SELECT id,created_at FROM contact_reply_groups WHERE actor_id=$1 AND request_id=$2", [actor.userId, requestId])).rows[0];
  if (!group) return fail("not_found");
  const items = (await c.query<{ contact_id: number; reply_id: number; round: number; text_state: string; card_state: string | null; text_error: string | null; card_error: string | null }>("SELECT i.contact_id,i.reply_id,i.round,t.estado text_state,k.estado card_state,t.error_code text_error,k.error_code card_error FROM contact_reply_group_items i JOIN contact_replies t ON t.id=i.reply_id LEFT JOIN contact_replies k ON k.contact_id=i.contact_id AND k.rodada=i.round AND k.versao='card' WHERE i.group_id=$1 ORDER BY i.contact_id", [group.id])).rows;
  return { ok: true as const, groupId: group.id, requestId, reservedAt: group.created_at.toISOString(), items: items.map(i => ({ contactId: i.contact_id, replyId: i.reply_id, round: i.round, textState: i.text_state, cardState: i.card_state, textErrorCode: i.text_error, cardErrorCode: i.card_error })), groupReserved: true, delivery: "not_inferred" as const, automaticResend: false };
}

/** Durable reservation, never a transport call. All cases are revalidated before any item is reserved. */
export async function reserveContactGroup(raw: unknown, actor: GroupActor) {
  const r = parse(raw); if (!r) return fail("parameters");
  const fingerprint = hmac("contact-group-execution:v1:" + JSON.stringify([actor?.userId, r]));
  try {
    return await tx(async c => {
      await c.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='3000ms'");
      if (!await authorize(c, actor, true)) return fail("forbidden");
      await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [`contact-group-request:${actor.userId}:${r.requestId}`]);
      const previous = (await c.query<{ id: string; input_hash: string }>("SELECT id,input_hash FROM contact_reply_groups WHERE actor_id=$1 AND request_id=$2", [actor.userId, r.requestId])).rows[0];
      if (previous) return previous.input_hash === fingerprint ? { ok: true as const, groupId: previous.id, requestId: r.requestId, newlyReserved: false, replyIds: [] as number[] } : fail("conflict");
      // Lock every selected source in ascending order, including nonapproved rows
      // that are part of the reviewed context. Shared draft writers use 7006.
      const selected = r.preview.selections.map(s => s.contactId);
      for (const id of selected) await c.query("SELECT pg_advisory_xact_lock(7006,$1)", [id]);
      await c.query("SELECT id FROM contact_messages WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [selected]);
      await c.query("SELECT contact_id FROM contact_drafts WHERE contact_id=ANY($1::int[]) ORDER BY contact_id FOR SHARE", [selected]);
      const preview = await prepareContactGroupPreviewWith(c, { ...r.preview, expectedProof: r.proof }, actor);
      if (!preview.ok) return preview.error === "forbidden" ? fail("forbidden") : fail("conflict");
      const approved = r.approvedContactIds.map(id => preview.recipients.find(x => x.contactId === id)!);
      if (approved.some(row => !row?.eligible || !row.preview || !("expandedInput" in row) || !row.expandedInput)) return fail("conflict");
      if (!await authorize(c, actor, false)) return fail("forbidden");
      const groupId = randomUUID();
      await c.query("INSERT INTO contact_reply_groups(id,actor_id,request_id,input_hash,context_proof,approved_ids) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [groupId, actor.userId, r.requestId, fingerprint, r.proof, JSON.stringify(r.approvedContactIds)]);
      const replyIds: number[] = [];
      for (const row of approved) {
        if (!row.preview || !("expandedInput" in row) || !row.expandedInput) throw new ReservationConflict();
        const selection = r.preview.selections.find(s => s.contactId === row.contactId)!;
        const reservation = await reserveContactResponseWith(c, { contactId: row.contactId, entrada: row.expandedInput, selo: row.preview.selo, nova: selection.newRound, por: actor });
        if ("erro" in reservation) throw new ReservationConflict();
        replyIds.push(reservation.text);
        await c.query("INSERT INTO contact_reply_group_items(group_id,contact_id,reply_id,round) VALUES($1,$2,$3,$4)", [groupId, row.contactId, reservation.text, reservation.rodada]);
      }
      if (!await authorize(c, actor, false)) throw new ReservationConflict("forbidden");
      await audit("contact_group_reserved", null, { groupId, requestId: r.requestId, contacts: r.approvedContactIds, replies: replyIds, userId: actor.userId, por: actor.email.toLowerCase() }, c);
      return { ok: true as const, groupId, requestId: r.requestId, newlyReserved: true, replyIds };
    });
  } catch (error) { if (error instanceof ReservationConflict) return fail(error.reason); throw error; }
}

/** Read-only recovery after a lost response. Never claims a job or re-emits mail. */
export async function contactGroupResult(requestId: unknown, actor: GroupActor) {
  if (typeof requestId !== "string" || !UUID.test(requestId)) return fail("parameters");
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await c.query("SET LOCAL statement_timeout='1500ms'");
    if (!await authorize(c, actor, false)) return fail("forbidden");
    return resultWith(c, requestId, actor);
  });
}

/** Explicit execution only. Replayed reservations return current states without calling the dispatcher again. */
export async function executeContactGroup(raw: unknown, actor: GroupActor, options: ContactDeliveryOptions = {}) {
  const reserved = await reserveContactGroup(raw, actor);
  if (!reserved.ok) return reserved;
  if (reserved.newlyReserved) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, reserved.replyIds.length) }, async () => {
      while (next < reserved.replyIds.length) {
        const id = reserved.replyIds[next++];
        // Durable prepared/sending/uncertain states remain owned by the existing
        // executor even if this HTTP request ends or result persistence fails.
        try { await dispatchContactReply(id, options); } catch {}
      }
    }));
  }
  const result = await contactGroupResult(reserved.requestId, actor);
  return result.ok ? { ...result, replayed: !reserved.newlyReserved } : result;
}
