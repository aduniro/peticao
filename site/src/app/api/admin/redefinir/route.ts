import { NextRequest, NextResponse } from "next/server";
import { redefinirSenha } from "@/lib/admin-users";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp, requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Define a nova senha a partir do link recebido por e-mail (uso único, 30 min; o convite de novo usuário vale 24 h). Derruba as sessões antigas. */
export async function POST(req: NextRequest) {
  const origem = requestOrigin(req.headers);
  const form = await req.formData();
  const token = String(form.get("token") ?? ""), senha = String(form.get("senha") ?? ""), senha2 = String(form.get("senha2") ?? "");
  const volta = (q: string) => NextResponse.redirect(new URL(`/admin/redefinir?token=${encodeURIComponent(token)}&${q}`, origem), 303);
  const o = req.headers.get("origin");
  if (o) { try { if (new URL(o).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return volta("erro=origem"); } catch { return volta("erro=origem"); } }
  if (!rateLimit(`admin-redefinir:${clientIp(req.headers)}`, 10, 15 * 60_000)) return volta("erro=limite");
  if (senha !== senha2) return volta("erro=diferentes");
  const r = await redefinirSenha(token, senha);
  if (r.ok) return NextResponse.redirect(new URL("/admin?msg=senha-redefinida", origem), 303);
  return volta(r.erro === "senha_fraca" ? `erro=fraca&d=${encodeURIComponent(r.detalhe ?? "")}` : "erro=token");
}
