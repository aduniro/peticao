import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { approveAndSend } from "@/lib/batches";
import { config } from "@/lib/config";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData();
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  const r = await approveAndSend(Number(params.id), String(form.get("code") ?? ""), config.approverEmail(), actor);
  url.searchParams.set("msg", r.ok ? `Enviado a ${r.sent} destinatário(s)${r.failed ? `; ${r.failed} falha(s), tente novamente` : ""}.` : r.reason);
  return NextResponse.redirect(url, 303);
}
