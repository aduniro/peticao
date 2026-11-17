import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { ownUuid } from "@/lib/president-own-document-contract";
import { readPresidentOwnDocumentPdf } from "@/lib/president-own-document-store";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, context: { params: { id: string } }) {
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  const blocked = await exigirNivel(req, "total", 60, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401, headers });
  if (req.nextUrl.searchParams.size || !ownUuid(context.params.id)) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers });
  const result = await readPresidentOwnDocumentPdf(context.params.id, actor);
  if (!result.ok) return NextResponse.json(result, { status: ({ parameters: 400, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503 })[result.error], headers });
  return new NextResponse(result.bytes, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="confirmacao-presidente-${result.artifactId}.pdf"`, "x-document-sha256": result.sha256, "x-source-document-sha256": result.sourceSha256 } });
}
