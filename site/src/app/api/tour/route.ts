import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hmac } from "@/lib/security";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
import { siteVersion } from "@/lib/version";
import { optedOut } from "@/lib/track";

export const dynamic = "force-dynamic";
const CATS = new Set(["servidor", "apoiador", "estrangeiro"]);

/** O tour desta categoria deve aparecer? Só no primeiro acesso de cada IP (guardado como hash) ou depois de uma atualização do site. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`tour:${ip}`, 60, 60_000)) return new NextResponse(null, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const category = String(body?.category ?? "");
  if (!CATS.has(category)) return NextResponse.json({ show: false }, { status: 400 });
  const version = siteVersion();
  if (optedOut(req.headers)) return NextResponse.json({ show: true, version, stored: false }); // Do Not Track: nada é guardado; o navegador controla a repetição
  const r = await query("INSERT INTO tour_seen(ip_hash,category,version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [hmac(`tour|${ip}`), category, version]);
  return NextResponse.json({ show: (r.rowCount ?? 0) > 0, version, stored: true });
}
