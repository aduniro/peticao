import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { drainMailOutbox } from "@/lib/mail";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Reenvia agora os e-mails da fila (o agendador do servidor também faz isso a cada poucos minutos). */
export async function POST(req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const r = await drainMailOutbox(50);
  const url = new URL("/admin/emails", requestOrigin(req.headers));
  url.searchParams.set("msg", `Fila de e-mails: ${r.tried} tentado(s), ${r.sent} enviado(s), ${r.pending} ainda pendente(s).`);
  return NextResponse.redirect(url, 303);
}
