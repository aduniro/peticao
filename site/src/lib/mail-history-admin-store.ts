import type {PoolClient} from "pg";
import {tx} from "@/lib/db";
import {pendingEmailCount,pendingEmailTimestamp,validPendingEmailActor} from "@/lib/pending-email-admin-contract";
import {historySearch,validHistoryKey,validHistoryUuid,validHistoryEventId,MESSAGE_STATES,MAIL_CHANNELS,CONTENT_STATES,ATTEMPT_STATES,EVENT_STATES,type MailHistoryActor,type HistoryOptions,type HistoryCollectionOptions,type HistoryCollection,type HistoryFailure,type HistoryRow,type HistoryPage,type HistoryAttempt,type HistoryEvent,type HistoryDetail,type HistoryCollectionPage,type HistoryCollectionMeta} from "./mail-history-admin-contract";
const fail=(error:HistoryFailure["error"]):HistoryFailure=>({ok:false,error});
const iso=(x:string)=>`to_char(${x} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const count=(v:unknown)=>{const n=pendingEmailCount(v);if(n===null)throw Error("history_count");return n;};
const text=(v:unknown,n:number)=>{if(typeof v!=="string"||v.length>n||v.includes("\0"))throw Error("history_text");return v;};
const nullable=(v:unknown,n:number)=>v===null?null:text(v,n);
const date=(v:unknown)=>pendingEmailTimestamp(v);
const checkpoint=(start:number)=>{if(performance.now()-start>10000)throw Error("history_deadline");};
const ensure=<T>(value:T):T=>{if(Buffer.byteLength(JSON.stringify(value))>2*1024*1024)throw Error("history_response_budget");return value;};
async function auth(c:PoolClient,a:MailHistoryActor){
 if(!(await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE",[a.userId,a.email.toLowerCase(),["edicao","exclusao","total"]])).rowCount)return false;
 return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE",[a.sessaoId,a.userId])).rowCount;
}
async function guarded<T>(actor:MailHistoryActor,work:(c:PoolClient,start:number)=>Promise<T>):Promise<T|HistoryFailure>{
 if(!validPendingEmailActor(actor))return fail("forbidden");
 try{return await tx(async c=>{const start=performance.now();await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");await c.query("SET LOCAL lock_timeout='1000ms'");await c.query("SET LOCAL statement_timeout='10000ms'");if(!await auth(c,actor))return fail("forbidden");const result=await work(c,start);checkpoint(start);ensure(result);if(!await auth(c,actor))return fail("forbidden");checkpoint(start);return result;});}catch{return fail("unavailable");}
}
function optionsValid(raw:unknown,collection=false){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
 const allowed=collection?["before","limit"]:["before","limit","recipient","kind","channel","status"];
 if(Object.keys(raw).some(k=>!allowed.includes(k)))return false;
 const sp=new URLSearchParams();for(const[k,v]of Object.entries(raw)){if(v===undefined)continue;if(k==="limit"?typeof v!=="number":typeof v!=="string")return false;sp.set(k,String(v));}
 if(collection){sp.set("id","message:00000000-0000-4000-8000-000000000001");sp.set("collection","attempts");}
 return historySearch(sp)!==null;
}
type ListCursor={at:string;key:string};
type CollectionCursor=ListCursor&{v:1;collection:HistoryCollection;id:string};
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
function decode(raw:unknown):Record<string,unknown>|null|undefined{
 if(raw===undefined)return undefined;if(typeof raw!=="string"||raw.length>800||!/^[A-Za-z0-9_-]+$/.test(raw))return null;
 try{const bytes=Buffer.from(raw,"base64url");if(bytes.toString("base64url")!==raw)return null;const v=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));return v&&typeof v==="object"&&!Array.isArray(v)?v:null;}catch{return null;}
}
function listCursor(raw:unknown):ListCursor|null|undefined{
 const v=decode(raw);if(v===null||v===undefined)return v;
 try{if(Object.keys(v).sort().join(",")!=="at,key"||!validHistoryKey(v.key)||typeof v.at!=="string"||date(v.at)!==v.at)return null;return{at:v.at,key:v.key};}catch{return null;}
}
/** Bound to exact message and collection before any SQL; event bigint IDs never pass through Number. */
export function decodeHistoryCollectionCursor(raw:unknown,key:string,collection:HistoryCollection):CollectionCursor|null|undefined{
 const v=decode(raw);if(v===null||v===undefined)return v;
 try{if(Object.keys(v).sort().join(",")!=="at,collection,id,key,v"||v.v!==1||v.key!==key||v.collection!==collection||typeof v.at!=="string"||date(v.at)!==v.at||!(collection==="attempts"?validHistoryUuid(v.id):validHistoryEventId(v.id)))return null;return v as CollectionCursor;}catch{return null;}
}
const RECORDS=`WITH records AS (
 SELECT 'message:'||id::text record_key,'message'::text source,created_at,kind,channel,to_addr,status,CASE WHEN content_state='stored' AND content_expires_at<=clock_timestamp() THEN 'expired' ELSE content_state END content_state,previous_id::text FROM mail_messages
 UNION ALL SELECT 'legacy:'||id::text,'legacy_attempt',ts,kind,channel,to_addr,CASE status WHEN 'sent' THEN 'accepted' WHEN 'queued' THEN 'queued' ELSE 'indeterminate' END,'unavailable',NULL FROM mail_log WHERE message_id IS NULL
)`;
const FILTERS=`($1::text IS NULL OR lower(to_addr)=$1) AND ($2::text IS NULL OR kind=$2) AND ($3::text IS NULL OR channel=$3) AND ($4::text IS NULL OR status=$4)`;
function row(r:Record<string,unknown>):HistoryRow{
 if(!validHistoryKey(r.record_key)||!["message","legacy_attempt"].includes(String(r.source))||!MESSAGE_STATES.includes(r.status as typeof MESSAGE_STATES[number])||!MAIL_CHANNELS.includes(r.channel as typeof MAIL_CHANNELS[number])||!CONTENT_STATES.includes(r.content_state as typeof CONTENT_STATES[number])||r.previous_id!==null&&!validHistoryUuid(r.previous_id))throw Error("history_row");
 return{record_key:r.record_key,source:r.source as HistoryRow["source"],created_at:date(r.created_at),kind:text(r.kind,100),channel:r.channel as string,to_addr:text(r.to_addr,254),status:r.status as string,content_state:r.content_state as string,previous_id:r.previous_id as string|null};
}
export async function readMailHistoryPage(actor:MailHistoryActor,options:HistoryOptions={}):Promise<HistoryPage|HistoryFailure>{
 if(!optionsValid(options))return fail("parameters");const cursor=listCursor(options.before);if(cursor===null)return fail("parameters");
 return guarded(actor,async(c,start)=>{const args=[options.recipient?.toLowerCase()??null,options.kind??null,options.channel??null,options.status??null],limit=options.limit??30;
 const total=count((await c.query(`${RECORDS} SELECT count(*)::text n FROM records WHERE ${FILTERS}`,args)).rows[0].n);checkpoint(start);
 const raw=(await c.query(`${RECORDS} SELECT record_key,source,${iso("created_at")} created_at,kind,channel,to_addr,status,content_state,previous_id FROM records WHERE ${FILTERS} AND ($5::timestamptz IS NULL OR(created_at,record_key COLLATE "C")<($5::timestamptz,$6::text COLLATE "C")) ORDER BY records.created_at DESC,record_key COLLATE "C" DESC LIMIT $7`,[...args,cursor?.at??null,cursor?.key??null,limit+1])).rows;
 const records=raw.slice(0,limit).map(row),next=raw.length>limit?encode({at:records.at(-1)!.created_at,key:records.at(-1)!.record_key}):null,asOf=date((await c.query(`SELECT ${iso("transaction_timestamp()")} stamp`)).rows[0].stamp);
 return{ok:true as const,asOf,total,records,next,coverage:{total,returned:records.length,complete:true as const}};
 });
}
function attempt(r:Record<string,unknown>):HistoryAttempt{
 if(!validHistoryUuid(r.id)||!ATTEMPT_STATES.includes(r.state as typeof ATTEMPT_STATES[number])||r.error_code!==null&&(typeof r.error_code!=="string"||!/^[a-z0-9_]{1,50}$/.test(r.error_code)))throw Error("history_attempt");
 return{id:r.id,provider:text(r.provider,100),from_addr:text(r.from_addr,512),state:r.state as string,started_at:date(r.started_at),finished_at:r.finished_at===null?null:date(r.finished_at),provider_id:nullable(r.provider_id,200),error_code:r.error_code as string|null};
}
function event(r:Record<string,unknown>):HistoryEvent{
 if(!validHistoryEventId(r.id)||!EVENT_STATES.includes(r.event_type as typeof EVENT_STATES[number])||r.attempt_id!==null&&!validHistoryUuid(r.attempt_id))throw Error("history_event");
 return{id:r.id,provider:text(r.provider,100),event_type:r.event_type as string,occurred_at:date(r.occurred_at),received_at:date(r.received_at),attempt_id:r.attempt_id as string|null};
}
async function collectionRead(c:PoolClient,key:string,collection:HistoryCollection,limit:number,cursor:CollectionCursor|undefined){
 const id=key.slice(8),attempts=collection==="attempts",table=attempts?"mail_message_attempts":"mail_message_events",at=attempts?"started_at":"occurred_at",condition=attempts?"message_id=$1":"message_id=$1 AND association_state='linked'",idtype=attempts?"uuid":"bigint";
 const total=count((await c.query(`SELECT count(*)::text n FROM ${table} WHERE ${condition}`,[id])).rows[0].n);
 const projection=attempts?`id::text,provider,from_addr,state,${iso("started_at")} started_at,${iso("finished_at")} finished_at,provider_id,error_code`:`id::text,provider,event_type,${iso("occurred_at")} occurred_at,${iso("received_at")} received_at,attempt_id::text`;
 const raw=(await c.query(`SELECT ${projection} FROM ${table} WHERE ${condition} AND($2::timestamptz IS NULL OR(${at},id)<($2::timestamptz,$3::${idtype})) ORDER BY ${table}.${at} DESC,${table}.id DESC LIMIT $4`,[id,cursor?.at??null,cursor?.id??null,limit+1])).rows;
 const items=attempts?raw.slice(0,limit).map(attempt):raw.slice(0,limit).map(event),last=items.at(-1),lastAt=last?(attempts?(last as HistoryAttempt).started_at:(last as HistoryEvent).occurred_at):null;
 const next=raw.length>limit?encode({v:1,key,collection,at:lastAt,id:last!.id}):null;
 return{items,meta:{total,returned:items.length,next,complete:true as const}};
}
export async function readMailHistoryCollection(actor:MailHistoryActor,key:unknown,collection:unknown,options:HistoryCollectionOptions={}):Promise<HistoryCollectionPage|HistoryFailure>{
 if(!validHistoryKey(key)||!key.startsWith("message:")||!["attempts","events"].includes(String(collection))||!optionsValid(options,true))return fail("parameters");
 const kind=collection as HistoryCollection,cursor=decodeHistoryCollectionCursor(options.before,key,kind);if(cursor===null)return fail("parameters");
 return guarded(actor,async(c,start)=>{if(!(await c.query("SELECT id FROM mail_messages WHERE id=$1",[key.slice(8)])).rowCount)return fail("not_found");
 const result=await collectionRead(c,key,kind,options.limit??100,cursor),asOf=date((await c.query(`SELECT ${iso("transaction_timestamp()")} stamp`)).rows[0].stamp);checkpoint(start);
 const common={ok:true as const,key,asOf,total:result.meta.total,next:result.meta.next,coverage:{total:result.meta.total,returned:result.meta.returned,complete:true as const}};
 return kind==="attempts"?{...common,collection:"attempts" as const,items:result.items as HistoryAttempt[]}:{...common,collection:"events" as const,items:result.items as HistoryEvent[]};
 });
}
export async function readMailHistoryDetail(actor:MailHistoryActor,key:unknown):Promise<HistoryDetail|HistoryFailure>{
 if(!validHistoryKey(key))return fail("parameters");
 return guarded(actor,async(c,start)=>{const asOf=date((await c.query(`SELECT ${iso("transaction_timestamp()")} stamp`)).rows[0].stamp),empty:HistoryCollectionMeta={total:0,returned:0,next:null,complete:true};
 if(key.startsWith("legacy:")){
 const r=(await c.query(`SELECT id,${iso("ts")} created_at,kind,channel,to_addr,provider,from_addr,status FROM mail_log WHERE id=$1 AND message_id IS NULL`,[Number(key.slice(7))])).rows[0];if(!r)return fail("not_found");
 const record={id:Number(r.id),created_at:date(r.created_at),kind:text(r.kind,100),channel:text(r.channel,100),to_addr:text(r.to_addr,254),provider:text(r.provider,100),from_addr:nullable(r.from_addr,512),status:text(r.status,100)};
 return{ok:true as const,key,asOf,source:"legacy_attempt" as const,record,content_state:"unavailable" as const,attempts:[],events:[],attempts_truncated:false,events_truncated:false,attemptsPage:empty,eventsPage:empty};
 }
 const raw=(await c.query(`SELECT id::text,${iso("created_at")} created_at,kind,channel,to_addr,status,previous_id::text,CASE WHEN content_state='stored' AND content_expires_at<=clock_timestamp() THEN 'expired' ELSE content_state END content_state FROM mail_messages WHERE id=$1`,[key.slice(8)])).rows[0];if(!raw)return fail("not_found");
 const projected=row({...raw,record_key:key,source:"message"}),record={id:raw.id as string,created_at:projected.created_at,kind:projected.kind,channel:projected.channel,to_addr:projected.to_addr,status:projected.status,previous_id:projected.previous_id,content_state:projected.content_state};
 const attempts=await collectionRead(c,key,"attempts",100,undefined);checkpoint(start);const events=await collectionRead(c,key,"events",100,undefined);checkpoint(start);
 return{ok:true as const,key,asOf,source:"message" as const,record,content_state:record.content_state,attempts:attempts.items as HistoryAttempt[],events:events.items as HistoryEvent[],attempts_truncated:attempts.meta.next!==null,events_truncated:events.meta.next!==null,attemptsPage:attempts.meta,eventsPage:events.meta};
 });
}
