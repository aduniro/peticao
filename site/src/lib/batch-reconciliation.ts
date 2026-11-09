import { audit, tx } from "./db";
import { authorizeBatchActor, batchEnvelope, batchMessageKey, documentVersion, type ApprovalRow, type BatchActor } from "./batches";
import { contentFingerprint } from "./mail/archive-codec";
import { frozenReplyTo } from "./mail/payload";
import { hmac, safeEqual } from "./security";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type Evidence = { recipient: string; messageId: string | null; state: string; acceptedAt: string | null; attemptId: string | null };
type Message = { id: string; kind: string; channel: string; to_addr: string; status: string; content_fingerprint: string; reply_to: string | null };
type Approval = { batchId: number; documentVersion: string; sentSha256: string; recipients: string[] };
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;

/** Metadata only. Never decrypt, prepare, renew or send an archived message. */
async function inspect(client: PoolClient, id: number, actor: BatchActor) {
  const row = (await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!row?.pdf || !row.approved_at || !["prepared", "failed", "sent"].includes(row.status)) return null;
  const records = (await client.query<{ id: number; data: string }>("SELECT id,data FROM audit_log WHERE event='batch_approved' AND data::jsonb->>'batchId'=$1 ORDER BY id LIMIT 2", [String(id)])).rows;
  if (records.length !== 1) return null;
  const approval: Approval = JSON.parse(records[0].data), pdf = row.signed_pdf ?? row.pdf;
  const sha = createHash("sha256").update(pdf).digest("hex"), version = documentVersion(row);
  if (approval.documentVersion !== version || approval.sentSha256 !== sha || sha !== (row.signed_pdf ? row.signed_pdf_sha256 : row.pdf_sha256) || !Array.isArray(approval.recipients) || !approval.recipients.length || approval.recipients.length > 2000 || approval.recipients.some(to => typeof to !== "string" || to.length > 254 || to !== to.trim().toLowerCase()) || new Set(approval.recipients).size !== approval.recipients.length) return null;
  const evidence: Evidence[] = [], proofs: unknown[] = [];
  for (const recipient of [...approval.recipients].sort()) {
    const key = hmac("mail-request-v1:" + batchMessageKey(id, sha, recipient));
    const message = (await client.query<Message>("SELECT id,kind,channel,to_addr,status,content_fingerprint,reply_to FROM mail_messages WHERE request_key=$1 FOR UPDATE", [key])).rows[0];
    let state = "unavailable", acceptedAt: string | null = null, attemptId: string | null = null;
    if (message) {
      const expected = contentFingerprint(frozenReplyTo(batchEnvelope(row, recipient, pdf, sha), message.reply_to));
      if (message.kind !== "lote" || message.channel !== "transactional" || message.to_addr !== recipient || message.content_fingerprint !== expected) return null;
      state = message.status;
      const attempt = (await client.query<{ id: string; accepted_at: string }>(`SELECT id,to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') accepted_at FROM mail_message_attempts WHERE message_id=$1 AND state='accepted' AND finished_at IS NOT NULL ORDER BY finished_at,id LIMIT 1`, [message.id])).rows[0];
      const active = (await client.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1 AND state='prepared' LIMIT 1", [message.id])).rowCount;
      if (message.status === "accepted" && attempt && !active) { acceptedAt = attempt.accepted_at; attemptId = attempt.id; }
      else if (message.status === "accepted") return null;
      proofs.push([message.id, message.status, message.content_fingerprint, message.reply_to, acceptedAt, attemptId]);
    } else proofs.push([recipient, "unavailable"]);
    evidence.push({ recipient, messageId: message?.id ?? null, state, acceptedAt, attemptId });
  }
  const proof = hmac("batch-reconciliation:v1:" + JSON.stringify([id, actor.userId, actor.email.trim().toLowerCase(), records[0].id, row.approved_at, version, proofs]));
  return { row, evidence, proof, approvalId: records[0].id };
}

export async function inspectBatchAcceptance(id: number, actor: BatchActor) {
  if (!validId(id)) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    if (!(await authorizeBatchActor(client, actor))) return { ok: false as const, error: "forbidden" };
    const snapshot = await inspect(client, id, actor);
    if (!snapshot) return { ok: false as const, error: "conflict" };
    return { ok: true as const, proof: snapshot.proof, recipients: snapshot.evidence, batchId: id };
  });
}

/** Reconcile observed acceptance only; rejection/uncertainty never opens another attempt. */
export async function reconcileBatchAcceptance(id: number, proof: unknown, actor: BatchActor) {
  if (!validId(id) || typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    if (!(await authorizeBatchActor(client, actor))) return { ok: false as const, error: "forbidden" };
    const snapshot = await inspect(client, id, actor);
    if (!snapshot || !safeEqual(snapshot.proof, proof)) return { ok: false as const, error: "conflict" };
    const accepted = snapshot.evidence.filter(e => e.state === "accepted" && e.acceptedAt);
    let updated = 0;
    for (const e of accepted) {
      const r = await client.query("INSERT INTO batch_sends(batch_id,recipient,ok,error,at) VALUES($1,$2,true,NULL,$3) ON CONFLICT(batch_id,recipient) DO UPDATE SET ok=true,error=NULL,at=EXCLUDED.at WHERE NOT batch_sends.ok RETURNING id", [id, e.recipient, e.acceptedAt]);
      updated += r.rowCount ?? 0;
    }
    const complete = accepted.length === snapshot.evidence.length;
    const at = accepted.map(e => e.acceptedAt!).sort().at(-1);
    if (complete && (snapshot.row.status !== "sent" || !snapshot.row.sent_at)) {
      await client.query("UPDATE batches SET status='sent',sent_at=COALESCE(sent_at,$2) WHERE id=$1", [id, at]); updated++;
    }
    if (updated) await audit("batch_acceptance_reconciled", null, { batchId: id, approvalId: snapshot.approvalId, userId: actor.userId, por: actor.email.trim().toLowerCase(), accepted: accepted.map(e => ({ recipient: e.recipient, messageId: e.messageId, attemptId: e.attemptId, at: e.acceptedAt })), complete }, client);
    return { ok: true as const, updated, complete };
  });
}
