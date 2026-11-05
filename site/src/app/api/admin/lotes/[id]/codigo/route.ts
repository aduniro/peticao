import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { requestApprovalCode } from "@/lib/batches";
import { rateLimit } from "@/lib/ratelimit";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  if (!rateLimit(`codigo:${params.id}`, 5, 15 * 60_000)) url.searchParams.set("msg", "Aguarde antes de pedir outro código.");
  else {
    try { await requestApprovalCode(Number(params.id)); url.searchParams.set("msg", "Código enviado ao aprovador."); }
    catch (e) { url.searchParams.set("msg", (e as Error).message); }
  }
  return NextResponse.redirect(url, 303);
}
