import { NextRequest, NextResponse } from "next/server";
import { intentStatus, ncpfEnabled } from "@/lib/ncpf-store";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  const headers={"Cache-Control":"no-store"};
  if (!ncpfEnabled()) return NextResponse.json({state:"unavailable"},{status:503,headers});
  if (!rateLimit(`ncpf-status:${clientIp(req.headers)}`,120,60_000)) return NextResponse.json({state:"pending"},{status:429,headers});
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({state:'expired'},{status:400,headers});
  return NextResponse.json(await intentStatus(token,req.cookies.get('vid')?.value),{headers});
}
