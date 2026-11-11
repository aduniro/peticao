import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId } from "@/lib/batch-http-input";
import { presidentDocumentBytes } from "@/lib/president-document";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const signed = req.nextUrl.searchParams.get("assinado") === "1";
  const preview = req.nextUrl.searchParams.get("previa") === "1";
  let result;
  try { result = await presidentDocumentBytes(id, signed, preview, actor); }
  catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
  if (!result.ok) return new NextResponse(result.error === "not_found" ? "Não encontrado" : null, { status: result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 400 });
  return new NextResponse(new Uint8Array(result.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `${preview ? "inline" : "attachment"}; filename="lote-${result.seq}${signed ? "-assinado" : ""}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
