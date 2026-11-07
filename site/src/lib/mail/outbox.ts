import { query, tx } from "../db";
import type { Mail } from "./index";
import { fromStored, toStored, type Stored } from "./payload";
import { queueMessage } from "./archive";

/**
 * Fila de reenvio: e-mail que nenhum provedor conseguiu enviar fica guardado e é tentado de novo, com intervalos crescentes,
 * até sair (quando o problema é resolvido) ou passar de 48 h (então fica "failed" para o admin ver).
 */
export const BACKOFF_MIN = [1, 2, 5, 10, 30, 60, 120, 240, 360];
export const MAX_AGE_H = 48;
export const nextDelayMinutes = (attempts: number) => BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)];

export async function enqueueMail(m: Mail, kind: string, error: string, messageId?: string): Promise<number> {
  if (messageId) return queueMessage(m,kind,error,messageId);
  const r = await query<{ id: number }>(
    `INSERT INTO mail_outbox(kind,to_addr,payload,last_error,attempts,next_attempt_at) VALUES($1,$2,$3,$4,0,now() + interval '1 minute') RETURNING id`,
    [kind, m.to, JSON.stringify(toStored(m)), error.slice(0, 300)]);
  return r.rows[0].id;
}

export type DrainResult = { tried: number; sent: number; failed: number; pending: number };

/** Tenta enviar os e-mails vencidos da fila. `send` é a função de envio real (cadeia de provedores, sem enfileirar de novo). */
export async function drainOutbox(send: (m: Mail, kind: string, context?: {id:number;messageId:string|null}) => Promise<unknown>, limit = 20): Promise<DrainResult> {
  const out: DrainResult = { tried: 0, sent: 0, failed: 0, pending: 0 };
  const due = await tx(async (c) => {
    const r = await c.query<{ id: number; kind: string; payload: Stored; message_id: string|null; attempts: number; created_at: string }>(
      `SELECT id,kind,payload,message_id,attempts,created_at FROM mail_outbox WHERE status='pending' AND next_attempt_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    // "reserva" cada item por 2 minutos, para duas execuções simultâneas não enviarem duas vezes
    if (r.rows.length) await c.query("UPDATE mail_outbox SET next_attempt_at = now() + interval '2 minutes' WHERE id = ANY($1::int[])", [r.rows.map((x) => x.id)]);
    return r.rows;
  });
  for (const row of due) {
    out.tried++;
    try {
      await send(fromStored(row.payload), row.kind, {id:row.id,messageId:row.message_id});
      const changed = await query("UPDATE mail_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1 AND status='pending'", [row.id]);
      if (changed.rowCount) out.sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const tooOld = Date.now() - new Date(row.created_at).getTime() > MAX_AGE_H * 3600_000;
      if (tooOld) { const changed = await query("UPDATE mail_outbox SET status='failed', attempts=$2, last_error=$3 WHERE id=$1 AND status='pending'", [row.id, attempts, String((e as Error).message).slice(0, 300)]); if (changed.rowCount) out.failed++; }
      else await query("UPDATE mail_outbox SET attempts=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id=$1 AND status='pending'", [row.id, attempts, String((e as Error).message).slice(0, 300), String(nextDelayMinutes(attempts))]);
    }
  }
  out.pending = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM mail_outbox WHERE status='pending'")).rows[0].n;
  return out;
}

export async function outboxStats(): Promise<{ pending: number; failed: number; oldest: string | null }> {
  const r = (await query<any>("SELECT COUNT(*) FILTER (WHERE status='pending')::int pending, COUNT(*) FILTER (WHERE status='failed')::int failed, MIN(created_at) FILTER (WHERE status='pending') oldest FROM mail_outbox")).rows[0];
  return { pending: r.pending, failed: r.failed, oldest: r.oldest };
}
