import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { issueConfiguredPresidentChallenge } from "@/lib/president-portal-store";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers={"cache-control":"private, no-store"};
  const blocked=await exigirNivel(req,"total",30,{stepup:true}); if(blocked) return blocked;
  const actor=await quemAge(req); if(!actor) return NextResponse.json({ok:false},{status:401,headers});
  const body=await readLimitedText(req,1024); if(!body.ok) return new NextResponse(null,{status:body.status,headers});
  let input;
  try { input=JSON.parse(body.raw); } catch { return NextResponse.json({ok:false,error:"parameters"},{status:400,headers}); }
  if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).length!==1 || !Number.isInteger(input.batchId) || input.batchId<=0 || input.batchId>2147483647) return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const result=await issueConfiguredPresidentChallenge(input.batchId,actor);
  return NextResponse.json(result,{status:result.ok?200:409,headers});
}
