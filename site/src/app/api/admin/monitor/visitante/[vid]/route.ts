import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { visitorTimeline } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { vid: string } }) {
  const bloqueio = await exigirNivel(_req, "leitura");
  if (bloqueio) return bloqueio;
  return NextResponse.json({ events: await visitorTimeline(params.vid) }, { headers: { "cache-control": "no-store" } });
}
