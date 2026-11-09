import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { monitorPoints, monitorRequestPoints, monitorRequests, monitorSummary, monitorVisitors, sinceOf, type Window } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura");
  if (bloqueio) return bloqueio;
  const w = (["1h", "24h", "7d", "30d", "all"].includes(req.nextUrl.searchParams.get("w") ?? "") ? req.nextUrl.searchParams.get("w") : "24h") as Window;
  const since = sinceOf(w);
  const [summary, points, visitors, requestPoints, requests] = await Promise.all([monitorSummary(since), monitorPoints(since), monitorVisitors(since), monitorRequestPoints(since), monitorRequests(since)]);
  return NextResponse.json({ window: w, summary, points, visitors, requestPoints, requests }, { headers: { "cache-control": "no-store" } });
}
