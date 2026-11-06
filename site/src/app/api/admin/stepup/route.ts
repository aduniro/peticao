import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { confirmarStepup, pedirStepup } from "@/lib/admin-users";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Confirmação extra do painel. `{ passo: "pedir" }` manda o código ao e-mail do usuário; `{ passo: "confirmar", senha, codigo }` libera a sessão por 15 minutos. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 30);
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  if (!s || !s.userId) return NextResponse.json({ ok: false, erro: "sem_conta" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (b?.passo === "pedir") {
    const r = await pedirStepup(s);
    return NextResponse.json(r, { status: r.ok ? 200 : 429 });
  }
  if (b?.passo === "confirmar") {
    if (!rateLimit(`stepup:${s.userId}`, 10, 15 * 60_000)) return NextResponse.json({ ok: false, erro: "muitas_tentativas" }, { status: 429 });
    const r = await confirmarStepup(s, String(b.senha ?? "").slice(0, 200), String(b.codigo ?? "").trim());
    return NextResponse.json(r.ok ? { ok: true } : r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
}
