import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { aceitarSugestao, reenviarConfirmacao, type Resultado } from "@/lib/assinaturas-email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const MAX = 200;

/** Ação em lote sobre cadastros pendentes: { acao: "sugestoes" | "reenviar", ids: number[] } (até 200). Devolve o resultado de cada cadastro. */
export async function POST(req: NextRequest) {
  const bloqueio = exigirAdmin(req, 10); if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b?.ids) ? [...new Set<number>(b.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] : [];
  if (b?.acao !== "sugestoes" && b?.acao !== "reenviar") return NextResponse.json({ ok: false, erro: "Ação desconhecida." }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ ok: false, erro: "Nenhum cadastro selecionado." }, { status: 400 });
  if (ids.length > MAX) return NextResponse.json({ ok: false, erro: `Selecione no máximo ${MAX} por vez.` }, { status: 400 });
  const resultados: { id: number; r: Resultado }[] = [];
  for (const id of ids) resultados.push({ id, r: b.acao === "sugestoes" ? await aceitarSugestao(id) : await reenviarConfirmacao(id) });
  const ok = resultados.filter((x) => x.r.ok).length;
  return NextResponse.json({ ok: true, total: ids.length, aplicados: ok, falhas: ids.length - ok, resultados });
}
