import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { attachSignedPdf } from "@/lib/batches";
import { batchId, readBatchMultipart } from "@/lib/batch-http-input";
import { config } from "@/lib/config";
import { batchReturnUrl, returnsToPresident } from "@/lib/batch-return";

export const dynamic = "force-dynamic";

/** Recebe o PDF do lote já assinado pelo responsável (e-CNPJ). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchMultipart(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const url = batchReturnUrl(req, id);
  if (body.form.getAll("file").length > 1) return new NextResponse(null, { status: 400 });
  const file = body.form.get("file");
  if (!file || typeof file === "string" || file.size === 0) url.searchParams.set("msg", "Escolha o PDF assinado.");
  else {
    try {
      const r = await attachSignedPdf(id, Buffer.from(await file.arrayBuffer()), config.approverEmail() || "admin", actor);
      url.searchParams.set("msg", `${r.ok ? "PDF assinado anexado" : "PDF assinado RECUSADO"} (${r.kind}). ${r.notes.join(" ")}`);
    } catch (error) {
      if (!returnsToPresident(req)) throw error;
      url.searchParams.set("msg", "Resultado da conferência do PDF indisponível. Atualize o documento antes de tentar outra ação.");
    }
  }
  return NextResponse.redirect(url, 303);
}
