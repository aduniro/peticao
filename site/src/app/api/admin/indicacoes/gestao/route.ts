import { NextRequest,NextResponse } from "next/server";
import { exigirNivel,quemAge } from "@/lib/admin-api";
import { listAdministrativeReferrals,manageAdministrativeReferral,readAdministrativeReferralMutation,parseReferralMutationIntent } from "@/lib/admin-referral-management";
import { readLimitedText } from "@/lib/http-body";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
function protect(response:NextResponse){for(const[k,v]of Object.entries(headers))response.headers.set(k,v);return response;}
const reply=(value:{ok:boolean;error?:string},status?:number)=>NextResponse.json(value,{status:status??(value.ok?200:value.error==="forbidden"?403:value.error==="conflict"||value.error==="legacy_unavailable"?409:value.error==="not_found"?404:value.error==="unavailable"?503:400),headers});
export async function GET(req:NextRequest){
 const denied=await exigirNivel(req,"edicao");if(denied)return protect(denied);const actor=await quemAge(req);if(!actor)return reply({ok:false,error:"forbidden"},401);
 const p=req.nextUrl.searchParams;
 if(Array.from(p.keys()).some(k=>!["requestId","filter","before","limit"].includes(k)||p.getAll(k).length!==1))return reply({ok:false,error:"invalid"});
 try{
  if(p.has("requestId")){if(p.size!==1)return reply({ok:false,error:"invalid"});const result=await readAdministrativeReferralMutation(p.get("requestId")!,actor);if(!result.ok&&result.error==="forbidden"){const extra=await exigirNivel(req,"exclusao",120,{stepup:true});if(extra)return protect(extra);}return reply(result);}
  const numeric=(k:string)=>p.has(k)?/^[1-9][0-9]{0,9}$/.test(p.get(k)!)?Number(p.get(k)):NaN:undefined;
  return reply(await listAdministrativeReferrals(actor,{filter:(p.get("filter")??"active")as"active"|"archived"|"all",before:numeric("before"),limit:numeric("limit")}));
 }catch{return reply({ok:false,error:"unavailable"},503);}
}
export async function POST(req:NextRequest){
 const denied=await exigirNivel(req,"edicao");if(denied)return protect(denied);const actor=await quemAge(req);if(!actor)return reply({ok:false,error:"forbidden"},401);
 if(req.nextUrl.searchParams.size)return reply({ok:false,error:"invalid"});
 const body=await readLimitedText(req,4096);if(!body.ok)return reply({ok:false,error:"invalid"},body.status);
 let raw:unknown;try{raw=JSON.parse(body.raw);}catch{return reply({ok:false,error:"invalid"});}
 const input=parseReferralMutationIntent(raw);if(!input)return reply({ok:false,error:"invalid"});
 if(input.operation!=="edit"){const extra=await exigirNivel(req,"exclusao",120,{stepup:true});if(extra)return protect(extra);}
 try{return reply(await manageAdministrativeReferral(input,actor));}catch{return reply({ok:false,error:"unavailable"},503);}
}
