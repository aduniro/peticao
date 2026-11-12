import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { parseCredentialInput, readA1Credential, registerA1Credential } from "@/lib/a1-credentials";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
export async function GET(req:NextRequest){
  const blocked=await exigirNivel(req,"total",30,{stepup:true});if(blocked)return blocked;
  const values=req.nextUrl.searchParams.getAll("requestId");if(values.length>1||[...req.nextUrl.searchParams.keys()].some(k=>k!=="requestId"))return NextResponse.json({ok:false,error:"invalid_request"},{status:400,headers});
  try{const r=await readA1Credential(values[0]);return NextResponse.json(r,{status:r.ok?200:r.error==="invalid_request"?400:503,headers})}catch{return NextResponse.json({ok:false,error:"credential_service_unavailable"},{status:503,headers})}
}
export async function POST(req:NextRequest){
  const blocked=await exigirNivel(req,"total",10,{stepup:true});if(blocked)return blocked;
  const actor=await quemAge(req);if(!actor)return NextResponse.json({ok:false,error:"forbidden"},{status:401,headers});
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type")??""))return NextResponse.json({ok:false,error:"invalid_request"},{status:415,headers});
  const body=await readLimitedText(req,2_810_000);if(!body.ok)return NextResponse.json({ok:false,error:"invalid_request"},{status:body.status,headers});
  let input;try{input=parseCredentialInput(JSON.parse(body.raw))}catch{input=null}if(!input)return NextResponse.json({ok:false,error:"invalid_request"},{status:400,headers});
  try{const r=await registerA1Credential(input,actor);return NextResponse.json(r,{status:r.ok?200:r.error==="forbidden"?403:["credential_service_unavailable","configuration_unavailable","storage_unavailable","chain_or_revocation_unavailable"].includes(r.error)?503:409,headers})}
  catch{return NextResponse.json({ok:false,error:"activation_pending",requestId:input.requestId},{status:503,headers})}
}
