import { randomUUID } from "node:crypto";
import { audit, query, tx } from "../db";
import { hmac } from "../security";
import type { Mail } from "./index";
import { toStored, fromStored, frozenReplyTo } from "./payload";
import { contentFingerprint, decryptMail, encryptMail, fitsArchive, serializeMail, validMessageId } from "./archive-codec";
import { lockEventLinks, reconcileReceiptEvents } from "./message-events";
import { validAccountScope } from "./event-scope";
import { ADMIN_CONTENT_RETENTION_DAYS, adminContentDeadline } from "../admin-retention-policy";
import type { PoolClient } from "pg";
type Channel = "transactional" | "marketing";
type State = "prepared" | "sending" | "accepted" | "rejected" | "indeterminate" | "queued";
/** Explicit content retention; absence archives metadata only. Nothing chooses a policy for the operator. */
export async function prepareMessage(mail: Mail, kind: string, channel: Channel, options: { requestKey?: string; archive?: { until: Date | null }; previousId?: string } = {}) {
  if (!kind || kind.length > 100 || !["transactional","marketing"].includes(channel) || options.previousId !== undefined && !validMessageId(options.previousId) || options.requestKey !== undefined && (!options.requestKey || options.requestKey.length > 256)) throw new Error("archive_parameters");
  const fingerprint = contentFingerprint(mail);
  const id = randomUUID(), request = options.requestKey ? hmac("mail-request-v1:" + options.requestKey) : null;
  const fits = options.archive ? fitsArchive(mail) : false;
  const cipher = options.archive && fits ? encryptMail(id,serializeMail(mail)) : null;
  const requested = options.archive ? options.archive.until : null;
  if (requested !== null && (!(requested instanceof Date) || !Number.isFinite(requested.getTime()))) throw new Error("archive_parameters");
  // The approved maximum also applies to old internal callers requesting unlimited retention.
  const expires = options.archive ? new Date(Math.min(requested?.getTime() ?? Infinity, adminContentDeadline().getTime())) : null;
  return tx(async c => {
    if (request) await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", ["mail-request:" + request]);
    if (request) {
      const previous = (await c.query<{id:string;kind:string;channel:string;to_addr:string;content_fingerprint:string;previous_id:string|null}>("SELECT id,kind,channel,to_addr,content_fingerprint,previous_id FROM mail_messages WHERE request_key=$1", [request])).rows[0];
      if (previous) {
        if (previous.kind !== kind || previous.channel !== channel || previous.to_addr !== mail.to.toLowerCase() || previous.content_fingerprint !== fingerprint || previous.previous_id !== (options.previousId ?? null)) throw new Error("message_conflict");
        return {id:previous.id,existing:true};
      }
    }
    if (expires && !(await c.query<{future:boolean}>("SELECT $1::timestamptz>clock_timestamp() future",[expires])).rows[0].future) throw new Error("archive_expired");
    await c.query("INSERT INTO mail_messages(id,request_key,kind,channel,to_addr,content_fingerprint,content_state,content_cipher,content_expires_at,previous_id,reply_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id,request,kind,channel,mail.to.toLowerCase(),fingerprint,cipher?"stored":options.archive&&!fits?"oversize":"unavailable",cipher,cipher?expires:null,options.previousId??null,mail.replyTo??null]);
    await audit("mail_message_prepared",null,{messageId:id,kind,channel,contentStored:!!cipher,previousId:options.previousId??null},c);
    return {id,existing:false};
  });
}

export async function beginAttempt(messageId: string, provider: string, from: string, options: { retryUncertain?: boolean } = {}) {
  if (!validMessageId(messageId) || !/^[a-z0-9_-]{1,40}$/.test(provider) || !from || from.length > 200) throw new Error("archive_parameters");
  return tx(async c => {
    const message = (await c.query<{status:State}>("SELECT status FROM mail_messages WHERE id=$1 FOR UPDATE",[messageId])).rows[0];
    if (!message) return {ok:false as const,error:"not_found"};
    if (message.status === "accepted") return {ok:false as const,error:"already_accepted"};
    if ((await c.query("SELECT id FROM mail_message_attempts WHERE message_id=$1 AND state='prepared'",[messageId])).rowCount) return {ok:false as const,error:"in_progress"};
    if (message.status === "indeterminate" && !options.retryUncertain) return {ok:false as const,error:"indeterminate"};
    const id = randomUUID();
    await c.query("INSERT INTO mail_message_attempts(id,message_id,provider,from_addr) VALUES($1,$2,$3,$4)",[id,messageId,provider,from]);
    await c.query("UPDATE mail_messages SET status='sending' WHERE id=$1",[messageId]);
    await audit("mail_message_attempt_started",null,{messageId,attemptId:id,provider,retryUncertain:!!options.retryUncertain},c);
    return {ok:true as const,id};
  });
}

/** A caller must distinguish a proven rejection from an uncertain transport result. */
export async function finishAttempt(id: string, outcome: "accepted" | "rejected" | "indeterminate", options: { providerId?: string; errorCode?: string; accountScope?: string } = {}) {
  if (!validMessageId(id) || !["accepted","rejected","indeterminate"].includes(outcome) || options.providerId !== undefined && (typeof options.providerId !== "string" || options.providerId.length>200) || options.errorCode !== undefined && !/^[a-z0-9_]{1,50}$/.test(options.errorCode) || options.accountScope !== undefined && !validAccountScope(options.accountScope)) throw new Error("archive_parameters");
  return tx(async c => {
    const base = (await c.query<{message_id:string}>("SELECT message_id FROM mail_message_attempts WHERE id=$1",[id])).rows[0];
    if (!base) return {ok:false as const,error:"not_found"};
    if(options.providerId && options.accountScope)await lockEventLinks(c);
    // Same lock order as admission: message, then attempt.
    const message = (await c.query<{id:string;kind:string;channel:string;to_addr:string}>("SELECT id,kind,channel,to_addr FROM mail_messages WHERE id=$1 FOR UPDATE",[base.message_id])).rows[0];
    const row = (await c.query<{state:string;provider:string;from_addr:string;provider_id:string|null;error_code:string|null;account_scope:string|null}>("SELECT state,provider,from_addr,provider_id,error_code,account_scope FROM mail_message_attempts WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if (row.state !== "prepared") {
      if (row.state !== outcome || row.provider_id !== (options.providerId??null) || row.error_code !== (options.errorCode??null) || row.account_scope !== (options.accountScope??null)) return {ok:false as const,error:"outcome_conflict"};
      return {ok:true as const,existing:true};
    }
    await c.query("UPDATE mail_message_attempts SET state=$2,finished_at=now(),provider_id=$3,error_code=$4,account_scope=$5 WHERE id=$1",[id,outcome,options.providerId??null,options.errorCode??null,options.accountScope??null]);
    const aggregate = (await c.query<{accepted:boolean;uncertain:boolean}>("SELECT bool_or(state='accepted') accepted,bool_or(state='indeterminate') uncertain FROM mail_message_attempts WHERE message_id=$1",[message.id])).rows[0];
    const state = aggregate.accepted ? "accepted" : aggregate.uncertain ? "indeterminate" : "rejected";
    await c.query("UPDATE mail_messages SET status=$2 WHERE id=$1",[message.id,state]);
    await c.query("INSERT INTO mail_log(kind,provider,from_addr,to_addr,status,error,channel,message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[message.kind,row.provider,row.from_addr,message.to_addr,outcome==="accepted"?"sent":"failed",options.errorCode??null,message.channel,message.id]);
    if(options.providerId && options.accountScope)await reconcileReceiptEvents(c,row.provider,options.accountScope,options.providerId,message.to_addr);
    await audit("mail_message_attempt_finished",null,{messageId:message.id,attemptId:id,state:outcome},c);
    return {ok:true as const,existing:false};
  });
}

/** Links an already identified queue item; never silently replaces a different message identity. */
export async function linkOutbox(outboxId: number, messageId: string, options: { frozenDefault?: boolean } = {}) {
  if (!Number.isSafeInteger(outboxId) || outboxId<1 || outboxId>2147483647 || !validMessageId(messageId)) throw new Error("archive_parameters");
  return tx(async c => {
    const message = (await c.query<{kind:string;to_addr:string;content_fingerprint:string;reply_to:string|null}>("SELECT kind,to_addr,content_fingerprint,reply_to FROM mail_messages WHERE id=$1 FOR UPDATE",[messageId])).rows[0];
    const row = (await c.query<{kind:string;to_addr:string;message_id:string|null;payload:any}>("SELECT kind,to_addr,message_id,payload FROM mail_outbox WHERE id=$1 FOR UPDATE",[outboxId])).rows[0];
    if (!message || !row || message.kind!==row.kind || message.to_addr!==row.to_addr.toLowerCase() || row.message_id && row.message_id!==messageId) return {ok:false as const,error:"queue_conflict"};
    let matches = false;
    try {
      const raw = fromStored(row.payload);
      const payload = options.frozenDefault ? frozenReplyTo(raw,message.reply_to) : raw;
      matches = contentFingerprint(payload) === message.content_fingerprint;
    } catch { /* A legacy/invalid payload cannot establish content identity. */ }
    if (!matches) return {ok:false as const,error:"queue_conflict"};
    if (row.message_id===messageId) return {ok:true as const,existing:true};
    await c.query("UPDATE mail_outbox SET message_id=$2 WHERE id=$1",[outboxId,messageId]);
    await audit("mail_message_queue_linked",null,{messageId,outboxId},c);
    return {ok:true as const,existing:false};
  });
}

/** Internal only: callers must authorize before decrypting; no plaintext API is provided here. */
export async function archivedContent(id: string) {
  if (!validMessageId(id)) return {state:"not_found" as const};
  const row = (await query<{content_state:string;content_cipher:string|null;valid:boolean}>("SELECT content_state,content_cipher,LEAST(COALESCE(content_expires_at,created_at+make_interval(days=>$2)),created_at+make_interval(days=>$2))>clock_timestamp() valid FROM mail_messages WHERE id=$1",[id,ADMIN_CONTENT_RETENTION_DAYS])).rows[0];
  if (!row) return {state:"not_found" as const};
  if (!row.valid || row.content_state==="expired") return {state:"expired" as const};
  if (row.content_state==="oversize") return {state:"oversize" as const};
  if (!row.content_cipher) return {state:"unavailable" as const};
  try { return {state:"stored" as const,mail:decryptMail(id,row.content_cipher)}; } catch { return {state:"unreadable" as const}; }
}

export async function purgeArchivedContent(limit=100, client?: PoolClient) {
  if (!Number.isInteger(limit)||limit<1||limit>1000) throw new Error("archive_parameters");
  const work = async (c: PoolClient) => {
    const rows=(await c.query<{id:string}>(`WITH expired AS (SELECT id FROM mail_messages WHERE content_state='stored'
      AND LEAST(COALESCE(content_expires_at,created_at+make_interval(days=>$2)),created_at+make_interval(days=>$2))<=clock_timestamp()
      ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
      UPDATE mail_messages m SET content_cipher=NULL,content_state='expired' FROM expired WHERE m.id=expired.id RETURNING m.id`,[limit,ADMIN_CONTENT_RETENTION_DAYS])).rows;
    if(rows.length)await audit("mail_message_content_expired",null,{messages:rows.map(r=>r.id)},c);
    return rows.length;
  };
  return client ? work(client) : tx(work);
}


export async function messageMetadata(id: string) {
  if (!validMessageId(id)) return null;
  return (await query<{id:string;kind:string;channel:string;to_addr:string;status:State;reply_to:string|null;content_fingerprint:string}>("SELECT id,kind,channel,to_addr,status,reply_to,content_fingerprint FROM mail_messages WHERE id=$1",[id])).rows[0]??null;
}

/** Queue creation and identity link commit together; no unlinked window for a new message. */
export async function queueMessage(mail: Mail,kind: string,error: string,messageId: string) {
  if (!validMessageId(messageId)) throw new Error("archive_parameters");
  return tx(async c=>{
    const message=(await c.query<{kind:string;channel:string;to_addr:string;status:State;content_fingerprint:string}>("SELECT kind,channel,to_addr,status,content_fingerprint FROM mail_messages WHERE id=$1 FOR UPDATE",[messageId])).rows[0];
    if (!message || message.kind!==kind || message.channel!=="transactional" || message.to_addr!==mail.to.toLowerCase() || message.content_fingerprint!==contentFingerprint(mail) || message.status==="accepted") throw new Error("queue_conflict");
    const existing=(await c.query<{id:number}>("SELECT id FROM mail_outbox WHERE message_id=$1 AND status='pending' ORDER BY id LIMIT 1",[messageId])).rows[0];
    if (existing) return existing.id;
    const row=(await c.query<{id:number}>("INSERT INTO mail_outbox(kind,to_addr,payload,last_error,attempts,next_attempt_at,message_id) VALUES($1,$2,$3,$4,0,now()+interval '1 minute',$5) RETURNING id",[kind,mail.to,JSON.stringify(toStored(mail)),error.slice(0,300),messageId])).rows[0];
    if (["prepared","rejected"].includes(message.status)) await c.query("UPDATE mail_messages SET status='queued' WHERE id=$1",[messageId]);
    await audit("mail_message_queued",null,{messageId,outboxId:row.id},c);
    return row.id;
  });
}
