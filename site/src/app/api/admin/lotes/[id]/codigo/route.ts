import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { requestApprovalCode } from "@/lib/batches";
import { rateLimit } from "@/lib/ratelimit";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  if (!rateLimit(`codigo:${params.id}`, 5, 15 * 60_000)) url.searchParams.set("msg", "Aguarde antes de pedir outro código.");
  else {
    try { await requestApprovalCode(Number(params.id)); url.searchParams.set("msg", "Código enviado ao aprovador."); }
    catch (e) { url.searchParams.set("msg", (e as Error).message); }
  }
  return NextResponse.redirect(url, 303);
}
