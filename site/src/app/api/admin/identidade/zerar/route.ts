import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { isValidCpf } from "@/lib/cpf";
import { resetIdentityAttempts } from "@/lib/identity";
import { audit } from "@/lib/db";
import { hmac } from "@/lib/security";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const cpf = String((await req.formData()).get("cpf") ?? "").replace(/\D/g, "");
  const url = new URL("/admin", requestOrigin(req.headers));
  if (!isValidCpf(cpf)) url.searchParams.set("msg", "CPF inválido.");
  else {
    const n = await resetIdentityAttempts(cpf);
    await audit("identity_attempts_reset", null, { cpfHash: hmac(cpf).slice(0, 12), removed: n });
    url.searchParams.set("msg", `Tentativas zeradas (${n} registro(s) removido(s)).`);
  }
  return NextResponse.redirect(url, 303);
}
