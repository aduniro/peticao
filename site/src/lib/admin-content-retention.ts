import { mailQueueScope, mailQueueTable } from "./mail/queue-scope";
import { audit, tx } from "./db";
import { purgeArchivedContent } from "./mail/archive";
import { ADMIN_CONTENT_RETENTION_DAYS } from "./admin-retention-policy";
import { purgeInboundContent } from "./mail/inbound-store";

/** Purge body copies, not receipt metadata, original contacts, signers or petition documents. */
export async function purgeAdminContent(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("retention_parameters");
  return tx(async c => {
    await purgeInboundContent(limit, c);
    const messages = await purgeArchivedContent(limit, c);
    const outbox = (await c.query<{ id: number }>(`WITH expired AS (
      SELECT id FROM ${mailQueueTable()} WHERE created_at<=clock_timestamp()-make_interval(days=>$2)
        AND (payload<>'{}'::jsonb OR status='pending') ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE ${mailQueueTable()} o SET payload='{}'::jsonb,
      last_error=CASE WHEN o.status='pending' THEN 'content_expired' ELSE o.last_error END,
      status=CASE WHEN o.status='pending' THEN 'failed' ELSE o.status END
      FROM expired WHERE o.id=expired.id RETURNING o.id`, [limit, ADMIN_CONTENT_RETENTION_DAYS])).rows;
    const replies = (await c.query<{ id: number }>(`WITH expired AS (
      SELECT id FROM contact_replies WHERE criada_em<=clock_timestamp()-make_interval(days=>$2)
        AND payload IS NOT NULL AND estado<>'sending' ORDER BY criada_em,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE contact_replies r SET payload=NULL,
      error_code=CASE WHEN r.estado IN ('prepared','blocked') THEN 'content_expired' ELSE r.error_code END,
      finished_at=CASE WHEN r.estado IN ('prepared','blocked') THEN COALESCE(r.finished_at,now()) ELSE r.finished_at END,
      ok=CASE WHEN r.estado IN ('prepared','blocked') THEN false ELSE r.ok END,
      estado=CASE WHEN r.estado IN ('prepared','blocked') THEN 'rejected' ELSE r.estado END
      FROM expired WHERE r.id=expired.id RETURNING r.id`, [limit, ADMIN_CONTENT_RETENTION_DAYS])).rows;
    const drafts = (await c.query<{ contact_id: number; revision: number }>(`WITH expired AS (
      SELECT contact_id FROM contact_drafts WHERE state='stored' AND expires_at<=clock_timestamp()
        ORDER BY expires_at,contact_id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE contact_drafts d SET content_cipher=NULL,state='expired',updated_at=clock_timestamp(),
      revision=CASE WHEN d.revision<2147483647 THEN d.revision+1 ELSE d.revision END
      FROM expired WHERE d.contact_id=expired.contact_id RETURNING d.contact_id,d.revision`, [limit])).rows;
    if (outbox.length || replies.length || drafts.length) await audit("admin_content_expired", null, { outbox: outbox.map(r => r.id), queueScope: mailQueueScope(), replies: replies.map(r => r.id), drafts, days: ADMIN_CONTENT_RETENTION_DAYS }, c);
    return { messages, outbox: outbox.length, replies: replies.length, drafts: drafts.length };
  });
}
