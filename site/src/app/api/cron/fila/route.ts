import { NextRequest, NextResponse } from "next/server";
import { drainContactReplies } from "@/lib/contact-delivery";
import { drainMailOutbox } from "@/lib/mail";
import { outboxStats } from "@/lib/mail/outbox";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/security";
import { purgeExpiredCpfCache } from "@/lib/cpf-cache";

export const dynamic = "force-dynamic";

/** Agendador do servidor (a cada ~2 min): reenvia os e-mails da fila. Authorization: Bearer $CRON_SECRET. */
export async function POST(req: NextRequest) {
  const secret = config.cronSecret();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(got, secret)) return new NextResponse("Não autorizado", { status: 401 });
  const r = await drainMailOutbox(30);
  const contactReplies = await drainContactReplies(5);
  const cacheExpired = await purgeExpiredCpfCache().catch(() => null);
  return NextResponse.json({ ...r, stats: await outboxStats(), cpfCacheExpired: cacheExpired, contactReplies });
}
