import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { cancelBatch } from "@/lib/batches";
import { batchId, readBatchFields } from "@/lib/batch-http-input";
import { batchReturnUrl, returnsToPresident } from "@/lib/batch-return";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const url = batchReturnUrl(req, id);
  try {
    const ok = await cancelBatch(id, actor);
    url.searchParams.set("msg", ok ? "Lote cancelado." : "Não foi possível cancelar.");
  } catch (error) {
    if (!returnsToPresident(req)) throw error;
    url.searchParams.set("msg", "Resultado do cancelamento a conferir. Atualize o documento.");
  }
  return NextResponse.redirect(url, 303);
}
