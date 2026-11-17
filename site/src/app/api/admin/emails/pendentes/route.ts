import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { pendingEmailSearch } from "@/lib/pending-email-admin-contract";
import { readPendingEmailPage, readPendingEmailExport, auditPendingEmailExport } from "@/lib/pending-email-admin-store";
import { buildPendingEmailCsv } from "@/lib/pending-email-csv";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
/** One registration per row; evidence is address history, not proof about its current confirmation request. */
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "edicao");
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied; }
    const actor = await quemAge(req); if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    const parsed = pendingEmailSearch(req.nextUrl.searchParams); if (!parsed.ok) return json(parsed, 400);
    if (parsed.format === "csv") {
      const source = await readPendingEmailExport(actor, { filters: parsed.options.filters });
      if (!source.ok) return json(source, source.error === "forbidden" ? 403 : source.error === "invalid" ? 400 : 503);
      const file = buildPendingEmailCsv(source.rows, source.total);
      if (!await auditPendingEmailExport(actor, { rows: file.rows, bytes: file.bytes, sha256: file.sha256, asOf: source.asOf })) return json({ ok: false, error: "unavailable" }, 503);
      return new NextResponse(new Uint8Array(file.body), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="pendentes-email.csv"', "content-length": String(file.bytes), "x-content-sha256": file.sha256, "x-data-as-of": source.asOf, "x-export-unit": source.unit } });
    }
    const result = await readPendingEmailPage(actor, parsed.options);
    return json(result, result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "invalid" ? 400 : 503);
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
