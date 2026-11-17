import { NextRequest, NextResponse } from "next/server";
import { readSecret } from "@/lib/secrets";
import { safeEqual } from "@/lib/security";
import { brevoWebhookToEngaj, mailersendWebhookToEngaj, mailersendWebhookEmail, sendpulseWebhookToEngaj, sendpulseEmail, sendpulseTipo, storeEngagement } from "@/lib/mail/engajamento";
import { storeEvents, type MailEvent } from "@/lib/mail/events";
import { authenticateWebhook, mailersendTestPing, webhookBody, webhookConfig } from "@/lib/mail/webhook-auth";
import { webhookMessageEvents } from "@/lib/mail/webhook-message-events";
import { recordApiEvents } from "@/lib/mail/api-message-events";

export const dynamic = "force-dynamic";
const legacyTimestamp = (b: any) => {
  const d = new Date(b?.date ?? b?.data?.created_at ?? b?.created_at ?? (typeof b?.timestamp === "number" ? (b.timestamp < 1e12 ? b.timestamp * 1000 : b.timestamp) : Date.now()));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

/**
 * Webhooks de rastreio (entrega, abertura, clique e devolução) da Brevo, do MailerSend e do SendPulse, em tempo real. Inerte (404) sem MAIL_WEBHOOK_SECRET.
 * A URL mantém a guarda legada. Correlação individual requer escopo configurado + autenticação própria do provedor, verificada sobre o corpo original.
 */
export async function POST(req: NextRequest, { params }: { params: { provedor: string } }) {
  const seg = readSecret("MAIL_WEBHOOK_SECRET", "mail-webhook-secret");
  const prov = params.provedor;
  if (!seg || (prov !== "brevo" && prov !== "mailersend" && prov !== "sendpulse")) return new NextResponse("Not found", { status: 404 });
  if (!safeEqual(req.nextUrl.searchParams.get("s") ?? "", seg)) return new NextResponse("Unauthorized", { status: 401 });
  const body = await webhookBody(req);
  if (!body.ok) return new NextResponse(body.status === 413 ? "Too large" : "Bad request", {status:body.status});
  const raw=body.raw;
  let j: any; try { j = JSON.parse(raw); } catch { return new NextResponse("Bad request", { status: 400 }); }
  if (prov === "mailersend" && mailersendTestPing(j,raw,req.headers)) return NextResponse.json({ok:true,eventos:0});
  const auth=authenticateWebhook(prov,raw,req.headers,webhookConfig(prov),seg);
  if(auth.status!==200)return new NextResponse(auth.status===401?"Unauthorized":"Unavailable",{status:auth.status});
  const lista = Array.isArray(j) ? j : [j];
  if (lista.length > 500) return new NextResponse("Too large",{status:413});
  if (lista.some(b=>!b || typeof b!=="object" || Array.isArray(b))) return new NextResponse("Bad request",{status:400});
  let n = 0;
  for (const b of lista) {
    const rawEmail = prov === "brevo" ? b?.email : prov === "sendpulse" ? sendpulseEmail(b) : mailersendWebhookEmail(b);
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) continue;
    const eng = prov === "brevo" ? brevoWebhookToEngaj(b) : prov === "sendpulse" ? sendpulseWebhookToEngaj(b) : mailersendWebhookToEngaj(b);
    if (prov === "sendpulse" && !eng.length && !sendpulseTipo(b)) console.warn("webhook sendpulse sem evento reconhecido; campos:", Object.keys(b ?? {}).join(","));
    let legacyFailed = false;
    n += await storeEngagement(eng).catch(() => { legacyFailed = true; return 0; });
    const ev: MailEvent[] = [];
    const tipo = String(prov === "brevo" ? b?.event : prov === "sendpulse" ? sendpulseTipo(b) : b?.type ?? "");
    const m: Record<string, MailEvent["type"]> = { hard_bounce: "hard_bounce", soft_bounce: "soft_bounce", blocked: "blocked", spam: "complaint", "activity.hard_bounced": "hard_bounce", "activity.soft_bounced": "soft_bounce", "activity.spam_complaint": "complaint", spam_by_user: "complaint", hard_bounced: "hard_bounce", soft_bounced: "soft_bounce" };
    if (email && Object.prototype.hasOwnProperty.call(m,tipo)) ev.push({ ts: legacyTimestamp(b), provider: prov, type: m[tipo], email, reason: String(b?.reason ?? b?.data?.morph?.reason ?? tipo).slice(0, 200), source: "webhook" });
    if (ev.length) await storeEvents(ev).catch(() => { legacyFailed = true; });
    if (legacyFailed && auth.scope) return new NextResponse("Unavailable",{status:503});
    if (auth.scope) {
      try { await recordApiEvents(webhookMessageEvents(prov,b,auth.scope)); }
      catch { return new NextResponse("Unavailable",{status:503}); }
    }
  }
  return NextResponse.json({ ok: true, eventos: n });
}
