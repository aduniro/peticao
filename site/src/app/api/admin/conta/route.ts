import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { trocarMinhaSenha } from "@/lib/admin-users";
import { requestOrigin } from "@/lib/net";
import { ADMIN_COOKIE } from "@/lib/admin";

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
  if (r.ok) {
    // trocarMinhaSenha commits before reporting success and revokes all old sessions.
    const res = NextResponse.redirect(new URL("/admin?msg=senha-alterada", requestOrigin(req.headers)), 303);
    res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return res;
  }
  return volta(r.erro === "senha_fraca" ? `erro=fraca&d=${encodeURIComponent(r.detalhe ?? "")}` : "erro=atual");
}
