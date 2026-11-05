import { NextRequest, NextResponse } from "next/server";
import { confirmFull } from "@/lib/signatures";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { posConfirmacao } from "@/lib/pos-confirmacao";
import { whatsappAtivo } from "@/lib/whatsapp/provider";
import { pendentePorToken } from "@/lib/whatsapp/store";
import { identityMode, verifyIdentity, MAX_FAILED, type IdentityMethod } from "@/lib/identity";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import { hmac } from "@/lib/security";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Confirmação pelo link do WhatsApp. Além do token: o CPF (conferido contra o hash gravado) e a data de nascimento OU o nome da mãe (conferidos na
 * base de CPF). Nada disso é gravado. Estrangeiros não têm CPF: confirmam só pelo link. Fora do ar (recurso desligado) responde como link inválido.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!whatsappAtivo()) return NextResponse.json({ result: "invalid" });
  if (!rateLimit(`confirm-wa:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ result: "invalid" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const pend = await pendentePorToken(token);
  if (!pend) return NextResponse.json({ result: "invalid" });
  if (!rateLimit(`confirm-wa-tok:${pend.id}`, 12, 60 * 60_000)) return NextResponse.json({ result: "locked" }, { status: 429 });

  if (pend.category !== "estrangeiro") {
    const cpf = onlyDigits(String(body?.cpf ?? ""));
    if (!isValidCpf(cpf) || !pend.cpfHash || hmac(cpf) !== pend.cpfHash) return NextResponse.json({ result: "cpf_mismatch" });
    if (identityMode() === "required") {
      const method = body?.method as IdentityMethod;
      const r = await verifyIdentity({ cpf, method, value: String(body?.value ?? ""), declaredName: pend.name });
      if (!r.ok) {
        const status = r.reason === "locked" ? 429 : r.reason === "unavailable" ? 503 : 200;
        return NextResponse.json({ result: "identity", code: r.reason, attemptsLeft: r.reason === "mismatch" ? r.attemptsLeft ?? MAX_FAILED - 1 : undefined }, { status });
      }
    }
  }
  const r = await confirmFull(token, { visitorId: req.cookies.get("vid")?.value, ip }, "whatsapp");
  if (r.result !== "ok") return NextResponse.json({ result: r.result });
  await audit("whatsapp_confirmed", r.signatureId ?? null, {}).catch(() => {});
  await posConfirmacao(r, { ip, headers: req.headers, canal: "whatsapp" });
  return NextResponse.json({ result: "ok", panel: r.manageToken ? `/meu/${r.manageToken}` : null });
}
