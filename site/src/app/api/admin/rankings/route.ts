import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { parseFiltros } from "@/lib/assinaturas-filtros";
import { rankingApoiadores, rankingCampi, rankingExterior, rankingIfes } from "@/lib/rankings";
import { COLUNAS, paraCsv } from "@/lib/rankings-csv";

export const dynamic = "force-dynamic";

/**
 * Rankings (somente leitura, nível leitura). `?tipo=ifes|campi|apoiadores|exterior` e os mesmos filtros do explorador (`status`, `de`, `ate`, `uf`, `regiao`...).
 * `?ifes=SIGLA` restringe o ranking de campi a uma IFES. Sem CPF, e-mail ou nome de pessoas: só contagens.
 * `?formato=csv&lista=uf|cidade|pais|universidade` baixa a tabela em CSV (para `ifes` e `campi` a lista é a própria; em `apoiadores`/`exterior` escolha a lista).
 */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura", 120);
  if (bloqueio) return bloqueio;
  const sp = req.nextUrl.searchParams, f = parseFiltros(sp), tipo = sp.get("tipo") ?? "ifes";
  try {
    const csv = sp.get("formato") === "csv", lista = sp.get("lista") ?? "";
    const baixar = (nome: string, cols: string, linhas: object[]) => new Response(paraCsv(COLUNAS[cols], linhas as Record<string, unknown>[]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ranking-${nome}.csv"`, "cache-control": "no-store" } });
    if (tipo === "ifes") { const linhas = await rankingIfes(f); return csv ? baixar("ifes", "ifes", linhas) : NextResponse.json({ ok: true, tipo, linhas }); }
    if (tipo === "campi") { const linhas = await rankingCampi(f, (sp.get("ifes") ?? "").slice(0, 80) || undefined); return csv ? baixar("campi", "campi", linhas) : NextResponse.json({ ok: true, tipo, linhas }); }
    if (tipo === "apoiadores") { const r = await rankingApoiadores(f); return csv ? (lista === "cidade" ? baixar("apoiadores-cidade", "cidade", r.porCidade) : baixar("apoiadores-estado", "uf", r.porUf)) : NextResponse.json({ ok: true, tipo, ...r }); }
    if (tipo === "exterior") { const r = await rankingExterior(f); return csv ? (lista === "universidade" ? baixar("exterior-universidade", "universidade", r.porUniversidade) : baixar("exterior-pais", "pais", r.porPais)) : NextResponse.json({ ok: true, tipo, ...r }); }
    return NextResponse.json({ ok: false, erro: "tipo_invalido" }, { status: 400 });
  } catch { return NextResponse.json({ ok: false, erro: "Falha ao montar o ranking." }, { status: 500 }); }
}
