import { query } from "./db";
import { hmac } from "./security";
import { purgeSignupEphemera } from "./signup-ephemeral-gc";
type Result={status:number;json:Record<string,unknown>};
const requestHash=(key:string,visitor:string)=>hmac(`signup-receipt:v1:${visitor}:${key}`);
export const validRequestKey=(key:string)=>/^[a-f0-9-]{36}$/.test(key);
export async function receiptStatus(key:string,visitor=""):Promise<Result|null> {
  if (!validRequestKey(key)) return null;
  const row=(await query<{state:string;response:Result|null}>("SELECT state,response FROM signup_receipts WHERE request_hash=$1 AND expires_at>now()",[requestHash(key,visitor)])).rows[0];
  return row?.state==='done' && row.response ? row.response : {status:202,json:{resultUnknown:true,errorCode:'result_unknown'}};
}
export async function withSignupReceipt(key:string,visitor:string,body:unknown,run:()=>Promise<Result>):Promise<Result> {
  if (!validRequestKey(key)) return {status:400,json:{errorCode:'invalid_request_key'}};
  await purgeSignupEphemera().catch(()=>{});
  const hash=requestHash(key,visitor),binding=hmac(JSON.stringify(body));
  const ins=await query(`INSERT INTO signup_receipts(request_hash,binding_hash,state,lease_until,expires_at)
    VALUES($1,$2,'working',now()+interval '2 minutes',now()+interval '24 hours') ON CONFLICT DO NOTHING`,[hash,binding]);
  if (!ins.rowCount) {
    const old=(await query<{binding_hash:string}>("SELECT binding_hash FROM signup_receipts WHERE request_hash=$1",[hash])).rows[0];
    if (!old || old.binding_hash!==binding) return {status:409,json:{restart:true,errorCode:'request_data_changed'}};
    return (await receiptStatus(key,visitor))!;
  }
  try {
    const result=await run();
    await query("UPDATE signup_receipts SET state='done',response=$2::jsonb WHERE request_hash=$1",[hash,JSON.stringify(result)]);
    return result;
  } catch {
    await query("UPDATE signup_receipts SET state='uncertain' WHERE request_hash=$1",[hash]).catch(()=>{});
    return {status:503,json:{resultUnknown:true,errorCode:'result_unknown'}};
  }
}
