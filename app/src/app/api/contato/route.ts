import { NextRequest, NextResponse } from "next/server";
import { saveAndSendContact, validateContact } from "@/lib/contact";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

/** Página de contato: dúvidas e relatos de problemas. Antirrobô (honeypot + Turnstile se ativo) e limite por IP. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ errorCode: "generic" }, { status: 400 });
  if (typeof body.website === "string" && body.website) return NextResponse.json({ ok: true }); // honeypot: finge sucesso
  if (!rateLimit(`contato:${ip}`, 4, 60 * 60_000)) return NextResponse.json({ errorCode: "rate_limited" }, { status: 429 });
  if (turnstileEnabled() && !(await verifyTurnstile(body.turnstileToken, ip))) return NextResponse.json({ errorCode: "robot" }, { status: 400 });
  const v = validateContact(body);
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 422 });
  try {
    await saveAndSendContact(v.value, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("contato falhou", e);
    return NextResponse.json({ errorCode: "generic" }, { status: 500 });
  }
}
