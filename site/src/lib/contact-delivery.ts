import { randomBytes } from "node:crypto";
import { audit, query, tx } from "./db";
import { sendMail, type Mail } from "./mail";
import { assertSendAllowed, MailBlockedError } from "./mail/guard";
import { isSuppressed, MailSuppressedError } from "./mail/suppression";
import { SAFE_EMAIL_RE } from "./email-syntax";

export type ContactDeliveryState = "legacy" | "prepared" | "blocked" | "sending" | "accepted" | "uncertain" | "rejected";
type Job = { id: number; contact_id: number; rodada: number; versao: "texto" | "card"; por: string; payload: Mail; attempt_id: string; estado: ContactDeliveryState };
export type ContactDispatch = { id: number; estado: ContactDeliveryState | "missing" };
export type ContactDeliveryOptions = { enviar?: typeof sendMail; deadlineMs?: number };

function validPayload(value: unknown): value is Mail {
  if (!value || typeof value !== "object") return false;
  const m = value as Mail;
  return typeof m.to === "string" && SAFE_EMAIL_RE.test(m.to) && typeof m.subject === "string" && m.subject.length <= 1000 && typeof m.text === "string" && m.text.length <= 1_000_000 && (m.html === undefined || typeof m.html === "string" && m.html.length <= 2_000_000) && (m.replyTo === undefined || typeof m.replyTo === "string" && SAFE_EMAIL_RE.test(m.replyTo)) && (m.bcc === undefined || Array.isArray(m.bcc) && m.bcc.length <= 20 && m.bcc.every(e => typeof e === "string" && SAFE_EMAIL_RE.test(e))) && m.attachments === undefined;
}

async function claim(id?: number): Promise<Job | null> {
  return tx(async c => {
    const row = (await c.query<Job>(`SELECT r.* FROM contact_replies r WHERE r.estado='prepared' AND r.due_at <= now()
      AND ($1::int IS NULL OR r.id=$1) AND (r.versao='texto' OR EXISTS(SELECT 1 FROM contact_replies t WHERE t.contact_id=r.contact_id AND t.rodada=r.rodada AND t.versao='texto' AND t.estado='accepted'))
      ORDER BY r.due_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`, [id ?? null])).rows[0];
    if (!row) return null;
    const attempt = randomBytes(16).toString("hex");
    await c.query("UPDATE contact_replies SET estado='sending',started_at=now(),attempt_id=$2,attempts=attempts+1 WHERE id=$1", [row.id, attempt]);
    await audit("contato_envio_iniciado", null, { contato: row.contact_id, resposta: row.id, rodada: row.rodada, versao: row.versao, por: row.por, tentativa: attempt }, c);
    return { ...row, estado: "sending", attempt_id: attempt };
  });
}

async function outcome(job: Job, state: "accepted" | "uncertain" | "rejected", error: string | null = null): Promise<void> {
  await tx(async c => {
    const changed = await c.query(`UPDATE contact_replies SET estado=$3,ok=$4,error_code=$5,finished_at=now()
      WHERE id=$1 AND attempt_id=$2 AND estado IN ('sending','uncertain') AND (estado<>$3 OR error_code IS DISTINCT FROM $5) RETURNING id`, [job.id, job.attempt_id, state, state === "accepted", error]);
    if (!changed.rowCount) return;
    if (state === "accepted" && job.versao === "texto") {
      await c.query("UPDATE contact_replies SET estado='prepared',due_at=now()+interval '1 minute' WHERE contact_id=$1 AND rodada=$2 AND versao='card' AND estado='blocked'", [job.contact_id, job.rodada]);
    }
    await audit("contato_envio_resultado", null, { contato: job.contact_id, resposta: job.id, rodada: job.rodada, versao: job.versao, por: job.por, tentativa: job.attempt_id, estado: state, codigo: error }, c);
  });
}

async function execute(job: Job, options: ContactDeliveryOptions): Promise<ContactDispatch> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async (): Promise<ContactDispatch> => {
    let accepted = false;
    try {
      if (!validPayload(job.payload)) { await outcome(job, "rejected", "invalid_payload"); return { id: job.id, estado: "rejected" }; }
      assertSendAllowed(job.payload.to);
      for (const recipient of job.payload.bcc ?? []) assertSendAllowed(recipient);
      if (await isSuppressed(job.payload.to)) throw new MailSuppressedError();
      const result = await (options.enviar ?? sendMail)(job.payload, "resposta-contato", { queue: false, singleAttempt: true, messageKey: `contact-reply:${job.id}` });
      if (result !== "sent") throw new Error("untracked_delivery_queue");
      accepted = true;
      await outcome(job, "accepted");
      return { id: job.id, estado: "accepted" };
    } catch (error) {
      const blocked = error instanceof MailBlockedError || error instanceof MailSuppressedError;
      const state = !accepted && blocked ? "rejected" : "uncertain";
      const code = accepted ? "persistence_after_accept" : blocked ? "blocked" : "provider_unconfirmed";
      await outcome(job, state, code).catch(() => {});
      return { id: job.id, estado: state };
    }
  })();
  const deadline = new Promise<ContactDispatch>(resolve => {
    timer = setTimeout(() => { void outcome(job, "uncertain", "timeout").catch(() => {}).then(() => resolve({ id: job.id, estado: "uncertain" })); }, options.deadlineMs ?? 30_000);
    timer.unref();
  });
  try { return await Promise.race([work, deadline]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function dispatchContactReply(id: number, options: ContactDeliveryOptions = {}): Promise<ContactDispatch> {
  const job = await claim(id);
  if (job) return execute(job, options);
  const row = (await query<{ estado: ContactDeliveryState }>("SELECT estado FROM contact_replies WHERE id=$1", [id])).rows[0];
  return { id, estado: row?.estado ?? "missing" };
}

/** A lost worker becomes uncertain, never eligible for a second automatic send. */
export async function reconcileInterruptedContacts(): Promise<number> {
  return tx(async c => {
    const changed = await c.query<{ id: number }>("UPDATE contact_replies SET estado='uncertain',ok=false,error_code='worker_interrupted',finished_at=now() WHERE estado='sending' AND started_at < now()-interval '5 minutes' RETURNING id");
    if (changed.rows.length) await audit("contato_envio_interrompido", null, { respostas: changed.rows.map(r => r.id) }, c);
    return changed.rows.length;
  });
}

export async function drainContactReplies(limit = 5, options: ContactDeliveryOptions = {}) {
  const out = { tried: 0, accepted: 0, uncertain: 0, rejected: 0, errors: 0, interrupted: await reconcileInterruptedContacts() };
  const maximum = Math.min(25, Math.max(0, Math.trunc(limit) || 0)); let slots = 0;
  await Promise.all(Array.from({ length: Math.min(3, maximum) }, async () => {
    while (slots++ < maximum) {
      try {
        const job = await claim(); if (!job) return;
        out.tried++;
        const result = await execute(job, options);
        if (result.estado === "accepted") out.accepted++;
        else if (result.estado === "rejected") out.rejected++;
        else out.uncertain++;
      } catch { out.errors++; }
    }
  }));
  return out;
}
