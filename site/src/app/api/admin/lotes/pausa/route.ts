import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { setSetting, sendingEnabled } from "@/lib/batches";
import { audit } from "@/lib/db";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Botão de parar: alterna a pausa global de envios (ex.: PLV sancionado antes do prazo). */
export async function POST(req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const next = !(await sendingEnabled());
  await setSetting("sending_enabled", String(next));
  await audit("sending_toggled", null, { enabled: next });
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  url.searchParams.set("msg", next ? "Envios retomados." : "Envios PAUSADOS.");
  return NextResponse.redirect(url, 303);
}
