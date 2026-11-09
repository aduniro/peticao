import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId, readBatchFields } from "@/lib/batch-http-input";
import { batchReturnUrl } from "@/lib/batch-return";
import { recoverBatchPreparation } from "@/lib/batches";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await exigirNivel(req, "total", 30, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  if ([...body.form.keys()].length !== 0) return new NextResponse(null, { status: 400 });
  const result = await recoverBatchPreparation(id, actor);
  if (!result.ok && result.error === "forbidden") return NextResponse.json({ ok: false }, { status: 403 });
  const url = batchReturnUrl(req, id);
  url.searchParams.set("msg", result.ok ? "PDF preparado com a lista reservada. Nenhuma mensagem foi enviada."
    : result.error === "busy" ? "Há um preparo em andamento. Aguarde antes de conferir novamente."
      : "Não foi possível retomar o preparo. Confira o documento e seu histórico antes de outra ação.");
  return NextResponse.redirect(url, 303);
}
