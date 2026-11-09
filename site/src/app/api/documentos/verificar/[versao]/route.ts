import { NextRequest, NextResponse } from "next/server";
import { publicDocumentVerification } from "@/lib/document-verification";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export async function GET(req:NextRequest,{params}:{params:{versao:string}}) {
  const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"};
  if (!rateLimit(`document-verify:${clientIp(req.headers)}`,30,60_000)) return NextResponse.json({ok:false},{status:429,headers});
  const hashes=req.nextUrl.searchParams.getAll("sha256");
  const result=await publicDocumentVerification(params.versao,hashes.length===1 ? hashes[0] : "");
  return NextResponse.json(result,{status:result.ok?200:404,headers});
}
