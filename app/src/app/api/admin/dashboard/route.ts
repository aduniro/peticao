import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { facetas, parseFiltros, pontos, serieDiaria, totais } from "@/lib/assinaturas-explorar";
import { monitorSummary, sinceOf, type Window } from "@/lib/monitor";

export const dynamic = "force-dynamic";
const JANELAS = new Set(["1h", "24h", "7d", "30d", "all"]);

/** Dados do dashboard: KPIs, série por dia, rankings, estados (mapa coroplético), pontos de campi/cidades e funil de visitas. Mesmos filtros do explorador. */
export async function GET(req: NextRequest) {
  const bloqueio = exigirAdmin(req, 120);
  if (bloqueio) return bloqueio;
  const sp = req.nextUrl.searchParams;
  const f = parseFiltros(sp);
  const j = sp.get("janela") ?? "30d";
  const [t, fa, serie, pts, funil] = await Promise.all([totais(f), facetas(f), serieDiaria(f), pontos(f), monitorSummary(sinceOf((JANELAS.has(j) ? j : "30d") as Window))]);
  const rank = (k: string, n = 10) => (fa[k] ?? []).slice(0, n).map((x) => ({ nome: x.rotulo ?? x.v, valor: x.n }));
  return NextResponse.json({
    ok: true, totais: t, serie, funil,
    estados: (fa.uf ?? []).map((x) => ({ uf: x.v, n: x.n })),
    ranking: { instituicao: rank("instituicao"), campus: rank("campus"), cargo: rank("cargo"), cidade: rank("cidade"), pais: rank("pais"), universidade: rank("universidade") },
    pontos: pts.pontos.slice(0, 1200), semLocal: pts.semLocal,
  }, { headers: { "cache-control": "no-store" } });
}
