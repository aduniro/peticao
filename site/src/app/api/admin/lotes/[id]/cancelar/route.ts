import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { cancelBatch } from "@/lib/batches";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const ok = await cancelBatch(Number(params.id));
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  url.searchParams.set("msg", ok ? "Lote cancelado." : "Não foi possível cancelar.");
  return NextResponse.redirect(url, 303);
}
