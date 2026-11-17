import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { signatureExplorerSearch } from "@/lib/signature-explorer-admin-contract";
import { readSignatureExplorer, readSignatureExport, auditSignatureExport } from "@/lib/signature-explorer-admin-store";
import { buildSignatureExplorerCsv } from "@/lib/signature-explorer-csv";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
/** Each JSON response is one consistent snapshot; CSV covers every row of its filter. */
export async function GET(req: NextRequest) {
  try {
    const denied = await exigirNivel(req, "leitura", 240);
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied; }
    const actor = await quemAge(req); if (!actor) return json({ ok: false, error: "forbidden" }, 401);
    const parsed = signatureExplorerSearch(req.nextUrl.searchParams); if (!parsed.ok) return json(parsed, 400);
    if (parsed.options.format === "csv") {
      const source = await readSignatureExport(actor, parsed.options);
      if (!source.ok) return json(source, source.error === "forbidden" ? 403 : source.error === "invalid" ? 400 : 503);
      const file = buildSignatureExplorerCsv(source.rows, source.total);
      if (!await auditSignatureExport(actor, { rows: file.rows, bytes: file.bytes, sha256: file.sha256, asOf: source.asOf })) return json({ ok: false, error: "unavailable" }, 503);
      return new NextResponse(new Uint8Array(file.body), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="assinaturas.csv"', "content-length": String(file.bytes), "x-content-sha256": file.sha256 } });
    }
    const result = await readSignatureExplorer(actor, parsed.options);
    return json(result, result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "invalid" ? 400 : 503);
  } catch { return json({ ok: false, error: "unavailable" }, 503); }
}
