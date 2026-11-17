import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { decryptDraft, encryptDraft, validDraftInput, type ContactDraftInput } from "./contact-draft-codec";
import { ADMIN_CONTENT_RETENTION_DAYS } from "./admin-retention-policy";
import { validHistoryId } from "./contact-history";

export type DraftActor = { userId: number; email: string };
type Row = { contact_id: number; id: string; revision: number; state: "stored" | "discarded" | "expired"; content_cipher: string | null; expired: boolean; created_at: string; updated_at: string; expires_at: string; updated_by: number; author: string };
const stamp = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const select = `SELECT d.contact_id,d.id,d.revision,d.state,d.content_cipher,d.expires_at<=clock_timestamp() expired,
  ${stamp("d.created_at")} created_at,${stamp("d.updated_at")} updated_at,${stamp("d.expires_at")} expires_at,d.updated_by,u.nome author
  FROM contact_drafts d JOIN admin_users u ON u.id=d.updated_by WHERE d.contact_id=$1`;
async function authorize(c: PoolClient, actor: DraftActor) {
  if (!actor || !validHistoryId(actor.userId) || typeof actor.email !== "string" || actor.email.length > 254) return false;
  await c.query("SELECT pg_advisory_xact_lock(7003)");
  return !!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, actor.email.trim().toLowerCase()])).rowCount;
}
function view(row?: Row) {
  if (!row) return { revision: 0, state: "empty" as const, input: null, author: null, updatedAt: null, expiresAt: null };
  const input = row.state === "stored" && !row.expired && row.content_cipher ? decryptDraft(row.id, row.content_cipher) : null;
  return { revision: row.revision, state: row.expired && row.state === "stored" ? "expired" as const : row.state === "stored" && !input ? "unavailable" as const : row.state,
    input, author: row.author, updatedAt: row.updated_at, expiresAt: row.expires_at };
}
/** One shared draft per received contact. Reading/saving never queues or authorizes mail. */
export async function readContactDraft(contactId: number, actor: DraftActor) {
  if (!validHistoryId(contactId)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    if (!await authorize(c, actor)) return { ok: false as const, error: "forbidden" };
    if (!(await c.query("SELECT 1 FROM contact_messages WHERE id=$1", [contactId])).rowCount) return { ok: false as const, error: "not_found" };
    const row = (await c.query<Row>(select, [contactId])).rows[0];
    await audit("contact_draft_read", null, { contactId, revision: row?.revision ?? 0, userId: actor.userId, por: actor.email.toLowerCase() }, c);
    return { ok: true as const, draft: view(row) };
  });
}

export async function writeContactDraft(contactId: number, revision: number, input: ContactDraftInput | null, actor: DraftActor) {
  if (!validHistoryId(contactId) || !Number.isInteger(revision) || revision < 0 || revision >= 2147483647 || input !== null && !validDraftInput(input)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    if (!await authorize(c, actor)) return { ok: false as const, error: "forbidden" };
    await c.query("SELECT pg_advisory_xact_lock(7006,$1)", [contactId]);
    if (!(await c.query("SELECT 1 FROM contact_messages WHERE id=$1", [contactId])).rowCount) return { ok: false as const, error: "not_found" };
    const current = (await c.query<Row>(select + " FOR UPDATE OF d", [contactId])).rows[0];
    if ((current?.revision ?? 0) !== revision) return { ok: false as const, error: "conflict", revision: current?.revision ?? 0 };
    if (!input && (!current || current.state === "discarded")) return { ok: true as const, draft: view(current) };
    const id = current?.id ?? randomUUID(), next = revision + 1;
    const cipher = input ? encryptDraft(id, input) : null;
    if (!current) {
      await c.query(`INSERT INTO contact_drafts(contact_id,id,revision,state,content_cipher,created_by,updated_by,expires_at)
        VALUES($1,$2,$3,'stored',$4,$5,$5,clock_timestamp()+make_interval(days=>$6))`, [contactId, id, next, cipher, actor.userId, ADMIN_CONTENT_RETENTION_DAYS]);
    } else {
      // Ordinary saves never extend the retention deadline. Expired/discarded content starts a new explicit cycle.
      const newCycle = !!input && (current.state !== "stored" || current.expired);
      await c.query(`UPDATE contact_drafts SET revision=$2,state=$3,content_cipher=$4,updated_by=$5,updated_at=clock_timestamp(),
        created_at=CASE WHEN $6 THEN clock_timestamp() ELSE created_at END,
        created_by=CASE WHEN $6 THEN $5 ELSE created_by END,
        expires_at=CASE WHEN $6 THEN clock_timestamp()+make_interval(days=>$7) ELSE expires_at END WHERE contact_id=$1`,
      [contactId, next, input ? "stored" : "discarded", cipher, actor.userId, newCycle, ADMIN_CONTENT_RETENTION_DAYS]);
    }
    await audit(input ? "contact_draft_saved" : "contact_draft_discarded", null, { contactId, draftId: id, revision: next, userId: actor.userId, por: actor.email.toLowerCase() }, c);
    return { ok: true as const, draft: view((await c.query<Row>(select, [contactId])).rows[0]) };
  });
}
