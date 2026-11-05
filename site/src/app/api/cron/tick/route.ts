import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/batches";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/security";
import { syncMail } from "@/lib/mail/status";

export const dynamic = "force-dynamic";

/** Agendador externo (cron do servidor) chama a cada ~10 min: Authorization: Bearer $CRON_SECRET. */
export async function POST(req: NextRequest) {
  const secret = config.cronSecret();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(got, secret)) return new NextResponse("Não autorizado", { status: 401 });
  const t = await tick();
  const q = new URL(req.url).searchParams; // ?dias=30&forcar=1: traz o histórico dos provedores de uma vez (só com o segredo do agendador)
  const dias = Math.min(90, Math.max(1, Number(q.get("dias")) || 3));
  const sync = await syncMail(q.get("forcar") === "1", dias).catch((e) => ({ ran: false, erro: String(e).slice(0, 80) })); // devoluções, saldos e respostas dos provedores (no máximo a cada 10 min)
  return NextResponse.json({ ...t, emails: sync });
}
