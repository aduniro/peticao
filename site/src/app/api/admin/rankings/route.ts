import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { parseFiltros } from "@/lib/assinaturas-filtros";
import { rankingApoiadores, rankingCampi, rankingExterior, rankingIfes } from "@/lib/rankings";

export const dynamic = "force-dynamic";

/**
 * Rankings (somente leitura, nível leitura). `?tipo=ifes|campi|apoiadores|exterior` e os mesmos filtros do explorador (`status`, `de`, `ate`, `uf`, `regiao`...).
 * `?ifes=SIGLA` restringe o ranking de campi a uma IFES. Sem CPF, e-mail ou nome de pessoas: só contagens.
 */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura", 120);
  if (bloqueio) return bloqueio;
  const sp = req.nextUrl.searchParams, f = parseFiltros(sp), tipo = sp.get("tipo") ?? "ifes";
  try {
    if (tipo === "ifes") return NextResponse.json({ ok: true, tipo, linhas: await rankingIfes(f) });
    if (tipo === "campi") return NextResponse.json({ ok: true, tipo, linhas: await rankingCampi(f, (sp.get("ifes") ?? "").slice(0, 80) || undefined) });
    if (tipo === "apoiadores") return NextResponse.json({ ok: true, tipo, ...(await rankingApoiadores(f)) });
    if (tipo === "exterior") return NextResponse.json({ ok: true, tipo, ...(await rankingExterior(f)) });
    return NextResponse.json({ ok: false, erro: "tipo_invalido" }, { status: 400 });
  } catch { return NextResponse.json({ ok: false, erro: "Falha ao montar o ranking." }, { status: 500 }); }
}
