import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { attachSignedPdf } from "@/lib/batches";
import { config } from "@/lib/config";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Recebe o PDF do lote já assinado pelo responsável (e-CNPJ). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) url.searchParams.set("msg", "Escolha o PDF assinado.");
  else {
    const r = await attachSignedPdf(Number(params.id), Buffer.from(await file.arrayBuffer()), config.approverEmail() || "admin");
    url.searchParams.set("msg", `${r.ok ? "PDF assinado anexado" : "PDF assinado RECUSADO"} (${r.kind}). ${r.notes.join(" ")}`);
  }
  return NextResponse.redirect(url, 303);
}
