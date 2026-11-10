import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { issueConfiguredPresidentChallenge, readPresidentChallengeRequest } from "@/lib/president-portal-store";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
  const blocked=await exigirNivel(req,"total",30,{stepup:true}); if(blocked) return blocked;
  const actor=await quemAge(req); if(!actor) return NextResponse.json({ok:false},{status:401,headers});
  if(req.nextUrl.searchParams.size)return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  if((req.headers.get("content-type")??"").split(";")[0].trim().toLowerCase()!=="application/json")return new NextResponse(null,{status:415,headers});
  const body=await readLimitedText(req,1024); if(!body.ok) return new NextResponse(null,{status:body.status,headers});
  let input;
  try { input=JSON.parse(body.raw); } catch { return NextResponse.json({ok:false,error:"parameters"},{status:400,headers}); }
  if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).sort().join(",")!=="batchId,expectedDocumentVersion,expectedProfileFingerprint,requestId" || typeof input.requestId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId) || typeof input.expectedDocumentVersion!=="string" || !/^[a-f0-9]{64}$/.test(input.expectedDocumentVersion) || typeof input.expectedProfileFingerprint!=="string" || !/^[a-f0-9]{64}$/.test(input.expectedProfileFingerprint) || !Number.isInteger(input.batchId) || input.batchId<=0 || input.batchId>2147483647) return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const result=await issueConfiguredPresidentChallenge(input.batchId,actor,undefined,{requestId:input.requestId,expectedDocumentVersion:input.expectedDocumentVersion,expectedProfileFingerprint:input.expectedProfileFingerprint});
  return NextResponse.json(result,{status:result.ok?200:409,headers});
}


export async function GET(req: NextRequest) {
  const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
  const blocked=await exigirNivel(req,"total",60,{stepup:true});if(blocked)return blocked;
  const actor=await quemAge(req);if(!actor)return NextResponse.json({ok:false},{status:401,headers});
  if(req.nextUrl.searchParams.size!==1||req.nextUrl.searchParams.getAll("requestId").length!==1)return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const requestId=req.nextUrl.searchParams.get("requestId");if(!requestId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId))return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  const result=await readPresidentChallengeRequest(requestId,actor);return NextResponse.json(result,{status:result.ok?200:({parameters:400,forbidden:403,not_found:404,unavailable:503}[result.error]),headers});
}
