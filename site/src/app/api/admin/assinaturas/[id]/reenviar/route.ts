import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { reenviarConfirmacao } from "@/lib/assinaturas-email";

export const dynamic = "force-dynamic";

/** Reenvia o e-mail de confirmação de um cadastro pendente. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "edicao", 60); if (bloqueio) return bloqueio;
  const r = await reenviarConfirmacao(Number(params.id));
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
