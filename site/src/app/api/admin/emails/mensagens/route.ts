import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { historySearch } from "@/lib/mail-history-admin-contract";
import { readMailHistoryPage, readMailHistoryDetail, readMailHistoryCollection } from "@/lib/mail-history-admin-store";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
/** Metadata only. Content preview keeps its existing separate Total/stepup contract. */
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "edicao");
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied; }
    const actor = await quemAge(req);
    if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    const parsed = historySearch(req.nextUrl.searchParams);
    if (!parsed) return json({ ok: false, error: "parameters" }, 400);
    const result = parsed.mode === "list" ? await readMailHistoryPage(actor, parsed.options)
      : parsed.mode === "detail" ? await readMailHistoryDetail(actor, parsed.key)
      : await readMailHistoryCollection(actor, parsed.key, parsed.collection, parsed.options);
    return json(result, result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "parameters" ? 400 : 503);
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
