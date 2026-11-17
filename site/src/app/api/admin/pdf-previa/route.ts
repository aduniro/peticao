import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { audit } from "@/lib/db";
import { previewPdf } from "@/lib/pdf-preview";

export const dynamic = "force-dynamic";

/** Prévia do PDF das assinaturas, aberta no navegador. ?tipo=modelo (fictício) | real (assinaturas confirmadas agora). */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura");
  if (bloqueio) return bloqueio;
  const tipo = req.nextUrl.searchParams.get("tipo") === "real" ? "real" : "modelo";
  const { bytes, n } = await previewPdf(tipo);
  await audit("pdf_preview", null, { tipo, n });
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="previa-${tipo}.pdf"`, "cache-control": "no-store" } });
}
