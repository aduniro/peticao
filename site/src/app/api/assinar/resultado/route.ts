import { NextRequest,NextResponse } from "next/server";
import { receiptStatus,validRequestKey } from "@/lib/signup-idempotency";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  const key=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  if (!validRequestKey(key) || !rateLimit(`signup-result:${clientIp(req.headers)}`,60,60_000)) return new NextResponse(null,{status:400});
  const result=await receiptStatus(key,req.cookies.get('vid')?.value);
  return NextResponse.json(result??{status:202,json:{resultUnknown:true,errorCode:'result_unknown'}},{headers:{'Cache-Control':'no-store'}});
}
