import { withSignupDiagnostics, recordSignupGate } from "@/lib/signup-diagnostics";
import { defaultProvider } from "@/lib/cpf-check";
import { NextRequest, NextResponse } from "next/server";
import { handleSign } from "@/lib/sign-flow";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`sign:${ip}`, 30, 10 * 60_000)) {
    await recordSignupGate(req.headers.get("x-sign-attempt"), "rate_limited", 429);
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    await recordSignupGate(req.headers.get("x-sign-attempt"), "invalid_json", 400);
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const r = await withSignupDiagnostics(req.headers.get("x-sign-attempt"), body, provider => handleSign(body, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    visitorId: req.cookies.get("vid")?.value,
    refCode: req.cookies.get("ref")?.value,
  }, provider), defaultProvider());
  return NextResponse.json(r.json, { status: r.status });
}
