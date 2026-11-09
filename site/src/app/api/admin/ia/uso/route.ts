import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { aiDailyUsage } from "@/lib/ai/executor";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total"); if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (q.size > 1 || q.size === 1 && !q.has("day")) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400 });
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  try { const r = await aiDailyUsage(q.get("day") ?? undefined, actor); return NextResponse.json(r, { status: r.ok ? 200 : r.error === "forbidden" ? 403 : 400, headers: { "cache-control": "no-store" } }); } catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
