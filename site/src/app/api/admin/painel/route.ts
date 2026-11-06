import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exigirNivel } from "@/lib/admin-api";
import { facetas, serieDiaria, totais } from "@/lib/assinaturas-explorar";
import { filtrosVazios } from "@/lib/assinaturas-filtros";
import { monitorSummary, sinceOf } from "@/lib/monitor";
import { config } from "@/lib/config";
import { juntarUfs, novoResumo, resumoPorUf } from "@/lib/rankings";
import { lerConfigPainel } from "@/lib/painel-config";

export const dynamic = "force-dynamic";

const NOMES_REG: Record<string, string> = { N: "Norte", NE: "Nordeste", SE: "Sudeste", S: "Sul", CO: "Centro-Oeste" };
let svg: { ufs: Record<string, { nome: string; reg: string }> } | null = null;
let cache: { em: number; p: Promise<unknown> } | null = null;

async function montar() {
  svg ??= JSON.parse(readFileSync(join(process.cwd(), "public", "data", "geo", "brasil-svg.json"), "utf8"));
  const v = filtrosVazios();
  const [conf, pend, serie, t, ext, extPend, funil, resumo] = await Promise.all([
    facetas({ ...v, status: ["confirmed"] }), facetas({ ...v, status: ["pending"] }), serieDiaria(v), totais(v),
    totais({ ...v, categoria: ["estrangeiro"], status: ["confirmed"] }), totais({ ...v, categoria: ["estrangeiro"], status: ["pending"] }),
    monitorSummary(sinceOf("24h")), resumoPorUf(10),
  ]);
  const c = new Map((conf.uf ?? []).map((x) => [x.v, x.n])), p = new Map((pend.uf ?? []).map((x) => [x.v, x.n]));
  const ufs = Object.entries(svg!.ufs).map(([uf, d]) => ({ uf, nome: d.nome, regiao: d.reg, conf: c.get(uf) ?? 0, pend: p.get(uf) ?? 0, total: (c.get(uf) ?? 0) + (p.get(uf) ?? 0), ...(resumo[uf] ?? novoResumo()) }));
  const regioes = Object.keys(NOMES_REG).map((id) => ({ id, nome: NOMES_REG[id], conf: ufs.filter((u) => u.regiao === id).reduce((a, u) => a + u.conf, 0), pend: ufs.filter((u) => u.regiao === id).reduce((a, u) => a + u.pend, 0), ...juntarUfs(ufs.filter((u) => u.regiao === id), 10) }));
  const dia = (d: string) => serie.find((x) => x.d === d);
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), ontem = new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 10);
  return {
    ok: true, geradoEm: new Date().toISOString(), meta: config.goal(), loteTamanho: config.batchSize(),
    totais: t, ufs, regioes, exterior: { conf: ext.confirmadas, pend: extPend.pendentes },
    hoje: { iniciadas: dia(hoje)?.iniciadas ?? 0, confirmadas: dia(hoje)?.confirmadas ?? 0 }, ontem: { iniciadas: dia(ontem)?.iniciadas ?? 0, confirmadas: dia(ontem)?.confirmadas ?? 0 },
    serie: serie.slice(-14), funil,
  };
}

/** Dados do painel ao vivo (somente leitura; mesmas funções do explorador). Cache de 15 s com uma única consulta em andamento. */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura", 240);
  if (bloqueio) return bloqueio;
  if (!cache || Date.now() - cache.em > 15_000) cache = { em: Date.now(), p: montar() };
  // A configuração é lida a cada pedido (fora do cache de 15 s): mudar na página de configurações vale na hora.
  try { return NextResponse.json({ ...(await cache.p as object), config: await lerConfigPainel() }, { headers: { "cache-control": "no-store" } }); }
  catch (e) { cache = null; return NextResponse.json({ ok: false, erro: "Falha ao montar o painel." }, { status: 500 }); }
}
