import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { hmac } from "./security";
import { CODE_RE } from "./referrals";

export type ReferralActor = { userId: number; email: string; sessaoId: number | null };
export type ReferralOperation = "edit" | "archive" | "restore";
export type ManagedReferral = { id: number; code: string; label: string; version: string; archivedAt: string | null };
export type ReferralMutationIntent = { id: number; version: string; requestId: string; operation: ReferralOperation; label?: string };
export type ReferralMutationSuccess = { ok: true; requestId: string; operation: ReferralOperation; context: { id: number; expectedVersion: string }; row: ManagedReferral; changed: boolean };
type Row = { id: number; code: string; label: string | null; display_name: string | null; signature_id: number | null; admin_version: string; archived_at: Date | null };
type Failure = { ok: false; error: "invalid" | "forbidden" | "conflict" | "not_found" | "legacy_unavailable" };
type LegacySuccess = { ok: true; row: ManagedReferral; changed: boolean };
type Ledger = { input_hash: string; referrer_id: number; operation: string | null; expected_version: string | null; result: unknown };
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });
const rowValue = (r: Row): ManagedReferral => ({ id: r.id, code: r.code, label: r.label!, version: String(r.admin_version), archivedAt: r.archived_at?.toISOString() ?? null });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const positive = (n: unknown): n is number => Number.isInteger(n) && Number(n)>0 && Number(n)<=2147483647;
const version = (v: unknown): v is string => typeof v==="string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v)<=9223372036854775807n;
const operation = (v: unknown): v is ReferralOperation => typeof v==="string" && ["edit","archive","restore"].includes(v);
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v==="object" && !Array.isArray(v);
const exact = (v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(",")===keys.sort().join(",");
const validActor = (a: ReferralActor) => positive(a?.userId) && typeof a.email==="string" && positive(a.sessaoId);
const canonicalLabel = (v:string)=>v.trim().replace(/\s+/g," ");
const labelValid = (v:unknown):v is string=>typeof v==="string" && v.length>=2 && v.length<=80 && !/[\u0000-\u001f\u007f]/.test(v) && canonicalLabel(v)===v;
const stamp = (v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
export function parseReferralMutationIntent(value:unknown):ReferralMutationIntent|null {
 if(!object(value)||!positive(value.id)||!version(value.version)||typeof value.requestId!=="string"||!uuid.test(value.requestId)||!operation(value.operation)||!exact(value,["id","version","requestId","operation",...(value.operation==="edit"?["label"]:[])]))return null;
 const label=value.operation==="edit"&&typeof value.label==="string"?canonicalLabel(value.label):null;
 if(value.operation==="edit"&&!labelValid(label))return null;
 return {id:value.id,version:value.version,requestId:value.requestId,operation:value.operation,...(label===null?{}:{label})};
}
const fingerprint=(actorId:number,id:number,v:string,op:ReferralOperation,label:string|null)=>hmac("admin-referral-mutation:v1:"+JSON.stringify([actorId,id,v,op,label]));
async function bounded(c:PoolClient){await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");}
async function authorized(c: PoolClient, actor: ReferralActor, archival: boolean) {
 await c.query("SELECT pg_advisory_xact_lock(7003)");
 const account=await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE",[actor.userId,actor.email.toLowerCase(),archival?["exclusao","total"]:["edicao","exclusao","total"]]);
 if(!account.rowCount)return false;
 return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND ($3::boolean=false OR stepup_ate>clock_timestamp()) FOR SHARE",[actor.sessaoId,actor.userId,archival])).rowCount;
}
function legacyResult(value:unknown):LegacySuccess|null {
 if(!object(value)||!exact(value,["ok","row","changed"])||value.ok!==true||typeof value.changed!=="boolean"||!object(value.row))return null;
 const r=value.row;
 if(!exact(r,["id","code","label","version","archivedAt"])||!positive(r.id)||typeof r.code!=="string"||!CODE_RE.test(r.code)||typeof r.label!=="string"||r.label.length>80||!version(r.version)||r.archivedAt!==null&&!stamp(r.archivedAt))return null;
 return {ok:true,row:{id:r.id,code:r.code,label:r.label,version:r.version,archivedAt:r.archivedAt},changed:value.changed};
}
/** Decode only a durable server envelope; no caller-supplied operation can authorize GET recovery. */
function durableResult(row:Ledger,requestId:string,actorId:number):ReferralMutationSuccess|null {
 if(!operation(row.operation)||!version(row.expected_version)||!object(row.result)||!exact(row.result,["ok","row","changed","requestId","operation","context"])||!object(row.result.context))return null;
 const r=row.result,context=r.context as Record<string,unknown>;
 const old=legacyResult({ok:r.ok,row:r.row,changed:r.changed});
 if(!old||r.requestId!==requestId||r.operation!==row.operation||!exact(context,["id","expectedVersion"])||context.id!==row.referrer_id||context.expectedVersion!==row.expected_version||old.row.id!==row.referrer_id||BigInt(old.row.version)!==BigInt(row.expected_version)+(old.changed?1n:0n))return null;
 if(row.operation!=="edit"&&!old.changed||row.operation==="archive"&&old.row.archivedAt===null||row.operation!=="archive"&&old.row.archivedAt!==null||row.operation==="edit"&&!labelValid(old.row.label))return null;
 if(row.input_hash!==fingerprint(actorId,row.referrer_id,row.expected_version,row.operation,row.operation==="edit"?old.row.label:null))return null;
 return {...old,requestId,operation:row.operation,context:{id:row.referrer_id,expectedVersion:row.expected_version}};
}
async function ledger(c:PoolClient,actorId:number,requestId:string){return(await c.query<Ledger>("SELECT input_hash,referrer_id,operation,expected_version::text,result FROM admin_referral_mutations WHERE actor_id=$1 AND request_id=$2",[actorId,requestId])).rows[0];}

/** No signer identity, code, token, attribution or public-link mutation. */
export async function manageAdministrativeReferral(value:ReferralMutationIntent,actor:ReferralActor):Promise<ReferralMutationSuccess|LegacySuccess|Failure>{
 if(!validActor(actor))return fail("forbidden");const input=parseReferralMutationIntent(value);if(!input)return fail("invalid");
 const label=input.operation==="edit"?input.label!:null,hash=fingerprint(actor.userId,input.id,input.version,input.operation,label);
 return tx(async c=>{
  await bounded(c);if(!await authorized(c,actor,input.operation!=="edit"))return fail("forbidden");
  await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))",[`referral-mutation:${actor.userId}:${input.requestId}`]);
  const previous=await ledger(c,actor.userId,input.requestId);
  if(previous){
   if(previous.input_hash!==hash||previous.referrer_id!==input.id)return fail("conflict");
   if(previous.operation===null&&previous.expected_version===null){const old=legacyResult(previous.result);return old&&old.row.id===input.id?old:fail("conflict");}
   const old=durableResult(previous,input.requestId,actor.userId);return old&&old.operation===input.operation&&old.context.expectedVersion===input.version?old:fail("conflict");
  }
  const old=(await c.query<Row>("SELECT id,code,label,display_name,signature_id,admin_version,archived_at FROM referrers WHERE id=$1 FOR UPDATE",[input.id])).rows[0];
  if(!old||old.signature_id!==null||old.display_name!==null||old.label===null)return fail("not_found");
  if(String(old.admin_version)!==input.version)return fail("conflict");
  if(input.operation==="edit"&&old.archived_at||input.operation==="archive"&&old.archived_at||input.operation==="restore"&&!old.archived_at)return fail("conflict");
  const changed=input.operation!=="edit"||old.label!==label;if(changed&&input.version==="9223372036854775807")return fail("conflict");
  let current=old;
  if(changed)current=(await c.query<Row>("UPDATE referrers SET label=CASE WHEN $2='edit' THEN $3 ELSE label END,archived_at=CASE WHEN $2='archive' THEN now() WHEN $2='restore' THEN NULL ELSE archived_at END,admin_version=admin_version+1 WHERE id=$1 RETURNING id,code,label,display_name,signature_id,admin_version,archived_at",[input.id,input.operation,label])).rows[0];
  const result:ReferralMutationSuccess={ok:true,requestId:input.requestId,operation:input.operation,context:{id:input.id,expectedVersion:input.version},row:rowValue(current),changed};
  await audit("admin_referral_managed",null,{referrerId:input.id,requestId:input.requestId,operation:input.operation,before:rowValue(old),after:result.row,changed,userId:actor.userId,por:actor.email.toLowerCase()},c);
  await c.query("INSERT INTO admin_referral_mutations(actor_id,request_id,input_hash,referrer_id,result,operation,expected_version)VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::bigint)",[actor.userId,input.requestId,hash,input.id,JSON.stringify(result),input.operation,input.version]);
  return result;
 });
}
/** Actor-scoped lookup; read authorization follows the operation stored in the ledger. */
export async function readAdministrativeReferralMutation(requestId:string,actor:ReferralActor):Promise<ReferralMutationSuccess|Failure>{
 if(!validActor(actor))return fail("forbidden");if(typeof requestId!=="string"||!uuid.test(requestId))return fail("invalid");
 return tx(async c=>{
  await bounded(c);if(!await authorized(c,actor,false))return fail("forbidden");
  const row=await ledger(c,actor.userId,requestId);if(!row)return fail("not_found");
  if(row.operation===null&&row.expected_version===null)return fail("legacy_unavailable");
  if(!operation(row.operation)||!version(row.expected_version))return fail("conflict");
  if(row.operation!=="edit"&&!await authorized(c,actor,true))return fail("forbidden");
  return durableResult(row,requestId,actor.userId)??fail("conflict");
 });
}
/** Separate administrative inventory; existing public/statistical consumers stay unchanged. */
export async function listAdministrativeReferrals(actor:ReferralActor,options:{filter?:"active"|"archived"|"all";before?:number;limit?:number}={}){
 if(!validActor(actor))return fail("forbidden");
 if(!object(options))return fail("invalid");
 const filter=options.filter??"active",limit=options.limit??50;
 if(Object.keys(options).some(k=>!["filter","before","limit"].includes(k))||!["active","archived","all"].includes(filter)||!Number.isInteger(limit)||limit<1||limit>100||options.before!==undefined&&!positive(options.before))return fail("invalid");
 return tx(async c=>{await bounded(c);if(!await authorized(c,actor,false))return fail("forbidden");
  const rows=(await c.query<Row>("SELECT id,code,label,display_name,signature_id,admin_version,archived_at FROM referrers WHERE signature_id IS NULL AND display_name IS NULL AND label IS NOT NULL AND ($1='all' OR ($1='active' AND archived_at IS NULL) OR ($1='archived' AND archived_at IS NOT NULL)) AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3",[filter,options.before??null,limit+1])).rows;
  return{ok:true as const,rows:rows.slice(0,limit).map(rowValue),nextBefore:rows.length>limit?rows[limit-1].id:null};
 });
}
