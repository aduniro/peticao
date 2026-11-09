import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { batchEnvelope, batchMessageKey, documentVersion, type ApprovalRow } from "./batches";
import { contentFingerprint } from "./mail/archive-codec";
import { frozenReplyTo } from "./mail/payload";
import { hmac } from "./security";

/** A fresh human code may retry only this frozen document and conclusively unsent recipients. */
export async function rejectedBatchRecipients(client: PoolClient, row: ApprovalRow): Promise<string[] | null> {
  if (row.status !== "failed" || !row.approved_at || !row.pdf) return null;
  const approvals = (await client.query<{ id: number; data: string }>("SELECT id,data FROM audit_log WHERE event='batch_approved' AND data::jsonb->>'batchId'=$1 ORDER BY id LIMIT 2", [String(row.id)])).rows;
  if (approvals.length !== 1) return null;
  const base = JSON.parse(approvals[0].data), pdf = row.signed_pdf ?? row.pdf, sha = createHash("sha256").update(pdf).digest("hex");
  if (base.documentVersion !== documentVersion(row) || base.sentSha256 !== sha || sha !== (row.signed_pdf ? row.signed_pdf_sha256 : row.pdf_sha256) || !Array.isArray(base.recipients) || !base.recipients.length || base.recipients.length > 2000 || base.recipients.some((to: unknown) => typeof to !== "string" || to.length > 254 || to !== to.trim().toLowerCase()) || new Set(base.recipients).size !== base.recipients.length) return null;
  // Status alone is insufficient: an audited completed round must precede recovery.
  if (!(await client.query("SELECT 1 FROM audit_log WHERE event='batch_send_result' AND id>$2 AND data::jsonb->>'batchId'=$1 LIMIT 1", [String(row.id), approvals[0].id])).rowCount) return null;
  const retry: string[] = [];
  for (const to of [...base.recipients as string[]].sort()) {
    const message = (await client.query<{ id: string; status: string; kind: string; channel: string; to_addr: string; content_fingerprint: string; reply_to: string | null }>("SELECT id,status,kind,channel,to_addr,content_fingerprint,reply_to FROM mail_messages WHERE request_key=$1 FOR UPDATE", [hmac("mail-request-v1:" + batchMessageKey(row.id, sha, to))])).rows[0];
    const settled = (await client.query<{ ok: boolean }>("SELECT ok FROM batch_sends WHERE batch_id=$1 AND recipient=$2", [row.id, to])).rows[0];
    if (!message) { if (settled?.ok) return null; retry.push(to); continue; }
    if (message.kind !== "lote" || message.channel !== "transactional" || message.to_addr !== to || message.content_fingerprint !== contentFingerprint(frozenReplyTo(batchEnvelope(row, to, pdf, sha), message.reply_to))) return null;
    const attempts = (await client.query<{ state: string; finished_at: Date | null }>("SELECT state,finished_at FROM mail_message_attempts WHERE message_id=$1", [message.id])).rows;
    if (attempts.some(a => a.state === "prepared" || a.state === "indeterminate")) return null;
    if (message.status === "accepted") {
      if (!attempts.some(a => a.state === "accepted" && a.finished_at)) return null;
      continue;
    }
    if (settled?.ok || attempts.some(a => a.state === "accepted")) return null;
    if (message.status === "rejected" && attempts.length && attempts.every(a => a.state === "rejected" && a.finished_at) || message.status === "prepared" && !attempts.length) retry.push(to);
    else return null;
  }
  return retry.length ? retry : null;
}
