import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { audit } from "@/lib/db";
import { dispersionRows } from "@/lib/dispersion";
import { esc } from "@/lib/csv";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Base interna completa (INCLUI e-mail): nunca enviar às autoridades. A lista para as autoridades é /api/admin/export. */
export async function GET(_req: NextRequest) {
  if (!isAdmin()) return new NextResponse("Não autorizado", { status: 401 });
  const rows = await dispersionRows(50000);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  await audit("export_internal_base", null, { rows: rows.length });
  const head = ["id", "nome", "email", "categoria", "instituicao_declarada", "dominio_do_email", "instituicao_pelo_email", "selo_email", "verificacao_identidade", "situacao",
    "assinou_em_brasilia", "confirmou_em_brasilia", "origem", "codigo_de_origem", "quem_indicou", "geracao", "convidou", "convidou_e_confirmaram", "confirmou_no_mesmo_aparelho"];
  const lines = rows.map((r) => [
    r.id, r.name, r.email, r.category, r.institution, r.email_domain, r.email_institution, r.email_domain_kind, r.identity_method, r.status === "confirmed" ? "confirmada" : "aguardando confirmação",
    brasilia(r.consent_at), brasilia(r.confirmed_at), r.origin === "pessoal" ? "indicacao_pessoal" : r.origin, r.ref_code,
    r.origin === "pessoal" ? names.get(r.owner_id!) : r.org_label, r.generation, r.invited, r.invited_confirmed,
    r.confirm_same_visitor === null ? "" : r.confirm_same_visitor ? "sim" : "nao",
  ].map(esc).join(","));
  return new NextResponse("﻿" + [head.join(",")].concat(lines).join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="base-interna-assinaturas.csv"', "cache-control": "no-store" },
  });
}
