import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { createBatchForAdmin } from "@/lib/batches";
import { readBatchFields } from "@/lib/batch-http-input";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Fecha manualmente o lote final (acumulado). */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  try {
    const b = await createBatchForAdmin("final", actor);
    url.searchParams.set("msg", b ? `Lote final ${b.seq} criado.` : "Nada a fechar (já existe lote final ou não há assinaturas).");
  } catch (e) { url.searchParams.set("msg", (e as Error).message); }
  return NextResponse.redirect(url, 303);
}
