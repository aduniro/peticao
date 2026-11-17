import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { auditDispersionExport, readDispersionExport } from "@/lib/dispersion-admin-store";
import { buildDispersionCsv } from "@/lib/dispersion-csv";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status: number) => NextResponse.json(data, { status, headers });
/** Internal CSV with email. Audit proves file preparation, not delivery. */
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "edicao");
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied; }
    const actor = await quemAge(req); if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    if ([...req.nextUrl.searchParams].length) return json({ ok: false, error: "invalid" }, 400);
    const source = await readDispersionExport(actor);
    if (!source.ok) return json(source, source.error === "forbidden" ? 403 : 503);
    const file = buildDispersionCsv(source.rows, source.total);
    if (!await auditDispersionExport(actor, { rows: file.rows, bytes: file.bytes, sha256: file.sha256, asOf: source.asOf })) return json({ ok: false, error: "unavailable" }, 503);
    return new NextResponse(new Uint8Array(file.body), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="base-interna-assinaturas.csv"', "content-length": String(file.bytes), "x-content-sha256": file.sha256 } });
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
