import { NextRequest, NextResponse } from "next/server";
import { searchUniversities } from "@/lib/world-universities";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { isCountryCode } from "@/i18n/countries";

export const dynamic = "force-dynamic";

/** Sugestões de universidades do país escolhido (base Hipo, MIT). */
export async function GET(req: NextRequest) {
  if (!rateLimit(`uni:${clientIp(req.headers)}`, 120, 60_000)) return new NextResponse(null, { status: 429 });
  const u = req.nextUrl.searchParams;
  const country = (u.get("c") ?? "").toUpperCase();
  const text = (u.get("q") ?? "").slice(0, 80);
  // Abrir a lista por clique pede explicitamente todos os nomes do país;
  // digitação e chamadas antigas preservam filtro e limite de40 sugestões.
  const all = u.get("all") === "1" && text === "" && /^[A-Z]{2}$/.test(country) && isCountryCode(country);
  const items = await searchUniversities(country, text, all ? Infinity : 40);
  return NextResponse.json({ items }, { headers: { "cache-control": "public, max-age=300" } });
}
