import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { audit } from "@/lib/db";
import { entregasCsv } from "@/lib/mail/entregas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** CSV interno (nome, e-mail, dados cadastrais e situação do e-mail; sem CPF) para a ADUNIR contatar as pessoas. Não é a lista das autoridades. */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const q = req.nextUrl.searchParams;
  const filtros = { busca: q.get("busca") ?? "", situacao: q.get("situacao") ?? "", cadastro: q.get("cadastro") ?? "", categoria: q.get("categoria") ?? "", provedor: q.get("provedor") ?? "" };
  const { csv, total } = await entregasCsv(filtros);
  await audit("export_entregas", null, { linhas: total, filtros });
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="entregas-emails.csv"', "cache-control": "no-store" } });
}
