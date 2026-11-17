import { mailQueueScope, mailQueueTable } from "./queue-scope";
import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { contentFingerprint } from "./archive-codec";
import { fromStored, frozenReplyTo } from "./payload";
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id)>0 && Number(id)<=2147483647;
type Actor = {userId:number;email:string};
async function inspect(c:PoolClient, id:number, lock=false) {
  const base=(await c.query<{message_id:string|null}>(`SELECT message_id FROM ${mailQueueTable()} WHERE id=$1`,[id])).rows[0];
  if(!base)return{ok:false as const,error:"not_found"};
  if(!base.message_id)return{ok:true as const,eligible:false as const,reason:"legacy_unlinked"};
  // Same order as linkOutbox/queueMessage/finalization: message, then queue. Workers hold neither during transport.
  const m=(await c.query(`SELECT id,status,kind,channel,to_addr,content_fingerprint,reply_to FROM mail_messages WHERE id=$1${lock?" FOR UPDATE":""}`,[base.message_id])).rows[0];
  const q=(await c.query(`SELECT id,status,message_id,kind,to_addr,payload,sent_at FROM ${mailQueueTable()} WHERE id=$1${lock?" FOR UPDATE":""}`,[id])).rows[0];
  if(!m||!q||q.message_id!==base.message_id||m.channel!=="transactional"||m.kind!==q.kind||m.to_addr!==q.to_addr.toLowerCase())return{ok:true as const,eligible:false as const,reason:"identity_conflict"};
  // Settled is an existing queue state, not a new acceptance/content verdict.
  // Retention may already have erased its payload; never require or restore it for a replay.
  if(q.status==="sent")return{ok:true as const,eligible:false as const,reason:"already_settled"};
  try {if(contentFingerprint(frozenReplyTo(fromStored(q.payload),m.reply_to))!==m.content_fingerprint)return{ok:true as const,eligible:false as const,reason:"content_conflict"};}
  catch{return{ok:true as const,eligible:false as const,reason:"content_conflict"};}
  if(m.status!=="accepted")return{ok:true as const,eligible:false as const,reason:"acceptance_unproven"};
  const active=(await c.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1 AND state='prepared' LIMIT 1",[m.id])).rowCount;
  if(active)return{ok:true as const,eligible:false as const,reason:"attempt_unfinished"};
  const proof=(await c.query<{id:string;at:string}>(`SELECT id,to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at
    FROM mail_message_attempts WHERE message_id=$1 AND state='accepted' AND finished_at IS NOT NULL ORDER BY finished_at DESC,id DESC LIMIT 1`,[m.id])).rows[0];
  if(!proof)return{ok:true as const,eligible:false as const,reason:"acceptance_unproven"};
  return{ok:true as const,eligible:true as const,queueId:id,messageId:m.id as string,attemptId:proof.id,acceptedAt:proof.at};
}
/** Read-only diagnosis. No payload/fingerprint/provider secrets leave the service. */
export async function mailRecoveryStatus(id:unknown) {
  if(!validId(id))return{ok:false as const,error:"parameters"};
  return tx(async c=>{
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");await c.query("SET LOCAL statement_timeout='2000ms'");
    return inspect(c,id);
  });
}
/** Metadata repair only: never sends, retries, edits a receipt or resolves uncertainty from elapsed time. */
export async function settleAcceptedQueue(id:unknown,actor:Actor) {
  if(!validId(id)||!actor||!validId(actor.userId)||typeof actor.email!=="string"||actor.email.length>254)return{ok:false as const,error:"parameters"};
  return tx(async c=>{
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    const user=(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel='total' FOR SHARE",[actor.userId,actor.email.toLowerCase()])).rowCount;
    if(!user)return{ok:false as const,error:"forbidden"};
    const result=await inspect(c,id,true);
    if(!result.ok)return result;
    if(!result.eligible)return result.reason==="already_settled"?{ok:true as const,existing:true,queueId:id}:{ok:false as const,error:result.reason};
    const changed=await c.query(`UPDATE ${mailQueueTable()} SET status='sent',last_error=NULL,sent_at=COALESCE(sent_at,$2::timestamptz) WHERE id=$1 AND status IN ('pending','failed')`,[id,result.acceptedAt]);
    if(!changed.rowCount)return{ok:false as const,error:"queue_conflict"};
    await audit("mail_queue_acceptance_recovered",null,{queueId:id,queueScope:mailQueueScope(),messageId:result.messageId,attemptId:result.attemptId,acceptedAt:result.acceptedAt,userId:actor.userId,por:actor.email.toLowerCase()},c);
    return{ok:true as const,existing:false,queueId:id};
  });
}

export type RecoveryRow = {queueId:number;kind:string;toAddr:string;acceptedAt:string};
/** Bounded keyset scan; invalid content is omitted without hiding the next scan cursor. */
export async function listMailRecovery(options:{before?:number;limit?:number}={}) {
  const limit=options.limit??10;
  if(!Number.isInteger(limit)||limit<1||limit>20||options.before!==undefined&&!validId(options.before))return{ok:false as const,error:"parameters"};
  return tx(async c=>{
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");await c.query("SET LOCAL statement_timeout='2000ms'");
    const candidates=(await c.query<{id:number;kind:string;to_addr:string}>(`SELECT q.id,q.kind,q.to_addr FROM ${mailQueueTable()} q JOIN mail_messages m ON m.id=q.message_id
      WHERE q.status IN ('pending','failed') AND m.status='accepted' AND m.channel='transactional'
      AND m.kind=q.kind AND m.to_addr=lower(q.to_addr) AND ($1::int IS NULL OR q.id<$1)
      AND EXISTS(SELECT 1 FROM mail_message_attempts a WHERE a.message_id=m.id AND a.state='accepted' AND a.finished_at IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM mail_message_attempts a WHERE a.message_id=m.id AND a.state='prepared')
      ORDER BY q.id DESC LIMIT $2`,[options.before??null,limit+1])).rows;
    const page=candidates.slice(0,limit),records:RecoveryRow[]=[];
    for(const row of page){const check=await inspect(c,row.id);if(check.ok&&check.eligible)records.push({queueId:row.id,kind:row.kind,toAddr:row.to_addr,acceptedAt:check.acceptedAt});}
    return{ok:true as const,records,next:candidates.length>limit?page[page.length-1].id:null};
  });
}
