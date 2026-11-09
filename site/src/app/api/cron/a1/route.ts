import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/security";
import { readLimitedText } from "@/lib/http-body";
import { runQueuedA1Job } from "@/lib/batch-a1-executor";

export const dynamic = "force-dynamic";
/** Dedicated scheduler: expensive signing cannot delay the existing mail queue. */
export async function POST(req: NextRequest) {
  const secret = config.cronSecret();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(got, secret)) return new NextResponse(null, { status: 401 });
  const body = await readLimitedText(req, 0);
  if (!body.ok || req.nextUrl.searchParams.size) return new NextResponse(null, { status: body.ok ? 400 : body.status });
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  try { return NextResponse.json(await runQueuedA1Job(), { headers }); }
  catch { return NextResponse.json({ ran: false, state: "unavailable" }, { status: 503, headers }); }
}
