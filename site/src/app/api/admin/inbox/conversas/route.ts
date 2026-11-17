import { NextRequest } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { inboundListController } from "@/lib/mail/inbound-controllers";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest) {
  const blocked = await exigirNivel(req, "edicao", 120, { stepup: true });
  if (blocked) { blocked.headers.set("cache-control", "private, no-store"); return blocked; }
  return inboundListController(req);
}
