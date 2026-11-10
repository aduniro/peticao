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
export type MailPreparationOptions = { requestKey?: string; archive?: { until: Date | null }; previousId?: string };
type PreparedMessageMaterial = { id: string; request: string | null; fingerprint: string; cipher: string | null; expires: Date | null; kind: string; channel: Channel; recipient: string; previousId: string | null; replyTo: string | null; contentState: "stored" | "oversize" | "unavailable" };
/** Same preparation algorithm for the legacy wrapper and the caller-owned transaction adapter. */
function preparationMaterial(mail: Mail, kind: string, channel: Channel, options: MailPreparationOptions): PreparedMessageMaterial {
  if (!kind || kind.length > 100 || !["transactional","marketing"].includes(channel) || options.previousId !== undefined && !validMessageId(options.previousId) || options.requestKey !== undefined && (!options.requestKey || options.requestKey.length > 256)) throw new Error("archive_parameters");
  const fingerprint = contentFingerprint(mail);
  const id = randomUUID(), request = options.requestKey ? hmac("mail-request-v1:" + options.requestKey) : null;
  const fits = options.archive ? fitsArchive(mail) : false;
  const cipher = options.archive && fits ? encryptMail(id,serializeMail(mail)) : null;
  const requested = options.archive ? options.archive.until : null;
  if (requested !== null && (!(requested instanceof Date) || !Number.isFinite(requested.getTime()))) throw new Error("archive_parameters");
  const expires = options.archive ? new Date(Math.min(requested?.getTime() ?? Infinity, adminContentDeadline().getTime())) : null;
  // Freeze metadata together with the already-frozen content digest before the first await.
  return { id,request,fingerprint,cipher,expires,kind,channel,recipient:mail.to.toLowerCase(),previousId:options.previousId??null,replyTo:mail.replyTo??null,contentState:cipher?"stored":options.archive&&!fits?"oversize":"unavailable" };
}
export type PreparedMessageTransaction = { id: string; existing: boolean; preparedAudit: { messageId: string; kind: string; channel: Channel; contentStored: boolean; previousId: string | null } | null };
const preparationClients = new WeakMap<PreparedMessageTransaction,PoolClient>();
const appendedPreparations = new WeakSet<PreparedMessageTransaction>();
const preparationTransactions = new WeakMap<PreparedMessageTransaction,string>();
const preparationStates = new WeakMap<PreparedMessageTransaction,string>();
function preparationState(value:Record<string,unknown>):string{
  const expiry=value.content_expires_at;
  return hmac("mail-preparation-proof:v1:"+JSON.stringify({id:value.id,request_key:value.request_key,kind:value.kind,channel:value.channel,to_addr:value.to_addr,content_fingerprint:value.content_fingerprint,content_state:value.content_state,content_cipher:value.content_cipher,content_expires_at:expiry===null?null:new Date(expiry as string|Date).toISOString(),previous_id:value.previous_id,reply_to:value.reply_to,status:value.status}));
}
async function assertPreparationState(c:PoolClient,prepared:PreparedMessageTransaction):Promise<void>{
  const expected=preparationStates.get(prepared);
  if(expected===undefined)throw new Error("archive_preparation_proof_missing");
  const row=(await c.query("SELECT id,request_key,kind,channel,to_addr,content_fingerprint,content_state,content_cipher,content_expires_at,previous_id,reply_to,status FROM mail_messages WHERE id=$1 FOR UPDATE",[prepared.id])).rows[0];
  try{if(!row||preparationState(row)!==expected)throw new Error();}catch{throw new Error("archive_prepared_state_changed");}
}
async function transactionId(c:PoolClient):Promise<string>{
  const id=(await c.query("SELECT txid_current()::text transaction_id")).rows[0]?.transaction_id;
  if(typeof id!=="string"||!/^[1-9][0-9]{0,19}$/.test(id))throw new Error("archive_active_transaction_required");
  return id;
}
function preparedForClient(c: PoolClient, prepared: PreparedMessageTransaction,material?:PreparedMessageMaterial): PreparedMessageTransaction {
  preparationClients.set(prepared,c);
  if(material)preparationStates.set(prepared,preparationState({id:material.id,request_key:material.request,kind:material.kind,channel:material.channel,to_addr:material.recipient,content_fingerprint:material.fingerprint,content_state:material.contentState,content_cipher:material.cipher,content_expires_at:material.cipher?material.expires:null,previous_id:material.previousId,reply_to:material.replyTo,status:"prepared"}));
  if(prepared.preparedAudit)Object.freeze(prepared.preparedAudit);
  return Object.freeze(prepared);
}
async function persistPreparedMessage(c: PoolClient, m: PreparedMessageMaterial): Promise<PreparedMessageTransaction> {
  if (m.request) await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", ["mail-request:" + m.request]);
  if (m.request) {
    const previous = (await c.query<{id:string;kind:string;channel:string;to_addr:string;content_fingerprint:string;previous_id:string|null}>("SELECT id,kind,channel,to_addr,content_fingerprint,previous_id FROM mail_messages WHERE request_key=$1", [m.request])).rows[0];
    if (previous) {
      if (previous.kind !== m.kind || previous.channel !== m.channel || previous.to_addr !== m.recipient || previous.content_fingerprint !== m.fingerprint || previous.previous_id !== m.previousId) throw new Error("message_conflict");
      return preparedForClient(c,{id:previous.id,existing:true,preparedAudit:null});
    }
  }
  if (m.expires && !(await c.query<{future:boolean}>("SELECT $1::timestamptz>clock_timestamp() future",[m.expires])).rows[0].future) throw new Error("archive_expired");
  await c.query("INSERT INTO mail_messages(id,request_key,kind,channel,to_addr,content_fingerprint,content_state,content_cipher,content_expires_at,previous_id,reply_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [m.id,m.request,m.kind,m.channel,m.recipient,m.fingerprint,m.contentState,m.cipher,m.cipher?m.expires:null,m.previousId,m.replyTo]);
  return preparedForClient(c,{id:m.id,existing:false,preparedAudit:{messageId:m.id,kind:m.kind,channel:m.channel,contentStored:!!m.cipher,previousId:m.previousId}},m);
}
/** Explicit retention only. Existing callers keep the original own-transaction behavior. */
export async function prepareMessage(mail: Mail, kind: string, channel: Channel, options: MailPreparationOptions = {}) {
  const material=preparationMaterial(mail,kind,channel,options);
  return tx(async c=>{
    const prepared=await persistPreparedMessage(c,material);
    await appendPreparedMessageAudit(c,prepared);
    return {id:prepared.id,existing:prepared.existing};
  });
}
/** Trusted server-only composable entry: caller owns an active transaction and must roll back on error.
 * Returns server-only deferred audit metadata: the caller MUST append it after all row locks/writes,
 * in THIS transaction. A failed audit MUST roll back message, token, and command together.
 * Never expose this entry point, retention options or metadata in an API/client DTO.
 * Does not send, select providers, choose retention, BEGIN, COMMIT or fall back to another connection.
 */
export async function prepareMessageInTransaction(c: PoolClient, mail: Mail, kind: string, channel: Channel, options: MailPreparationOptions = {}) {
  if (!c || typeof c.query!=="function" || typeof c.release!=="function") throw new Error("archive_client_required");
  const material=preparationMaterial(mail,kind,channel,options);
  const first=await transactionId(c),second=await transactionId(c);
  if(first!==second)throw new Error("archive_active_transaction_required");
  const result=await persistPreparedMessage(c,material);
  if(await transactionId(c)!==first)throw new Error("archive_transaction_changed");
  preparationTransactions.set(result,first);
  return result;
}

/** Trusted append phase. Acquire audit-chain lock only after ALL business locks/writes. */
export async function appendPreparedMessageAudit(c: PoolClient, prepared: PreparedMessageTransaction): Promise<void> {
  if (preparationClients.get(prepared)!==c) throw new Error("archive_client_mismatch");
  if (appendedPreparations.has(prepared)) throw new Error("archive_audit_already_appended");
  const expected=preparationTransactions.get(prepared);
  if(expected!==undefined&&await transactionId(c)!==expected)throw new Error("archive_transaction_changed");
  if(prepared.preparedAudit){
    await assertPreparationState(c,prepared);
    await audit("mail_message_prepared",null,prepared.preparedAudit,c);
    await assertPreparationState(c,prepared);
  }
  if(expected!==undefined&&await transactionId(c)!==expected)throw new Error("archive_transaction_changed");
  appendedPreparations.add(prepared);
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
type FinishAttemptOutcome = "accepted" | "rejected" | "indeterminate";
type FinishAttemptOptions = { providerId?: string; errorCode?: string; accountScope?: string };
function validateAttemptCompletion(id:string,outcome:FinishAttemptOutcome,options:FinishAttemptOptions) {
  if (!validMessageId(id) || !["accepted","rejected","indeterminate"].includes(outcome) || options.providerId !== undefined && (typeof options.providerId !== "string" || options.providerId.length>200) || options.errorCode !== undefined && !/^[a-z0-9_]{1,50}$/.test(options.errorCode) || options.accountScope !== undefined && !validAccountScope(options.accountScope)) throw new Error("archive_parameters");
 }
async function persistFinishedAttempt(c:PoolClient,id:string,outcome:FinishAttemptOutcome,options:FinishAttemptOptions) {
    const base = (await c.query<{message_id:string}>("SELECT message_id FROM mail_message_attempts WHERE id=$1",[id])).rows[0];
    if (!base) return {result:{ok:false as const,error:"not_found"},auditData:null};
    if(options.providerId && options.accountScope)await lockEventLinks(c);
    // Same lock order as admission: message, then attempt.
    const message = (await c.query<{id:string;kind:string;channel:string;to_addr:string}>("SELECT id,kind,channel,to_addr FROM mail_messages WHERE id=$1 FOR UPDATE",[base.message_id])).rows[0];
    const row = (await c.query<{state:string;provider:string;from_addr:string;provider_id:string|null;error_code:string|null;account_scope:string|null}>("SELECT state,provider,from_addr,provider_id,error_code,account_scope FROM mail_message_attempts WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if (row.state !== "prepared") {
      if (row.state !== outcome || row.provider_id !== (options.providerId??null) || row.error_code !== (options.errorCode??null) || row.account_scope !== (options.accountScope??null)) return {result:{ok:false as const,error:"outcome_conflict"},auditData:null};
      return {result:{ok:true as const,existing:true},auditData:null};
    }
    await c.query("UPDATE mail_message_attempts SET state=$2,finished_at=now(),provider_id=$3,error_code=$4,account_scope=$5 WHERE id=$1",[id,outcome,options.providerId??null,options.errorCode??null,options.accountScope??null]);
    const aggregate = (await c.query<{accepted:boolean;uncertain:boolean}>("SELECT bool_or(state='accepted') accepted,bool_or(state='indeterminate') uncertain FROM mail_message_attempts WHERE message_id=$1",[message.id])).rows[0];
    const state = aggregate.accepted ? "accepted" : aggregate.uncertain ? "indeterminate" : "rejected";
    await c.query("UPDATE mail_messages SET status=$2 WHERE id=$1",[message.id,state]);
    await c.query("INSERT INTO mail_log(kind,provider,from_addr,to_addr,status,error,channel,message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[message.kind,row.provider,row.from_addr,message.to_addr,outcome==="accepted"?"sent":"failed",options.errorCode??null,message.channel,message.id]);
    if(options.providerId && options.accountScope)await reconcileReceiptEvents(c,row.provider,options.accountScope,options.providerId,message.to_addr);
    return {result:{ok:true as const,existing:false},auditData:{messageId:message.id,attemptId:id,state:outcome}};
}
/** Legacy entry retains its own transaction and original result/audit semantics. */
export async function finishAttempt(id:string,outcome:FinishAttemptOutcome,options:FinishAttemptOptions={}) {
  validateAttemptCompletion(id,outcome,options);
  return tx(async c=>{
    const {result,auditData}=await persistFinishedAttempt(c,id,outcome,options);
    if(auditData)await audit("mail_message_attempt_finished",null,auditData,c);
    return result;
  });
}
type PersistedCompletion = Awaited<ReturnType<typeof persistFinishedAttempt>>;
export type FinishedAttemptTransaction = PersistedCompletion["result"];
const completionProofs=new WeakMap<object,{client:PoolClient;transactionId:string;evidence:string;auditData:PersistedCompletion["auditData"]}>();
const appendedCompletions=new WeakSet<object>();
async function completionTransactionId(c:PoolClient):Promise<string>{
  const value=(await c.query("SELECT txid_current()::text transaction_id")).rows[0]?.transaction_id;
  if(typeof value!=="string"||!/^[1-9][0-9]{0,19}$/.test(value))throw new Error("archive_active_transaction_required");
  return value;
}
/** Metadata-only persistence readback also detects rollback to a savepoint inside the same txid. */
async function completionEvidence(c:PoolClient,id:string):Promise<string>{
  const rows=(await c.query(`SELECT a.message_id::text,a.state,a.provider_id,a.error_code,a.account_scope,a.finished_at::text,m.status message_status,
    (SELECT count(*)::text FROM mail_log l WHERE l.message_id=m.id) log_count,
    (SELECT max(l.id)::text FROM mail_log l WHERE l.message_id=m.id) last_log_id
    FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id WHERE a.id=$1`,[id])).rows;
  return JSON.stringify(rows);
}
/** Server-only composable completion. Caller owns an ACTIVE transaction and rolls back on error.
 * No new attempt, signature mutation, transport, retry, BEGIN or COMMIT is performed here.
 * All business writes/locks, including the command ledger, must precede the audit append.
 * The returned result must never itself be treated as proof that the outer transaction committed.
 */
export async function finishAttemptInTransaction(c:PoolClient,id:string,outcome:FinishAttemptOutcome,options:FinishAttemptOptions={}):Promise<FinishedAttemptTransaction>{
  if(!c||typeof c.query!=="function"||typeof c.release!=="function")throw new Error("archive_client_required");
  validateAttemptCompletion(id,outcome,options);
  const transactionId=await completionTransactionId(c);
  if(await completionTransactionId(c)!==transactionId)throw new Error("archive_active_transaction_required");
  const {result,auditData}=await persistFinishedAttempt(c,id,outcome,options);
  if(await completionTransactionId(c)!==transactionId)throw new Error("archive_transaction_changed");
  completionProofs.set(result,{client:c,transactionId,auditData,evidence:await completionEvidence(c,id)});
  return result;
}
/** Append once, in the original caller transaction, after all command/journal business locks.
 * Audit failure must roll back the complete outer transaction. Idempotent completion adds no audit.
 */
export async function appendFinishedAttemptAudit(c:PoolClient,result:FinishedAttemptTransaction):Promise<void>{
  const proof=completionProofs.get(result);
  if(!proof||proof.client!==c)throw new Error("archive_client_mismatch");
  if(appendedCompletions.has(result))throw new Error("archive_audit_already_appended");
  if(await completionTransactionId(c)!==proof.transactionId)throw new Error("archive_transaction_changed");
  if(proof.auditData&&await completionEvidence(c,proof.auditData.attemptId)!==proof.evidence)throw new Error("archive_completion_changed");
  if(proof.auditData)await audit("mail_message_attempt_finished",null,proof.auditData,c);
  if(proof.auditData&&await completionEvidence(c,proof.auditData.attemptId)!==proof.evidence)throw new Error("archive_completion_changed");
  if(await completionTransactionId(c)!==proof.transactionId)throw new Error("archive_transaction_changed");
  appendedCompletions.add(result);
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
