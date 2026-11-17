import { NextRequest, NextResponse } from "next/server";
import { clientIp, requestOrigin } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
import { readLimitedText } from "@/lib/http-body";
import { normalizeRegistryBirth, parseBirth } from "@/lib/birth";
import { onlyDigits } from "@/lib/cpf";
import { confirmConfiguredPresidentChallenge } from "@/lib/president-portal-store";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers={"cache-control":"private, no-store"};
  try { if(new URL(req.headers.get("origin")??"").origin!==requestOrigin(req.headers)) return new NextResponse(null,{status:403,headers}); }
  catch { return new NextResponse(null,{status:403,headers}); }
  if(!rateLimit(`president-confirm:${clientIp(req.headers)}`,12,60_000)) return new NextResponse(null,{status:429,headers});
  if((req.headers.get("content-type")??"").split(";")[0].trim().toLowerCase()!=="application/json") return new NextResponse(null,{status:415,headers});
  const body=await readLimitedText(req,2048); if(!body.ok) return new NextResponse(null,{status:body.status,headers});
  let input;
  try { input=JSON.parse(body.raw); } catch { return NextResponse.json({ok:false,error:"parameters"},{status:400,headers}); }
  if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).length!==4 || ["token","password","cpf","birthDate"].some(k=>typeof input[k]!=="string") || input.cpf.length>20 || !/^[0-9.\s-]+$/.test(input.cpf) || input.birthDate.length>10) return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const birth=normalizeRegistryBirth(input.birthDate);
  if(!birth || !parseBirth(birth)) return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const [day,month,year]=birth.split("/");
  const result=await confirmConfiguredPresidentChallenge({token:input.token,password:input.password,cpf:onlyDigits(input.cpf),birthDate:`${year}-${month}-${day}`});
  return NextResponse.json(result,{status:result.ok?200:409,headers});
}
