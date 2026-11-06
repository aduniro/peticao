import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { createBatch } from "@/lib/batches";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Fecha manualmente o lote final (acumulado). */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total");
  if (bloqueio) return bloqueio;
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  try {
    const b = await createBatch("final");
    url.searchParams.set("msg", b ? `Lote final ${b.seq} criado.` : "Nada a fechar (já existe lote final ou não há assinaturas).");
  } catch (e) { url.searchParams.set("msg", (e as Error).message); }
  return NextResponse.redirect(url, 303);
}
