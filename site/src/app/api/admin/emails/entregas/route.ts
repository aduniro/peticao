import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { mailDeliverySearch } from "@/lib/mail-delivery-admin-contract";
import { readMailDeliveryPage, readMailDeliveryExport, auditMailDeliveryExport } from "@/lib/mail-delivery-admin-store";
import { buildMailDeliveryCsv } from "@/lib/mail-delivery-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

/** Preserve the existing default CSV; JSON is explicit. One registration or unregistered address per row, never an inferred person. */
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "edicao");
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied; }
    const actor = await quemAge(req);
    if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    const params = new URLSearchParams(req.nextUrl.searchParams);
    if (!params.has("formato")) params.set("formato", "csv");
    const parsed = mailDeliverySearch(params);
    if (!parsed.ok) return json(parsed, 400);
    if (parsed.format === "csv") {
      const source = await readMailDeliveryExport(actor, { filters: parsed.options.filters });
      if (!source.ok) return json(source, source.error === "forbidden" ? 403 : source.error === "invalid" ? 400 : 503);
      const file = buildMailDeliveryCsv(source.rows, source.total);
      if (!await auditMailDeliveryExport(actor, { rows: file.rows, bytes: file.bytes, sha256: file.sha256, asOf: source.asOf })) return json({ ok: false, error: "unavailable" }, 503);
      return new NextResponse(new Uint8Array(file.body), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="entregas-emails.csv"', "content-length": String(file.bytes), "x-content-sha256": file.sha256, "x-data-as-of": source.asOf, "x-export-unit": source.unit } });
    }
    const result = await readMailDeliveryPage(actor, parsed.options);
    return json(result, result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "invalid" ? 400 : 503);
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
