import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { syncEngajamento } from "@/lib/mail/engajamento";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Atualizar engajamento": busca entregas, aberturas e cliques nos provedores (Brevo, MailerSend). Não altera cadastros. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return new NextResponse("Origem não permitida", { status: 403 }); } catch { return new NextResponse("Origem inválida", { status: 403 }); } }
  const f = await req.formData().catch(() => null);
  const dias = Math.min(90, Math.max(1, Number(f?.get("dias") ?? 30) || 30));
  const rep = await syncEngajamento(dias);
  await audit("mail_engajamento_sync", null, { dias, rep });
  const resumo = Object.entries(rep).map(([k, v]) => `${k}: ${v.ok ? `${v.eventos} eventos` : `erro (${v.erro})`}`).join(" · ") || "nenhum provedor configurado";
  return NextResponse.redirect(new URL(`/admin/emails?msg=${encodeURIComponent(`Engajamento atualizado (últimos ${dias} dias). ${resumo}`)}`, req.url), 303);
}
