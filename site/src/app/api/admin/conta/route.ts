import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { trocarMinhaSenha } from "@/lib/admin-users";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** O próprio usuário troca a senha (precisa da atual). Qualquer nível logado pode; a senha única de transição e a pré-visualização não têm conta para trocar. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura", 20);
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  const volta = (q: string) => NextResponse.redirect(new URL("/admin/conta?" + q, requestOrigin(req.headers)), 303);
  if (!s || !s.userId) return volta("erro=semconta");
  const f = await req.formData();
  const nova = String(f.get("nova") ?? "");
  if (nova !== String(f.get("nova2") ?? "")) return volta("erro=diferentes");
  const r = await trocarMinhaSenha(s.userId, String(f.get("atual") ?? ""), nova);
  if (r.ok) return volta("msg=ok");
  return volta(r.erro === "senha_fraca" ? `erro=fraca&d=${encodeURIComponent(r.detalhe ?? "")}` : "erro=atual");
}
