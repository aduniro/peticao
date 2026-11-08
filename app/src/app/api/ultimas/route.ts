import { NextRequest, NextResponse } from "next/server";
import { recentSignatures } from "@/lib/public-feed";
import { counts } from "@/lib/signatures";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Últimas assinaturas confirmadas (só nome e inicial do sobrenome) e totais. Consultado pelo site a cada poucos segundos. */
export async function GET(req: NextRequest) {
  if (!rateLimit(`live:${clientIp(req.headers)}`, 90, 60_000)) return new NextResponse(null, { status: 429 });
  const [items, c] = await Promise.all([recentSignatures(8), counts()]);
  return NextResponse.json({ counts: c, items }, { headers: { "cache-control": "public, max-age=4, s-maxage=4, stale-while-revalidate=10" } });
}
