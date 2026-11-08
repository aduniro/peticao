import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { syncMail } from "@/lib/mail/status";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** "Sincronizar agora": consulta todos os provedores (devoluções, saldos, respostas) sem esperar o agendador. `dias` (1 a 90) define até onde buscar. */
export async function POST(req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const f = await req.formData().catch(() => null);
  const dias = Math.min(90, Math.max(1, Number(f?.get("dias") ?? 3) || 3));
  const r = await syncMail(true, dias);
  await audit("mail_sync", null, { dias, report: r.report ?? null });
  const resumo = Object.entries(r.report ?? {}).map(([k, v]) => `${k}: ${v.ok ? `${v.eventos} eventos, ${v.novos} novos` : `erro (${v.erro})`}`).join(" · ");
  return NextResponse.redirect(new URL(`/admin/emails?msg=${encodeURIComponent(`Sincronizado (últimos ${dias} dias). ${resumo}`)}`, req.url), 303);
}
