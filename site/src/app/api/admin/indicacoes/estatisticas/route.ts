import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { referralStatsSearch } from "@/lib/referral-admin-stats-contract";
import { listReferralAdminStats } from "@/lib/referral-admin-stats-store";
export const dynamic = "force-dynamic";
function privateResponse(response: NextResponse) {
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
const json = (data: unknown, status = 200) => privateResponse(NextResponse.json(data, { status }));
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "leitura"); if (denied) return privateResponse(denied);
    const actor = await quemAge(req); if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    const options = referralStatsSearch(req.nextUrl.searchParams); if (!options) return json({ ok: false, error: "invalid" }, 400);
    const result = await listReferralAdminStats(actor, options);
    return json(result, result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "unavailable" ? 503 : 400);
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
