import { NextRequest } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { inboundContentController } from "@/lib/mail/inbound-controllers";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest,{params}:{params:{id:string}}) {
  const blocked = await exigirNivel(req, "edicao", 120, { stepup: true });
  if (blocked) { blocked.headers.set("cache-control", "private, no-store"); return blocked; }
  return inboundContentController(req,params.id);
}
