import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { createLabelReferrer } from "@/lib/referrals";
import { audit } from "@/lib/db";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const f = await req.formData();
  const label = String(f.get("label") ?? "").trim();
  const url = new URL("/admin/indicacoes", requestOrigin(req.headers));
  if (label.length < 2) url.searchParams.set("msg", "Informe um nome para o código (ex.: Sindicato X).");
  else {
    const r = await createLabelReferrer(label);
    await audit("referrer_created", null, { code: r.code, label });
    url.searchParams.set("msg", `Código criado: ${r.code}`);
  }
  return NextResponse.redirect(url, 303);
}
