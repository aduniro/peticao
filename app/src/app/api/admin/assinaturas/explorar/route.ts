import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { explorar, linhas, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";

const csv = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };

/** Filtros combináveis (mapa, tabela, facetas e totais saem da mesma consulta). `?formato=csv` baixa o filtro atual (sem e-mail nem CPF). */
export async function GET(req: NextRequest) {
  const bloqueio = exigirAdmin(req, 240);
  if (bloqueio) return bloqueio;
  const sp = req.nextUrl.searchParams;
  const f = parseFiltros(sp);
  if (sp.get("formato") === "csv") {
    const r = await linhas(f, { pagina: 1, limite: 20000, ordem: sp.get("ordem") ?? "criada", dir: sp.get("dir") ?? "desc" });
    const cab = ["Nome", "Categoria", "Instituição", "Cargo", "Amazônia Legal/Fronteira", "Campus", "Cidade/UF", "País", "Status", "Criada em", "Confirmada em"];
    const corpo = r.linhas.map((l) => [l.nome, l.categoria, l.instituicao, l.cargo, l.regiao, l.campus, l.cidadeUf, l.pais, l.status, l.criada, l.confirmada ?? ""].map(csv).join(","));
    return new NextResponse("﻿" + [cab.map(csv).join(","), ...corpo].join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="assinaturas.csv"', "cache-control": "no-store" } });
  }
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const limite = Math.min(200, Math.max(10, Number(sp.get("limite")) || 50));
  const r = await explorar(f, { pagina, limite, ordem: sp.get("ordem") ?? "criada", dir: sp.get("dir") ?? "desc" });
  return NextResponse.json({ ok: true, ...r, pagina, limite }, { headers: { "cache-control": "no-store" } });
}
