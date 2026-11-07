import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { rodarAcao } from "@/lib/acoes";

export const dynamic = "force-dynamic";

/** Central de Ações: nível total + confirmação extra (senha e código por e-mail). Corpo: { acao, modo: "simular"|"executar", parametros?, confirmacao? }. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 30, { stepup: true });
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  const b = await req.json().catch(() => null);
  if (!s || !b || typeof b !== "object") return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  if (b.modo !== "simular" && b.modo !== "executar") return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  const r = await rodarAcao(b.acao, b.modo, b.parametros, b.confirmacao, { userId: s.userId, email: s.email });
  return NextResponse.json(r, { status: r.ok ? 200 : r.erro === "ocupado" ? 409 : r.erro === "falhou" ? 500 : r.erro === "indeterminado" ? 502 : 400 });
}
