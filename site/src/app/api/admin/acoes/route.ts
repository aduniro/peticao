import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { rodarAcao } from "@/lib/acoes";
import { conciliarPublicacao, historicoAcoes } from "@/lib/acoes/history";

export const dynamic = "force-dynamic";

/** Central de Ações: nível total + confirmação extra (senha e código por e-mail). Corpo: { acao, modo: "simular"|"executar"|"consultar", parametros?, confirmacao?, simulacao? }. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 30, { stepup: true });
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  const b = await req.json().catch(() => null);
  if (!s || !b || typeof b !== "object") return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  if (b.modo === "conciliar") {
    const result = await conciliarPublicacao(b.id, { userId: s.userId, email: s.email });
    return NextResponse.json(result, { status: result.ok ? 200 : result.erro === "nao_autorizado" ? 403 : result.erro === "parametros" ? 400 : result.erro === "nao_encontrado" ? 404 : 409 });
  }
  if (b.modo !== "simular" && b.modo !== "executar" && b.modo !== "consultar") return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  const r = await rodarAcao(b.acao, b.modo, b.parametros, b.confirmacao, { userId: s.userId, email: s.email }, { requireIntent: true, simulacao: b.simulacao });
  return NextResponse.json(r, { status: r.ok ? 200 : r.erro === "ocupado" ? 409 : r.erro === "falhou" ? 500 : r.erro === "indeterminado" ? 502 : 400 });
}


export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60, { stepup: true });
  if (bloqueio) return bloqueio;
  const params = req.nextUrl.searchParams;
  const before = params.has("antes") ? Number(params.get("antes")) : undefined;
  const limit = params.has("limite") ? Number(params.get("limite")) : 30;
  const result = await historicoAcoes(before, limit);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
