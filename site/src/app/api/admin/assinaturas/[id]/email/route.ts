import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { corrigirEmail } from "@/lib/assinaturas-email";

export const dynamic = "force-dynamic";

/** Corrige o e-mail de um cadastro pendente. Corpo: { email, version } da linha apresentada ao editor. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "edicao"); if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b?.email !== "string") return NextResponse.json({ ok: false, erro: "Informe o e-mail." }, { status: 400 });
  if (typeof b.version !== "string" || !/^[1-9][0-9]{0,9}$/.test(b.version)) return NextResponse.json({ ok: false, erro: "Não foi possível salvar.", code: "conflict" }, { status: 409 });
  const r = await corrigirEmail(Number(params.id), b.email, { userId: actor.userId, email: actor.email }, b.version);
  return NextResponse.json(r, { status: r.ok ? 200 : r.code === "forbidden" ? 403 : r.code === "conflict" ? 409 : 422 });
}
