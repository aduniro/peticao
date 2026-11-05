import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { corrigirEmail } from "@/lib/assinaturas-email";

export const dynamic = "force-dynamic";

/** Corrige o e-mail de um cadastro pendente. Corpo: { email }. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = exigirAdmin(req); if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  if (typeof b?.email !== "string") return NextResponse.json({ ok: false, erro: "Informe o e-mail." }, { status: 400 });
  const r = await corrigirEmail(Number(params.id), b.email);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
