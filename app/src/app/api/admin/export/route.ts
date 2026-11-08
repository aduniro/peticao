import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { query, audit } from "@/lib/db";
import { brasilia } from "@/lib/time";
import { esc } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  // A lista destinada às autoridades NÃO inclui CPF nem e-mail.
  const { rows } = await query<Record<string, string>>(
    `SELECT name, category, role, institution, campus, city, uf, country, university, region_validated, region_criteria, confirmed_at
     FROM signatures WHERE status='confirmed' ORDER BY confirmed_at, id`
  );
  await audit("export_list", null, { rows: rows.length });
  const head = ["nome", "categoria", "cargo", "instituicao", "campus", "cidade", "uf", "pais", "universidade", "lotado_amazonia_fronteira", "criterio_regiao", "confirmado_em_brasilia"];
  const csv = [head.join(",")]
    .concat(rows.map((r) => [r.name, r.category, r.role, r.institution, r.campus, r.city, r.uf, r.country, r.university, r.region_validated ? "sim" : "", r.region_criteria, brasilia(r.confirmed_at)].map(esc).join(",")))
    .join("\n");
  return new NextResponse("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="assinaturas.csv"' },
  });
}
