import { createConnection } from "node:net";

export type A1CredentialMetadata = {
  credentialVersionId: string; certificateFingerprintSha256: string; cnpj: "15883671000115";
  notBefore: string; notAfter: string; profileVersion: "pades-ad-rb-declared-unhomologated-v1";
  trustStoreVersion: string; activatedAt: string;
};
export type CredentialRequest = {version:1;operation:"get";requestId?:string}|{version:1;operation:"put";requestId:string;pfxBase64?:string;password?:string};
export type CredentialBrokerResult = {ok:true;credential:A1CredentialMetadata|null;currentCredentialVersionId:string|null;intent:{requestId:string;state:"completed"|"not_found"}|null;replayed?:boolean}|{ok:false;error:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{64}$/;
const safeErrors=new Set(["invalid_request","invalid_certificate","password_or_certificate_invalid","certificate_expired_or_not_yet_valid","holder_mismatch","key_mismatch","chain_or_revocation_unavailable","request_conflict","request_not_found","credential_superseded","storage_unavailable","configuration_unavailable","credential_service_unavailable"]);
function metadata(v:unknown):v is A1CredentialMetadata {
  if(!v||typeof v!=="object"||Array.isArray(v))return false;const o=v as Record<string,unknown>;
  return Object.keys(o).sort().join(",")===["credentialVersionId","certificateFingerprintSha256","cnpj","notBefore","notAfter","profileVersion","trustStoreVersion","activatedAt"].sort().join(",")&&typeof o.credentialVersionId==="string"&&uuid.test(o.credentialVersionId)&&typeof o.certificateFingerprintSha256==="string"&&sha.test(o.certificateFingerprintSha256)&&o.cnpj==="15883671000115"&&o.profileVersion==="pades-ad-rb-declared-unhomologated-v1"&&typeof o.trustStoreVersion==="string"&&sha.test(o.trustStoreVersion)&&[o.notBefore,o.notAfter,o.activatedAt].every(t=>typeof t==="string"&&t.length<50&&Number.isFinite(Date.parse(t)));
}
export function parseCredentialBroker(value:unknown):CredentialBrokerResult {
  const unavailable={ok:false as const,error:"credential_service_unavailable"};
  if(!value||typeof value!=="object"||Array.isArray(value))return unavailable;const o=value as Record<string,unknown>;
  if(o.ok===false)return{ok:false,error:typeof o.error==="string"&&safeErrors.has(o.error)?o.error:unavailable.error};
  if(o.ok!==true||!(o.credential===null||metadata(o.credential))||!(o.currentCredentialVersionId===null||typeof o.currentCredentialVersionId==="string"&&uuid.test(o.currentCredentialVersionId)))return unavailable;
  if(o.intent!==null){const i=o.intent as Record<string,unknown>;if(!i||typeof i!=="object"||typeof i.requestId!=="string"||!uuid.test(i.requestId)||!["completed","not_found"].includes(String(i.state)))return unavailable;}
  return{ok:true,credential:o.credential as A1CredentialMetadata|null,currentCredentialVersionId:o.currentCredentialVersionId as string|null,intent:o.intent as {requestId:string;state:"completed"|"not_found"}|null,...(typeof o.replayed==="boolean"?{replayed:o.replayed}:{})};
}
/** Unix connection only, bounded frame, one attempt; no PFX/password in diagnostics. */
export async function credentialBroker(request:CredentialRequest):Promise<CredentialBrokerResult>{
  const path=process.env.A1_CREDENTIAL_SOCKET??"/run/peticao-signing/credentials.sock";
  const unavailable={ok:false as const,error:"credential_service_unavailable"};
  if(!path.startsWith("/")||Buffer.byteLength(path)>100||/[\x00-\x1f\x7f]/.test(path))return unavailable;
  const raw=Buffer.from(JSON.stringify(request));if(raw.length>2_810_000)return unavailable;
  return new Promise(resolve=>{
    let settled=false,header=Buffer.alloc(0),expected:number|null=null,received=0;let chunks:Buffer[]=[];
    const socket=createConnection({path});
    const finish=(value:CredentialBrokerResult)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();chunks=[];resolve(value)};
    const timer=setTimeout(()=>finish(unavailable),60_000);
    socket.on("error",()=>finish(unavailable));socket.on("end",()=>finish(unavailable));socket.on("close",()=>finish(unavailable));
    socket.on("connect",()=>{const prefix=Buffer.alloc(4);prefix.writeUInt32BE(raw.length);socket.write(prefix);socket.write(raw)});
    socket.on("data",(incoming:Buffer)=>{let data=incoming;if(expected===null){const needed=4-header.length;header=Buffer.concat([header,data.subarray(0,needed)]);data=data.subarray(Math.min(needed,data.length));if(header.length<4)return;expected=header.readUInt32BE(0);if(expected<1||expected>16384)return finish(unavailable)}received+=data.length;if(received>expected)return finish(unavailable);chunks.push(data);if(received===expected){try{finish(parseCredentialBroker(JSON.parse(Buffer.concat(chunks,received).toString("utf8"))))}catch{finish(unavailable)}}});
  });
}
