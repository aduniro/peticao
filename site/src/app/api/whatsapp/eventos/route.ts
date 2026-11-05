import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readSecret } from "@/lib/secrets";
import { whatsappAtivo } from "@/lib/whatsapp/provider";
import { atualizarStatusMensagem } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";
const MAPA: Record<string, "sent" | "delivered" | "read" | "failed"> = { "whatsapp.sent": "sent", "whatsapp.delivered": "delivered", "whatsapp.read": "read", "whatsapp.failed": "failed" };

/**
 * Webhook do MailerSend para whatsapp.sent/delivered/read/failed. Inerte (404) com o recurso desligado ou sem o segredo de assinatura
 * (MAILERSEND_WHATSAPP_WEBHOOK_SECRET); exige a assinatura HMAC-SHA256 do corpo no cabeçalho `Signature`.
 */
export async function POST(req: NextRequest) {
  const segredo = readSecret("MAILERSEND_WHATSAPP_WEBHOOK_SECRET", "mailersend-whatsapp-webhook");
  if (!whatsappAtivo() || !segredo) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 200_000) return new NextResponse("Too large", { status: 413 });
  const quer = createHmac("sha256", segredo).update(raw).digest("hex");
  const veio = req.headers.get("signature") ?? "";
  if (veio.length !== quer.length || !timingSafeEqual(Buffer.from(veio), Buffer.from(quer))) return new NextResponse("Unauthorized", { status: 401 });
  let j: any; try { j = JSON.parse(raw); } catch { return new NextResponse("Bad request", { status: 400 }); }
  const tipo = String(j?.type ?? ""); const status = MAPA[tipo];
  const id = String(j?.data?.message_id ?? j?.data?.id ?? "");
  if (status && id) await atualizarStatusMensagem(id, status, status === "failed" ? String(j?.data?.error ?? j?.data?.reason ?? "").slice(0, 200) : undefined);
  return NextResponse.json({ ok: true });
}
