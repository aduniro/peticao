import { audit, query, tx } from "./db";
import { authorizeBatchActor, type BatchActor } from "./batches";
import { BATCH_A1_POLICY_KEY } from "./batch-a1-jobs";
import { credentialBroker, type CredentialRequest, type A1CredentialMetadata } from "./a1-credentials-client";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type CredentialInput={requestId:string;pfxBase64?:string;password?:string};
export function parseCredentialInput(v:unknown):CredentialInput|null{
  if(!v||typeof v!=="object"||Array.isArray(v))return null;const o=v as Record<string,unknown>;
  if(typeof o.requestId!=="string"||!uuid.test(o.requestId))return null;
  const keys=Object.keys(o).sort().join(",");if(keys==="requestId")return{requestId:o.requestId};
  if(keys!=="password,pfxBase64,requestId"||typeof o.pfxBase64!=="string"||typeof o.password!=="string"||Buffer.byteLength(o.password)<1||Buffer.byteLength(o.password)>4096||o.pfxBase64.length>2_796_204||!o.pfxBase64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(o.pfxBase64))return null;
  const bytes=Buffer.from(o.pfxBase64,"base64");if(!bytes.length||bytes.length>2*1024*1024||bytes.toString("base64")!==o.pfxBase64)return null;
  return{requestId:o.requestId,pfxBase64:o.pfxBase64,password:o.password};
}
function samePolicy(raw:string|undefined,credential:A1CredentialMetadata|null){
  if(!credential||!raw)return false;try{const p=JSON.parse(raw);return p.version===1&&p.enabled===true&&p.credentialActive===true&&p.credentialVersionId===credential.credentialVersionId&&p.certificateFingerprintSha256===credential.certificateFingerprintSha256&&p.trustStoreVersion===credential.trustStoreVersion&&p.profileVersion===credential.profileVersion&&p.expectedCnpj===credential.cnpj}catch{return false}
}
/** GET is read-only even when a previous POST lost its response after storage. */
export async function readA1Credential(requestId?:string){
  if(requestId!==undefined&&!uuid.test(requestId))return{ok:false as const,error:"invalid_request"};
  const broker=await credentialBroker({version:1,operation:"get",...(requestId?{requestId}:{})});if(!broker.ok)return broker;
  const row=(await query<{value:string}>("SELECT value FROM settings WHERE key=$1",[BATCH_A1_POLICY_KEY])).rows[0];
  const activated=broker.currentCredentialVersionId===broker.credential?.credentialVersionId&&samePolicy(row?.value,broker.credential);
  return{ok:true as const,configured:activated,credential:broker.credential,intent:broker.intent?{...broker.intent,activated}:null};
}
/** Serialize certificate changes with policy publication; a lost COMMIT is queried, never retried automatically. */
export async function registerA1Credential(input:CredentialInput,actor:BatchActor){
  return tx(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(7008)");
    if(!await authorizeBatchActor(c,actor))return{ok:false as const,error:"forbidden"};
    const sessionAuthorized=async()=>Number.isInteger(actor.sessaoId)&&!!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp() FOR SHARE",[actor.sessaoId,actor.userId])).rowCount;
    if(!await sessionAuthorized())return{ok:false as const,error:"forbidden"};
    const before=(await c.query<{value:string}>("SELECT value FROM settings WHERE key=$1 FOR UPDATE",[BATCH_A1_POLICY_KEY])).rows[0];
    const request:CredentialRequest={version:1,operation:"put",...input};const stored=await credentialBroker(request);
    if(!stored.ok)return stored;
    if(!await sessionAuthorized())return{ok:false as const,error:"forbidden"};
    const credential=stored.credential;
    if(!credential||credential.credentialVersionId!==input.requestId||stored.currentCredentialVersionId!==credential.credentialVersionId)return{ok:false as const,error:"credential_superseded"};
    const replayed=samePolicy(before?.value,credential);
    if(!replayed){
      let revision=1;try{const old=JSON.parse(before?.value??"{}");if(Number.isSafeInteger(old.revision)&&old.revision>=1)revision=old.revision+1}catch{/* New policy starts at revision1. */}
      const policy={version:1,revision,enabled:true,credentialActive:true,credentialVersionId:credential.credentialVersionId,profileVersion:credential.profileVersion,trustStoreVersion:credential.trustStoreVersion,expectedCnpj:credential.cnpj,certificateFingerprintSha256:credential.certificateFingerprintSha256};
      await c.query("INSERT INTO settings(key,value)VALUES($1,$2) ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value",[BATCH_A1_POLICY_KEY,JSON.stringify(policy)]);
      await audit("a1_credential_activated",null,{requestId:input.requestId,credentialVersionId:credential.credentialVersionId,certificateFingerprintSha256:credential.certificateFingerprintSha256,userId:actor.userId},c);
    }
    return{ok:true as const,requestId:input.requestId,credential,activated:true,replayed};
  });
}
