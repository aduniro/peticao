import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin";
import { encerrarSessao } from "@/lib/admin-users";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Encerra a sessão do painel (revoga no banco e apaga o cookie) e volta para a tela de acesso. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  await encerrarSessao(token).catch(() => {});
  const res = NextResponse.redirect(new URL("/admin?msg=saiu", requestOrigin(req.headers)), 303);
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
