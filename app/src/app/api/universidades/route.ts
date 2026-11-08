import { NextRequest, NextResponse } from "next/server";
import { searchUniversities } from "@/lib/world-universities";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Sugestões de universidades do país escolhido (base Hipo, MIT). */
export async function GET(req: NextRequest) {
  if (!rateLimit(`uni:${clientIp(req.headers)}`, 120, 60_000)) return new NextResponse(null, { status: 429 });
  const u = req.nextUrl.searchParams;
  const items = await searchUniversities((u.get("c") ?? "").toUpperCase(), (u.get("q") ?? "").slice(0, 80), 40);
  return NextResponse.json({ items }, { headers: { "cache-control": "public, max-age=300" } });
}
