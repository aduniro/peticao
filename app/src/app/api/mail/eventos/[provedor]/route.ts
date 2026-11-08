import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { readSecret } from "@/lib/secrets";
import { safeEqual } from "@/lib/security";
import { brevoWebhookToEngaj, mailersendWebhookToEngaj, sendpulseWebhookToEngaj, sendpulseEmail, sendpulseTipo, storeEngagement } from "@/lib/mail/engajamento";
import { storeEvents, type MailEvent } from "@/lib/mail/events";

export const dynamic = "force-dynamic";

/**
 * Webhooks de rastreio (entrega, abertura, clique e devolução) da Brevo, do MailerSend e do SendPulse, em tempo real. Inerte (404) sem MAIL_WEBHOOK_SECRET.
 * Autenticação: segredo na URL (?s=…) e, no MailerSend, também a assinatura HMAC-SHA256 do corpo (cabeçalho Signature) se MAILERSEND_WEBHOOK_SIGNING_SECRET existir.
 */
export async function POST(req: NextRequest, { params }: { params: { provedor: string } }) {
  const seg = readSecret("MAIL_WEBHOOK_SECRET", "mail-webhook-secret");
  const prov = params.provedor;
  if (!seg || (prov !== "brevo" && prov !== "mailersend" && prov !== "sendpulse")) return new NextResponse("Not found", { status: 404 });
  if (!safeEqual(req.nextUrl.searchParams.get("s") ?? "", seg)) return new NextResponse("Unauthorized", { status: 401 });
  const raw = await req.text();
  if (raw.length > 200_000) return new NextResponse("Too large", { status: 413 });
  if (prov === "mailersend") {
    const ass = readSecret("MAILERSEND_WEBHOOK_SIGNING_SECRET", "mailersend-webhook-signing");
    if (ass && !safeEqual(req.headers.get("signature") ?? "", createHmac("sha256", ass).update(raw).digest("hex"))) return new NextResponse("Unauthorized", { status: 401 });
  }
  let j: any; try { j = JSON.parse(raw); } catch { return new NextResponse("Bad request", { status: 400 }); }
  const lista = Array.isArray(j) ? j : [j];
  let n = 0;
  for (const b of lista) {
    const eng = prov === "brevo" ? brevoWebhookToEngaj(b) : prov === "sendpulse" ? sendpulseWebhookToEngaj(b) : mailersendWebhookToEngaj(b);
    if (prov === "sendpulse" && !eng.length && !sendpulseTipo(b)) console.warn("webhook sendpulse sem evento reconhecido; campos:", Object.keys(b ?? {}).join(","));
    n += await storeEngagement(eng).catch(() => 0);
    const ev: MailEvent[] = []; const email = String(prov === "brevo" ? b?.email : prov === "sendpulse" ? sendpulseEmail(b) : b?.data?.email?.recipient?.email ?? "").toLowerCase();
    const tipo = String(prov === "brevo" ? b?.event : prov === "sendpulse" ? sendpulseTipo(b) : b?.type ?? "");
    const m: Record<string, MailEvent["type"]> = { hard_bounce: "hard_bounce", soft_bounce: "soft_bounce", blocked: "blocked", spam: "complaint", "activity.hard_bounced": "hard_bounce", "activity.soft_bounced": "soft_bounce", "activity.spam_complaint": "complaint", hard_bounced: "hard_bounce", soft_bounced: "soft_bounce" };
    if (email && m[tipo]) ev.push({ ts: new Date(b?.date ?? b?.data?.created_at ?? (typeof b?.timestamp === "number" ? (b.timestamp < 1e12 ? b.timestamp * 1000 : b.timestamp) : Date.now())).toISOString(), provider: prov, type: m[tipo], email, reason: String(b?.reason ?? b?.data?.morph?.reason ?? tipo).slice(0, 200), source: "webhook" });
    if (ev.length) await storeEvents(ev).catch(() => {});
  }
  return NextResponse.json({ ok: true, eventos: n });
}
