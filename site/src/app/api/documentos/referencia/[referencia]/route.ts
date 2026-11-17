import { NextRequest, NextResponse } from "next/server";
import { publicDocumentReference } from "@/lib/document-reference-public";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest,{params}:{params:{referencia:string}}) {
 const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"};
 if(!rateLimit(`document-verify:${clientIp(req.headers)}`,30,60_000)) return NextResponse.json({ok:false},{status:429,headers});
 if(req.nextUrl.searchParams.size) return NextResponse.json({ok:false},{status:404,headers});
 const result=await publicDocumentReference(params.referencia);
 return NextResponse.json(result,{status:result.ok?200:404,headers});
}
