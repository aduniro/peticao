import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { visitorTimeline } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { vid: string } }) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  return NextResponse.json({ events: await visitorTimeline(params.vid) }, { headers: { "cache-control": "no-store" } });
}
