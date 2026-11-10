import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit,tx } from "./db";
import { authorizeBatchActor } from "./batches";
import type { SessaoAdmin } from "./admin-users";
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const digest=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const error=(code:'disabled'|'parameters'|'forbidden'|'request_conflict'|'not_found')=>({ok:false as const,error:code});
async function bounded(c:PoolClient){await c.query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='5000ms'");}
async function authorized(c:PoolClient,actor:SessaoAdmin|null){
 if(!actor?.sessaoId||!await authorizeBatchActor(c,actor))return false;
 return !!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND stepup_ate>now() FOR SHARE",[actor.sessaoId,actor.userId])).rowCount;
}
const projection=(row:{id:string;sha256:string;byte_length:number})=>({artifactId:row.id,sha256:row.sha256,byteLength:row.byte_length,validationState:'pending' as const,usableInPackage:false as const});
/** Recover only the authenticated actor's exact upload intent, including when new uploads are disabled. */
export async function getStagedPetitionBaseRequest(requestId:string,actor:SessaoAdmin|null){
 if(!uuid(requestId))return error('parameters');
 return tx(async c=>{
  await bounded(c);if(!await authorized(c,actor))return error('forbidden');
  const row=(await c.query<{id:string;sha256:string;byte_length:number}>('SELECT a.id,a.sha256,octet_length(a.bytes) byte_length FROM petition_base_upload_requests r JOIN petition_base_artifacts a ON a.id=r.artifact_id WHERE r.actor_id=$1 AND r.request_id=$2',[actor!.userId,requestId])).rows[0];
  return row?{ok:true as const,requestId,...projection(row)}:error('not_found');
 });
}
/** Limited metadata inventory only. A recorded validation is not a fresh permission to select/send. */
export async function listStagedPetitionBases(actor:SessaoAdmin|null){
 if(process.env.GOVBR_BASE_ENABLED!=='1')return error('disabled');
 return tx(async c=>{
  await bounded(c);if(!await authorized(c,actor))return error('forbidden');
  const rows=(await c.query<{id:string;sha256:string;byte_length:number;uploaded_at:Date;validation_id:string|null;validated_at:Date|null}>(`SELECT a.id,a.sha256,octet_length(a.bytes) byte_length,a.uploaded_at,v.id validation_id,v.created_at validated_at FROM petition_base_artifacts a LEFT JOIN LATERAL(SELECT t.id,r.validation_id FROM petition_base_validation_attempts t LEFT JOIN petition_base_validation_results r ON r.attempt_id=t.id WHERE t.artifact_id=a.id ORDER BY t.ordinal DESC LIMIT 1)j ON true LEFT JOIN LATERAL(SELECT id,created_at FROM petition_base_validations WHERE artifact_id=a.id AND (j.id IS NULL OR id=j.validation_id) ORDER BY created_at DESC,id DESC LIMIT 1)v ON true ORDER BY a.uploaded_at DESC,a.id DESC LIMIT 21`)).rows;
  return{ok:true as const,hasMore:rows.length>20,artifacts:rows.slice(0,20).map(r=>({...projection(r),uploadedAt:r.uploaded_at.toISOString(),lastValidationId:r.validation_id,lastValidatedAt:r.validated_at?.toISOString()??null}))};
 });
}
/** Only immutable private staging. Upload, filename, a PDF header or owner authorization never establish signature validity. */
export async function stagePetitionBase(input:{requestId:string;bytes:Buffer},actor:SessaoAdmin|null){
 if(process.env.GOVBR_BASE_ENABLED!=='1')return error('disabled');
 if(!input||Object.keys(input).sort().join(',')!=='bytes,requestId'||!uuid(input.requestId)||!Buffer.isBuffer(input.bytes)||input.bytes.length<16||input.bytes.length>25*1024*1024||input.bytes.subarray(0,5).toString()!=='%PDF-')return error('parameters');
 const requestId=input.requestId,bytes=Buffer.from(input.bytes),sha256=digest(bytes);
 return tx(async c=>{
  await bounded(c);if(!await authorized(c,actor))return error('forbidden');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`petition-base-upload:${actor!.userId}:${requestId}`]);
  const previous=(await c.query<{input_sha256:string;id:string;sha256:string;byte_length:number}>(`SELECT r.input_sha256,a.id,a.sha256,octet_length(a.bytes) byte_length FROM petition_base_upload_requests r JOIN petition_base_artifacts a ON a.id=r.artifact_id WHERE r.actor_id=$1 AND r.request_id=$2`,[actor!.userId,requestId])).rows[0];
  if(previous)return previous.input_sha256===sha256?{ok:true as const,...projection(previous),replayed:true}:error('request_conflict');
  const id=randomUUID();await c.query('INSERT INTO petition_base_artifacts(id,bytes,sha256,uploaded_by)VALUES($1,$2,$3,$4)',[id,bytes,sha256,actor!.userId]);
  await c.query('INSERT INTO petition_base_upload_requests(actor_id,request_id,input_sha256,artifact_id)VALUES($1,$2,$3,$4)',[actor!.userId,requestId,sha256,id]);
  await audit('petition_base_uploaded',null,{artifactId:id,sha256,byteLength:bytes.length,userId:actor!.userId},c);
  return {ok:true as const,...projection({id,sha256,byte_length:bytes.length}),replayed:false};
 });
}
/** Exact authenticated private read; never a public attachment endpoint. */
export async function readStagedPetitionBase(artifactId:string,actor:SessaoAdmin|null){
 if(process.env.GOVBR_BASE_ENABLED!=='1')return error('disabled');if(!uuid(artifactId))return error('parameters');
 return tx(async c=>{await bounded(c);if(!await authorized(c,actor))return error('forbidden');
  const row=(await c.query<{id:string;sha256:string;bytes:Buffer;byte_length:number}>('SELECT id,sha256,bytes,octet_length(bytes) byte_length FROM petition_base_artifacts WHERE id=$1',[artifactId])).rows[0];
  if(!row)return error('not_found');if(digest(row.bytes)!==row.sha256)throw new Error('petition_base_integrity_mismatch');
  await audit('petition_base_downloaded',null,{artifactId,sha256:row.sha256,userId:actor!.userId},c);
  return {ok:true as const,...projection(row),bytes:Buffer.from(row.bytes)};
 });
}
