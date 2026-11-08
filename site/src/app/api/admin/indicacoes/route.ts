import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { createAdministrativeReferrer } from "@/lib/admin-referrals";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const f = await req.formData();
  const label = String(f.get("label") ?? "").trim();
  const url = new URL("/admin/indicacoes", requestOrigin(req.headers));
  if (label.length < 2) url.searchParams.set("msg", "Informe um nome para o código (ex.: Sindicato X).");
  else {
    const requestId = String(f.get("requestId") ?? "");
    const r = await createAdministrativeReferrer(label, actor, { requestId });
    if (!r.ok) {
      if (r.error === "request" || r.error === "conflict") return new NextResponse(null, { status: r.error === "request" ? 400 : 409 });
      return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 403 });
    }
    url.searchParams.set("msg", `Código criado: ${r.code}`);
    url.searchParams.set("completedRequestId", requestId);
  }
  return NextResponse.redirect(url, 303);
}
