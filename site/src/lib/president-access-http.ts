import { NextRequest, NextResponse } from "next/server";
import { clientIp, requestOrigin } from "./net";
import { rateLimit } from "./ratelimit";
import { readLimitedText } from "./http-body";
import { readConfiguredPresidentAccess } from "./president-portal-store";

const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"};
export async function presidentAccessPost(req:NextRequest,includeDocument:boolean) {
  try{if(new URL(req.headers.get("origin")??"").origin!==requestOrigin(req.headers))return new NextResponse(null,{status:403,headers});}
  catch{return new NextResponse(null,{status:403,headers});}
  // Both read endpoints share one budget, independent of attacker-supplied credentials.
  if(!rateLimit(`president-access:${clientIp(req.headers)}`,12,60_000))return new NextResponse(null,{status:429,headers});
  if((req.headers.get("content-type")??"").split(";")[0].trim().toLowerCase()!=="application/json")return new NextResponse(null,{status:415,headers});
  const body=await readLimitedText(req,512);if(!body.ok)return new NextResponse(null,{status:body.status,headers});
  let input:unknown;try{input=JSON.parse(body.raw);}catch{return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});}
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==2||!("token"in input)||!("password"in input)||typeof input.token!=="string"||typeof input.password!=="string")return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const result=await readConfiguredPresidentAccess({token:input.token,password:input.password},includeDocument);
  if(!result.ok)return NextResponse.json(result,{status:409,headers});
  if(includeDocument&&result.bytes)return new NextResponse(new Uint8Array(result.bytes),{headers:{...headers,"content-type":"application/pdf","content-disposition":`attachment; filename="documento-lote-${result.document.seq}.pdf"`,"content-security-policy":"sandbox; default-src 'none'; frame-ancestors 'none'","x-document-version":result.document.documentVersion,"x-document-sha256":result.document.sha256}});
  return NextResponse.json(result,{headers});
}
